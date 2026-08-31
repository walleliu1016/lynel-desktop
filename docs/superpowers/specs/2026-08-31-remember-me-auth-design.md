# 免登录（记住我）设计方案

- 日期：2026-08-31
- 状态：已批准

## 背景

当前登录每次启动都必须输入用户名 + 密码（PIN+Token）。`DesktopSocket` 的 `password`/`token` 均为纯内存，进程重启即失效；前端启动一律落 `/login`，`auth.loggedIn` 初始为 `false`，无任何持久化恢复路径。

历史：v0.0.12 曾实现「本地持久化 JWT → 启动时直接 `desktop:auth` 自动登录」，后被 commit `015efff`（简化登录、凭据纯内存）整体移除。本设计为其回归 + 增强版。

## 目标

- 上一次认证通过且勾选「记住我」时，启动免输入用户名密码直接进首页。
- 云服务未开启但已记住用户名时，同样跳过登录页直接进首页。
- 凭据不落明文，使用系统安全存储加密。

## 决策

| 决策点 | 结论 |
|---|---|
| 持久化凭据 | 仅持久化 JWT（token），密码永不留存 |
| 存储方式 | Electron `safeStorage`（OS 级加密：Windows DPAPI / macOS Keychain）；Linux 无 keyring 时 `isEncryptionAvailable() === false`，不持久化、退回登录 |
| 交互 | 登录页新增「记住我」勾选框（默认勾选）；退出登录清除已持久化 JWT |
| 云服务关闭 | 已记住用户名 → 跳过登录页直接进首页 |

## 架构

```
渲染进程                                     主进程
─────────                                   ─────
LoginView.onMounted                            App.start()
  ├─ app:auth:restoreState ────────────────►   loadStoredAuth()
  │   ◄── { cloudEnabled, remembered, username }   │
  │                                               ├─ 云开+有JWT → desktopSocket.restoreToken()
  │                                               └─ 触发 connect → ensureJwtAndAuth → desktop:auth
  ├─ EventsOn('auth:state', cb) ◄──────────  onStateChange → getBus().emit('auth:state')
  │      authenticated → 进首页
  │      auth_failed  → 显示表单（用户名预填、记住我勾选）
  │
  │  登录成功 → app:loginWithToken(user, pwd, remember)
  │       └─ remember=true → saveStoredAuth(userId, getToken())
```

## 详细设计

### 1. 新增 `src/main/auth-persistence.ts`

单一职责模块，封装 JWT 持久化。store 仍用 `getStore()`（`~/.lynel-desktop` 下 electron-store）。

- `saveStoredAuth(userId: string, jwt: string): boolean`
  - `safeStorage.isEncryptionAvailable()` 为 `false` → 直接返回 `false`（安全优先，不落盘）。
  - 否则 `safeStorage.encryptString(jwt)` 得 Buffer → base64 写入 store key `auth_jwt_enc`。
- `loadStoredAuth(): { userId: string; jwt: string } | null`
  - 读 `auth_jwt_enc`（无则 null）。
  - `safeStorage.decryptString(Buffer.from(b64, 'base64'))`；解密抛错（跨系统用户 / 跨机器）→ 调 `clearStoredAuth()` 并返回 null。
  - 返回的 `userId` 与 store 中 `currentUser` 不一致（换账户）→ 清掉并返回 null。
- `clearStoredAuth(): void`
  - 删除 `auth_jwt_enc`。

偏好开关：
- `auth_remember`（bool）：登录时勾选状态，默认 true。
- 用户名沿用已有 `currentUser`（明文，非敏感，用于 wecom 默认 ChatId）。

### 2. `src/main/channels/desktop-socket.ts` 小改

- 新增 `restoreToken(userId: string, jwt: string): void`：设置 `this.userId` + `this.token = jwt`，不触发 reconnect。配合启动既有 connect 流程，`ensureJwtAndAuth()` 会在 connect 事件后直接 emit `desktop:auth`（现有 token 复用路径已支持）。
- 新增 `getToken(): string | undefined`：返回 `this.token`，供 app.ts 登录成功后读取持久化。

### 3. `src/main/app.ts` 启动编排与 IPC

启动顺序（`App.start()` 内、`applyCloudSettings()` 之前）：
1. `loadStoredAuth()`：
   - 有 JWT 且云开启 → `desktopSocket.restoreToken(userId, jwt)`；随后 `applyCloudSettings()` 触发 connect，自动走 `desktop:auth`。
   - 有用户名且云关闭 → 仅渲染端直接进首页（用户名用 `currentUser`），主进程无额外动作。
2. `auth:failed` 回调（现有）追加 `clearStoredAuth()`（JWT 失效自愈，下次启动不再闪加载态）。
3. `onStateChange`（现有 `app.ts:527`）追加 `getBus().emit('auth:state', state)`，把认证状态推给渲染进程（`setWindow` 已代理 bus.emit → `webContents.send`）。

IPC 变更：
- `app:loginWithToken` 增加第三参 `remember: boolean`：
  - 成功后 `remember && isCloudEnabled()` → `saveStoredAuth(userId, this.desktopSocket.getToken())`。
  - `!remember` → `clearStoredAuth()`（清除历史残留，避免「取消勾选仍自动登录」）。
  - 同时写 store `auth_remember = remember`。
- 新增 `app:auth:restoreState` → 返回 `{ cloudEnabled: boolean, remembered: boolean, username: string }`：
  - `remembered = loadStoredAuth() !== null`（云开启且本地有可用 JWT）。
  - `username = getCurrentUserAccount()`。
- `app:logout` 追加 `clearStoredAuth()`。

`preload.ts` 与 `useElectron.ts` 同步暴露新 IPC 与事件：
- `loginWithToken(userId, token, remember)`（改签名）。
- `authRestoreState()`。
- `EventsOn('auth:state', cb)`（已有 `eventsOn` 助手，直接复用）。

### 4. 渲染进程

`stores/auth.ts`：
- 新增 `autoLoginState: 'none' | 'pending' | 'done'`。
- 新增 `tryAutoLogin(): Promise<'home' | 'form' | 'none'>`：按 `app:auth:restoreState` 分流，返回决策。

`views/LoginView.vue` onMounted：
1. 调 `app:auth:restoreState`：
   - `!cloudEnabled && username` → `loggedIn = true` + `router.push('/home')`（免登录直进）。
   - `cloudEnabled && remembered` → 设 `autoLoginState = 'pending'`，显示「正在自动登录...」加载态；`EventsOn('auth:state', cb)` 订阅（先取当前状态再订阅，防漏事件）：
     - `authenticated` → `loggedIn = true` + `router.push('/home')`。
     - `auth_failed` → `autoLoginState = 'none'`，退出加载态显示表单，用户名预填、记住我勾选。
   - 否则 → `autoLoginState = 'none'`，普通表单。
2. 表单新增「记住我」checkbox（默认勾选，读 `auth_remember`）。
3. onSubmit：`auth.login(username, password, remember)`，成功进首页逻辑不变。

### 5. 错误处理与边界

| 场景 | 行为 |
|---|---|
| JWT 过期 / 云地址变更 / 账户变更 | `auth:failed` → 自动 `clearStoredAuth()` → 显示登录表单 |
| 跨系统用户 / 跨机器 | safeStorage 解密抛错 → 清掉并退回登录 |
| Linux 无 keyring | `isEncryptionAvailable()` false → 不持久化，静默降级为每次登录 |
| 云开启→关闭，残留 JWT | 不读取、无害 |
| 网络不可达（启动时 auth 无响应） | socket 停在 connecting/reconnecting，加载态持续；需兜底超时退出加载态（建议 15s，显示表单） |

补充：加载态需超时兜底（如 15s），避免网络异常时登录页无限转菊花。

### 6. 测试

- `tests/main/auth-persistence.test.ts`：加密往返、解密失败清理、加密不可用拒绝写入、userId 不一致清理。
- `tests/main/desktop-socket.test.ts`：`restoreToken` 后 connect → 直接 emit `desktop:auth`（mock socket / mock login）。
- `tests/main/app.test.ts`：`app:auth:restoreState` 三分支（云开+记住 / 云关+用户名 / 无记录）；`loginWithToken` 带 remember 的持久化/清理路径。

## 影响面

- 新增文件：`src/main/auth-persistence.ts`、`tests/main/auth-persistence.test.ts`。
- 修改：`src/main/channels/desktop-socket.ts`、`src/main/app.ts`、`src/main/preload.ts`、`src/renderer/src/composables/useElectron.ts`、`src/renderer/src/stores/auth.ts`、`src/renderer/src/views/LoginView.vue`。
