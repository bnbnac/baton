use super::*;
async fn command(
    h: &SessionHandle,
    v: ViewBinding,
    id: u128,
    bytes: &[u8],
    marker: &str,
) -> Result<(), SshError> {
    h.submit(InputCall {
        principal: Principal::User,
        epoch: SafeInt::new(0).unwrap(),
        request_id: RequestId::from_u128(id),
        payload: bytes.to_vec(),
    })
    .await
    .map_err(|_| SshError::CoreRejected)?;
    multi::read_until(h, v, marker).await?;
    Ok(())
}
pub async fn run(h: &SessionHandle, v: ViewBinding) -> Result<(), SshError> {
    command(h, v, 1, b"stty size\r", "32 120\r\n").await?;
    println!("{{\"stage\":\"initial-32x120\"}}");
    h.resize(GeometryRequest {
        binding: v,
        resize_seq: SafeInt::new(1).unwrap(),
        geometry: Geometry::new(91, 27).unwrap(),
    })
    .await
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while h.geometry().await.columns != 91 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .map_err(|_| SshError::Timeout)?;
    command(h, v, 2, b"stty size\r", "27 91\r\n").await?;
    println!("{{\"stage\":\"resized-27x91\"}}");
    command(
        h,
        v,
        3,
        b"printf 'SLEEP_READY\\n'; sleep 30\r",
        "SLEEP_READY\r\n",
    )
    .await?;
    command(h, v, 4, b"\x03", "^C").await?;
    command(
        h,
        v,
        5,
        b"printf 'AFTER_INTERRUPT\\n'\r",
        "AFTER_INTERRUPT\r\n",
    )
    .await?;
    println!("{{\"stage\":\"interrupt-survived\"}}");
    Ok(())
}
