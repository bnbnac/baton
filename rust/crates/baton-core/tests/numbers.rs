use baton_core::*;

#[test]
fn safe_numbers_reject_before_rounding() {
    for json in [
        "-1",
        "1.5",
        "9007199254740992",
        "\"1\"",
        "1e0",
        "18446744073709551615",
    ] {
        assert!(serde_json::from_str::<SafeInt>(json).is_err(), "{json}");
    }
    let n: SafeInt = serde_json::from_str("9007199254740991").unwrap();
    assert_eq!(n.get(), SafeInt::MAX);
    assert_eq!(n.checked_next(), Err(CoreError::CounterExhausted));
    assert_eq!(serde_json::from_str::<SafeInt>("0").unwrap().get(), 0);
    assert_eq!(SafeInt::new(u64::MAX), Err(CoreError::InvalidNumber));
    assert_eq!(SafeInt::new(0).unwrap().checked_next().unwrap().get(), 1);
    assert_eq!(serde_json::to_string(&n).unwrap(), "9007199254740991");
}

#[test]
fn connection_capacity_is_not_consumed_by_duplicates() {
    let mut r = Registry::new(AppId::from_u128(1));
    for id in 0..32 {
        let c = ConnectionId::from_u128(id);
        assert_eq!(r.register_connection(c), Ok(()));
        assert_eq!(r.register_connection(c), Err(CoreError::DuplicateId));
    }
    assert_eq!(
        r.register_connection(ConnectionId::from_u128(32)),
        Err(CoreError::Capacity)
    );
    r.remove_connection(ConnectionId::from_u128(0)).unwrap();
    assert_eq!(r.register_connection(ConnectionId::from_u128(32)), Ok(()));
    assert_eq!(
        r.remove_connection(ConnectionId::from_u128(0)),
        Err(CoreError::UnknownId)
    );
}
