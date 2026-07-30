// happyJsonl: 追加写 happy envelope 序列到 envelopes.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { stripEnvelope, type LynelEnvelope } from '../protocol/envelope.js';
import { getLogger } from '../log.js';

export class HappyJsonlWriter {
  private filePath: string;
  // 串行写队列：append 异步化（不阻塞主进程事件循环）后仍保证行顺序
  private queue: Promise<void> = Promise.resolve();

  constructor(sessionDir: string) {
    this.filePath = path.join(sessionDir, 'envelopes.jsonl');
  }

  open(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  append(env: LynelEnvelope): void {
    const line = JSON.stringify(stripEnvelope(env)) + '\n';
    this.queue = this.queue
      .then(() => fs.promises.appendFile(this.filePath, line))
      .catch((err) => {
        // 落盘失败只打日志：主进程未捕获异常会导致窗口白屏
        getLogger().error(`[happyJsonl] append failed ${this.filePath}: ${err?.message || err}`);
      });
  }

  close(): Promise<void> {
    // 等待队列排空，进程退出前尽量把残余行写完
    return this.queue;
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