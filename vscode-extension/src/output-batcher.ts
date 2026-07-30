// output-batcher: PTY 输出推送合帧器
// 高频 PTY chunk 按 ~16ms 窗口拼接成一条再推给渲染进程，
// 避免每个 chunk 一条 webContents.send IPC（PTY 爆发输出时 IPC 洪峰）。
// 只影响推送路径；session.appendBuffer 的本地缓冲仍逐 chunk 追加。

export class OutputBatcher {
  private pending = new Map<string, { chunks: string[]; timer: NodeJS.Timeout | null }>();

  constructor(
    private flushFn: (id: string, data: string) => void,
    private intervalMs = 16,
  ) {}

  push(id: string, chunk: string): void {
    let p = this.pending.get(id);
    if (!p) {
      p = { chunks: [], timer: null };
      this.pending.set(id, p);
    }
    p.chunks.push(chunk);
    if (!p.timer) {
      p.timer = setTimeout(() => this.flush(id), this.intervalMs);
    }
  }

  // 立即 flush 指定 id 的残余数据。
  // 保序：发送 done / 错误提示等 out-of-band 消息前必须调用，
  // 否则这些消息会越过尚在窗口期内的 PTY 输出先到达渲染端。
  flush(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    if (p.chunks.length > 0) this.flushFn(id, p.chunks.join(''));
  }

  // 丢弃残余数据并清 timer（session 销毁时用，避免 timer 持有已销毁 session 引用）
  clear(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
  }
}
