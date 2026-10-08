use crate::*;
use baton_core::SafeInt;
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    net::windows::named_pipe::ClientOptions,
    sync::{Semaphore, mpsc, oneshot},
};
type Reply = Result<AgentResponse, WireError>;
struct Inner {
    out: mpsc::Sender<Frame>,
    pending: Mutex<BTreeMap<SafeInt, oneshot::Sender<Reply>>>,
    cancel: CancellationToken,
    next: AtomicU64,
    slots: Arc<Semaphore>,
}
pub struct LocalClient {
    inner: Arc<Inner>,
    context: ConnectionContext,
}
impl Drop for LocalClient {
    fn drop(&mut self) {
        self.inner.cancel.cancel();
    }
}
struct CallGuard {
    inner: Arc<Inner>,
    id: SafeInt,
    armed: bool,
}
impl Drop for CallGuard {
    fn drop(&mut self) {
        self.inner.pending.lock().unwrap().remove(&self.id);
        if self.armed
            && self
                .inner
                .out
                .try_send(Frame::Cancel { id: self.id })
                .is_err()
        {
            self.inner.cancel.cancel();
        }
    }
}
impl LocalClient {
    pub fn context(&self) -> ConnectionContext {
        self.context
    }
    pub fn is_connected(&self) -> bool {
        !self.inner.cancel.is_cancelled()
    }
    pub fn close(&self) {
        self.inner.cancel.cancel();
    }
    pub async fn disconnected(&self) {
        self.inner.cancel.cancelled().await;
    }
    pub async fn connect(dir: &Path) -> Result<Self, WireError> {
        let result=tokio::time::timeout(Duration::from_secs(3),async{
            let discovery=endpoint::load_endpoint(dir)?;
            let mut pipe=ClientOptions::new().open(&discovery.pipe_name).map_err(|_|WireError::new(ErrorCode::AppOffline))?;
            write_frame(&mut pipe,&Frame::Hello{contract_version:2,app_instance_id:discovery.app_instance_id,secret:discovery.secret.clone()}).await?;
            let context=match read_frame(&mut pipe).await? {
                Frame::Welcome{contract_version:2,app_instance_id,connection_id} if app_instance_id==discovery.app_instance_id=>ConnectionContext{app:app_instance_id,connection:connection_id},
                Frame::Rejected{error}=>return Err(error),
                _=>return Err(WireError::new(ErrorCode::ProtocolMismatch)),
            };
            let(mut read,mut write)=tokio::io::split(pipe);let(out,mut rx)=mpsc::channel(16);
            let inner=Arc::new(Inner{out,pending:Mutex::new(BTreeMap::new()),cancel:CancellationToken::new(),next:AtomicU64::new(0),slots:Arc::new(Semaphore::new(16))});
            let writer=inner.clone();tokio::spawn(async move{
                loop {tokio::select!{biased;_=writer.cancel.cancelled()=>break, frame=rx.recv()=>{
                    let Some(frame)=frame else{break};
                    let sent=tokio::select!{biased;_=writer.cancel.cancelled()=>break,result=tokio::time::timeout(Duration::from_secs(3),write_frame(&mut write,&frame))=>result};
                    if !matches!(sent,Ok(Ok(()))){break;}
                }}}
                writer.cancel.cancel();
            });
            let reader=inner.clone();tokio::spawn(async move{
                loop {
                    let frame=tokio::select!{biased;_=reader.cancel.cancelled()=>break,result=read_frame(&mut read)=>result};
                    match frame {
                        Ok(Frame::Response{id,result,error})=>{
                            if id.get()>=reader.next.load(Ordering::Acquire){break;}
                            if let Some(reply)=reader.pending.lock().unwrap().remove(&id){let _=reply.send(match(result,error){(Some(value),None)=>Ok(value),(None,Some(e))=>Err(e),_=>Err(WireError::new(ErrorCode::InvalidFrame))});}
                        },_=>break,
                    }
                }
                reader.cancel.cancel();let pending=std::mem::take(&mut *reader.pending.lock().unwrap());for(_,reply)in pending{let _=reply.send(Err(WireError::new(ErrorCode::Disconnected)));}
            });
            Ok(Self{inner,context})
        }).await;
        result.map_err(|_| WireError::new(ErrorCode::AppOffline))?
    }
    pub async fn call(&self, request: AgentRequest, cancel: CancellationToken) -> Reply {
        request.validate()?;
        if self.inner.cancel.is_cancelled() {
            return Err(WireError::new(ErrorCode::AppOffline));
        }
        if cancel.is_cancelled() {
            return Err(WireError::new(ErrorCode::Cancelled));
        }
        let _permit = self
            .inner
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| WireError::new(ErrorCode::RequestLimit))?;
        // Allocation and enqueue share one gate, so concurrent callers cannot
        // enqueue request N+1 before N (the server rejects replayed IDs).
        let (id, rx) = {
            let mut pending = self.inner.pending.lock().unwrap();
            let n = self
                .inner
                .next
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                    if n < SafeInt::MAX { Some(n + 1) } else { None }
                })
                .map_err(|_| WireError::new(ErrorCode::CounterExhausted))?;
            let id = SafeInt::new(n).map_err(WireError::from)?;
            let (tx, rx) = oneshot::channel();
            pending.insert(id, tx);
            if self
                .inner
                .out
                .try_send(Frame::Request { id, body: request })
                .is_err()
            {
                pending.remove(&id);
                self.inner.cancel.cancel();
                return Err(WireError::new(ErrorCode::Disconnected));
            }
            (id, rx)
        };
        let mut guard = CallGuard {
            inner: self.inner.clone(),
            id,
            armed: true,
        };
        tokio::select! {biased;
            _=cancel.cancelled()=>Err(WireError::new(ErrorCode::Cancelled)),
            _=self.inner.cancel.cancelled()=>Err(WireError::new(ErrorCode::Disconnected)),
            result=rx=>{guard.armed=false;result.unwrap_or(Err(WireError::new(ErrorCode::Disconnected)))}
        }
    }
}
