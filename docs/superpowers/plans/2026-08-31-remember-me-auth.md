# 免登录（记住我）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上次认证通过且勾选「记住我」时，启动免输入用户名密码直接进首页；云服务关闭且已记住用户名时同样跳过登录页。

**Architecture:** 登录成功后把 JWT 用 Electron `safeStorage`（OS 加密）持久化到 settingsStore；启动时在主进程恢复 token 并注入 `DesktopSocket`，socket connect 后走既有 `desktop:auth` 认证；渲染进程通过新 IPC `app:auth:restoreState` + 事件 `auth:state` 分流：直接进首页 / 显示「自动登录中」/ 显示表单。

**Tech Stack:** Electron（`safeStorage`）、socket.io-client、electron-store、Vitest、Vue 3 Pinia。

## Global Constraints

- 密码永不留存；仅持久化 JWT。
- `safeStorage.isEncryptionAvailable() === false`（如 Linux 无 keyring）→ 不持久化，静默降级为每次登录。
- `ensureJwtAndAuth` 中 token 检查必须先于 password 检查（否则恢复的 token 会被 `!password` 分支短路）。
- 渲染进程改动无单测（renderer `test` 脚本是占位符），用 `vue-tsc` + 手动验证。
- 注释与 commit message 用简体中文。

---

### Task 1: `auth-persistence.ts` 持久化模块 + 单测

**Files:**
- Create: `src/main/auth-persistence.ts`
- Create: `tests/main/auth-persistence.test.ts`

**Interfaces:**
- Produces（后续 Task 3 依赖）:
  - `saveStoredAuth(userId: string, jwt: string): boolean` — 加密写入，成功 true；加密不可用 false。
  - `loadStoredAuth(): { userId: string; jwt: string } | null`
  - `clearStoredAuth(): void`
  - `decideRestore(cloudEnabled: boolean, hasStoredJwt: boolean, username: string): 'home' | 'pending' | 'form'`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/auth-persistence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeStorage } from 'electron';
import { getStore } from '../../src/main/store.js';
import {
  saveStoredAuth,
  loadStoredAuth,
  clearStoredAuth,
  decideRestore,
} from '../../src/main/auth-persistence.js';

const store = vi.hoisted(() => ({
  _data: {} as Record<string, unknown>,
  get(key: string) { return (this as any)._data[key]; },
  set(key: string, val: unknown) { (this as any)._data[key] = val; },
  delete(key: string) { delete (this as any)._data[key]; },
  get store() { return (this as any)._data; },
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, '')),
  },
}));

vi.mock('../../src/main/store.js', () => ({ getStore: () => store }));

describe('auth-persistence', () => {
  beforeEach(() => { store._data = {}; vi.clearAllMocks(); });

  it('保存后可解密取回', () => {
    expect(saveStoredAuth('u1', 'jwt-abc')).toBe(true);
    expect(loadStoredAuth()).toEqual({ userId: 'u1', jwt: 'jwt-abc' });
  });

  it('加密不可用时不持久化且返回 false', () => {
    (safeStorage.isEncryptionAvailable as any).mockReturnValue(false);
    expect(saveStoredAuth('u1', 'jwt')).toBe(false);
    expect(loadStoredAuth()).toBeNull();
  });

  it('解密失败时清理并返回 null', () => {
    saveStoredAuth('u1', 'jwt-abc');
    (safeStorage.decryptString as any).mockImplementation(() => { throw new Error('decrypt failed'); });
    expect(loadStoredAuth()).toBeNull();
    expect(store.get('auth_jwt_enc')).toBeUndefined();
  });

  it('currentUser 缺失时清理并返回 null', () => {
    saveStoredAuth('u1', 'jwt-abc');
    store.delete('currentUser');
    expect(loadStoredAuth()).toBeNull();
    expect(store.get('auth_jwt_enc')).toBeUndefined();
  });

  it('clearStoredAuth 删除 JWT', () => {
    saveStoredAuth('u1', 'jwt-abc');
    clearStoredAuth();
    expect(loadStoredAuth()).toBeNull();
  });

  it('decideRestore 三分支', () => {
    expect(decideRestore(false, false, 'u1')).toBe('home');
    expect(decideRestore(false, true, 'u1')).toBe('home');
    expect(decideRestore(true, true, 'u1')).toBe('pending');
    expect(decideRestore(true, false, 'u1')).toBe('form');
    expect(decideRestore(false, false, '')).toBe('form');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/auth-persistence.test.ts`
Expected: FAIL（`auth-persistence.js` 模块不存在 / 导入错误）。

- [ ] **Step 3: 实现 `src/main/auth-persistence.ts`**

```ts
// src/main/auth-persistence.ts
import { safeStorage } from 'electron';
import { getStore } from './store.js';

const JWT_KEY = 'auth_jwt_enc';

export interface StoredAuth {
  userId: string;
  jwt: string;
}

export type RestoreDecision = 'home' | 'pending' | 'form';

/** 启动分流决策：云关闭+已记住用户名 → 直接进首页；云开启+有可用 JWT → 自动登录；否则 → 表单 */
export function decideRestore(
  cloudEnabled: boolean,
  hasStoredJwt: boolean,
  username: string,
): RestoreDecision {
  if (!cloudEnabled && username) return 'home';
  if (cloudEnabled && hasStoredJwt) return 'pending';
  return 'form';
}

/** 加密持久化 JWT；safeStorage 不可用时拒绝落盘（安全优先） */
export function saveStoredAuth(userId: string, jwt: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  getStore('settings').set(JWT_KEY, safeStorage.encryptString(jwt).toString('base64'));
  getStore('settings').set('currentUser', userId);
  return true;
}

/** 读取并解密 JWT；解密失败或 currentUser 缺失时清理并返回 null */
export function loadStoredAuth(): StoredAuth | null {
  const raw = getStore('settings').get(JWT_KEY) as string | undefined;
  if (!raw) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    clearStoredAuth();
    return null;
  }
  let jwt: string;
  try {
    jwt = safeStorage.decryptString(Buffer.from(raw, 'base64'));
  } catch {
    clearStoredAuth();
    return null;
  }
  const userId = getStore('settings').get('currentUser') as string | undefined;
  if (!userId) {
    clearStoredAuth();
    return null;
  }
  return { userId, jwt };
}

/** 清除持久化 JWT */
export function clearStoredAuth(): void {
  getStore('settings').delete(JWT_KEY);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/auth-persistence.test.ts`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/main/auth-persistence.ts tests/main/auth-persistence.test.ts
git commit -m "feat: auth-persistence 模块，JWT 用 safeStorage 加密持久化 + 启动分流决策"
```

---

### Task 2: `DesktopSocket` restoreToken / getToken / token 优先认证 + 单测

**Files:**
- Modify: `src/main/channels/desktop-socket.ts`（`clearCredentials()` 之后新增方法；`ensureJwtAndAuth()` 调整顺序；更新头部注释）
- Create: `tests/main/channels/desktop-socket.test.ts`

**Interfaces:**
- Consumes: —（独立）
- Produces（后续 Task 3 依赖）:
  - `restoreToken(userId: string, jwt: string): void` — 注入内存 token，不触发重连。
  - `getToken(): string | undefined` — 读当前内存 token。

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/channels/desktop-socket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopSocket } from '../../../src/main/channels/desktop-socket.js';

function makeSocket(): DesktopSocket {
  const ds = new DesktopSocket();
  (ds as any).url = 'https://cloud.example.com';
  (ds as any).enabled = true;
  return ds;
}

describe('DesktopSocket restoreToken / token-first auth', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('restoreToken 设置 userId+token，getToken 可读回', () => {
    const ds = makeSocket();
    ds.restoreToken('u1', 'jwt-abc');
    expect(ds.getToken()).toBe('jwt-abc');
    expect((ds as any).userId).toBe('u1');
  });

  it('有 token 时 ensureJwtAndAuth 直接 emit desktop:auth，不调 login', async () => {
    const ds = makeSocket();
    ds.restoreToken('u1', 'jwt-abc');
    (ds as any).password = 'pw-ignored';
    const emitSpy = vi.fn();
    (ds as any).socket = { connected: true, emit: emitSpy };
    const loginSpy = vi.spyOn(ds as any, 'login').mockResolvedValue({ token: 'never' });
    await (ds as any).ensureJwtAndAuth();
    expect(loginSpy).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('desktop:auth', {
      user_id: 'u1',
      token: 'jwt-abc',
      machine_name: expect.any(String),
    });
  });

  it('无 token 有密码时走 login 换 token 再 emit', async () => {
    const ds = makeSocket();
    (ds as any).password = 'pw';
    const emitSpy = vi.fn();
    (ds as any).socket = { connected: true, emit: emitSpy };
    vi.spyOn(ds as any, 'login').mockResolvedValue({ token: 'new-token' });
    await (ds as any).ensureJwtAndAuth();
    expect(emitSpy).toHaveBeenCalledWith('desktop:auth', expect.objectContaining({ token: 'new-token' }));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/channels/desktop-socket.test.ts`
Expected: FAIL（`restoreToken` / `getToken` 不存在；token 优先逻辑未生效——token 分支被 `!password` 短路）。

- [ ] **Step 3: 实现**

在 `clearCredentials()` 方法（`desktop-socket.ts:156-159`）之后新增：

```ts
  /** 启动恢复：注入上次认证的 JWT，不触发重连；connect 后 ensureJwtAndAuth 直接 emit desktop:auth */
  restoreToken(userId: string, jwt: string): void {
    this.userId = userId;
    this.token = jwt;
  }

  /** 读取当前内存 token（供 app 登录成功后持久化） */
  getToken(): string | undefined {
    return this.token;
  }
```

调整 `ensureJwtAndAuth()`（当前 `desktop-socket.ts:334-343`）——把 token 检查移到 password 检查之前：

```ts
    try {
      // 已有 token -> 直接 emit（启动恢复 / 重连复用，避免重复 login）
      if (this.token) {
        this.emit('desktop:auth', { user_id: this.userId, token: this.token, machine_name: this.machineName });
        return;
      }
      if (!this.password) {
        getLogger().warn('[desktop-socket] no password, waiting for login');
        return;
      }
      // 无 token -> 调 /api/auth/login 用密码换 token
      const result = await this.login(this.password);
```

同步更新文件头部注释（`desktop-socket.ts:2`），把「token 纯内存，每次启动需重新登录」改为「token 可由启动恢复注入（免登录），password 仍纯内存」：

```ts
// DesktopSocket: Socket.IO 上行通道 -> 云服务
// 认证流程：
//   1. 登录页输入 user_id + token -> app:loginWithToken
//   2. 主进程 desktopSocket.setToken(token) 内存缓存 + applyCloudSettings 触发 reconnect
//   3. socket 连接建立 -> ensureJwtAndAuth -> 有 token 直接 emit desktop:auth；无 token 用 password 换
//   4. cloud 校验 token 通过 -> emit desktop:auth { user_id, token }
//   5. cloud 返回 auth:success -> 状态 authenticated -> 进 home
//   6. token 无效 -> auth:failed -> 清内存 token，等用户重新登录
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/channels/desktop-socket.test.ts`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/main/channels/desktop-socket.ts tests/main/channels/desktop-socket.test.ts
git commit -m "feat: DesktopSocket 支持启动恢复 token，认证改为 token 优先"
```

---

### Task 3: app.ts 启动编排 + IPC + preload / useElectron

**Files:**
- Modify: `src/main/app.ts`（import、`init()`、`onStateChange`、`app:loginWithToken`、`app:logout`、新增 `app:auth:restoreState`）
- Modify: `src/main/preload.ts:7-9`（`loginWithToken` 加 remember、新增 `authRestoreState`）
- Modify: `src/renderer/src/composables/useElectron.ts:17-18`（`LoginWithToken` 加 remember、新增 `AuthRestoreState`）

**Interfaces:**
- Consumes: Task 1 的 `loadStoredAuth` / `saveStoredAuth` / `clearStoredAuth`；Task 2 的 `restoreToken` / `getToken`。
- Produces（后续 Task 4 依赖）:
  - IPC `app:auth:restoreState` → `{ cloudEnabled: boolean; remembered: boolean; username: string }`
  - IPC `app:loginWithToken(userId, password, remember: boolean)`
  - 事件 `auth:state`（主进程 → 渲染，payload 为 `ConnectionState` 字符串）

- [ ] **Step 1: 确认基线全绿**

Run: `npm run test:main`
Expected: PASS（既有用例不受影响）。

- [ ] **Step 2: 加 import 与启动恢复**

`app.ts` 顶部 import 区（现有 `./store.js` 等附近）新增：

```ts
import { loadStoredAuth, saveStoredAuth, clearStoredAuth, decideRestore } from './auth-persistence.js';
```

`init()` 中 `this.applyCloudSettings()`（`app.ts:459`）之前插入 `this.restoreStoredAuth();`。

新增私有方法（放在 `applyCloudSettings()` 附近，`app.ts:681` 之前）：

```ts
  /** 启动恢复：把上次记住的 JWT 注入 desktopSocket，connect 后自动走 desktop:auth（云关闭时跳过） */
  private restoreStoredAuth(): void {
    const stored = loadStoredAuth();
    if (!stored) return;
    if (!this.isCloudEnabled()) return;
    this.desktopSocket.restoreToken(stored.userId, stored.jwt);
    getLogger().info(`[app] restored stored auth for user=${stored.userId}`);
  }
```

同步更新 `app.ts:388` 的过时注释：

```ts
  // cloud 密码仍只存内存（desktopSocket），进程重启即失效；JWT 可经 auth-persistence 加密恢复实现免登录
```

- [ ] **Step 3: onStateChange 推送 auth:state + auth_failed 清 JWT**

`app.ts:527-531` 的 `onStateChange` 改为：

```ts
    // cloud: 认证状态推送到渲染进程（免登录分流用）；auth_failed 时清掉失效 JWT
    this.desktopSocket.onStateChange = (state) => {
      getBus().emit('auth:state', state);
      if (state === 'auth_failed') {
        clearStoredAuth();
      }
      if (state === 'authenticated') {
        this.sendCloudSessionSnapshot();
      }
    };
```

- [ ] **Step 4: `app:loginWithToken` 加 remember 参数与持久化**

`app.ts:1377-1392` 改为：

```ts
    // 登录：调 cloud /api/auth/login 校验密码，成功即进主页
    // 密码 + token 纯内存；remember=true 时把 JWT 用 safeStorage 加密持久化，供下次启动免登录
    ipcMain.handle('app:loginWithToken', async (_event, userId: string, password: string, remember: boolean) => {
      if (!userId) return { ok: false, error: '请填写用户名' };
      if (!this.isCloudEnabled()) {
        // cloud 未启用：不需要密码，直接放行；清掉历史 JWT
        this.settingsStore.set('auth_remember', !!remember);
        clearStoredAuth();
        return { ok: true };
      }
      if (!password) return { ok: false, error: '请填写密码' };
      // 保存 user_id（用于 socket 认证 + 机器人默认 ChatId）
      try { this.setCurrentUserAccount(userId); } catch { /* ignore */ }
      // 调 cloud /api/auth/login 校验密码
      const result = await this.desktopSocket.verifyLogin(userId, password);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      this.settingsStore.set('auth_remember', !!remember);
      if (remember) {
        const jwt = this.desktopSocket.getToken();
        if (jwt) saveStoredAuth(userId, jwt);
      } else {
        clearStoredAuth();
      }
      return { ok: true };
    });
```

- [ ] **Step 5: `app:logout` 清持久化 JWT**

`app.ts:1395-1419` 的 `app:logout` 中，在 `this.desktopSocket.clearCredentials();`（当前 1415 行）之后插入：

```ts
      // 5. 清除持久化 JWT（记住我），避免退出后再启动又自动登录
      clearStoredAuth();
```

- [ ] **Step 6: 新增 `app:auth:restoreState` IPC**

在 `app:cloud:connectionState` handler（`app.ts:1950-1952`）之后新增：

```ts
    // 启动免登录分流查询：渲染进程据此决定 直接进首页 / 自动登录中 / 显示表单
    // username 读原始 currentUser 键（无则空串），避免回退 os 用户名被误判为"已记住"
    ipcMain.handle('app:auth:restoreState', () => {
      const cloudEnabled = this.isCloudEnabled();
      const remembered = loadStoredAuth() !== null;
      const username = (this.settingsStore.get('currentUser', '') as string) || '';
      const decision = decideRestore(cloudEnabled, remembered, username);
      return { cloudEnabled, remembered, username, decision };
    });
```

> 注意：不要用 `getCurrentUserAccount()`（其回退 `os.userInfo().username`，新装未登录也会返回非空，导致云关闭时误跳首页）。

- [ ] **Step 7: preload.ts 与 useElectron.ts 暴露**

`preload.ts:7-9` 改为：

```ts
  loginWithToken: (userId: string, token: string, remember: boolean) =>
    ipcRenderer.invoke('app:loginWithToken', userId, token, remember),
```

`preload.ts` 中 `logout`（第 9 行）之后新增：

```ts
  authRestoreState: () => ipcRenderer.invoke('app:auth:restoreState'),
```

`useElectron.ts:17-18` 改为：

```ts
export const LoginWithToken = (userId: string, token: string, remember: boolean) =>
  api().loginWithToken(userId, token, remember);
export const AuthRestoreState = () => api().authRestoreState();
```

- [ ] **Step 8: 类型检查 + 测试全绿**

Run:
```bash
npx tsc
npm run test:main
```
Expected: `tsc` 无报错；`npm run test:main` 全绿（含 Task 1/2 新用例）。

- [ ] **Step 9: 提交**

```bash
git add src/main/app.ts src/main/preload.ts src/renderer/src/composables/useElectron.ts
git commit -m "feat: 启动恢复 JWT 自动认证 + app:auth:restoreState IPC + 登录/退出持久化凭据"
```

---

### Task 4: 渲染进程 auth store + LoginView 记住我

**Files:**
- Modify: `src/renderer/src/stores/auth.ts`
- Modify: `src/renderer/src/views/LoginView.vue`

**Interfaces:**
- Consumes: Task 3 的 `app:auth:restoreState`（`AuthRestoreState`）、`app:loginWithToken(userId, password, remember)`（`LoginWithToken`）、事件 `auth:state`（`EventsOn`）、`app:cloud:connectionState`（`CloudConnectionState`）。
- Produces: auth store `autoLoginState: 'none' | 'pending' | 'done'`、`tryAutoLogin(): Promise<'home' | 'pending' | 'form'>`、`markAuthenticated()`。

- [ ] **Step 1: 重写 `stores/auth.ts`**

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LoginWithToken, AuthRestoreState } from '../composables/useElectron'

export type AutoLoginState = 'none' | 'pending' | 'done'

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false)
  const autoLoginState = ref<AutoLoginState>('none')

  // 登录：直接拿 user_id + token 调 cloud /api/auth/login
  // 成功 -> loggedIn = true；remember 决定是否持久化 JWT（主进程处理）
  async function login(userId: string, token: string, remember: boolean): Promise<string | null> {
    try {
      const r = await LoginWithToken(userId, token, remember)
      if (r?.ok) {
        loggedIn.value = true
        autoLoginState.value = 'done'
        return null
      }
      return r?.error ?? '登录失败'
    } catch (e: any) {
      return e?.message ?? '登录失败'
    }
  }

  // 启动免登录分流：决策由主进程 decideRestore 纯函数算好（'home'|'pending'|'form'），这里只消费
  async function tryAutoLogin(): Promise<'home' | 'pending' | 'form'> {
    try {
      const s = await AuthRestoreState()
      if (s?.decision === 'home') {
        loggedIn.value = true
        autoLoginState.value = 'done'
        return 'home'
      }
      if (s?.decision === 'pending') {
        autoLoginState.value = 'pending'
        return 'pending'
      }
      return 'form'
    } catch {
      return 'form'
    }
  }

  function markAuthenticated() {
    loggedIn.value = true
    autoLoginState.value = 'done'
  }

  function logout() {
    loggedIn.value = false
    autoLoginState.value = 'none'
  }

  return { loggedIn, autoLoginState, login, tryAutoLogin, markAuthenticated, logout }
})
```

- [ ] **Step 2: LoginView script 改造**

`LoginView.vue` import 区新增：

```ts
import { AuthRestoreState, CloudConnectionState, EventsOn } from '../composables/useElectron'
```

（`useElectron` import 已有，合并入现有那一行 import；现有 `LoginWithToken` 相关仍走 `auth.login`。）

新增状态与逻辑（放在 `onMounted` 之前）：

```ts
const authStore = auth // 已有 const auth = useAuthStore()
const remember = ref(true)
let authStateUnsub: (() => void) | null = null
let autoLoginTimer: ReturnType<typeof setTimeout> | null = null

const showForm = computed(() => auth.autoLoginState !== 'pending')
```

`onMounted` 中，在取到 `cfg` 后加 `remember.value = cfg.auth_remember !== false`，并在末尾追加：

```ts
  // 启动免登录分流
  try { await runAutoLogin() } catch {}
```

新增方法：

```ts
async function runAutoLogin() {
  const decision = await auth.tryAutoLogin()
  if (decision === 'home') {
    await enterHome()
    return
  }
  if (decision === 'pending') {
    // 先查当前 socket 状态，防止订阅前已认证
    try {
      const s = await CloudConnectionState()
      if (s?.state === 'authenticated') {
        auth.markAuthenticated()
        await enterHome()
        return
      }
    } catch {}
    authStateUnsub = EventsOn('auth:state', (state: string) => {
      if (state === 'authenticated') {
        cleanupAutoLogin()
        auth.markAuthenticated()
        void enterHome()
      } else if (state === 'auth_failed') {
        cleanupAutoLogin()
      }
    })
    // 超时兜底 15s：网络异常时退出加载态，显示表单
    autoLoginTimer = setTimeout(() => { cleanupAutoLogin() }, 15_000)
  }
}

function cleanupAutoLogin() {
  if (authStateUnsub) { authStateUnsub(); authStateUnsub = null }
  if (autoLoginTimer) { clearTimeout(autoLoginTimer); autoLoginTimer = null }
}

async function enterHome() {
  try { await win.applyHomeLayout() } catch {}
  try { WindowCenter() } catch {}
  router.push('/home')
}
```

新增 `onBeforeUnmount` 清理：

```ts
onBeforeUnmount(() => { cleanupAutoLogin() })
```

（`onBeforeUnmount` 从 `vue` 引入，合并现有 `import { ref, onMounted, computed, watch } from 'vue'`。）

`onSubmit` 中 `auth.login(...)` 调用改为：

```ts
  const err = await auth.login(username.value.trim(), token.value, remember.value)
```

- [ ] **Step 3: LoginView template 改造**

「记住我」开关（放在登录按钮之前、`.cloud-section` 之后）：

```html
          <label class="remember-row">
            <Switch v-model="remember" />
            <span class="remember-label">记住我（下次免登录）</span>
          </label>
```

表单区用 `v-if="showForm"` 包裹（`<form>` 内、按钮 + footer 一起），并在卡片内表单之前加加载态：

```html
        <div v-if="!showForm" class="auto-login">
          <Icon name="loader-circle" :size="20" class="spin" />
          <span>正在自动登录...</span>
        </div>
        <form v-else @submit.prevent="onSubmit" class="form">
```

样式追加（scoped）：

```css
.remember-row {
  display: flex; align-items: center; gap: 8px;
  margin: 6px 0 2px;
  color: var(--text-secondary); font-size: 12px; cursor: pointer;
}
.remember-label { font-size: 12px; color: var(--text-secondary); }
.auto-login {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 26px 0; color: var(--text-secondary); font-size: 13px;
}
.auto-login .spin { animation: auth-spin 1s linear infinite; }
@keyframes auth-spin { to { transform: rotate(360deg); } }
```

> 注意：`Icon` 组件需确认 `loader-circle` 图标存在；若无，改用现有已用图标（如 `settings`）或 `alert-circle`。`Icon.vue` 基于 `@lucide/vue`，`loader-circle` 在 lucide 中存在。

- [ ] **Step 4: 类型检查**

Run:
```bash
cd src/renderer && npx vue-tsc --noEmit
```
Expected: 无报错。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/stores/auth.ts src/renderer/src/views/LoginView.vue
git commit -m "feat: 登录页记住我勾选 + 启动免登录分流（自动登录加载态）"
```

---

### Task 5: 全量验证与手动回归

- [ ] **Step 1: 全量测试 + 类型检查**

Run:
```bash
npm run test:main
cd src/renderer && npx vue-tsc --noEmit
```
Expected: 全绿。

- [ ] **Step 2: 手动回归清单（`npm run dev`）**

- 全新启动（无 `auth_jwt_enc`）：显示登录表单，用户名/密码正常登录。
- 勾选「记住我」登录成功后重启：云开启 → 显示「正在自动登录...」→ 直接进首页；云关闭 → 直接进首页。
- 未勾选「记住我」登录后重启：显示表单（用户名为空）。
- JWT 失效（改云端密码 / 云地址）：启动时加载态短暂后回表单，且已自动清除 `auth_jwt_enc`（下次启动直接表单）。
- 退出登录：清 JWT，重启不再自动登录。
- 首页云状态正常显示（`authenticated`）、会话同步正常。

- [ ] **Step 3: 提交收尾（若手动回归有修复改动，单独 commit）**

---

## 自检结论

- Spec 覆盖：持久化模块→T1；DesktopSocket 恢复与 token 优先→T2；启动编排/IPC/preload/useElectron→T3；渲染分流/记住我 UI/超时兜底→T4；全量回归→T5。
- 无占位符；所有代码步骤含具体实现。
- 类型一致性：`restoreToken(userId, jwt)` / `getToken()` / `saveStoredAuth(userId, jwt)` / `loadStoredAuth()` / `clearStoredAuth()` / `decideRestore(...)` / `AuthRestoreState()` / `loginWithToken(userId, token, remember)` / `tryAutoLogin(): 'home'|'pending'|'form'` / `autoLoginState` / `markAuthenticated()` 在各任务间一致。
- 已知取舍：app.ts 的 IPC 装配为薄接线，未做单测（主进程依赖 electron 环境，repo 现无 app.ts 测试），以 `tsc` + 既有 `test:main` + 手动回归覆盖；spec 中「restoreState 三分支测试」以 `decideRestore` 纯函数测试等价覆盖。
