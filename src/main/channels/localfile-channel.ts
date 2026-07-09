import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OutputChannel, ProxyStageEvent } from './channel.js';

export interface LocalFileConfig {
  enabled: boolean;
  outputPath: string;
  format: 'jsonl' | 'json';
}

export class LocalFileChannel implements OutputChannel {
  readonly id = 'localfile';
  readonly name = '本地文件';

  private cfg: LocalFileConfig = { enabled: false, outputPath: '', format: 'jsonl' };
  private streams = new Map<string, fs.WriteStream>();

  isEnabled(): boolean {
    return this.cfg.enabled;
  }

  updateConfig(cfg: LocalFileConfig): void {
    const wasEnabled = this.cfg.enabled;
    this.cfg = cfg;
    if (!cfg.enabled && wasEnabled) {
      this.closeAll();
    }
  }

  send(event: ProxyStageEvent): void {
    if (!this.cfg.enabled) return;
    // 过滤流式 text/thinking 碎片，response_complete 已包含完整文本
    if (event.kind === 'text' || event.kind === 'thinking') return;

    const baseDir = this.cfg.outputPath || path.join(os.homedir(), '.lynel-desktop', 'output');
    const project = this.sanitizeProject(event.workDir);
    const dir = path.join(baseDir, project);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${event.sessionId}.${this.cfg.format === 'json' ? 'json' : 'jsonl'}`);

    const record = {
      seq: event.seq,
      turn: event.turn,
      kind: event.kind,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: event.payload,
    };

    if (this.cfg.format === 'json') {
      this.writeJson(filePath, dir, event.sessionId, record);
    } else {
      this.writeJsonl(filePath, record);
    }
  }

  private writeJsonl(filePath: string, record: any): void {
    const line = JSON.stringify(record) + '\n';
    try {
      fs.appendFileSync(filePath, line, 'utf8');
    } catch {
      // 静默忽略写入错误
    }
  }

  private writeJson(filePath: string, dir: string, sessionId: string, record: any): void {
    const key = `${dir}/${sessionId}`;
    let records: any[] = [];
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        records = JSON.parse(raw);
        if (!Array.isArray(records)) records = [];
      }
    } catch {
      records = [];
    }
    records.push(record);
    try {
      fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
    } catch {
      // 静默忽略写入错误
    }
  }

  private sanitizeProject(workDir: string): string {
    try {
      const abs = path.resolve(workDir);
      const parts = abs.split(path.sep).filter(Boolean);
      return parts[parts.length - 1] || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private closeAll(): void {
    for (const stream of this.streams.values()) {
      try { stream.end(); } catch {}
    }
    this.streams.clear();
  }

  close(): void {
    this.closeAll();
  }
}
