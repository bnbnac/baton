use crate::dto::{AppError, Id};
pub fn fresh() -> Result<Id, AppError> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|_| AppError::new("random_unavailable"))?;
    Ok(Id(u128::from_le_bytes(bytes)))
}
