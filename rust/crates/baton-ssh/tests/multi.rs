use super::*;
pub async fn run(ports: Vec<u16>) -> Result<(), SshError> {
    assert_eq!(ports.len(), 2);
    let rt = Runtime::spawn(Registry::new(AppId::from_u128(1)));
    let mut handles = Vec::new();
    let result = async {
        for i in 0..4 {
            let id = SessionId::from_u128(i + 1);
            rt.reserve_session(id).unwrap();
            let cancel = CancellationToken::new();
            let ui = Arc::new(Ui {
                case: "password".into(),
                key: None,
                round: std::sync::atomic::AtomicUsize::new(0),
                cancel: cancel.clone(),
                fingerprint: None,
            });
            let h = connect(
                ConnectRequest {
                    session: id,
                    attempt_id: AttemptId(i + 1),
                    target: Target {
                        host: "127.0.0.1".into(),
                        port: ports[i as usize / 2],
                    },
                    username: "fixture".into(),
                    auth_method: AuthMethod::Password,
                    initial_geometry: Geometry::new(120, 32).unwrap(),
                },
                ui,
                cancel,
            )
            .await?
            .activate(&rt)?;
            let v = h.bind_view(ViewId::from_u128(i + 1)).await.unwrap();
            handles.push((h, v));
        }
        // All four connections are alive before any command is sent.
        for (i, (h, _)) in handles.iter().enumerate() {
            h.submit(InputCall {
                principal: Principal::User,
                epoch: SafeInt::new(0).unwrap(),
                request_id: RequestId::from_u128(1),
                payload: format!("SESSION_{i}\r").into_bytes(),
            })
            .await
            .unwrap();
        }
        for (i, (h, v)) in handles.iter().enumerate() {
            let received = read_until(h, *v, &format!("SESSION_{i}\r")).await?;
            for other in 0..4 {
                if other != i {
                    assert!(!received.contains(&format!("SESSION_{other}")));
                }
            }
        }
        handles[0].0.close(CloseReason::User).await;
        for (i, (h, v)) in handles.iter().enumerate().skip(1) {
            h.submit(InputCall {
                principal: Principal::User,
                epoch: SafeInt::new(0).unwrap(),
                request_id: RequestId::from_u128(2),
                payload: format!("ALIVE_{i}\r").into_bytes(),
            })
            .await
            .unwrap();
            read_until(h, *v, &format!("ALIVE_{i}\r")).await?;
        }
        println!("{{\"stage\":\"four-isolated-three-survived\"}}");
        Ok(())
    }
    .await;
    rt.shutdown().await;
    result
}
pub async fn read_until(
    h: &SessionHandle,
    v: ViewBinding,
    marker: &str,
) -> Result<String, SshError> {
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        let mut received = Vec::new();
        let mut changed = h.subscribe();
        loop {
            while let Some(f) = h
                .next_ui_frame(v)
                .await
                .map_err(|_| SshError::CoreRejected)?
            {
                received.extend_from_slice(&f.bytes);
                h.ack_ui_frame(v, f.seq).await.unwrap();
                if received.len() > 65536 {
                    return Err(SshError::Capacity);
                }
            }
            if received
                .windows(marker.len())
                .any(|w| w == marker.as_bytes())
            {
                return Ok(String::from_utf8_lossy(&received).into_owned());
            }
            changed
                .changed()
                .await
                .map_err(|_| SshError::TransportFailed)?;
        }
    })
    .await
    .map_err(|_| SshError::Timeout)?
}
