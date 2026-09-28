use crate::{AppService, dto::*};
use baton_core::{CoreError, QueryKind, State};
use std::sync::Arc;
pub trait OutputSink: Send + Sync {
    fn frame(&self, frame: FrameDto) -> Result<(), AppError>;
}
impl AppService {
    pub fn start_output(
        self: &Arc<Self>,
        binding: Binding,
        sink: Arc<dyn OutputSink>,
    ) -> Result<(), AppError> {
        let handle = self.handle(binding)?;
        let mut state = self.state.lock().unwrap();
        let entry = state
            .entries
            .get_mut(&binding.session)
            .ok_or_else(|| AppError::new("unknown_session"))?;
        if entry.output_started {
            return Err(AppError::new("output_already_started"));
        }
        entry.output_started = true;
        let ready = entry.output_ready.clone();
        let weak = Arc::downgrade(self);
        // Register before examining the queue so the last receive cannot be lost.
        let mut changes = handle.subscribe();
        entry.tasks.push(tokio::spawn(async move {
            loop {
                if changes.borrow_and_update().state == State::Closed {
                    return;
                }
                loop {
                    match handle.next_ui_frame(binding.core()).await {
                        Ok(Some(frame)) => {
                            let dto = FrameDto {
                                binding,
                                seq: frame.seq,
                                bytes: frame.bytes,
                                queries: frame
                                    .queries
                                    .into_iter()
                                    .map(|q| QueryDto {
                                        id: q.id.0,
                                        epoch: q.epoch,
                                        end_offset: q.end_offset,
                                        kind: match q.kind {
                                            QueryKind::Dsr => "dsr",
                                            QueryKind::Cpr => "cpr",
                                            QueryKind::Da => "da",
                                        }
                                        .into(),
                                    })
                                    .collect(),
                            };
                            if sink.frame(dto).is_err() {
                                if let Some(app) = weak.upgrade() {
                                    app.frontend_lost();
                                }
                                return;
                            }
                        }
                        Ok(None) => break,
                        Err(CoreError::SessionClosed) => return,
                        Err(_) => {
                            if let Some(app) = weak.upgrade() {
                                app.frontend_lost();
                            }
                            return;
                        }
                    }
                }
                tokio::select! {
                    changed = changes.changed() => { if changed.is_err() { return; } },
                    _ = ready.notified() => {},
                }
            }
        }));
        Ok(())
    }
}
