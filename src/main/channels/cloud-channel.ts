// CloudChannel: 推送到云服务（未来云服务 → 独立移动 App）
// 4.4 节：Phase 1-7 仅预留接口，不实现真实推送

import type { OutputChannel } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';

export class CloudChannel implements OutputChannel {
  readonly id = 'cloud';
  readonly name = 'Cloud (预留)';

  isEnabled(): boolean {
    // Phase 1-7: 始终返回 false，不连云服务
    return false;
  }

  send(_event: LynelEnvelope): void {
    // no-op
  }
}
