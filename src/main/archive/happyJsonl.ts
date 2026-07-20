// happyJsonl: 追加写 happy envelope 序列到 envelopes.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { stripEnvelope, type LynelEnvelope } from '../protocol/envelope.js';

export class HappyJsonlWriter {
  private filePath: string;

  constructor(sessionDir: string) {
    this.filePath = path.join(sessionDir, 'envelopes.jsonl');
  }

  open(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  append(env: LynelEnvelope): void {
    const line = JSON.stringify(stripEnvelope(env)) + '\n';
    fs.appendFileSync(this.filePath, line);
  }

  close(): void {
    // 同步模式无需 close
  }

  static readAll(sessionDir: string): LynelEnvelope[] {
    const filePath = path.join(sessionDir, 'envelopes.jsonl');
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, 'utf8');
    const out: LynelEnvelope[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LynelEnvelope);
      } catch {
        // skip malformed line
      }
    }
    return out;
  }
}