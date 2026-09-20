import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';

export type Query = { id: string; kind: 'cpr'|'dsr'|'da'; endOffset: number };
export type Frame = { sessionId: string; epoch: number; seq: number; bytes: number[]; queries: Query[] };
export class ProbeTerminal {
  readonly term = new Terminal({ cols: 120, rows: 32, scrollback: 1000, allowProposedApi: false });
  readonly fit = new FitAddon();
  readonly replies: Promise<unknown>[] = [];
  frame?: Frame;
  query?: Query;
  private lastSeq = 0;
  constructor(host: HTMLElement) {
    this.term.loadAddon(this.fit); this.term.open(host);
    this.term.onData(text => {
      if (this.frame) this.replies.push(invoke('ordinary_input', { sessionId: this.frame.sessionId, epoch: this.frame.epoch, text }));
    });
    this.term.parser.registerCsiHandler({ final: 'n' }, params => {
      if (params.length !== 1 || (params[0] !== 5 && params[0] !== 6)) return false;
      this.reply(params[0] === 6 ? 'cpr' : 'dsr'); return true;
    });
    this.term.parser.registerCsiHandler({ final: 'c' }, params => {
      if (params.length !== 1 || params[0] !== 0) return false;
      this.reply('da'); return true;
    });
  }
  private reply(kind: Query['kind']): void {
    if (!this.frame || this.query?.kind !== kind) return;
    this.replies.push(invoke('protocol_reply', { reply: {
      sessionId: this.frame.sessionId, epoch: this.frame.epoch, queryId: this.query.id, kind,
      ...(kind === 'cpr' ? { row: this.term.buffer.active.cursorY + 1, column: this.term.buffer.active.cursorX + 1 } : {})
    } }));
  }
  async write(frame: Frame): Promise<void> {
    if (!Number.isSafeInteger(frame.seq) || frame.seq <= this.lastSeq) throw new Error('replayed_frame');
    this.lastSeq = frame.seq;
    this.frame = frame;
    let start = 0;
    for (const query of frame.queries) {
      this.query = query;
      await new Promise<void>(resolve => this.term.write(new Uint8Array(frame.bytes.slice(start, query.endOffset + 1)), resolve));
      this.query = undefined;
      start = query.endOffset + 1;
    }
    if (start < frame.bytes.length) await new Promise<void>(resolve => this.term.write(new Uint8Array(frame.bytes.slice(start)), resolve));
    await this.flush();
  }
  async flush(): Promise<void> { await Promise.all(this.replies.splice(0)); }
  dispose(): void { this.term.dispose(); }
}
