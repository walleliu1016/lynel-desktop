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
  private onRaiseHandlers: Array<(req: PermissionRequest) => void> = [];
  private onResolveHandlers: Array<(id: string, decision: 'allow' | 'deny', source: string) => void> = [];
  private onCancelHandlers: Array<(id: string) => void> = [];

  async wait(request: PermissionRequest): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(request.id, { request, resolve });
      const stKey = `${request.sessionId}::${request.toolName}`;
      this.sessionToolIndex.set(stKey, request.id);
      logger.info(`[raise] ${request.id.slice(0, 8)} tool=${request.toolName} sid=${request.sessionId.slice(0, 8)}`);
      for (const h of this.onRaiseHandlers) {
        try { h(request); } catch {}
      }
    });
  }

  resolve(id: string, decision: 'allow' | 'deny', source: string, answers?: Record<string, string | string[]>): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      logger.info(`[resolve] ${id.slice(0, 8)} not found (already resolved or cancelled)`);
      return false;
    }
    this.pending.delete(id);
    this.removeFromIndex(entry.request);
    entry.resolve({ decision, answers });
    logger.info(`[resolve] ${id.slice(0, 8)} decision=${decision} source=${source}`);
    for (const h of this.onResolveHandlers) {
      try { h(id, decision, source); } catch {}
    }
    return true;
  }

  cancel(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    this.removeFromIndex(entry.request);
    logger.info(`[cancel] ${id.slice(0, 8)} client disconnected`);
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

  onRaise(handler: (req: PermissionRequest) => void): void {
    this.onRaiseHandlers.push(handler);
  }

  onResolve(handler: (id: string, decision: 'allow' | 'deny', source: string) => void): void {
    this.onResolveHandlers.push(handler);
  }

  onCancel(handler: (id: string) => void): void {
    this.onCancelHandlers.push(handler);
  }
}

export const permissionBroker = new PermissionBroker();
