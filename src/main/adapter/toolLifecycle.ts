// ToolTracker: 跟踪 tool_use block，累积 input_json_delta，
// 在 content_block_stop 时补全 tool-call-start 的 args（4.3 节）

export interface PendingToolBlock {
  call: string;
  name: string;
  inputJson: string;
  envelopeIndex: number;
}

export class ToolTracker {
  private pending = new Map<number, PendingToolBlock>();
  private activeCalls = new Set<string>();
  // 已发出 tool-call-start 的 envelope 引用，由 sessionAdapter 注入用于补全
  private envelopes: unknown[] = [];

  setEnvelopeBuffer(envs: unknown[]): void {
    this.envelopes = envs;
  }

  isActive(call: string): boolean {
    return this.activeCalls.has(call);
  }

  onToolUseStart(index: number, call: string, name: string, envelopeIndex: number): void {
    this.pending.set(index, { call, name, inputJson: '', envelopeIndex });
    this.activeCalls.add(call);
  }

  onInputJsonDelta(index: number, partial: string): void {
    const p = this.pending.get(index);
    if (!p) return;
    p.inputJson += partial;
  }

  // content_block_stop(tool_use) 时调用：解析累积的 partial_json，补全对应 envelope
  onToolUseStop(index: number): Record<string, unknown> | null {
    const p = this.pending.get(index);
    if (!p) return null;
    this.pending.delete(index);
    let args: Record<string, unknown> = {};
    if (p.inputJson) {
      try {
        const parsed = JSON.parse(p.inputJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          args = { _raw: p.inputJson };
        }
      } catch {
        args = { _raw: p.inputJson };
      }
    }
    // 补全之前的 envelope
    const env = this.envelopes[p.envelopeIndex] as { ev: { args: Record<string, unknown> } } | undefined;
    if (env) {
      env.ev.args = args;
    }
    return args;
  }

  // 下一个请求的 tool_result 到达时调用，返回完整的 tool-call-end 事件
  onToolResult(
    call: string,
    isError: boolean,
    errorSummary?: string,
    content?: string,
  ): { t: 'tool-call-end'; call: string; is_error?: boolean; error?: string; result?: string } {
    const out: { t: 'tool-call-end'; call: string; is_error?: boolean; error?: string; result?: string } = {
      t: 'tool-call-end',
      call,
    };
    this.activeCalls.delete(call);
    if (isError) {
      out.is_error = true;
      if (errorSummary) out.error = errorSummary;
    }
    if (content) out.result = content;
    return out;
  }

  // session 结束时清理
  clear(): void {
    this.pending.clear();
    this.activeCalls.clear();
    this.envelopes = [];
  }
}
