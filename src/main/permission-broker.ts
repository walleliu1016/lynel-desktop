import { getLogger } from './log.js';

const logger = getLogger().scope('permission-broker');

export interface PermissionRequest {
  id: string;
  sessionId: string;
  workDir: string;
  toolName: string;
  toolInput: unknown;
}

export interface PermissionResult {
  decision: 'allow' | 'deny';
  answers?: Record<string, string | string[]>;
}

interface PendingEntry {
  request: PermissionRequest;
  resolve: (result: PermissionResult) => void;
}

class PermissionBroker {
  private pending = new Map<string, PendingEntry>();
  private sessionToolIndex = new Map<string, string>(); // sessionId+toolName → id
  private seqToId = new Map<number, string>(); // seq → id
  private idToSeq = new Map<string, number>(); // id → seq
  private nextSeq = 1;
  private onRaiseHandlers: Array<(req: PermissionRequest) => void> = [];
  private onResolveHandlers: Array<(id: string, decision: 'allow' | 'deny', source: string, sessionId: string, toolName: string) => void> = [];
  private onCancelHandlers: Array<(id: string) => void> = [];

  async wait(request: PermissionRequest): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      // 如果 allocateSeq 已预分配，则复用；否则新分配
      let seq = this.idToSeq.get(request.id);
      if (seq === undefined) {
        seq = this.nextSeq++;
        this.seqToId.set(seq, request.id);
        this.idToSeq.set(request.id, seq);
      }
      this.pending.set(request.id, { request, resolve });
      const stKey = `${request.sessionId}::${request.toolName}`;
      this.sessionToolIndex.set(stKey, request.id);
      logger.info(`[raise] #${seq} ${request.id.slice(0, 8)} tool=${request.toolName} sid=${request.sessionId.slice(0, 8)}`);
      for (const h of this.onRaiseHandlers) {
        try { h({ ...request, seq } as any); } catch {}
      }
    });
  }

  resolve(id: string, decision: 'allow' | 'deny', source: string, answers?: Record<string, string | string[]>): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      logger.info(`[resolve] ${id.slice(0, 8)} not found (already resolved or cancelled)`);
      return false;
    }
    const sessionId = entry.request.sessionId;
    const toolName = entry.request.toolName;
    this.cleanupEntry(id, entry);
    entry.resolve({ decision, answers });
    logger.info(`[resolve] #${this.idToSeq.get(id)} ${id.slice(0, 8)} decision=${decision} source=${source}`);
    for (const h of this.onResolveHandlers) {
      try { h(id, decision, source, sessionId, toolName); } catch {}
    }
    return true;
  }

  resolveBySeq(seq: number, decision: 'allow' | 'deny', source: string): boolean {
    const id = this.seqToId.get(seq);
    if (!id) return false;
    return this.resolve(id, decision, source);
  }

  cancel(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.cleanupEntry(id, entry);
    logger.info(`[cancel] #${this.idToSeq.get(id)} ${id.slice(0, 8)}`);
    for (const h of this.onCancelHandlers) {
      try { h(id); } catch {}
    }
  }

  // 通过 sessionId + toolName 取消（用户在终端自行解决权限）
  cancelBySessionTool(sessionId: string, toolName: string): boolean {
    const stKey = `${sessionId}::${toolName}`;
    const id = this.sessionToolIndex.get(stKey);
    if (!id || !this.pending.has(id)) return false;
    logger.info(`[cancelBySessionTool] sid=${sessionId.slice(0, 8)} tool=${toolName}`);
    this.cancel(id);
    return true;
  }

  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  private removeFromIndex(request: PermissionRequest): void {
    const stKey = `${request.sessionId}::${request.toolName}`;
    this.sessionToolIndex.delete(stKey);
  }

  private cleanupEntry(id: string, entry: PendingEntry): void {
    this.pending.delete(id);
    this.removeFromIndex(entry.request);
    const seq = this.idToSeq.get(id);
    if (seq !== undefined) {
      this.seqToId.delete(seq);
      this.idToSeq.delete(id);
    }
  }

  getSeq(id: string): number | undefined {
    return this.idToSeq.get(id);
  }

  /** 预分配序号，在 dispatcher.dispatch 之前调用，确保 WeCom 消息中展示的是序号而非 UUID */
  allocateSeq(id: string): number {
    const seq = this.nextSeq++;
    this.seqToId.set(seq, id);
    this.idToSeq.set(id, seq);
    return seq;
  }

  onRaise(handler: (req: PermissionRequest) => void): void {
    this.onRaiseHandlers.push(handler);
  }

  onResolve(handler: (id: string, decision: 'allow' | 'deny', source: string, sessionId: string, toolName: string) => void): void {
    this.onResolveHandlers.push(handler);
  }

  onCancel(handler: (id: string) => void): void {
    this.onCancelHandlers.push(handler);
  }
}

export const permissionBroker = new PermissionBroker();
