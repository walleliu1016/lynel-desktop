import { PtyProcess, PtySize } from './pty.js';

export type SessionState = 'idle' | 'running' | 'awaiting_permission' | 'done';

export interface Session {
  id: string;
  workDir: string;
  state: SessionState;
  process: PtyProcess | null;
  lastHookAt: number;
  buffer: string;
}

const MAX_BUFFER = 65536

export function appendBuffer(id: string, data: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.buffer += data
  if (s.buffer.length > MAX_BUFFER) {
    s.buffer = s.buffer.slice(s.buffer.length - MAX_BUFFER)
  }
}

export function getBuffer(id: string): string {
  return sessions.get(id)?.buffer ?? ''
}

const sessions = new Map<string, Session>();
let onRemoveCallback: ((id: string) => void) | null = null;

export function setOnRemove(callback: (id: string) => void): void {
  onRemoveCallback = callback;
}

export function newSession(id: string, workDir: string): Session {
  return {
    id,
    workDir,
    state: 'idle',
    process: null,
    lastHookAt: 0,
    buffer: '',
  };
}

export function register(session: Session): void {
  sessions.set(session.id, session);
}

export function lookup(id: string): Session | undefined {
  return sessions.get(id);
}

export function remove(id: string): void {
  close(id);
  sessions.delete(id);
  onRemoveCallback?.(id);
}

export function list(): Session[] {
  return Array.from(sessions.values());
}

export function setProcess(id: string, proc: PtyProcess): void {
  const s = sessions.get(id);
  if (s) {
    s.process = proc;
    s.state = 'running';
  }
}

export function touch(id: string): void {
  const s = sessions.get(id);
  if (s) {
    s.lastHookAt = Date.now();
  }
}

export function setState(id: string, state: SessionState): void {
  const s = sessions.get(id);
  if (s) {
    s.state = state;
  }
}

export function send(id: string, prompt: string): void {
  const s = sessions.get(id);
  if (!s || !s.process) throw new Error(`session ${id} not found or no process`);
  const normalized = /[\r\n]$/.test(prompt) ? prompt : prompt + '\r';
  s.process.write(normalized);
}

export function writeInput(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s || !s.process) throw new Error(`session ${id} not found or no process`);
  s.process.write(data);
}

export function resize(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (s?.process) s.process.resize(cols, rows);
}

export function close(id: string, signal?: string): void {
  const s = sessions.get(id);
  if (s?.process) {
    s.process.kill(signal);
    s.process = null;
    s.state = 'done';
  }
}
