use baton_core::*;
use baton_ssh::*;
use std::sync::Arc;
struct Never;
#[tokio::test]
async fn initial_pty_matches_the_core_initial_geometry() {
    let request = ConnectRequest {
        session: SessionId::from_u128(1),
        attempt_id: AttemptId(1),
        target: Target {
            host: "127.0.0.1".into(),
            port: 1,
        },
        username: "fixture".into(),
        auth_method: AuthMethod::Password,
        initial_geometry: Geometry::new(91, 27).unwrap(),
    };
    assert_eq!(
        connect(request, Arc::new(Never), CancellationToken::new())
            .await
            .err(),
        Some(SshError::InvalidInput)
    );
}
#[tokio::test]
async fn mailbox_rejects_cross_session_attempt_challenge_and_replay() {
    let (mailbox, mut prompts) = AuthMailbox::new();
    let prompt = AuthPrompt {
        session: SessionId::from_u128(1),
        attempt_id: AttemptId(2),
        challenge_id: ChallengeId(3),
        kind: PromptKind::HostKey,
        display: "fingerprint".into(),
        prompts: vec![],
    };
    let ui = mailbox.clone();
    let pending = tokio::spawn(async move { ui.ask(prompt).await });
    let p = prompts.recv().await.expect("prompt must be emitted");
    for (session, attempt, challenge) in [
        (SessionId::from_u128(9), p.attempt_id, p.challenge_id),
        (p.session, AttemptId(9), p.challenge_id),
        (p.session, p.attempt_id, ChallengeId(9)),
    ] {
        assert_eq!(
            mailbox.answer(session, attempt, challenge, AuthAnswer::Host(true)),
            Err(SshError::StaleChallenge)
        );
    }
    assert!(!pending.is_finished());
    assert_eq!(
        mailbox.answer(
            p.session,
            p.attempt_id,
            p.challenge_id,
            AuthAnswer::Host(true)
        ),
        Ok(())
    );
    assert!(matches!(pending.await.unwrap(), Ok(AuthAnswer::Host(true))));
    assert_eq!(
        mailbox.answer(
            p.session,
            p.attempt_id,
            p.challenge_id,
            AuthAnswer::Host(true)
        ),
        Err(SshError::StaleChallenge)
    );
}
#[tokio::test]
async fn cancelled_prompt_does_not_accept_a_late_answer() {
    let (mailbox, mut prompts) = AuthMailbox::new();
    let ui = mailbox.clone();
    let pending = tokio::spawn(async move {
        ui.ask(AuthPrompt {
            session: SessionId::from_u128(1),
            attempt_id: AttemptId(1),
            challenge_id: ChallengeId(1),
            kind: PromptKind::Password,
            display: String::new(),
            prompts: vec![],
        })
        .await
    });
    let p = prompts.recv().await.expect("prompt must be emitted");
    pending.abort();
    let _ = pending.await;
    assert_eq!(
        mailbox.answer(
            p.session,
            p.attempt_id,
            p.challenge_id,
            AuthAnswer::Password(Zeroizing::new("private".into()))
        ),
        Err(SshError::StaleChallenge)
    );
}
impl AuthUi for Never {
    fn ask(&self, _: AuthPrompt) -> IoFuture<'_, Result<AuthAnswer, SshError>> {
        Box::pin(async { panic!("invalid input must not prompt") })
    }
}
#[tokio::test]
async fn invalid_targets_are_rejected_before_network_or_prompts() {
    for host in ["".to_owned(), "x".repeat(254), "host\nother".to_owned()] {
        let request = ConnectRequest {
            session: SessionId::from_u128(1),
            attempt_id: AttemptId(1),
            target: Target { host, port: 22 },
            username: "test".into(),
            auth_method: AuthMethod::Password,
            initial_geometry: Geometry::new(120, 32).unwrap(),
        };
        assert_eq!(
            connect(request, Arc::new(Never), CancellationToken::new())
                .await
                .err(),
            Some(SshError::InvalidInput)
        );
    }
}
