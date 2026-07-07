# Lynel Desktop —— 从 Wails + Go 迁移到 Electron 设计文档

**日期**: 2026-07-06  
**作者**: Brainstorming session  
**状态**: 待用户审阅

## 1. 概述

当前 `lynel-desktop` 是基于 Wails v2 + Go 的跨平台桌面应用，用于管理本地 Claude Code 会话。由于需要集成 Node.js 开发的 `wecom-openclaw-plugin`（企业微信 OpenClaw 插件），继续使用 Wails+Go 会带来大量 Go ↔ Node.js 的胶水代码。

本设计目标是将 `lynel-desktop` 从 Wails + Go 迁移到 **Electron + Node.js + Vue 3**，同时保留现有前端交互，复用已经打磨过的 Vue 组件与状态管理。

## 2. 范围

### 2.1 在范围内

- **Electron 主进程搭建**：窗口、托盘、单实例锁、菜单、生命周期。
- **前端复用**：保留 Vue 3 / Pinia / vue-router / xterm.js 代码，仅替换 IPC 层。
- **Go 后端迁移到 Node.js**：session、pty、process、hookserver、apiproxy、jsonl、auth、settings、instance、log。
- **Channel 输出抽象**：把 `apiproxy` 解析出的阶段数据分发到多个输出 channel。
  - **HTTP SSE channel**：保持原有 `/api/sessions/{id}/calls/stream` 行为。
  - **WeCom channel**：通过 `wecom-openclaw-plugin` 或企微 API 把关键事件转发到企业微信机器人/应用。
  - 预留扩展接口，后续支持 Slack、钉钉等 channel。
- **构建与打包**：`electron-builder` 三平台产物（exe / dmg / AppImage）。

### 2.2 不在范围内（本次不做）

- 前端 UI 大规模重设计（仅做最小适配）。
- 自动更新（`electron-updater` 可预留位置，本次不接入）。
- 代码签名 / 公证。
- 除 SSE 与 WeCom 外的其他 channel 具体实现（只留扩展接口）。

## 3. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main (Node.js + TypeScript)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Session     │ │ HookServer  │ │ API Proxy   │           │
│  │ Manager     │ │ (Express)   │ │ (MITM)      │           │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘           │
│         │               │               │                   │
│  ┌──────┴───────────────┴───────────────┴──────┐           │
│  │  Channel Dispatcher                          │           │
│  │  ┌─────────────┐ ┌─────────────────────┐    │           │
│  │  │ SSE Channel │ │ WeCom Channel       │    │           │
│  │  └─────────────┘ └─────────────────────┘    │           │
│  └─────────────────────────────────────────────┘           │
│                          │                                  │
│  IPC (contextBridge)     ▼                                  │
├─────────────────────────────────────────────────────────────┤
│  Electron Renderer (Vue 3 + Pinia)                          │
│  复用现有 views/components/composables                       │
│  仅 `useWails.ts` 替换为 `useElectron.ts`                    │
└─────────────────────────────────────────────────────────────┘
```

## 4. 模块映射

| 当前 Go 包 | 目标 Node.js 模块 | 说明 |
|---|---|---|
| `internal/app` | `src/main/app.ts` | Wails binding 改 `ipcMain` 处理器 |
| `internal/session` | `src/main/session.ts` | 会话状态机 |
| `internal/pty` | `node-pty` | 直接替换 |
| `internal/process` | Node `child_process` | `spawn` / `kill` |
| `internal/hookserver` | `src/main/hookserver.ts` | Express HTTP server |
| `internal/apiproxy` | `src/main/apiproxy.ts` | HTTP 代理 + Channel 分发 |
| `internal/jsonl` | `src/main/jsonl.ts` | `fs` + `chokidar` |
| `internal/auth` | `src/main/auth.ts` | `bcryptjs` 替换 bcrypt |
| `internal/settings` / `internal/instance` | `src/main/store.ts` | 本地 JSON 持久化 |
| `internal/tray` | Electron `Tray` | 内置能力 |
| `internal/single` | `app.requestSingleInstanceLock` | 内置能力 |
| `internal/terminal` | 移除或保留兜底 | Electron 内以 xterm 为主 |
| `internal/events` | Node `EventEmitter` | 进程内事件总线 |
| `internal/log` | `electron-log` 或 `winston` | 日志滚动 |

## 5. Channel 输出层设计

### 5.1 接口

```ts
// src/main/channels/channel.ts
export interface OutputChannel {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  send(event: ProxyStageEvent): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface ProxyStageEvent {
  seq: number;
  turn: number;
  sessionId: string;
  workDir: string;
  kind: 'prompt' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  payload: unknown;
  timestamp: number;
}
```

### 5.2 Dispatcher

`apiproxy` 在写入 `calls.jsonl` 后，把同一条事件推给 `ChannelDispatcher`：

```ts
// src/main/channels/registry.ts
class ChannelDispatcher {
  private channels: OutputChannel[] = [];

  register(channel: OutputChannel): void;
  unregister(id: string): void;
  dispatch(event: ProxyStageEvent): Promise<void>;
}
```

Dispatcher 对单个 channel 的错误做隔离捕获，避免一个 channel 失败影响其他 channel。

### 5.3 SSE Channel

保持与现有前端兼容：

- `GET /api/sessions/{id}/calls?workDir=...`
- `GET /api/sessions/{id}/calls/stream?workDir=...`
- `GET /api/calls/{seq}`

### 5.4 WeCom Channel

通过 `wecom-openclaw-plugin` 的公开能力发送企业微信消息：

- 只发送「需要人感知」的事件，避免刷屏：
  - `PermissionRequest`
  - `SessionEnd`
  - `tool_result` 中exitCode != 0 的失败
  - 可配置的关键 tool_use 开始/结束
- 调用插件的 `sendWeComMessage` 或等效 API。
- chatId / chatType 通过 sessionKey 关联，大小写保持原始值。

配置示例（`~/.lynel-desktop/settings.json`）：

```json
{
  "outputChannels": {
    "sse": { "enabled": true },
    "wecom": {
      "enabled": true,
      "botId": "...",
      "secret": "...",
      "agent": { "corpId": "...", "corpSecret": "...", "agentId": 1000002 }
    }
  }
}
```

## 6. 前端改动

### 6.1 IPC 层替换

- 删除 `frontend/src/composables/useWails.ts`
- 新增 `frontend/src/composables/useElectron.ts`
- 方法签名保持不变，底层改为 `window.electronAPI.xxx()`

### 6.2 contextBridge 暴露

```ts
// electron/preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  isInitialized: () => ipcRenderer.invoke('app:isInitialized'),
  verify: (pw: string) => ipcRenderer.invoke('app:verify', pw),
  // ... 其余方法一一映射
  eventsOn: (channel: string, cb: (...args: any[]) => void) => { ... },
  windowMinimise: () => ipcRenderer.send('window:minimise'),
  // ...
});
```

### 6.3 无需改动的部分

- Vue 组件（除 TitleBar 等直接调用 window.runtime 的少量组件外）
- Pinia stores
- vue-router 配置
- CSS 主题变量
- xterm.js 终端组件

## 7. 数据流

### 7.1 新建 session

1. 前端 `useSessionsStore.create(workDir, prompt)` → `ipcRenderer.invoke('app:createSession', ...)`
2. 主进程 `node-pty` 启动 `claude`（`ModeAuto`）
3. 启动本地 `apiproxy`，注入 `ANTHROPIC_BASE_URL`
4. `SessionStart` hook 通过 `session-start.sh/ps1` → curl → `hookserver`
5. 主进程拿到真实 UUID，迁移 proxy token → real sessionId
6. 注册 session，启动 PTY 事件泵送
7. 前端根据 UUID 插入占位，等 `sessions:list:changed` 刷新

### 7.2 消息发送

1. 前端 `SendMessage(sessionId, prompt)`
2. 主进程 `session.send(prompt)`，自动补 `\r`
3. Claude CLI 处理并输出 ANSI
4. `node-pty` 输出 → 前端 `session:<id>` 事件 → xterm.js 写入
5. 同时 `apiproxy` 拦截 API 请求，解析阶段数据 → dispatcher → SSE / WeCom

### 7.3 外部 HTTP 写入

`POST /api/send` 保持不变：未启动的 session 自动 `claude --resume <sid>` 后写入 PTY。

## 8. 构建与打包

### 8.1 新增文件

```
lynel-desktop/
├── electron/
│   ├── main.ts          # 主进程入口
│   ├── preload.ts       # contextBridge
│   └── vite.config.ts   # 主进程/预加载构建
├── frontend/            # 现有 Vue 前端，保留
├── package.json         # 根 package，新增 Electron 脚本与依赖
├── electron-builder.yml # 打包配置
└── tsconfig.electron.json
```

### 8.2 package.json 脚本示例

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:electron\"",
    "dev:frontend": "cd frontend && vite",
    "dev:electron": "tsc -p tsconfig.electron.json --watch",
    "build": "npm run build:frontend && npm run build:electron",
    "build:frontend": "cd frontend && vue-tsc --noEmit && vite build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "dist": "electron-builder",
    "dist:win": "electron-builder --win",
    "dist:mac": "electron-builder --mac",
    "dist:linux": "electron-builder --linux"
  }
}
```

### 8.3 产物

| 平台 | 产物 |
|---|---|
| Windows | `lynel-desktop Setup.exe` |
| macOS | `lynel-desktop.dmg` |
| Linux | `lynel-desktop.AppImage` |

包体预计 80–150MB（Electron 自带 Chromium）。

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `node-pty` Windows 下命令行转义差异 | 高 | 参考现有 `exec_windows.go`，用 `COMSPEC` 原生命令行 |
| Electron 包体与启动速度劣化 | 中 | 延迟加载非核心模块、启用 asar、合理分包 |
| Go 并发模型迁移到 Node 事件循环 | 中 | 耗时操作放 worker_thread，主进程保持非阻塞 |
| 企微 chatId 大小写敏感 | 中 | WeCom channel 内始终使用原始大小写 |
| 单实例锁迁移 | 低 | 使用 `app.requestSingleInstanceLock` |
| 前端 `window.go` 全局类型删除 | 低 | 统一收口到 `useElectron.ts`，类型声明同步更新 |

## 10. 人天估算

按 1 名熟悉 Node.js + Electron 的全栈开发：

| 阶段 | 人天 |
|---|---|
| 1. Electron 壳搭建 + Vue 嵌入 + 窗口状态 | 3–4 |
| 2. Go 后端迁移（session/pty/process/jsonl/settings/instance） | 8–10 |
| 3. HookServer / API Proxy / SSE channel 重写 | 5–7 |
| 4. Channel Dispatcher + WeCom channel 集成 | 3–5 |
| 5. 前端 `useWails` → `useElectron` 替换 | 2–3 |
| 6. 打包、签名、跨平台测试 | 4–6 |
| 7. 回归测试 + bugfix | 5–7 |
| **总计** | **约 30–42 人天（6–8 周）** |

2 人并行（1 人主进程、1 人前端/打包）可压缩到 **4–5 周**。

## 11. 推荐迁移路径

1. **M0（第 1 周）**：Electron 壳跑起来，Vue 前端嵌入，窗口/托盘/登录页可交互。
2. **M1（第 2–3 周）**：核心后端迁移完成，session/pty/jsonl/settings 可工作。
3. **M2（第 4 周）**：HookServer + API Proxy + SSE channel 恢复原有能力。
4. **M3（第 5 周）**：Channel Dispatcher + WeCom channel 集成。
5. **M4（第 6 周）**：打包、三平台测试、bugfix。

## 12. 决策记录

- **方案 A（Electron 外壳 + 复用 Vue）** 优于方案 B（全量重写），因为可以保留已验证的前端交互，降低风险和周期。
- **WeCom 不作为 UI channel 直接嵌入**，而是作为 `apiproxy` 阶段数据的一个输出 channel，保持架构清晰且可扩展。
- **Node.js 主进程直接引入 `wecom-openclaw-plugin`**，避免 Go ↔ Node 胶水。
