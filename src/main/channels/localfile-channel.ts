// LocalFileChannel: apiproxy 已直接写 happy jsonl，此 channel 留作扩展点
// 4.4 节：Phase 1-7 仅占位

import type { OutputChannel } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';

export class LocalFileChannel implements OutputChannel {
  readonly id = 'localfile';
  readonly name = '本地文件归档（占位）';

  isEnabled(): boolean {
    return false;
  }

  send(_event: LynelEnvelope): void {
    // no-op
  }

  close(): void {
    // no-op
  }
}
