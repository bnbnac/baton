use crate::*;
use baton_core::SafeInt;
use endpoint::EndpointLease;
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    net::windows::named_pipe::NamedPipeServer,
    sync::{OwnedSemaphorePermit, Semaphore, mpsc},
    task::{JoinHandle, JoinSet},
};
pub struct LocalServer {
    cancel: CancellationToken,
    task: Mutex<Option<JoinHandle<()>>>,
}
impl Drop for LocalServer {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
impl LocalServer {
    pub async fn start(
        dir: &Path,
        app: WireId,
        backend: Arc<dyn AgentBackend>,
    ) -> Result<Self, WireError> {
        let mut endpoint = EndpointLease::publish(dir, app)?;
        let mut next = endpoint
            .take_first_pipe()
            .ok_or(WireError::new(ErrorCode::Disconnected))?;
        let cancel = CancellationToken::new();
        let stopping = cancel.clone();
        let slots = Arc::new(Semaphore::new(32));
        let task = tokio::spawn(async move {
            let mut tasks = JoinSet::new();
            loop {
                tokio::select! {biased;
                    _=stopping.cancelled()=>break,
                    _=tasks.join_next(),if !tasks.is_empty()=>{},
                    result=next.connect()=>{
                        if result.is_err(){break;}
                        let replacement=match endpoint.next_pipe(){Ok(p)=>p,Err(_)=>break};let pipe=std::mem::replace(&mut next,replacement);
                        if let Ok(permit)=slots.clone().try_acquire_owned(){tasks.spawn(serve(pipe,endpoint.discovery().clone(),backend.clone(),stopping.child_token(),permit));}
                        // Excess clients are disconnected without allocating a handshake task.
                    }
                }
            }
            stopping.cancel();
            drop(next);
            while tasks.join_next().await.is_some() {}
            drop(endpoint);
        });
        Ok(Self {
            cancel,
            task: Mutex::new(Some(task)),
        })
    }
    pub async fn shutdown(&self) {
        self.cancel.cancel();
        let task = self.task.lock().unwrap().take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }
}
struct Response {
    id: SafeInt,
    request: Option<AgentRequest>,
    result: Result<AgentResponse, WireError>,
    _slot: Option<OwnedSemaphorePermit>,
    _read: Option<OwnedSemaphorePermit>,
}
async fn serve(
    mut pipe: NamedPipeServer,
    discovery: endpoint::Discovery,
    backend: Arc<dyn AgentBackend>,
    cancel: CancellationToken,
    _connection_slot: OwnedSemaphorePermit,
) {
    let context = tokio::select! {biased;_=cancel.cancelled()=>return,result=tokio::time::timeout(Duration::from_secs(3),async{
        match read_frame(&mut pipe).await? {
            Frame::Hello{contract_version,app_instance_id,secret}=>discovery.verify(contract_version,app_instance_id,&secret)?,
            _=>return Err(WireError::new(ErrorCode::AuthenticationFailed)),
        }
        Ok(ConnectionContext{app:discovery.app_instance_id,connection:fresh_id()?})
    })=>match result {Ok(Ok(ctx))=>ctx,other=>{let error=match other{Ok(Err(e))=>e,_=>WireError::new(ErrorCode::AuthenticationFailed)};let _=tokio::time::timeout(Duration::from_secs(3),write_frame(&mut pipe,&Frame::Rejected{error})).await;return;}}};
    if let Err(error) = backend.connected(context).await {
        let _ = tokio::time::timeout(
            Duration::from_secs(3),
            write_frame(&mut pipe, &Frame::Rejected { error }),
        )
        .await;
        return;
    }
    let welcome = Frame::Welcome {
        contract_version: 2,
        app_instance_id: context.app,
        connection_id: context.connection,
    };
    let result = tokio::select! {biased;_=cancel.cancelled()=>Err(WireError::new(ErrorCode::Disconnected)),result=tokio::time::timeout(Duration::from_secs(3),write_frame(&mut pipe,&welcome))=>result.unwrap_or(Err(WireError::new(ErrorCode::Disconnected)))};
    if result.is_ok() {
        session(pipe, context, backend.clone(), cancel).await;
    }
    backend.disconnected(context).await;
}
async fn session(
    pipe: NamedPipeServer,
    context: ConnectionContext,
    backend: Arc<dyn AgentBackend>,
    cancel: CancellationToken,
) {
    let (mut reader, mut writer) = tokio::io::split(pipe);
    let (tx, mut rx) = mpsc::channel::<Response>(16);
    let writer_cancel = cancel.clone();
    let writer_backend = backend.clone();
    let writer_task = tokio::spawn(async move {
        loop {
            tokio::select! {biased;_=writer_cancel.cancelled()=>break,response=rx.recv()=>{
                let Some(mut response)=response else{break};
                if let Some(request)=&response.request{writer_backend.commit_response(context,request,&mut response.result);}
                let frame=match response.result{Ok(value)=>Frame::success(response.id,value),Err(error)=>Frame::failure(response.id,error)};
                let result=tokio::select!{biased;_=writer_cancel.cancelled()=>break,result=tokio::time::timeout(Duration::from_secs(3),write_frame(&mut writer,&frame))=>result};
                if !matches!(result,Ok(Ok(()))){break;}
            }}
        }
        writer_cancel.cancel();
    });
    let slots = Arc::new(Semaphore::new(16));
    let reads = Arc::new(Semaphore::new(8));
    let mut running = JoinSet::new();
    let mut pending = BTreeMap::<SafeInt, CancellationToken>::new();
    let mut last = None;
    'connection: loop {
        // read_frame owns partially consumed bytes. Keep the same future alive
        // when a dispatch completes; recreating it would lose the frame prefix.
        let frame = {
            let next_frame = read_frame(&mut reader);
            tokio::pin!(next_frame);
            loop {
                tokio::select! {biased;
                    _=cancel.cancelled()=>break 'connection,
                    done=running.join_next(),if !running.is_empty()=>{match done{Some(Ok(id))=>{pending.remove(&id);},_=>break 'connection}},
                    frame=&mut next_frame=>break frame,
                }
            }
        };
        match frame {
            Ok(Frame::Cancel { id }) => {
                if let Some(token) = pending.get(&id) {
                    token.cancel();
                }
            }
            Ok(Frame::Request { id, body }) => {
                if last.is_some_and(|old| id <= old) {
                    break;
                }
                last = Some(id);
                let slot = slots.clone().try_acquire_owned();
                let read = if matches!(&body,AgentRequest::ReadOutput{wait_ms,..} if *wait_ms>0) {
                    reads.clone().try_acquire_owned().map(Some)
                } else {
                    Ok(None)
                };
                let error = if slot.is_err() {
                    Some(ErrorCode::RequestLimit)
                } else if read.is_err() {
                    Some(ErrorCode::ReadLimit)
                } else {
                    None
                };
                if let Some(code) = error {
                    if tx
                        .try_send(Response {
                            id,
                            request: None,
                            result: Err(WireError::new(code)),
                            _slot: None,
                            _read: None,
                        })
                        .is_err()
                    {
                        break;
                    }
                    continue;
                }
                let permit = slot.unwrap();
                let read = read.unwrap();
                let token = cancel.child_token();
                pending.insert(id, token.clone());
                let backend = backend.clone();
                let tx = tx.clone();
                let connection_cancel = cancel.clone();
                running.spawn(async move {
                    let result = backend.dispatch(context, body.clone(), token).await;
                    if tx
                        .try_send(Response {
                            id,
                            request: Some(body),
                            result,
                            _slot: Some(permit),
                            _read: read,
                        })
                        .is_err()
                    {
                        connection_cancel.cancel();
                    }
                    id
                });
            }
            _ => break,
        }
    }
    cancel.cancel();
    for (_, token) in pending {
        token.cancel();
    }
    // Production dispatch cancels queued input before finishing. Bound arbitrary
    // backend cleanup, then disconnect the authenticated principal exactly once.
    if tokio::time::timeout(Duration::from_secs(3), async {
        while running.join_next().await.is_some() {}
    })
    .await
    .is_err()
    {
        running.abort_all();
        while running.join_next().await.is_some() {}
    }
    let _ = writer_task.await;
}
