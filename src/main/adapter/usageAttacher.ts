// UsageAttacher: 在 message_delta 时把 usage 挂到最后一条可携带 envelope
import type { LynelEnvelope } from '../protocol/envelope.js';
import { canCarryUsage } from '../protocol/events.js';
import type { SessionUsage } from '../protocol/usage.js';

export function attachUsageToLast(
  envelopes: LynelEnvelope[],
  startIndex: number,
  usage: SessionUsage,
): void {
  for (let i = envelopes.length - 1; i >= startIndex; i -= 1) {
    if (canCarryUsage(envelopes[i].ev)) {
      // 直接 mutate 对象，保持外部引用不变
      (envelopes[i] as any).usage = usage;
      return;
    }
  }
}