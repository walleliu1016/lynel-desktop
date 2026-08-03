# 在线升级功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Lynel Desktop 实现 electron-updater + 双源 fallback（GitHub → 云服务 HTTP）在线升级功能。

**Architecture:** 主进程 `src/main/updater/` 模块负责版本检测（自研 HTTP 请求 + fallback）和下载管理（委托 electron-updater），通过 IPC 与前端通信。前端在 Settings 页面展示升级区域。

**Tech Stack:** electron-updater, electron-builder publish config, undici (项目已有), electron-store (项目已有)

## Global Constraints

- 所有代码注释、commit message 用简体中文
- 平台覆盖：Windows (NSIS)、macOS (DMG)、Linux (AppImage)
- 仅 stable 通道走自动更新，beta 手动安装
- 当前无代码签名证书，跳过签名校验
- 更新配置持久化到 electron-store，名称为 `updater`
- IPC 模式遵循现有 `preload.ts` → `useElectron.ts` 模式
- 前端 Pinia 用 setup style，Vue 组件用 `<script setup lang="ts">`
- 样式用 `styles/theme.css` 的 CSS 变量，禁止硬编码颜色

---

### Task 1: 安装依赖 & 配置 electron-builder publish

**Files:**
- Modify: `package.json`
- Modify: `electron-builder.yml`

**Interfaces:**
- Produces: `electron-updater` 依赖就绪，构建产物包含 latest.yml 和 blockmap

- [ ] **Step 1: 安装 electron-updater**

```bash
cd "G:/work/lynel-desktop" && npm install electron-updater
```

- [ ] **Step 2: 在 electron-builder.yml 增加 publish 配置**

在 `electron-builder.yml` 末尾追加：

```yaml
publish:
  - provider: github
    owner: <your-org>
    repo: lynel-desktop
    releaseType: release
```

> 注：GitHub publish 配置用于生成 latest.yml / blockmap 元数据。owner/repo 后续需替换为实际值。实际检测时使用自研 checker，不依赖此 provider 的发布功能。

- [ ] **Step 3: 验证构建产物包含元数据**

```bash
cd "G:/work/lynel-desktop" && npm run dist:win
# 检查 dist/ 目录下是否生成 latest.yml 和 .blockmap 文件
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json electron-builder.yml
git commit -m "chore: 添加 electron-updater 依赖和 publish 配置"
```

---

### Task 2: 创建 updater 类型定义

**Files:**
- Create: `src/main/updater/types.ts`

**Interfaces:**
- Produces:
  - `UpdateInfo { version: string; releaseDate: string; releaseNotes: string; forceUpdate: boolean; downloadUrl: string; sha512: string; size: number }`
  - `UpdateState { status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update'; data?: { version?: string; percent?: number; speed?: number; error?: string } }`
  - `UpdateConfig { githubEnabled: boolean; httpEnabled: boolean; httpBaseUrl: string; channel: 'stable' }`
  - `CheckResult { hasUpdate: boolean; version?: string; releaseDate?: string; releaseNotes?: string; forceUpdate?: boolean; downloadUrl?: string; sha512?: string; size?: number }`
  - `CloudCheckResponse { hasUpdate: boolean; version?: string; releaseDate?: string; releaseNotes?: string; forceUpdate?: boolean; downloadUrl?: string; sha512?: string; size?: number }`

- [ ] **Step 1: 创建 types.ts**

```typescript
// 云服务检查更新响应
export interface CloudCheckResponse {
  hasUpdate: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  downloadUrl?: string;
  sha512?: string;
  size?: number;
}

// 内部统一检查结果
export interface CheckResult {
  hasUpdate: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
  downloadUrl?: string;
  sha512?: string;
  size?: number;
}

// 更新状态（推送给前端）
export interface UpdateState {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update';
  data?: {
    version?: string;
    percent?: number;
    speed?: number;
    error?: string;
  };
}

// 更新配置
export interface UpdateConfig {
  githubEnabled: boolean;
  httpEnabled: boolean;
  httpBaseUrl: string;
  channel: 'stable';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater/types.ts
git commit -m "feat: 添加在线升级类型定义"
```

---

### Task 3: 创建版本检测模块（checker.ts）

**Files:**
- Create: `src/main/updater/checker.ts`

**Interfaces:**
- Consumes: `CheckResult`, `CloudCheckResponse`, `UpdateConfig` from types.ts
- Produces: `checkForUpdates(config: UpdateConfig, currentVersion: string) => Promise<CheckResult>`

- [ ] **Step 1: 创建 checker.ts**

```typescript
import { getLogger } from '../log.js';
import type { CheckResult, CloudCheckResponse, UpdateConfig } from './types.js';
import os from 'node:os';

const logger = getLogger('updater:checker');
const TIMEOUT_MS = 10_000;

function platformParam(): string {
  switch (process.platform) {
    case 'win32': return 'win';
    case 'darwin': return 'mac';
    case 'linux': return 'linux';
    default: return process.platform;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function checkGitHub(
  _config: UpdateConfig,
  currentVersion: string,
): Promise<CheckResult | null> {
  const [owner, repo] = ['<owner>', 'lynel-desktop']; // TODO: 替换为实际值
  const platform = platformParam();
  const arch = os.arch();
  const ymlUrl = `https://github.com/${owner}/${repo}/releases/latest/download/latest.yml`;

  try {
    logger.info(`[checker] github check: ${ymlUrl}`);
    const resp = await fetchWithTimeout(ymlUrl, TIMEOUT_MS);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();

    // 解析 electron-builder latest.yml 格式
    const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const releaseDate = /^releaseDate:\s*(.+)$/m.exec(text)?.[1]?.trim();

    if (!version) throw new Error('version not found in latest.yml');

    if (version === currentVersion) {
      logger.info(`[checker] github: 已是最新 (${version})`);
      return { hasUpdate: false };
    }

    // 从 latest.yml 获取文件信息构建 download URL
    const pathLine = /^path:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    const sha512 = /^sha512:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    const downloadUrl = `https://github.com/${owner}/${repo}/releases/latest/download/${pathLine}`;

    // 尝试获取 release notes（如果有单独的 latest.json 或从 GitHub API）
    const size = 0; // GitHub latest.yml 中可能没有 size

    logger.info(`[checker] github: 发现新版本 ${version} -> ${downloadUrl}`);
    return {
      hasUpdate: true,
      version,
      releaseDate: releaseDate ?? new Date().toISOString(),
      releaseNotes: '',
      forceUpdate: false,
      downloadUrl,
      sha512,
      size,
    };
  } catch (err: any) {
    logger.warn(`[checker] github check failed: ${err?.message ?? err}`);
    return null;
  }
}

async function checkHttp(config: UpdateConfig, currentVersion: string): Promise<CheckResult | null> {
  const platform = platformParam();
  const arch = os.arch();
  const url = `${config.httpBaseUrl}/api/update/check?platform=${platform}&arch=${arch}&version=${currentVersion}&channel=${config.channel}`;

  try {
    logger.info(`[checker] http check: ${url}`);
    const resp = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const body: CloudCheckResponse = await resp.json();
    if (!body.hasUpdate) {
      logger.info('[checker] http: 已是最新');
      return { hasUpdate: false };
    }

    logger.info(`[checker] http: 发现新版本 ${body.version}`);
    return {
      hasUpdate: true,
      version: body.version,
      releaseDate: body.releaseDate,
      releaseNotes: body.releaseNotes,
      forceUpdate: body.forceUpdate ?? false,
      downloadUrl: body.downloadUrl,
      sha512: body.sha512,
      size: body.size,
    };
  } catch (err: any) {
    logger.warn(`[checker] http check failed: ${err?.message ?? err}`);
    return null;
  }
}

export async function checkForUpdates(
  config: UpdateConfig,
  currentVersion: string,
): Promise<CheckResult> {
  // GitHub 主源
  if (config.githubEnabled) {
    const result = await checkGitHub(config, currentVersion);
    if (result) return result;
    logger.info('[checker] github 失败，进入 fallback');
  }

  // HTTP 备源
  if (config.httpEnabled && config.httpBaseUrl) {
    const result = await checkHttp(config, currentVersion);
    if (result) return result;
  }

  throw new Error('检查更新失败，请检查网络');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater/checker.ts
git commit -m "feat: 实现双源 fallback 版本检测模块"
```

---

### Task 4: 创建下载管理模块（downloader.ts）

**Files:**
- Create: `src/main/updater/downloader.ts`

**Interfaces:**
- Consumes: `CheckResult` from types.ts
- Produces: `downloadUpdate(info: CheckResult, onProgress: (state: UpdateState) => void) => Promise<void>`
- Produces: `quitAndInstall() => void`

- [ ] **Step 1: 创建 downloader.ts**

```typescript
import { autoUpdater } from 'electron-updater';
import { getLogger } from '../log.js';
import type { CheckResult, UpdateState } from './types.js';

const logger = getLogger('updater:downloader');

export function downloadUpdate(
  info: CheckResult,
  onProgress: (state: UpdateState) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 不依赖 autoUpdater 的 provider，手动设置下载 URL
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: new URL(info.downloadUrl!).origin,
      channel: 'stable',
    });

    let resolved = false;

    autoUpdater.on('download-progress', (progress) => {
      onProgress({
        status: 'downloading',
        data: {
          version: info.version,
          percent: progress.percent,
          speed: progress.bytesPerSecond,
        },
      });
    });

    autoUpdater.on('update-downloaded', () => {
      logger.info(`[downloader] 下载完成: ${info.version}`);
      if (!resolved) {
        resolved = true;
        onProgress({ status: 'downloaded', data: { version: info.version } });
        resolve();
      }
    });

    autoUpdater.on('error', (err) => {
      logger.error(`[downloader] 下载失败: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // 直接告诉 electron-updater 要下载的 URL
    (autoUpdater as any).updateConfigPath = undefined;
    (autoUpdater as any).updateInfo = {
      version: info.version,
      files: [{ url: info.downloadUrl, sha512: info.sha512, size: info.size }],
      path: info.downloadUrl,
    };

    autoUpdater.downloadUpdate().catch((err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater/downloader.ts
git commit -m "feat: 实现下载管理和安装重启模块"
```

---

### Task 5: 创建 updater 入口模块 & IPC 注册

**Files:**
- Create: `src/main/updater/index.ts`

**Interfaces:**
- Consumes: `checker.ts`, `downloader.ts`, `types.ts`, `store.ts`
- Produces: `initUpdater(getMainWindow: () => BrowserWindow) => void`

- [ ] **Step 1: 创建 index.ts**

```typescript
import { ipcMain, BrowserWindow, app } from 'electron';
import { getStore } from '../store.js';
import { getLogger } from '../log.js';
import { checkForUpdates } from './checker.js';
import { downloadUpdate, quitAndInstall } from './downloader.js';
import type { UpdateConfig, UpdateState } from './types.js';

const logger = getLogger('updater');

const DEFAULT_CONFIG: UpdateConfig = {
  githubEnabled: true,
  httpEnabled: false,
  httpBaseUrl: '',
  channel: 'stable',
};

function config(): UpdateConfig {
  const store = getStore('updater');
  return { ...DEFAULT_CONFIG, ...(store.get('config') as Partial<UpdateConfig> | undefined) };
}

export function getConfig(): UpdateConfig {
  return config();
}

function saveConfig(cfg: UpdateConfig): void {
  const store = getStore('updater');
  store.set('config', cfg);
}

export function initUpdater(getMainWindow: () => BrowserWindow): void {
  const send = (state: UpdateState) => {
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:state', state);
      }
    } catch {}
  };

  // 检查更新
  ipcMain.handle('app:checkUpdate', async () => {
    try {
      send({ status: 'checking' });
      const result = await checkForUpdates(config(), app.getVersion());
      if (!result.hasUpdate) {
        send({ status: 'no-update' });
        return { hasUpdate: false };
      }
      send({ status: 'available', data: { version: result.version } });
      return {
        hasUpdate: true,
        version: result.version,
        releaseDate: result.releaseDate,
        releaseNotes: result.releaseNotes,
        forceUpdate: result.forceUpdate,
      };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      send({ status: 'error', data: { error: msg } });
      return { hasUpdate: false, error: msg };
    }
  });

  // 下载更新
  ipcMain.handle('app:downloadUpdate', async (_event, info: any) => {
    try {
      const current = config();
      // 如果有云服务的 downloadUrl，优先用它做 generic provider
      // downloader 内部使用传入的 downloadUrl
      await downloadUpdate(
        {
          hasUpdate: true,
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes,
          forceUpdate: info.forceUpdate,
          downloadUrl: info.downloadUrl,
          sha512: info.sha512,
          size: info.size,
        },
        send,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      send({ status: 'error', data: { error: msg } });
      throw err;
    }
  });

  // 重启安装
  ipcMain.handle('app:quitAndInstall', async () => {
    quitAndInstall();
  });

  // 获取当前状态
  ipcMain.handle('app:getUpdateStatus', async () => ({
    status: 'idle' as const,
    lastCheckTime: 0,
    currentVersion: app.getVersion(),
  }));

  // 获取/更新更新配置
  ipcMain.handle('app:getUpdateConfig', async () => config());

  ipcMain.handle('app:updateUpdateConfig', async (_event, cfg: Partial<UpdateConfig>) => {
    const current = config();
    const updated = { ...current, ...cfg };
    saveConfig(updated);
    logger.info('[updater] config updated', updated);
    return updated;
  });

  // 启动后定时检查（4小时）
  async function scheduledCheck() {
    try {
      logger.info('[updater] 定时检查更新');
      const result = await checkForUpdates(config(), app.getVersion());
      if (result.hasUpdate && result.forceUpdate) {
        send({ status: 'available', data: { version: result.version } });
      }
      // 普通更新不主动推送，用户手动检查时再通知
    } catch {}
  }

  // 首次启动 5 秒后检查一次
  setTimeout(scheduledCheck, 5_000);

  // 每 4 小时检查一次
  setInterval(scheduledCheck, 4 * 60 * 60 * 1000);

  logger.info('[updater] initialized');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater/index.ts
git commit -m "feat: 实现 updater IPC 注册和定时检查"
```

---

### Task 6: 在 app.ts 中接入 updater

**Files:**
- Modify: `src/main/app.ts`

**Interfaces:**
- Consumes: `initUpdater` from `updater/index.ts`
- Produces: 应用启动时初始化更新模块

- [ ] **Step 1: 在 import 区域添加引用**

在 `src/main/app.ts` 的 import 区域末尾添加：

```typescript
import { initUpdater } from './updater/index.js';
```

- [ ] **Step 2: 在 App.start() 中调用 initUpdater**

在 `App` 类的 `start()` 方法中，找到合适位置（建议在 `registerTraceIpc()` 附近），添加：

```typescript
// 初始化在线升级
initUpdater(() => this.mainWindow!);
```

> 注意：需确保 `start()` 调用时 `mainWindow` 已创建。检查代码，放在 `this.mainWindow` 赋值之后。

- [ ] **Step 3: Commit**

```bash
git add src/main/app.ts
git commit -m "feat: app.ts 接入在线升级模块"
```

---

### Task 7: 添加 preload.ts 桥接方法

**Files:**
- Modify: `src/main/preload.ts`

**Interfaces:**
- Produces: preload 暴露 `checkUpdate`、`downloadUpdate`、`quitAndInstall`、`getUpdateStatus`、`getUpdateConfig`、`updateUpdateConfig` 方法

- [ ] **Step 1: 在 preload.ts 的 api 对象末尾（`watchTraceSession` 之后）添加方法**

```typescript
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: (info: any) => ipcRenderer.invoke('app:downloadUpdate', info),
  quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  getUpdateConfig: () => ipcRenderer.invoke('app:getUpdateConfig'),
  updateUpdateConfig: (cfg: any) => ipcRenderer.invoke('app:updateUpdateConfig', cfg),
```

- [ ] **Step 2: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: preload 添加在线升级桥接方法"
```

---

### Task 8: 添加 useElectron.ts 封装方法

**Files:**
- Modify: `src/renderer/src/composables/useElectron.ts`

**Interfaces:**
- Produces: 导出 `CheckUpdate`、`DownloadUpdate`、`QuitAndInstall`、`GetUpdateStatus`、`GetUpdateConfig`、`UpdateUpdateConfig` 函数

- [ ] **Step 1: 在 useElectron.ts 末尾添加导出**

```typescript
export const CheckUpdate = () => api().checkUpdate();
export const DownloadUpdate = (info: any) => api().downloadUpdate(info);
export const QuitAndInstall = () => api().quitAndInstall();
export const GetUpdateStatus = () => api().getUpdateStatus();
export const GetUpdateConfig = () => api().getUpdateConfig();
export const UpdateUpdateConfig = (cfg: any) => api().updateUpdateConfig(cfg);
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/composables/useElectron.ts
git commit -m "feat: useElectron 添加在线升级封装方法"
```

---

### Task 9: 创建设置页升级区域组件（UpdaterSection.vue）

**Files:**
- Create: `src/renderer/src/components/settings/UpdaterSection.vue`

**Interfaces:**
- Consumes: `CheckUpdate`, `DownloadUpdate`, `QuitAndInstall`, `GetUpdateConfig`, `UpdateUpdateConfig`, `EventsOn` from useElectron
- Produces: 升级设置 UI 区域

- [ ] **Step 1: 创建 UpdaterSection.vue 模板**

```vue
<template>
  <div class="updater-section">
    <h2>在线升级</h2>

    <div class="form-group">
      <label class="form-label">当前版本</label>
      <div class="version-row">
        <span class="version-text">{{ currentVersion }}</span>
        <button class="btn-check" :disabled="checking" @click="onCheckUpdate">
          {{ checking ? '检查中...' : '检查更新' }}
        </button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">更新通道</label>
      <span class="form-static">Stable</span>
      <p class="form-hint">Beta 版本请手动下载安装</p>
    </div>

    <div class="form-group">
      <label class="form-label">更新源</label>
      <div class="switch-list">
        <label class="switch-row">
          <span class="switch-label">主：GitHub Releases</span>
          <Switch v-model="cfg.githubEnabled" @change="onSourceChange" />
        </label>
        <label class="switch-row">
          <span class="switch-label">备：HTTP 云服务</span>
          <Switch v-model="cfg.httpEnabled" @change="onSourceChange" />
        </label>
      </div>
      <input
        v-if="cfg.httpEnabled"
        class="form-input"
        v-model="cfg.httpBaseUrl"
        @change="onSourceChange"
        placeholder="https://your-api.example.com"
      />
    </div>

    <div class="status-area" v-if="statusText">
      <div :class="['status-line', statusClass]">
        <span class="status-dot" />
        {{ statusText }}
        <template v-if="state.status === 'available' && !state.data?.version">
          <button class="btn-download" @click="onDownload">立即下载</button>
        </template>
      </div>
      <!-- 下载进度条 -->
      <div v-if="state.status === 'downloading'" class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: (state.data?.percent ?? 0) + '%' }" />
        </div>
        <span class="progress-text">{{ Math.round(state.data?.percent ?? 0) }}%</span>
      </div>
      <!-- 下载完成 -->
      <div v-if="state.status === 'downloaded'" class="install-hint">
        下载完成，重启应用以安装新版本。
        <button class="btn-restart" @click="onRestart">立即重启</button>
        <button class="btn-later" @click="statusText = ''">稍后</button>
      </div>
      <!-- 错误 -->
      <div v-if="state.status === 'error'" class="error-hint">
        {{ state.data?.error }}
        <button class="btn-retry" @click="onCheckUpdate">重试</button>
      </div>
      <!-- 强制更新弹窗 -->
      <div v-if="state.status === 'available' && checkResult?.forceUpdate" class="force-overlay">
        <div class="force-dialog">
          <h3>必须更新</h3>
          <p>需要更新到 {{ checkResult?.version }} 才能继续使用。</p>
          <p class="force-notes">{{ checkResult?.releaseNotes }}</p>
          <button class="btn-download" @click="onDownload">立即更新</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 创建 UpdaterSection.vue script**

```vue
<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import Switch from '../Switch.vue'
import {
  CheckUpdate, DownloadUpdate, QuitAndInstall,
  GetUpdateConfig, UpdateUpdateConfig,
  EventsOn,
} from '../../composables/useElectron'
import { pushToast } from '../../composables/useToast'

interface UpdateConfig {
  githubEnabled: boolean
  httpEnabled: boolean
  httpBaseUrl: string
  channel: 'stable'
}

interface UpdateState {
  status: string
  data?: { version?: string; percent?: number; speed?: number; error?: string }
}

const cfg = reactive<UpdateConfig>({
  githubEnabled: true,
  httpEnabled: false,
  httpBaseUrl: '',
  channel: 'stable',
})

const state = reactive<UpdateState>({ status: 'idle' })
const checking = ref(false)
const checkResult = ref<{
  hasUpdate: boolean
  version?: string
  releaseDate?: string
  releaseNotes?: string
  forceUpdate?: boolean
  downloadUrl?: string
  sha512?: string
  size?: number
  error?: string
} | null>(null)
const currentVersion = ref('')

const statusText = computed(() => {
  switch (state.status) {
    case 'checking': return '正在检查更新...'
    case 'available': return `新版本 ${state.data?.version ?? ''} 可用`
    case 'downloading': return `正在下载 ${state.data?.version ?? ''}...`
    case 'downloaded': return `v${state.data?.version ?? ''} 下载完成`
    case 'no-update': return '已是最新版本'
    case 'error': return '检查更新失败'
    default: return ''
  }
})

const statusClass = computed(() => {
  switch (state.status) {
    case 'error': return 'status-error'
    case 'no-update': return 'status-ok'
    default: return 'status-info'
  }
})

onMounted(async () => {
  try {
    const remote = await GetUpdateConfig()
    if (remote) Object.assign(cfg, remote)
  } catch {}
  // 从 package.json 获取版本号通过 IPC
  try {
    const status = await (window.electronAPI as any)?.getUpdateStatus?.()
    currentVersion.value = status?.currentVersion ?? ''
  } catch {}
})

// 监听主进程推送的状态
EventsOn('update:state', (s: UpdateState) => {
  Object.assign(state, s)
})

async function onSourceChange() {
  try {
    await UpdateUpdateConfig({ ...cfg })
  } catch {}
}

async function onCheckUpdate() {
  checking.value = true
  try {
    const result = await CheckUpdate()
    checkResult.value = result
  } catch (e: any) {
    pushToast({ level: 'error', source: 'updater', message: '检查更新失败：' + (e?.message ?? e) })
  } finally {
    checking.value = false
  }
}

async function onDownload() {
  if (!checkResult.value) {
    // 从状态中获取版本信息
    checkResult.value = {
      hasUpdate: true,
      version: state.data?.version,
      downloadUrl: '',
      sha512: '',
      size: 0,
    }
  }
  try {
    await DownloadUpdate(checkResult.value)
  } catch (e: any) {
    pushToast({ level: 'error', source: 'updater', message: '下载失败：' + (e?.message ?? e) })
  }
}

function onRestart() {
  QuitAndInstall()
}
</script>
```

- [ ] **Step 3: 创建 UpdaterSection.vue style**

```vue
<style scoped>
.updater-section { padding: 20px 24px; max-width: 560px; }
h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; margin-bottom: 20px; }

.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-static { font-size: 13px; color: var(--text-primary); }
.form-hint { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }
.form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: 13px; font-family: inherit; margin-top: 8px;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.form-input::placeholder { color: var(--text-tertiary); }

.version-row { display: flex; align-items: center; gap: 12px; }
.version-text { font-size: 13px; color: var(--text-primary); font-family: var(--font-mono); }
.btn-check {
  padding: 5px 14px; background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-primary); border-radius: var(--radius-md); font-size: 12px; cursor: pointer;
}
.btn-check:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn-check:disabled { opacity: 0.5; cursor: not-allowed; }

.switch-list { display: flex; flex-direction: column; gap: 2px; }
.switch-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer;
}
.switch-row:hover { background: var(--bg-input); }
.switch-label { font-size: 13px; color: var(--text-primary); }

.status-area { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
.status-line { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-info .status-dot { background: var(--accent); }
.status-ok .status-dot { background: var(--status-success); }
.status-error .status-dot { background: var(--status-error); }
.status-info { color: var(--accent); }
.status-ok { color: var(--status-success); }
.status-error { color: var(--status-error); }

.btn-download, .btn-restart, .btn-retry {
  padding: 4px 12px; background: var(--accent); color: white;
  border: none; border-radius: var(--radius-md); font-size: 12px; cursor: pointer; margin-left: 8px;
}
.btn-download:hover, .btn-restart:hover, .btn-retry:hover { background: var(--accent-deep); }
.btn-later {
  padding: 4px 12px; background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-secondary); border-radius: var(--radius-md); font-size: 12px; cursor: pointer; margin-left: 8px;
}

.progress-wrap { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.progress-bar { flex: 1; height: 4px; background: var(--bg-input); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
.progress-text { font-size: 12px; color: var(--text-secondary); min-width: 36px; }

.install-hint { margin-top: 8px; font-size: 13px; color: var(--text-secondary); }
.error-hint { margin-top: 8px; font-size: 13px; color: var(--status-error); }

.force-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.force-dialog {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 28px; max-width: 420px; text-align: center;
}
.force-dialog h3 { font-size: 18px; color: var(--text-primary); margin-bottom: 12px; }
.force-dialog p { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
.force-notes { font-size: 12px; color: var(--text-tertiary); max-height: 120px; overflow-y: auto; }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/UpdaterSection.vue
git commit -m "feat: 创建设置页在线升级区域组件"
```

---

### Task 10: 在 SettingsView.vue 中集成 UpdaterSection

**Files:**
- Modify: `src/renderer/src/views/SettingsView.vue`

- [ ] **Step 1: 把 UpdaterSection 加入 GeneralTab**

在 `GeneralTab.vue` 末尾（`</template>` 之前，`</div>` 之后）引入：

```vue
<UpdaterSection />
```

并在 script 中添加 import：

```typescript
import UpdaterSection from './UpdaterSection.vue'
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/settings/GeneralTab.vue
git commit -m "feat: 通用设置页集成在线升级区域"
```

---

### Task 11: 端到端验证

- [ ] **Step 1: 构建验证**

```bash
cd "G:/work/lynel-desktop" && npm run build
# 确认无类型错误
```

- [ ] **Step 2: 主进程测试**

```bash
npm run test:main
# 确认全部通过
```

- [ ] **Step 3: 前端类型检查**

```bash
cd src/renderer && npx vue-tsc --noEmit
# 确认无类型错误
```

- [ ] **Step 4: dev 模式验证**

```bash
npm run dev
# 打开 Settings 页面，确认升级区域正常渲染
# 点击"检查更新"按钮，确认能看到检测结果
# 注意：dev 模式下无法测试完整下载安装流程，仅验证 UI 和 IPC 通道
```

- [ ] **Step 5: Commit（如有修改）**

```bash
git add -A
git commit -m "fix: 在线升级端到端验证修复"
```
