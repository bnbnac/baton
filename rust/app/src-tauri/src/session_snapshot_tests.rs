use crate::{dto::*, *};
use baton_core::IoFuture;
use baton_ssh::{AuthUi, CancellationToken, ConnectRequest, SshError};
use serde_json::Value;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::Duration;

struct Pending;
impl Connector for Pending {
    fn connect(
        &self,
        _: ConnectRequest,
        _: Arc<dyn AuthUi>,
        cancel: CancellationToken,
    ) -> IoFuture<'_, Result<Box<dyn ReadyConnection>, SshError>> {
        Box::pin(async move {
            cancel.cancelled().await;
            Err(SshError::Cancelled)
        })
    }
}
struct DelayedSink {
    armed: AtomicBool,
    entered: mpsc::Sender<()>,
    release: Mutex<mpsc::Receiver<()>>,
    events: Mutex<Vec<Value>>,
}
impl EventSink for DelayedSink {
    fn emit(&self, event: UiEvent) -> Result<(), AppError> {
        if matches!(event, UiEvent::Sessions { .. }) && self.armed.swap(false, Ordering::SeqCst) {
            self.entered.send(()).unwrap();
            self.release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        self.events
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap());
        Ok(())
    }
}
fn request(label: &str) -> ConnectionRequest {
    ConnectionRequest {
        host: "example.test".into(),
        port: 22,
        username: "user".into(),
        label: label.into(),
        method: Method::Password,
    }
}

#[tokio::test]
async fn delayed_publication_keeps_its_older_revision_after_another_session_closes() {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let sink = Arc::new(DelayedSink {
        armed: AtomicBool::new(false),
        entered: entered_tx,
        release: Mutex::new(release_rx),
        events: Mutex::new(vec![]),
    });
    let app = AppService::with_connector(Arc::new(Pending), sink.clone());
    app.connect(request("A")).unwrap();
    let b = app.connect(request("B")).unwrap().id;
    let initial_before = serde_json::to_value(app.session_snapshot().unwrap()).unwrap();
    sink.events.lock().unwrap().clear();
    sink.armed.store(true, Ordering::SeqCst);
    let old_app = app.clone();
    let old = std::thread::spawn(move || old_app.publish());
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    // The old full list is now held at the sink boundary, before delivery.
    app.close(b).unwrap();
    let initial_after = serde_json::to_value(app.session_snapshot().unwrap()).unwrap();
    release_tx.send(()).unwrap();
    old.join().unwrap();
    let events = sink.events.lock().unwrap().clone();
    app.shutdown().await;
    assert_eq!(events.len(), 2);
    let state = |event: &Value| {
        event["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["label"] == "B")
            .unwrap()["state"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(state(&events[0]), "closed");
    assert_eq!(state(&events[1]), "connecting");
    assert_eq!(state(&initial_before), "connecting");
    assert_eq!(state(&initial_after), "closed");
    let newer = events[0]["revision"]
        .as_u64()
        .expect("newer snapshot must identify its capture order");
    let older = events[1]["revision"]
        .as_u64()
        .expect("delayed snapshot must retain its capture order");
    assert!(
        older < newer,
        "arrival order must not assign revisions: {events:?}"
    );
    assert!(initial_before["revision"].as_u64().unwrap() < older);
    assert!(newer < initial_after["revision"].as_u64().unwrap());
}

#[tokio::test]
async fn revision_exhaustion_closes_sessions_instead_of_wrapping_the_ui_clock() {
    struct Sink;
    impl EventSink for Sink {
        fn emit(&self, _: UiEvent) -> Result<(), AppError> {
            Ok(())
        }
    }
    let app = AppService::with_connector(Arc::new(Pending), Arc::new(Sink));
    app.connect(request("A")).unwrap();
    app.state.lock().unwrap().session_revision =
        baton_core::SafeInt::new(baton_core::SafeInt::MAX - 1).unwrap();
    let last = app.session_snapshot().unwrap();
    assert_eq!(last.revision.get(), 9_007_199_254_740_991);
    assert_eq!(
        app.session_snapshot().unwrap_err().code,
        "session_revision_exhausted"
    );
    assert_eq!(app.list()[0].state, "closed");
    assert_eq!(app.connect(request("B")).unwrap_err().code, "app_closed");
    assert_eq!(
        app.session_snapshot().unwrap_err().code,
        "session_revision_exhausted"
    );
    app.shutdown().await;
}
