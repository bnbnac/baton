#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use baton_terminal_probe::{
    output::Output,
    queries::{Queries, Query, Reply},
};
use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tauri::{State, ipc::Channel};

struct Case {
    id: String,
    epoch: u64,
    queries: Queries,
    output: Output,
    protocol: Vec<String>,
    ordinary: Vec<u8>,
    rejected: usize,
    user_owned: bool,
    start: Instant,
    channel: Option<Channel<Frame>>,
    closed: Option<&'static str>,
}
impl Case {
    fn new(id: String) -> Self {
        Self {
            queries: Queries::new(&id, 1),
            id,
            epoch: 1,
            output: Output::default(),
            protocol: Vec::new(),
            ordinary: Vec::new(),
            rejected: 0,
            user_owned: false,
            start: Instant::now(),
            channel: None,
            closed: None,
        }
    }
    fn enqueue(&mut self, bytes: Vec<u8>) {
        if self.closed.is_some() {
            return;
        }
        if let Err(error) = self.output.enqueue(bytes) {
            self.closed = Some(error);
        }
    }
    fn pump(&mut self) -> Result<bool, String> {
        if self.closed.is_some() {
            return Ok(true);
        }
        while let Some(chunk) = self.output.take().inspect_err(|e| {
            self.closed = Some(e);
        })? {
            let queries = self
                .queries
                .receive(
                    chunk.seq,
                    &chunk.bytes,
                    self.start.elapsed().as_millis() as u64,
                )
                .inspect_err(|e| {
                    self.closed = Some(e);
                })?;
            self.channel
                .as_ref()
                .ok_or("no_channel")?
                .send(Frame {
                    session_id: self.id.clone(),
                    epoch: self.epoch,
                    seq: chunk.seq,
                    bytes: chunk.bytes,
                    queries,
                })
                .map_err(|_| {
                    self.closed = Some("channel_closed");
                    "channel_closed"
                })?;
        }
        Ok(self.output.sizes() == (0, 0))
    }
}
#[derive(Default)]
struct Hub {
    next: u64,
    active: Option<Case>,
}
fn active<'a>(hub: &'a mut Hub, id: &str) -> Result<&'a mut Case, String> {
    hub.active
        .as_mut()
        .filter(|c| c.id == id)
        .ok_or_else(|| "wrong_case".into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    session_id: String,
    epoch: u64,
    seq: u64,
    bytes: Vec<u8>,
    queries: Vec<Query>,
}
#[tauri::command]
fn start_case(
    name: String,
    on_frame: Channel<Frame>,
    state: State<'_, Mutex<Hub>>,
) -> Result<String, String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    hub.next = hub
        .next
        .checked_add(1)
        .filter(|v| *v <= 9_007_199_254_740_991)
        .ok_or("sequence_overflow")?;
    let mut case = Case::new(format!("case-{}", hub.next));
    let bytes = match name.as_str() {
        "cpr_agent_owned" | "token_attacks" | "expired" | "epoch" | "tokenless" => {
            b"\x1b[2;3H\x1b[6n".to_vec()
        }
        "mixed_queries" => b"\x1b[2;3H\x1b[5n\x1b[6n\x1b[c\x1b[0c".to_vec(),
        "two_cpr" => b"\x1b[2;3H\x1b[6n\x1b[4;5H\x1b[6n".to_vec(),
        "leading_zero" => b"\x1b[06n\x1b[2;3H\x1b[6n".to_vec(),
        "osc_escape" => b"\x1b]0;\x1b[6n\x07\x1b[2;3H\x1b[6n".to_vec(),
        "dcs_escape" => b"\x1bPq\x1b[6n\x1b\\\x1b[2;3H\x1b[6n".to_vec(),
        "untracked_prefix" => [b"\x1b[".as_slice(), &[b'0'; 70], b"6n\x1b[2;3H\x1b[6n"].concat(),
        "alternate" => b"\x1b[?1049h\x1b[4;5H\x1b[6n\x1b[?1049l\x1b[6n".to_vec(),
        "origin" => b"\x1b[3;20r\x1b[?6h\x1b[2;3H\x1b[6n".to_vec(),
        "scroll_region" => b"\x1b[3;20r\x1b[20;4H\n\x1b[6n".to_vec(),
        "wrap_pending" => b"\x1b[1;120HX\x1b[6n".to_vec(),
        "wrap_max" => b"\x1b[200;500HX\x1b[6n".to_vec(),
        "untrusted_sequences" => [
            b"\x1b]52;c;?\x07\x1b]0;".as_slice(),
            &vec![b'x'; 70000],
            b"\x07\x1bP",
            &vec![b'x'; 70000],
            b"\x1b\\\x1b[",
            &vec![b'1'; 70000],
            b"m\x1b[?6n\x1b[>c",
        ]
        .concat(),
        "output_pressure" => vec![b'X'; 65537],
        "queue_overload" => vec![b'X'; 1048577],
        "input_paths" => b"\x1b[?1000h\x1b[?1006h".to_vec(),
        "query_overload" => b"\x1b[6n".repeat(33),
        "split_1" | "split_2" | "split_3" => {
            let split = name.as_bytes()[6] as usize - b'0' as usize;
            case.enqueue([b"\x1b[2;3H".as_slice(), &b"\x1b[6n"[..split]].concat());
            b"\x1b[6n"[split..].to_vec()
        }
        other if other.starts_with("mixed_split_") => {
            let split: usize = other[12..].parse().map_err(|_| "invalid_split")?;
            let bytes = b"\x1b[06n\x1b[2;3H\x1b[6n";
            if split == 0 || split >= bytes.len() {
                return Err("invalid_split".into());
            }
            case.enqueue(bytes[..split].to_vec());
            bytes[split..].to_vec()
        }
        _ => return Err("unknown_case".into()),
    };
    case.enqueue(bytes);
    case.channel = Some(on_frame);
    let id = case.id.clone();
    hub.active = Some(case);
    Ok(id)
}
#[tauri::command]
fn begin_case(case_id: String, state: State<'_, Mutex<Hub>>) -> Result<bool, String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    active(&mut hub, &case_id)?.pump()
}
#[tauri::command]
fn protocol_reply(reply: Reply, state: State<'_, Mutex<Hub>>) -> Result<(), String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    let case = active(&mut hub, &reply.session_id)?;
    if case.closed.is_some() {
        return Err("session_closed".into());
    }
    let bytes = case
        .queries
        .reply(reply, case.start.elapsed().as_millis() as u64)?;
    case.protocol
        .push(bytes.iter().map(|b| format!("{b:02x}")).collect());
    Ok(())
}
#[tauri::command]
fn ordinary_input(
    session_id: String,
    epoch: u64,
    text: String,
    state: State<'_, Mutex<Hub>>,
) -> Result<bool, String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    let case = active(&mut hub, &session_id)?;
    if epoch != case.epoch || !case.user_owned || case.closed.is_some() || text.len() > 16384 {
        case.rejected += 1;
        return Ok(false);
    }
    if case.ordinary.len() + text.len() > 65536 {
        return Err("input_evidence_limit".into());
    }
    case.ordinary.extend_from_slice(text.as_bytes());
    Ok(true)
}
#[tauri::command]
fn ack(session_id: String, seq: u64, state: State<'_, Mutex<Hub>>) -> Result<bool, String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    let case = active(&mut hub, &session_id)?;
    case.output.ack(seq)?;
    case.pump()
}
#[tauri::command]
fn case_result(case_id: String, state: State<'_, Mutex<Hub>>) -> Result<serde_json::Value, String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    let case = active(&mut hub, &case_id)?;
    let (queued, inflight) = case.output.sizes();
    Ok(
        serde_json::json!({ "protocolHex": case.protocol, "ordinaryBytes": case.ordinary.len(),
        "ordinaryHex": case.ordinary.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        "rejectedInputs": case.rejected, "pending": case.queries.pending(),
        "queuedBytes": queued, "inFlightBytes": inflight, "closedReason": case.closed }),
    )
}
#[tauri::command]
fn set_owner(
    case_id: String,
    user_owned: bool,
    state: State<'_, Mutex<Hub>>,
) -> Result<u64, String> {
    let mut hub = state.lock().map_err(|_| "state_failed")?;
    let case = active(&mut hub, &case_id)?;
    let epoch = case.epoch.checked_add(1).ok_or("sequence_overflow")?;
    case.queries.transition(epoch)?;
    case.epoch = epoch;
    case.user_owned = user_owned;
    Ok(epoch)
}
#[tauri::command]
fn report(outcomes: serde_json::Value) -> Result<(), String> {
    if let Ok(path) = std::env::var("BATON_TERMINAL_REPORT") {
        let runtime = serde_json::json!({ "webviewVersion": tauri::webview_version().map_err(|_| "runtime_version_failed")? });
        std::fs::write(
            format!("{path}.runtime.json"),
            serde_json::to_vec(&runtime).map_err(|_| "report_failed")?,
        )
        .map_err(|_| "report_failed")?;
        let bytes = serde_json::to_vec_pretty(&outcomes).map_err(|_| "report_failed")?;
        let temporary = format!("{path}.partial");
        std::fs::write(&temporary, bytes).map_err(|_| "report_failed")?;
        std::fs::rename(temporary, path).map_err(|_| "report_failed")?;
    }
    Ok(())
}
#[tauri::command]
fn probe_mode() -> bool {
    std::env::var("BATON_TERMINAL_INJECT").as_deref() == Ok("output-wait")
}
fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(Hub::default()))
        .invoke_handler(tauri::generate_handler![
            start_case,
            begin_case,
            protocol_reply,
            ordinary_input,
            ack,
            case_result,
            set_owner,
            report,
            probe_mode
        ])
        .run(tauri::generate_context!())
        .expect("terminal_probe_runtime_failed");
}
