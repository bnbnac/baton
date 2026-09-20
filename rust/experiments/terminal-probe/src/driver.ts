import './style.css';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { ProbeTerminal, type Frame } from './terminal';

const host = document.querySelector<HTMLElement>('#terminal')!;
const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
let terminal = new ProbeTerminal(host), caseId = '', running = false;
type Result = { protocolHex: string[]; ordinaryBytes: number; ordinaryHex: string; rejectedInputs: number; pending: number; queuedBytes: number; inFlightBytes: number; closedReason: string|null };
function equal(actual: unknown, expected: unknown): void { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
function hex(text: string): string { return [...new TextEncoder().encode(text)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function rejected(promise: Promise<unknown>, code?: string): Promise<void> {
  try { await promise; } catch (error) { if (code && !String(error).includes(code)) throw error; return; }
  throw new Error('expected_rejection');
}
async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<T>((_, fail) => { timer = setTimeout(() => fail(new Error('case_timeout')), 10000); })]); }
  finally { clearTimeout(timer!); }
}
async function scenario(name: string): Promise<void> {
  terminal.dispose(); host.replaceChildren(); terminal = new ProbeTerminal(host);
  const oracleHost = document.createElement('div'); oracleHost.className = 'oracle'; document.body.append(oracleHost);
  const oracle = new Terminal({ cols: 120, rows: 32, scrollback: 1000 }); oracle.open(oracleHost);
  if (name === 'wrap_max') { terminal.term.resize(500, 200); oracle.resize(500, 200); }
  const oracleHex: string[] = [];
  oracle.onData(text => oracleHex.push(hex(text)));
  let resolve!: () => void, reject!: (error: unknown) => void;
  const completed = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // Attach a handler before command failure can arrive ahead of awaiting completion.
  completed.catch(() => {});
  let chain = Promise.resolve(); let received = 0; let frameCount = 0;
  const onFrame = new Channel<Frame>();
  onFrame.onmessage = frame => {
    chain = chain.then(async () => {
      frameCount++; received += frame.bytes.length;
      if (frameCount > 128) throw new Error('frame_budget');
      if (frame.sessionId !== caseId) throw new Error('wrong_frame');
      if (name === 'output_pressure' && frameCount === 1) {
        const before = await invoke<Result>('case_result', { caseId });
        equal([before.queuedBytes, before.inFlightBytes], [1, 65536]);
        await rejected(invoke('ack', { sessionId: caseId, seq: frame.seq + 1 }), 'invalid_ack');
        const after = await invoke<Result>('case_result', { caseId });
        equal([after.queuedBytes, after.inFlightBytes], [1, 65536]);
      }
      const query = frame.queries[0];
      const reply = query && { sessionId: caseId, epoch: frame.epoch, queryId: query.id, kind: query.kind, row: 2, column: 3 };
      if (name === 'token_attacks' && reply) {
        await rejected(invoke('protocol_reply', { reply: { ...reply, sessionId: 'other' } }), 'wrong_case');
        await rejected(invoke('protocol_reply', { reply: { ...reply, row: 201 } }), 'invalid_position');
        await rejected(invoke('protocol_reply', { reply: { ...reply, column: 502 } }), 'invalid_position');
        await rejected(invoke('protocol_reply', { reply: { ...reply, kind: 'da' } }), 'wrong_kind');
        await rejected(invoke('protocol_reply', { reply: { ...reply, text: 'forbidden' } }));
      }
      if (name === 'expired' && reply) {
        await new Promise(yes => setTimeout(yes, 2100));
        await rejected(invoke('protocol_reply', { reply }), 'query_expired'); frame.queries = [];
      }
      if (name === 'epoch' && reply) {
        await invoke('set_owner', { caseId, userOwned: false });
        await rejected(invoke('protocol_reply', { reply }), 'not_owner'); frame.queries = [];
      }
      if (name === 'tokenless') frame.queries = [];
      await terminal.write(frame);
      await new Promise<void>(yes => oracle.write(new Uint8Array(frame.bytes), yes));
      if (name === 'token_attacks' && reply) {
        await rejected(invoke('protocol_reply', { reply }), 'unknown_query');
        await rejected(terminal.write(frame), 'replayed_frame');
        equal(await invoke('ordinary_input', { sessionId: caseId, epoch: frame.epoch, text: '\x1b[2;3R' }), false);
      }
      const done = await invoke<boolean>('ack', { sessionId: caseId, seq: frame.seq });
      if (name === 'output_pressure') await rejected(invoke('ack', { sessionId: caseId, seq: frame.seq }), 'invalid_ack');
      if (done) resolve();
    });
    chain.catch(reject);
  };
  try {
    caseId = await invoke<string>('start_case', { name, onFrame });
    if (name === 'query_overload') { await rejected(invoke('begin_case', { caseId }), 'query_limit'); resolve(); }
    else if (await invoke<boolean>('begin_case', { caseId })) resolve();
    await completed;
    if (name === 'input_paths') {
      terminal.term.input('KEY'); terminal.term.paste('붙여넣기'); await terminal.flush();
      equal((await invoke<Result>('case_result', { caseId })).ordinaryBytes, 0);
      const epoch = await invoke<number>('set_owner', { caseId, userOwned: true });
      terminal.frame!.epoch = epoch;
      terminal.term.input('KEY'); terminal.term.paste('붙여넣기'); await terminal.flush();
      equal((await invoke<Result>('case_result', { caseId })).ordinaryHex, hex('KEY붙여넣기'));
      equal(await invoke('ordinary_input', { sessionId: caseId, epoch: epoch - 1, text: 'OLD' }), false);
      equal(await invoke('ordinary_input', { sessionId: caseId, epoch, text: 'X'.repeat(16385) }), false);
    }
    const r = await invoke<Result>('case_result', { caseId });
    const suppressed = ['expired', 'epoch', 'tokenless', 'untrusted_sequences', 'queue_overload', 'query_overload'];
    equal(r.protocolHex, suppressed.includes(name) ? [] : oracleHex);
    if (name !== 'input_paths') equal(r.ordinaryBytes, 0);
    if (!['input_paths', 'token_attacks', 'untrusted_sequences'].includes(name)) equal(r.rejectedInputs, 0);
    if (name === 'queue_overload') { equal(r.closedReason, 'output_overload'); equal(frameCount, 0); }
    else if (name === 'query_overload') equal(r.closedReason, 'query_limit');
    else { equal([r.queuedBytes, r.inFlightBytes], [0, 0]); equal(r.closedReason, null); }
    if (!['tokenless', 'query_overload'].includes(name)) equal(r.pending, 0);
    if (name === 'cpr_agent_owned') equal(r.protocolHex, ['1b5b323b3352']);
    if (name === 'wrap_max') equal(r.protocolHex, [hex('\x1b[200;501R')]);
    if (name === 'mixed_queries') equal(r.protocolHex, ['1b5b306e', '1b5b323b3352', '1b5b3f313b3263', '1b5b3f313b3263']);
    if (name === 'output_pressure') { equal(received, 65537); equal(frameCount, 2); }
  } finally { oracle.dispose(); oracleHost.remove(); }
}
async function run(): Promise<void> {
  if (running) return; running = true; runButton.disabled = true;
  status.textContent = '자동 시험 실행 중';
  const outcomes: { name: string; passed: boolean; error?: string }[] = [];
  try {
    for (const name of ['cpr_agent_owned', 'mixed_queries', 'split_1', 'split_2', 'split_3', 'two_cpr', 'alternate', 'origin', 'scroll_region', 'wrap_pending', 'wrap_max', 'untrusted_sequences', 'output_pressure', 'queue_overload', 'query_overload', 'token_attacks', 'expired', 'epoch', 'tokenless', 'input_paths']) {
      try { await withDeadline(scenario(name)); outcomes.push({ name, passed: true }); }
      catch (error) { outcomes.push({ name, passed: false, error: String(error) }); }
    }
    results.textContent = JSON.stringify(outcomes, null, 2);
    status.textContent = outcomes.every(x => x.passed) ? '자동 시험 통과 · 실제 IME/마우스는 별도 확인 필요' : '자동 시험 실패';
    await invoke('report', { outcomes });
  } finally { running = false; runButton.disabled = false; }
}
runButton.addEventListener('click', () => void run());
for (const [selector, userOwned] of [['#user', true], ['#agent', false]] as const) {
  document.querySelector(selector)!.addEventListener('click', async () => {
    if (running || !caseId) return;
    const epoch = await invoke<number>('set_owner', { caseId, userOwned });
    if (terminal.frame) terminal.frame.epoch = epoch;
    status.textContent = userOwned ? '사용자 입력 허용' : '에이전트 소유 · 사용자 입력 차단'; terminal.term.focus();
  });
}
void run();
