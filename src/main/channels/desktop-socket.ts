// DesktopSocket: Socket.IO 上行通道 -> 云服务
// 认证流程（token 纯内存，每次启动需重新登录）：
//   1. 用户在登录页输入 user_id + token -> app:loginWithToken
//   2. 主进程 desktopSocket.setToken(token) 内存缓存 + applyCloudSettings 触发 reconnect
//   3. socket 连接建立 -> ensureJwtAndAuth -> POST /api/auth/login { user_id, token }
//   4. cloud 校验 token 通过 -> emit desktop:auth { user_id, token }
//   5. cloud 返回 auth:success -> 状态 authenticated -> 进 home
//   6. token 无效 -> auth:failed -> 前端报错留在登录页
//
// 事件命名约定：所有 Desktop 上行事件统一 desktop: 前缀，与 Mobile 事件完全隔离
//   desktop:auth            连接后认证（携带 token）
//   desktop:session:sync    会话元数据同步
//   desktop:envelope:push   批量推 LynelEnvelope（buffer + 定时 flush）
//   desktop:hook:batch      非审批 hook 批量上报
//   desktop:hook:permission 单个 PermissionRequest（阻塞，等 desktop:hook:result）
//   desktop:hook:abort      本地 race 胜出时通知 cloud 取消
//
// 下行事件：
//   auth:success            认证成功 -> emitAllPendingBatches
//   auth:failed             认证失败 -> 清内存 token，等用户重新登录
//   desktop:hook:result     PermissionRequest 决策结果（匹配 request_id）
//   desktop:chat            Mobile 转发的消息 -> 路由到对应 session 的 PTY

import { io, type Socket } from 'socket.io-client';
import https from 'node:https';
import type { OutputChannel, HookChannel, HookEventLike } from './channel.js';
import type { LynelEnvelope } from '../protocol/envelope.js';
import { getLogger } from '../log.js';
import { notifyExternal, errMessage } from './notify-error.js';

// 忽略 TLS 证书校验：cloud 服务可能用自签证书，desktop 端不强制校验
// 影响：socket.io 握手（polling + websocket）跳过证书验证
// fetch 单独通过临时设置 NODE_TLS_REJECT_UNAUTHORIZED=0 实现（见 login()）
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

export interface DesktopSocketConfig {
  url?: string;
  enabled?: boolean;
  userId?: string;
  /** desktop 机器名（os.hostname()），cloud 端按 (user_id, machine_name) 区分设备 */
  machineName?: string;
}

export type SyncSessionEvent = 'created' | 'opened' | 'closed' | 'title_updated' | 'snapshot';

export interface SyncSession {
  session_id: string;
  jsonl_path?: string;
  cwd?: string;
  project_name?: string;
  title?: string;
  last_activity_at?: number;
  status: 'open' | 'closed';
  /** 触发本次上报的事件类型；snapshot 表示全量快照（重连认证成功后上报，供 cloud 端收敛） */
  event?: SyncSessionEvent;
  /** 来源机器名；未显式传时 syncSessions 统一用 config.machineName 填充 */
  machine_name?: string;
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

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'auth_failed' | 'reconnecting';

export interface ConnectionStateInfo {
  state: ConnectionState;
  reconnectAttempt: number;
}

export class DesktopSocket implements OutputChannel, HookChannel {
  readonly id = 'cloud';
  readonly name = 'Cloud';

  private socket: Socket | null = null;
  private url = '';
  private enabled = false;
  private userId = '';
  private machineName = '';
  private password: string | undefined;       // 用户输入的密码，纯内存，进程重启即失效
  private token: string | undefined;          // cloud 返回的 token（用于 socket 认证），纯内存
  private state: ConnectionState = 'disconnected';
  private authenticating = false;             // 防止重入 login 流程
  private reconnectAttempt = 0;               // 当前重连次数（0 = 未在重连）

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

  // 重连认证成功回调（app.ts 注入：全量上报当前 open 会话，供 cloud 端收敛）
  onSessionSnapshot: (() => void) | null = null;

  // 状态变更回调（供 UI 显示连接状态）
  onStateChange: ((state: ConnectionState) => void) | null = null;

  isEnabled(): boolean {
    return this.enabled && this.url.length > 0;
  }

  isConnected(): boolean {
    return this.state === 'authenticated';
  }

  getState(): ConnectionStateInfo {
    return { state: this.state, reconnectAttempt: this.reconnectAttempt };
  }

  // 由 app:loginWithToken 调用：用密码调 /api/auth/login 校验
  // 成功 -> 存密码 + token，触发 reconnect 让 socket 走 emit desktop:auth
  // 失败 -> 返回具体错误原因
  async verifyLogin(userId: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.url) return { ok: false, error: '云服务地址未配置' };
    this.userId = userId;
    const result = await this.login(password);
    if ('error' in result) return { ok: false, error: result.error };
    this.password = password;
    this.token = result.token;
    // 触发重连，新 socket 连接后 ensureJwtAndAuth 会直接 emit desktop:auth（已有 token）
    this.reconnect();
    return { ok: true };
  }

  setPassword(pw: string): void {
    this.password = pw;
  }

  clearCredentials(): void {
    this.password = undefined;
    this.token = undefined;
  }

  updateConfig(cfg: DesktopSocketConfig): void {
    const prevEnabled = this.enabled && this.url.length > 0;
    if (cfg.url !== undefined) this.url = cfg.url.replace(/\/+$/, '');
    if (cfg.userId !== undefined) this.userId = cfg.userId;
    if (cfg.machineName !== undefined) this.machineName = cfg.machineName;
    if (cfg.enabled !== undefined) this.enabled = cfg.enabled;

    const nextEnabled = this.isEnabled();
    // url 变更或 enabled 状态切换都需要重连
    if (nextEnabled !== prevEnabled || (nextEnabled && this.socket)) {
      this.reconnect();
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
      getLogger().error(`[desktop-socket] invalid url, missing protocol? url=${this.url}`);
      return;
    }

    getLogger().info(`[desktop-socket] connecting to ${baseUrl} path=/socket.io (http api=${this.url})`);
    this.reconnectAttempt = 0;
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
      // HTTP 连接不能使用 https.Agent（会触发 ERR_INVALID_PROTOCOL），
      // 只有 HTTPS 才注入跳过证书校验的 agent
      agent: baseUrl.startsWith('https://') ? insecureHttpsAgent : undefined,
      // websocket transport 透传给 ws 库的选项
      extraHeaders: { 'User-Agent': 'lynel-desktop' },
    };
    this.socket = io(baseUrl, socketOpts as any);

    this.socket.on('connect', () => {
      getLogger().info('[desktop-socket] connected, authenticating...');
      this.reconnectAttempt = 0;
      this.setState('connected');
      // socket 连接建立后，确保有 JWT 再 emit desktop:auth
      this.ensureJwtAndAuth();
    });

    this.socket.on('auth:success', (...args: any[]) => {
      let raw = args[0];
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
      getLogger().info(`[desktop-socket] authenticated type=${typeof args[0]} data=${JSON.stringify(raw ?? '').slice(0, 200)}`);
      this.setState('authenticated');
      this.emitAllPendingBatches();
      // 重连认证成功后全量上报当前 open 会话（权威快照），供 cloud 端收敛
      this.onSessionSnapshot?.();
    });

    this.socket.on('auth:failed', (...args: any[]) => {
      let raw = args[0];
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch {} }
      const data = raw as { reason?: string } | undefined;
      getLogger().error('[desktop-socket] auth failed:', data?.reason, raw ? JSON.stringify(raw).slice(0, 200) : '');
      this.setState('auth_failed');
      this.token = undefined;
      void this.ensureJwtAndAuth();
    });

    this.socket.on('desktop:hook:result', (...args: any[]) => {
      // cloud 端可能 JSON.stringify 了 payload，需要先 parse
      let raw = args[0];
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { /* ignore parse error */ }
      }
      const data = raw as DesktopHookResult;
      getLogger().info(`[desktop-socket] hook result type=${typeof args[0]} req_id=${data?.request_id?.slice(0, 8)} decision=${data?.decision} output=${JSON.stringify(data?.output ?? '').slice(0, 300)}`);

      if (!data?.request_id || !data?.decision) {
        getLogger().warn(`[desktop-socket] hook result payload invalid: ${JSON.stringify(data ?? null).slice(0, 200)}`);
        return;
      }
      const pending = this.pendingPermissions.get(data.request_id);
      if (!pending) {
        getLogger().warn(`[desktop-socket] orphan hook result req_id=${data.request_id?.slice(0, 8)}`);
        return;
      }
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(data.request_id);
      pending.resolve(data);
    });

    this.socket.on('desktop:chat', (...args: any[]) => {
      // socket.io v4 监听器 args 可能是 [data] 或 [data, ack]；
      // cloud 端可能 JSON.stringify 了 payload，导致 data 是 string 而非 object
      let raw = args[0];
      getLogger().info(`[desktop:chat] raw args=${args.length} type=${typeof raw} data=${JSON.stringify(raw ?? null).slice(0, 200)}`);

      // 如果 data 是 JSON string，先 parse
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          getLogger().warn(`[desktop:chat] data is string but not valid JSON: ${(raw as string).slice(0, 200)}`);
        }
      }

      const sid = raw?.session_id;
      const question = raw?.question;
      if (sid && typeof question === 'string') {
        this.onChatMessage?.(sid, question);
      } else {
        getLogger().warn(`[desktop:chat] payload invalid: sid=${sid} q=${question}`);
        notifyExternal({ source: 'cloud:chat', level: 'warn', message: `云端 chat payload 无效: sid=${sid} q=${question}` });
      }
    });

    this.socket.on('disconnect', (reason: string) => {
      getLogger().info(`[desktop-socket] disconnected: ${reason} (socket.io will auto-reconnect in ~1s, max 10s backoff)`);
      this.setState('disconnected');
      // pending permission 请求不清理：
      //   1. cloud 端如果还保留 popup 等待，重连后 mobile 响应仍会通过 desktop:hook:result 回来
      //   2. 超时由各 pending 自己的 timer 控制，超时后 reject 走 broker 兜底
    });

    this.socket.on('connect_error', (err: Error & { description?: unknown; context?: unknown }) => {
      getLogger().warn(`[desktop-socket] connect error: ${err.message} desc=${JSON.stringify(err.description)} ctx=${JSON.stringify(err.context)}`);
      notifyExternal({ source: 'cloud:connect', level: 'warn', message: `云端连接失败: ${errMessage(err)}`, throttleMs: 30_000 });
    });

    // socket.io Manager 级别事件：每次重连尝试触发
    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      getLogger().info(`[desktop-socket] reconnect attempt #${attempt}...`);
      this.reconnectAttempt = attempt;
      this.setState('reconnecting');
    });
    this.socket.io.on('reconnect', (attempt: number) => {
      getLogger().info(`[desktop-socket] reconnect success after ${attempt} attempts`);
      this.reconnectAttempt = 0;
    });
    this.socket.io.on('reconnect_error', (err: Error) => {
      getLogger().warn(`[desktop-socket] reconnect error: ${err.message}`);
    });
    this.socket.io.on('reconnect_failed', () => {
      getLogger().error('[desktop-socket] reconnect failed after max attempts');
      notifyExternal({ source: 'cloud:reconnect', level: 'error', message: '云端重连失败：达到最大重试次数，请检查云服务是否在线' });
    });
  }

  // socket 连接后调 /api/auth/login 用密码换 token，然后 emit desktop:auth
  // 防止重入：authenticating 标志保证同一时刻只有一个 login 在跑
  private async ensureJwtAndAuth(): Promise<void> {
    if (this.authenticating) return;
    if (!this.socket?.connected) return;
    this.authenticating = true;
    try {
      if (!this.password) {
        getLogger().warn('[desktop-socket] no password, waiting for login');
        return;
      }
      // 已有 token -> 直接 emit（重连复用，避免重复 login）
      if (this.token) {
        this.emit('desktop:auth', { user_id: this.userId, token: this.token, machine_name: this.machineName });
        return;
      }
      // 无 token -> 调 /api/auth/login 用密码换 token
      const result = await this.login(this.password);
      if ('error' in result) {
        this.setState('auth_failed');
        return;
      }
      this.token = result.token;
      // 异步 login 期间 socket 可能已断开，此时不 emit，
      // token 已缓存，下次 connect 事件会走 token 复用路径同步 emit
      if (!this.socket?.connected) {
        getLogger().warn('[desktop-socket] socket disconnected during login, defer auth to next connect');
        return;
      }
      this.emit('desktop:auth', { user_id: this.userId, token: result.token, machine_name: this.machineName });
    } finally {
      this.authenticating = false;
    }
  }

  // 调 POST /api/auth/login 用 { user_id, user_password } 换 token
  // 用户在登录页输入的"密码"实际就是 user_password，cloud 校验后返回 token
  // 拿到 token 后 emit desktop:auth，cloud 端 socket.io 用 token 完成 socket 认证
  // 返回: { token } 或 { error } —— 将实际错误原因逐层传递到 UI
  private async login(userPassword: string): Promise<{ token: string } | { error: string }> {
    if (!this.url) return { error: '云服务地址未配置' };

    try {
      // 忽略 TLS 证书校验：临时设全局环境变量（fetch 不支持 dispatcher 选项的类型声明）
      const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      let res: Response;
      try {
        res = await fetch(`${this.url}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: this.userId, user_password: userPassword }),
          signal: AbortSignal.timeout(10_000),
        });
      } finally {
        if (savedEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
      }
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        getLogger().info(`[desktop-socket] /api/auth/login status=${res.status} body=${text.slice(0, 300)}`);
        if (parsed?.success && parsed.token) {
          getLogger().info(`[desktop-socket] login ok user=${this.userId}`);
          return { token: parsed.token as string };
        }
        // API 返回了 JSON 但 success=false 或没有 token
        const apiError = parsed?.error
          || (res.status === 401 || res.status === 403 ? '用户名或密码错误' : '')
          || (res.status >= 500 ? `服务器内部错误 (${res.status})` : `登录失败 (${res.status})`);
        getLogger().error(`[desktop-socket] login failed: ${apiError}`);
        return { error: apiError };
      } catch {
        // 非 JSON 响应
        getLogger().warn(`[desktop-socket] /api/auth/login non-JSON response status=${res.status}: ${text.slice(0, 120)}`);
        if (res.status >= 500) return { error: `服务器内部错误 (${res.status})` };
        if (res.status === 404) return { error: '云服务地址不正确，接口不存在 (404)' };
        return { error: `服务器返回了无效的响应格式 (${res.status})` };
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      getLogger().warn(`[desktop-socket] /api/auth/login error: ${msg}`);
      notifyExternal({ source: 'cloud:auth', level: 'error', message: `云端登录失败: ${errMessage(err)}` });
      if (msg.includes('timeout') || msg.includes('abort') || msg.includes('AbortError')) {
        return { error: '连接超时，请检查网络或云服务地址是否正确' };
      }
      if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
        return { error: `网络连接失败：${msg}` };
      }
      return { error: `登录请求失败：${msg}` };
    }
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
    // 统一填充 machine_name（调用方未显式指定时用 config 里的机器名）
    const enriched = sessions.map((s) => ({ ...s, machine_name: s.machine_name ?? this.machineName }));
    // 未认证时直接 emit 会被 socket 缓冲（如果 transports 支持），但更稳妥是认证后再发
    // 这里直接 emit，未连接时 emit 内部会丢弃并打 warn；认证成功的回调里也会 flush
    this.emit('desktop:session:sync', { sessions: enriched });
    return Promise.resolve();
  }

  private emit(event: string, data: unknown): void {
    if (!this.socket?.connected) {
      getLogger().warn(`[desktop-socket] not connected, dropping ${event}`);
      notifyExternal({ source: 'cloud:send', level: 'warn', message: `云端未连接，事件已丢弃 (${event})`, throttleMs: 30_000 });
      return;
    }
    if (this.state !== 'authenticated' && event !== 'desktop:auth') {
      getLogger().warn(`[desktop-socket] not authenticated, dropping ${event}`);
      notifyExternal({ source: 'cloud:auth', level: 'warn', message: `云端未认证，事件已丢弃 (${event})`, throttleMs: 30_000 });
      return;
    }
    getLogger().info(`[desktop-socket] emit ${event} data=${JSON.stringify(data ?? '').slice(0, 200)}`);
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
      notifyExternal({ source: 'cloud:socket', level: 'warn', message: `云端连接断开异常: ${errMessage(err)}` });
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
  }
}
