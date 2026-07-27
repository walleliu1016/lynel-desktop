// DesktopSocket: Socket.IO 上行通道 -> 云服务（取代 CloudChannel 的所有 HTTP 调用）
// 认证流程：
//   1. 启动时读本地 JWT（settingsStore.cloud_jwt）
//   2. 有 JWT -> POST /api/auth/login { user_id, token: jwt } -> 拿新 JWT
//   3. 无 JWT 或 JWT 失效 -> POST /api/auth/login { user_id, user_password }
//   4. 拿到 JWT -> 持久化 -> emit desktop:auth { user_id, token: jwt }
//   5. socket 重连时重新走 1-4
//
// 事件命名约定：所有 Desktop 上行事件统一 desktop: 前缀，与 Mobile 事件完全隔离
//   desktop:auth            连接后认证（携带 JWT）
//   desktop:session:sync    会话元数据同步（取代 POST /api/sessions/sync）
//   desktop:envelope:push   批量推 LynelEnvelope（buffer + 定时 flush）
//   desktop:hook:batch      非审批 hook 批量上报
//   desktop:hook:permission 单个 PermissionRequest（阻塞，等 desktop:hook:result）
//   desktop:hook:abort      本地 race 胜出时通知 cloud 取消
//
// 下行事件：
//   auth:success            认证成功 -> 自动 syncSessions
//   auth:failed             认证失败 -> 重新 login（JWT 失效走密码登录）
//   desktop:hook:result     PermissionRequest 决策结果（匹配 request_id）
//   desktop:chat            Mobile 转发的消息 -> 路由到对应 session 的 PTY

import { io, type Socket } from 'socket.io-client';
import https from 'node:https';
import type { OutputChannel, HookChannel, HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';
import { getLogger } from '../log.js';

// 忽略 TLS 证书校验：cloud 服务可能用自签证书，desktop 端不强制校验
// 影响：socket.io 握手（polling + websocket）跳过证书验证
// fetch 单独通过临时设置 NODE_TLS_REJECT_UNAUTHORIZED=0 实现（见 login()）
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export interface DesktopSocketConfig {
  url?: string;
  enabled?: boolean;
  userId?: string;
  // App 解锁时缓存的明文密码；锁定时传 undefined。无 JWT 时用密码换 JWT
  userPassword?: string;
}

// JWT 持久化回调：由 app.ts 注入，写入 settingsStore.cloud_jwt
export interface JwtPersistence {
  load(): string | undefined;
  save(jwt: string): void;
  clear(): void;
}

export interface SyncSession {
  session_id: string;
  jsonl_path?: string;
  cwd?: string;
  project_name?: string;
  title?: string;
  last_activity_at?: number;
}

// sendPermissionRequest 同步等待 cloud 决策后的结果
export interface DesktopHookResult {
  request_id: string;
  decision: 'allow' | 'deny';
  output?: unknown;     // Claude standard hook output，原样透传给 hookserver
}

// PermissionRequest 默认超时：2 小时（与原 CloudChannel 保持一致）
const DEFAULT_PERMISSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

interface PendingRequest {
  resolve: (v: DesktopHookResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'auth_failed';

export class DesktopSocket implements OutputChannel, HookChannel {
  readonly id = 'cloud';
  readonly name = 'Cloud';

  private socket: Socket | null = null;
  private url = '';
  private enabled = false;
  private userId = '';
  private userPassword: string | undefined;
  private jwt: string | undefined;          // 内存缓存，与 persistence 同步
  private persistence: JwtPersistence | null = null;
  private state: ConnectionState = 'disconnected';
  private authenticating = false;           // 防止重入 login 流程

  // envelope buffer：3s flush 或满 50 条
  private buffer: LynelEnvelope[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL = 3_000;
  private readonly MAX_BATCH_SIZE = 50;

  // 非审批 hook 独立 buffer：fire-and-forget batch
  private hookBuffer: Record<string, unknown>[] = [];
  private hookFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HOOK_FLUSH_INTERVAL = 3_000;
  private readonly HOOK_MAX_BATCH_SIZE = 50;

  // PermissionRequest 待响应 Promise 控制
  private pendingPermissions = new Map<string, PendingRequest>();

  // Mobile -> Desktop 聊天消息回调（app.ts 注入：路由到 session.send）
  onChatMessage: ((sessionId: string, question: string) => void) | null = null;

  // 状态变更回调（供 UI 显示连接状态）
  onStateChange: ((state: ConnectionState) => void) | null = null;

  isEnabled(): boolean {
    return this.enabled && this.url.length > 0;
  }

  isConnected(): boolean {
    return this.state === 'authenticated';
  }

  getState(): ConnectionState {
    return this.state;
  }

  setPersistence(p: JwtPersistence): void {
    this.persistence = p;
    this.jwt = p.load();
  }

  updateConfig(cfg: DesktopSocketConfig): void {
    const prevEnabled = this.enabled && this.url.length > 0;
    const prevPassword = this.userPassword;
    if (cfg.url !== undefined) this.url = cfg.url.replace(/\/+$/, '');
    if (cfg.userId !== undefined) this.userId = cfg.userId;
    if (cfg.userPassword !== undefined) this.userPassword = cfg.userPassword;
    if (cfg.enabled !== undefined) this.enabled = cfg.enabled;

    const nextEnabled = this.isEnabled();
    // url 变更或 enabled 状态切换都需要重连
    if (nextEnabled !== prevEnabled || (nextEnabled && this.socket)) {
      this.reconnect();
      return;
    }
    // socket 已连接但停在 connected（未认证），且本次密码从无到有：
    // 用户刚解锁，触发 ensureJwtAndAuth 用新密码换 JWT
    if (this.socket?.connected && !this.authenticating && this.state !== 'authenticated' && !prevPassword && this.userPassword) {
      getLogger().info('[desktop-socket] password set after connect, retry auth');
      void this.ensureJwtAndAuth();
    }
  }

  /** 建立连接（如果已配置） */
  private reconnect(): void {
    // 先断开旧连接
    this.disconnect();

    if (!this.isEnabled()) {
      getLogger().info('[desktop-socket] disabled, skip connect');
      return;
    }

    // URL 可能带反代路径前缀（如 https://host/lynel），但 cloud 服务端 socket.io
    // 通常挂在根路径 /socket.io，反代前缀只用于 HTTP API（/lynel/api/auth/login）。
    // 因此 socket.io 连接用 origin + 默认 path /socket.io，避免 /lynel/socket.io 404。
    // 若服务端确实把 socket.io 挂在反代路径下，需在此调整。
    let baseUrl = this.url;
    try {
      const u = new URL(this.url);
      baseUrl = u.origin;
    } catch {
      // URL 解析失败，降级用原 url
    }

    getLogger().info(`[desktop-socket] connecting to ${baseUrl} path=/socket.io (http api=${this.url})`);
    this.setState('connecting');

    // socket.io-client 类型对 agent 选项声明不全，用 as any 绕过类型检查
    // 实际运行时会透传给 polling(https.Agent) 和 websocket(ws 库)
    const socketOpts: Record<string, unknown> = {
      // 先 polling 握手再升级到 websocket，避免 Electron 下纯 websocket 握手失败
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      timeout: 10_000,
      // socket.io 默认 path：cloud 服务端通常挂在根路径 /socket.io
      path: '/socket.io',
      // 忽略 TLS 证书校验（cloud 可能用自签证书）
      agent: insecureHttpsAgent,
      // websocket transport 透传给 ws 库的选项
      extraHeaders: { 'User-Agent': 'lynel-desktop' },
    };
    this.socket = io(baseUrl, socketOpts as any);

    this.socket.on('connect', () => {
      getLogger().info('[desktop-socket] connected, authenticating...');
      this.setState('connected');
      // socket 连接建立后，确保有 JWT 再 emit desktop:auth
      this.ensureJwtAndAuth();
    });

    this.socket.on('auth:success', () => {
      getLogger().info('[desktop-socket] authenticated');
      this.setState('authenticated');
      // 认证成功后立刻同步会话
      this.emitAllPendingBatches();
    });

    this.socket.on('auth:failed', (data: { reason?: string } | undefined) => {
      getLogger().error('[desktop-socket] auth failed:', data?.reason);
      this.setState('auth_failed');
      // JWT 失效：清掉本地 JWT，重新走 login 流程（用密码换新 JWT）
      // 如果没有密码（App 未解锁），等用户解锁后 updateConfig 触发重连
      this.clearJwt();
      void this.ensureJwtAndAuth();
    });

    this.socket.on('desktop:hook:result', (data: DesktopHookResult) => {
      const pending = this.pendingPermissions.get(data.request_id);
      if (!pending) {
        getLogger().warn(`[desktop-socket] orphan hook result req_id=${data.request_id.slice(0, 8)}`);
        return;
      }
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(data.request_id);
      pending.resolve(data);
    });

    this.socket.on('desktop:chat', (data: { session_id: string; question: string; user_id?: string }) => {
      getLogger().info(`[desktop-socket] chat from mobile sid=${data.session_id?.slice(0, 8)} q=${data.question?.slice(0, 40)}`);
      if (data.session_id && typeof data.question === 'string') {
        this.onChatMessage?.(data.session_id, data.question);
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      getLogger().info(`[desktop-socket] disconnected: ${reason}`);
      this.setState('disconnected');
      // pending permission 请求不清理：
      //   1. cloud 端如果还保留 popup 等待，重连后 mobile 响应仍会通过 desktop:hook:result 回来
      //   2. 超时由各 pending 自己的 timer 控制，超时后 reject 走 broker 兜底
    });

    this.socket.on('connect_error', (err: Error & { description?: unknown; context?: unknown }) => {
      getLogger().warn(`[desktop-socket] connect error: ${err.message} description=${JSON.stringify(err.description)} context=${JSON.stringify(err.context)}`);
    });
  }

  // 确保 jwt 存在（必要时调 /api/auth/login），然后 emit desktop:auth
  // 防止重入：authenticating 标志保证同一时刻只有一个 login 在跑
  private async ensureJwtAndAuth(): Promise<void> {
    if (this.authenticating) return;
    if (!this.socket?.connected) return;
    this.authenticating = true;
    try {
      // 1. 已有 JWT -> 直接 emit
      if (this.jwt) {
        this.emit('desktop:auth', { user_id: this.userId, token: this.jwt });
        return;
      }
      // 2. 无 JWT -> 调 /api/auth/login 换 JWT
      //    需要密码（App 已解锁）；无密码时打日志等用户解锁
      if (!this.userPassword) {
        getLogger().warn('[desktop-socket] no JWT and no password (app locked?), waiting for unlock');
        return;
      }
      const jwt = await this.login(this.userPassword);
      if (!jwt) return;  // login 失败已打日志
      this.setJwt(jwt);
      this.emit('desktop:auth', { user_id: this.userId, token: jwt });
    } finally {
      this.authenticating = false;
    }
  }

  // 调 POST /api/auth/login 换 JWT
  // 优先用 token（已有 JWT），失败再用 user_password
  // cloud 端会校验 token，无效则返回 401，desktop 改用密码重试
  private async login(password: string): Promise<string | null> {
    if (!this.url) return null;

    const tryLogin = async (body: Record<string, string>): Promise<{ success: boolean; token?: string; error?: string } | null> => {
      try {
        // 忽略 TLS 证书校验：临时设全局环境变量（fetch 不支持 dispatcher 选项的类型声明）
        // login 是串行调用，不会有并发问题；finally 里恢复原值
        const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        let res: Response;
        try {
          res = await fetch(`${this.url}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          });
        } finally {
          if (savedEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
          else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
        }
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          getLogger().warn(`[desktop-socket] /api/auth/login non-JSON response status=${res.status}: ${text.slice(0, 120)}`);
          return null;
        }
      } catch (err: any) {
        getLogger().warn(`[desktop-socket] /api/auth/login error: ${err.message}`);
        return null;
      }
    };

    // 优先用 JWT 复用
    if (this.jwt) {
      const r = await tryLogin({ user_id: this.userId, token: this.jwt });
      if (r?.success && r.token) {
        getLogger().info(`[desktop-socket] login with jwt ok user=${this.userId}`);
        return r.token;
      }
      getLogger().warn(`[desktop-socket] login with jwt failed: ${r?.error ?? 'unknown'}, fallback to password`);
      this.clearJwt();
    }

    // JWT 失效或没有 -> 用密码
    const r = await tryLogin({ user_id: this.userId, user_password: password });
    if (r?.success && r.token) {
      getLogger().info(`[desktop-socket] login with password ok user=${this.userId}`);
      return r.token;
    }
    getLogger().error(`[desktop-socket] login with password failed: ${r?.error ?? 'unknown'}`);
    return null;
  }

  private setJwt(jwt: string): void {
    this.jwt = jwt;
    this.persistence?.save(jwt);
  }

  private clearJwt(): void {
    this.jwt = undefined;
    this.persistence?.clear();
  }

  private setState(s: ConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    this.onStateChange?.(s);
  }

  // 认证成功后立刻把 buffer 里的内容批量推出
  private emitAllPendingBatches(): void {
    if (this.buffer.length > 0) this.flush();
    if (this.hookBuffer.length > 0) this.flushHooks();
  }

  // OutputChannel: LynelEnvelope buffer + flush
  send(event: LynelEnvelope): void {
    if (!this.isEnabled()) return;
    this.buffer.push(event);
    if (this.buffer.length >= this.MAX_BATCH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  // HookChannel: 非审批类 hook fire-and-forget batch
  // PermissionRequest 走 sendPermissionRequest；PermissionResolved 是 broker 内部合成事件
  sendHook(event: HookEventLike): void {
    if (!this.isEnabled()) return;
    if (event.kind === 'PermissionRequest' || event.kind === 'PermissionResolved') return;
    if (!event.rawBody) return;
    this.hookBuffer.push(event.rawBody);
    if (this.hookBuffer.length >= this.HOOK_MAX_BATCH_SIZE) {
      this.flushHooks();
    } else if (!this.hookFlushTimer) {
      this.hookFlushTimer = setTimeout(() => this.flushHooks(), this.HOOK_FLUSH_INTERVAL);
    }
  }

  // 同步发送 PermissionRequest，等待 desktop:hook:result
  // 超时 / 本地 abort / 断线超时均 reject；调用方需做 race 协调
  sendPermissionRequest(
    reqId: string,
    rawBody: Record<string, unknown>,
    timeoutMs: number = DEFAULT_PERMISSION_TIMEOUT_MS,
  ): Promise<DesktopHookResult> {
    if (!this.isEnabled()) {
      return Promise.reject(new Error('[desktop-socket] not enabled'));
    }
    return new Promise<DesktopHookResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingPermissions.delete(reqId)) {
          getLogger().warn(`[desktop-socket] permission timeout req_id=${reqId.slice(0, 8)}`);
          reject(new Error('cloud permission timeout'));
        }
      }, timeoutMs);

      this.pendingPermissions.set(reqId, { resolve, reject, timer });
      this.emit('desktop:hook:permission', { request_id: reqId, data: rawBody });
    });
  }

  // 本地 broker 先 resolve 时调用：通知 cloud 取消 + 拒绝本地 Promise
  // emit 失败仅打 warn，不抛异常
  abortPermissionRequest(
    reqId: string,
    rawBody: Record<string, unknown>,
    decision?: 'allow' | 'deny',
  ): void {
    // 1. 取消本地 Promise（如果还在等）
    const pending = this.pendingPermissions.get(reqId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(reqId);
      pending.reject(new Error('aborted by local resolution'));
    }

    // 2. 通知 cloud 取消
    if (!this.isEnabled()) return;
    this.emit('desktop:hook:abort', {
      request_id: reqId,
      decision,
      data: rawBody,
    });
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.emit('desktop:envelope:push', { envelopes: batch });
  }

  private flushHooks(): void {
    if (this.hookFlushTimer) {
      clearTimeout(this.hookFlushTimer);
      this.hookFlushTimer = null;
    }
    if (this.hookBuffer.length === 0) return;
    const batch = this.hookBuffer.splice(0);
    this.emit('desktop:hook:batch', { hooks: batch });
  }

  syncSessions(sessions: SyncSession[]): Promise<void> {
    if (!this.isEnabled()) return Promise.resolve();
    // 未认证时直接 emit 会被 socket 缓冲（如果 transports 支持），但更稳妥是认证后再发
    // 这里直接 emit，未连接时 emit 内部会丢弃并打 warn；认证成功的回调里也会 flush
    this.emit('desktop:session:sync', { sessions });
    return Promise.resolve();
  }

  private emit(event: string, data: unknown): void {
    if (!this.socket?.connected) {
      getLogger().warn(`[desktop-socket] not connected, dropping ${event}`);
      return;
    }
    if (this.state !== 'authenticated' && event !== 'desktop:auth') {
      getLogger().warn(`[desktop-socket] not authenticated, dropping ${event}`);
      return;
    }
    this.socket.emit(event, data);
  }

  /** 显式建立连接（启动时调用） */
  connect(): void {
    if (this.socket) return;
    if (!this.isEnabled()) {
      getLogger().info('[desktop-socket] not enabled, skip connect');
      return;
    }
    this.reconnect();
  }

  disconnect(): void {
    if (!this.socket) return;
    try {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    } catch (err) {
      getLogger().warn('[desktop-socket] disconnect error:', (err as Error).message);
    }
    this.socket = null;
    this.setState('disconnected');
  }

  close(): void {
    // flush 剩余 buffer（即使断线也尝试一次，未连接会被 emit 丢弃）
    this.flush();
    this.flushHooks();
    // 关闭时拒绝所有 pending 的 permission 请求
    for (const [id, pending] of this.pendingPermissions) {
      clearTimeout(pending.timer);
      pending.reject(new Error('channel closed'));
    }
    this.pendingPermissions.clear();
    this.disconnect();
    this.enabled = false;
    this.userPassword = undefined;
  }
}
