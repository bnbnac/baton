use super::*;
use std::future::{pending, poll_fn};
use std::task::Poll;
type WriteFuture = IoFuture<'static, (Box<dyn Transport>, WriteResult)>;
struct Cancellation {
    principal: Principal,
    epoch: SafeInt,
    flag: Arc<AtomicBool>,
}

struct DriverGuard {
    shared: Arc<Shared>,
    link: Arc<Link>,
}
impl Drop for DriverGuard {
    fn drop(&mut self) {
        let mut r = lock(&self.shared.registry);
        if let Ok(s) = r.session_mut(self.link.id) {
            if s.snapshot().state != State::Closed {
                s.close(CloseReason::TransportLost);
            }
            self.link.publish(s);
        }
        self.link.finished.store(true, Ordering::Release);
    }
}

pub(super) fn run(
    shared: Arc<Shared>,
    link: Arc<Link>,
    transport: Box<dyn Transport>,
    mut commands: mpsc::Receiver<Submit>,
    mut incoming: mpsc::Receiver<Receive>,
) -> impl Future<Output = ()> + Send {
    // Construct before spawning: abort-before-first-poll must also retire the driver.
    let guard = DriverGuard {
        shared: shared.clone(),
        link: link.clone(),
    };
    async move {
        let _guard = guard;
        let mut transport = Some(transport);
        let mut active: Option<(SafeInt, WriteFuture)> = None;
        let mut cancellations: BTreeMap<RequestId, Cancellation> = BTreeMap::new();
        loop {
            // Polling once under the same gate as reclaim is the delivery start boundary.
            // No lock is held across a pending await.
            poll_fn(|cx| {
                let mut r = lock(&shared.registry);
                let s = r.session_mut(link.id).unwrap();
                let before = s.snapshot();
                s.tick(shared.origin.elapsed());
                cancellations.retain(|id, cancel| {
                    if cancel.flag.load(Ordering::Acquire) {
                        let _ = s.cancel_input(cancel.principal, cancel.epoch, *id);
                        return false;
                    }
                    matches!(
                        s.input_result(cancel.principal, cancel.epoch, *id),
                        Ok(InputResult::Pending)
                    )
                });
                let mut started = false;
                if active.is_none() {
                    let request = s.next_input();
                    if let Some(op) = s.start_write() {
                        if let Some(id) = request {
                            cancellations.remove(&id);
                        }
                        let id = op.id;
                        let mut writer = transport.take().unwrap();
                        let mut future: WriteFuture = Box::pin(async move {
                            let result = writer.write(&op.payload).await;
                            (writer, result)
                        });
                        match future.as_mut().poll(cx) {
                            Poll::Ready((writer, result)) => {
                                transport = Some(writer);
                                let _ = s.finish_write(id, result);
                            }
                            Poll::Pending => active = Some((id, future)),
                        }
                        started = true;
                    }
                }
                if before != s.snapshot() || started {
                    link.publish(s);
                }
                Poll::Ready(())
            })
            .await;
            let (snapshot, reason, transition) = {
                let r = lock(&shared.registry);
                let s = r.session(link.id).unwrap();
                (s.snapshot(), s.close_reason(), s.transition_deadline())
            };
            if snapshot.state == State::Closed {
                commands.close();
                incoming.close();
                // Complete pending callers with a closed error; never process them as input.
                while let Ok(message) = commands.try_recv() {
                    let _ = message.reply.send(Err(CoreError::SessionClosed));
                }
                while let Ok(message) = incoming.try_recv() {
                    let _ = message.reply.send(Err(CoreError::SessionClosed));
                }
                let deadline = if reason == Some(CloseReason::TransitionTimeout) {
                    Instant::now()
                } else {
                    lock(&link.close_deadline)
                        .unwrap_or_else(|| Instant::now() + limits::TRANSITION_TIMEOUT)
                };
                if let Some((_, future)) = active.take() {
                    if let Ok((writer, _)) = tokio::time::timeout_at(deadline, future).await {
                        transport = Some(writer);
                    }
                }
                if let Some(mut writer) = transport.take() {
                    let _ = tokio::time::timeout_at(deadline, writer.close()).await;
                }
                break;
            }
            let has_active = active.is_some();
            let deadline = transition.map(|duration| shared.origin + duration);
            tokio::select! {
                biased;
                _=link.wake.notified()=>{},
                _=async {
                    if let Some(end)=deadline { tokio::time::sleep_until(end).await; }
                    else { pending::<()>().await; }
                }=>{},
                (writer,result)=async {
                    match active.as_mut() {
                        Some((_,future))=>future.await,
                        None=>pending().await,
                    }
                },if has_active=>{
                    let id=active.take().unwrap().0; transport=Some(writer);
                    let mut r=lock(&shared.registry); let s=r.session_mut(link.id).unwrap();
                    s.tick(shared.origin.elapsed());
                    let _=s.finish_write(id,result); link.publish(s);
                },
                Some(message)=incoming.recv()=>{
                    let mut r=lock(&shared.registry); let s=r.session_mut(link.id).unwrap();
                    s.tick(shared.origin.elapsed());
                    let result=s.receive_scoped(&message.bytes,message.scope); link.publish(s);
                    let _=message.reply.send(result);
                },
                Some(message)=commands.recv()=>{
                    if message.reply.is_closed() || message.cancelled.load(Ordering::Acquire) { continue; }
                    let mut r=lock(&shared.registry);
                    let connected=match message.call.principal {
                        Principal::User=>true,Principal::Agent(c)=>r.has_connection(c),
                    };
                    let s=r.session_mut(link.id).unwrap(); s.tick(shared.origin.elapsed());
                    let principal=message.call.principal; let epoch=message.call.epoch; let id=message.call.request_id;
                    let new=s.input_result(principal,epoch,id)==Err(CoreError::UnknownId);
                    let result=if connected { s.submit(message.call) } else { Err(CoreError::NotOwner) };
                    if new && result==Ok(InputResult::Pending) {
                        cancellations.insert(id,Cancellation { principal,epoch,flag:message.cancelled });
                    }
                    let _=message.reply.send(result);
                },
            }
        }
    }
}
