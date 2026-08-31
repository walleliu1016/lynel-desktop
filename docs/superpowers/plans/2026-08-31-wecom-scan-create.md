# 企业微信 Bot 扫码一键创建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 BotAddDialog 提供「扫码创建」入口，用户用手机企业微信扫码后自动创建智能机器人并拿到 botId/secret，免手填凭据。

**Architecture:** 主进程新增 `wecom-scan.ts` 单例，复用企业微信官方端点 `generate`（拿 scode+auth_url）与 `query_result`（轮询拿 botid/secret）；渲染进程用 `qrcode` 库把 auth_url 渲染成二维码图片，主进程轮询结果经 `bot:scanResult` 事件推送，成功后用现有 `app:saveBot`→`connectBot` 链路保存并绑定。

**Tech Stack:** Node https、Electron IPC（invoke + webContents.send 事件）、Vue 3 `<script setup>`、Pinia、`qrcode`（渲染进程）。

## Global Constraints

- 端点与平台映射（spec 精确值）：
  - `GET https://work.weixin.qq.com/ai/qc/generate?source=wecom-cli&plat=<N>` → `{ data: { scode, auth_url } }`；`plat`：darwin=1、win32=2、linux=3、其他=0。
  - `GET https://work.weixin.qq.com/ai/qc/query_result?scode=<scode>` → `{ data: { status, bot_info: { botid, secret } } }`；`status === 'success'` 时取 `botid`/`secret`。
  - 轮询间隔 3s，超时 5min（`scanTiming` 可覆盖，测试缩短）。
- botid/secret 只在内存流转，不写日志、不进 trace。
- Bot 名称选填，留空默认「企业微信机器人」。
- `scanState` 并发保护：`startScan` 先取消旧扫描；弹窗卸载自动 `cancelScan`。
- 提交规范：commit 前设置 local git identity（`git config user.name "walleliu1016"` + `git config user.email "walleliu1016@example.com"`）；每个 task 独立 commit，message 用简体中文、`<type>: <subject>` 格式；commit 前 `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit` 全绿。
- 代码注释与 commit message 一律简体中文。

---

## 文件结构

- **新增** `src/main/wecom-scan.ts`：扫码核心（generate/poll/轮询单例）。
- **新增** `tests/main/wecom-scan.test.ts`：核心逻辑单测（mock `node:https`）。
- **修改** `src/main/app.ts`：注册 `bot:startScan` / `bot:cancelScan` IPC + `bot:scanResult` 事件推送。
- **修改** `src/main/preload.ts`：暴露 `startWecomScan` / `cancelWecomScan`。
- **修改** `src/renderer/src/composables/useElectron.ts`：转发 `StartWecomScan` / `CancelWecomScan`。
- **新增** `src/renderer/src/components/QrScanDialog.vue`：二维码弹窗。
- **修改** `src/renderer/src/components/BotAddDialog.vue`：加「扫码创建」入口 + 自动保存。
- **修改** `src/renderer/package.json`：新增 `qrcode` + `@types/qrcode`。

---

### Task 1: 主进程扫码模块（wecom-scan.ts）与单测

**Files:**
- Create: `src/main/wecom-scan.ts`
- Test: `tests/main/wecom-scan.test.ts`

**Interfaces:**
- Produces（供 Task 2/3 使用，签名精确）：
  - `export type ScanEvent = { type: 'pending' } | { type: 'success'; botId: string; secret: string } | { type: 'timeout' } | { type: 'error'; message: string }`
  - `export interface ScanStartResult { scode: string; authUrl: string }`
  - `export interface ScanBotInfo { botId: string; secret: string }`
  - `export function getPlatCode(platform?: NodeJS.Platform): number`
  - `export async function fetchQRCode(platform?: NodeJS.Platform): Promise<ScanStartResult>`
  - `export async function pollOnce(scode: string): Promise<ScanBotInfo | null>`
  - `export function startScan(onEvent: (e: ScanEvent) => void): Promise<ScanStartResult>`
  - `export function cancelScan(): void`
  - `export const scanTiming = { intervalMs: 3000, timeoutMs: 300000 }`

- [ ] **Step 1: 写失败测试**

创建 `tests/main/wecom-scan.test.ts`（mock `node:https`，用 `vi.hoisted` 保持 mock 引用）：

```ts
// tests/main/wecom-scan.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const httpsGetMock = vi.hoisted(() => vi.fn());

vi.mock('node:https', () => ({
  default: { get: httpsGetMock },
}));

import {
  fetchQRCode,
  pollOnce,
  getPlatCode,
  startScan,
  cancelScan,
  scanTiming,
} from '../../src/main/wecom-scan.js';

type MockRes = EventEmitter & { statusCode?: number };

/** 单次响应：注册 https.get mock，返回可手动 emit 的 res */
function mockHttpsGet(body: string): MockRes {
  const res = new EventEmitter() as MockRes;
  httpsGetMock.mockImplementationOnce((_url: string, cb: (r: any) => void) => {
    cb(res);
    return { on: vi.fn() };
  });
  return res;
}

function emitBody(res: MockRes, body: string) {
  res.emit('data', body);
  res.emit('end');
}

/** 按调用序号返回响应体（最后一个重复），setImmediate 自动 emit，用于轮询集成测试 */
function mockHttpsSequence(bodies: string[]) {
  let i = 0;
  httpsGetMock.mockImplementation((_url: string, cb: (r: any) => void) => {
    const r = new EventEmitter() as any;
    const body = bodies[Math.min(i++, bodies.length - 1)];
    cb(r);
    setImmediate(() => { r.emit('data', body); r.emit('end'); });
    return { on: vi.fn() };
  });
}

describe('getPlatCode', () => {
  it('平台映射 darwin=1 win32=2 linux=3 其他=0', () => {
    expect(getPlatCode('darwin')).toBe(1);
    expect(getPlatCode('win32')).toBe(2);
    expect(getPlatCode('linux')).toBe(3);
    expect(getPlatCode('freebsd')).toBe(0);
  });
});

describe('fetchQRCode', () => {
  beforeEach(() => { httpsGetMock.mockReset(); });

  it('解析 scode 与 authUrl，并按平台传 plat', async () => {
    const res = mockHttpsGet(JSON.stringify({ data: { scode: 's1', auth_url: 'http://qr/abc' } }));
    emitBody(res, '');
    const r = await fetchQRCode('linux');
    expect(r).toEqual({ scode: 's1', authUrl: 'http://qr/abc' });
    expect(httpsGetMock).toHaveBeenCalledWith(
      expect.stringContaining('source=wecom-cli&plat=3'),
      expect.any(Function),
    );
  });

  it('响应缺 scode/auth_url 时抛错', async () => {
    const res = mockHttpsGet(JSON.stringify({ data: {} }));
    emitBody(res, '');
    await expect(fetchQRCode('linux')).rejects.toThrow('响应格式异常');
  });
});

describe('pollOnce', () => {
  beforeEach(() => { httpsGetMock.mockReset(); });

  it('success 返回 botid/secret', async () => {
    const res = mockHttpsGet(JSON.stringify({
      data: { status: 'success', bot_info: { botid: 'B1', secret: 'S1' } },
    }));
    emitBody(res, '');
    await expect(pollOnce('s1')).resolves.toEqual({ botId: 'B1', secret: 'S1' });
  });

  it('非 success 返回 null', async () => {
    const res = mockHttpsGet(JSON.stringify({ data: { status: 'waiting' } }));
    emitBody(res, '');
    await expect(pollOnce('s1')).resolves.toBeNull();
  });

  it('success 但缺 bot_info 抛错', async () => {
    const res = mockHttpsGet(JSON.stringify({ data: { status: 'success', bot_info: {} } }));
    emitBody(res, '');
    await expect(pollOnce('s1')).rejects.toThrow('未获取到 Bot 信息');
  });
});

describe('startScan 轮询', () => {
  beforeEach(() => {
    httpsGetMock.mockReset();
    cancelScan();
    scanTiming.intervalMs = 5;
    scanTiming.timeoutMs = 60;
  });

  it('扫码成功返回 scode/authUrl 并推送 pending + success', async () => {
    mockHttpsSequence([
      JSON.stringify({ data: { scode: 's1', auth_url: 'http://qr' } }),
      JSON.stringify({ data: { status: 'success', bot_info: { botid: 'B1', secret: 'S1' } } }),
    ]);
    const events: any[] = [];
    const { scode, authUrl } = await startScan((e) => events.push(e));
    expect(scode).toBe('s1');
    expect(authUrl).toBe('http://qr');
    await vi.waitFor(() => {
      const success = events.find((e) => e.type === 'success');
      expect(success).toEqual({ type: 'success', botId: 'B1', secret: 'S1' });
    });
    expect(events.some((e) => e.type === 'pending')).toBe(true);
  });

  it('扫码未完成时推送 timeout', async () => {
    mockHttpsSequence([
      JSON.stringify({ data: { scode: 's1', auth_url: 'http://qr' } }),
      JSON.stringify({ data: { status: 'waiting' } }),
    ]);
    scanTiming.intervalMs = 2;
    scanTiming.timeoutMs = 15;
    const events: any[] = [];
    await startScan((e) => events.push(e));
    await vi.waitFor(
      () => expect(events.some((e) => e.type === 'timeout')).toBe(true),
      { timeout: 2000 },
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/wecom-scan.test.ts`
Expected: FAIL，报错 `Cannot find module '../../src/main/wecom-scan.js'`。

- [ ] **Step 3: 实现 wecom-scan.ts**

创建 `src/main/wecom-scan.ts`：

```ts
// src/main/wecom-scan.ts
import https from 'node:https';
import os from 'node:os';

export type ScanEvent =
  | { type: 'pending' }
  | { type: 'success'; botId: string; secret: string }
  | { type: 'timeout' }
  | { type: 'error'; message: string };

export interface ScanStartResult {
  scode: string;
  authUrl: string;
}
export interface ScanBotInfo {
  botId: string;
  secret: string;
}

const QR_GENERATE_URL = 'https://work.weixin.qq.com/ai/qc/generate';
const QR_QUERY_URL = 'https://work.weixin.qq.com/ai/qc/query_result';
/** 轮询与超时参数，测试中可缩短 */
export const scanTiming = { intervalMs: 3000, timeoutMs: 300000 };

let active = false;

/** 平台码：darwin=1、win32=2、linux=3、其他=0 */
export function getPlatCode(platform: NodeJS.Platform = os.platform()): number {
  switch (platform) {
    case 'darwin': return 1;
    case 'win32': return 2;
    case 'linux': return 3;
    default: return 0;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

/** 请求二维码链接，返回 scode 与 auth_url */
export async function fetchQRCode(
  platform: NodeJS.Platform = os.platform(),
): Promise<ScanStartResult> {
  const url = `${QR_GENERATE_URL}?source=wecom-cli&plat=${getPlatCode(platform)}`;
  const raw = await httpsGet(url);
  const resp = JSON.parse(raw);
  if (!resp?.data?.scode || !resp?.data?.auth_url) {
    throw new Error('获取二维码失败，响应格式异常');
  }
  return { scode: resp.data.scode, authUrl: resp.data.auth_url };
}

/** 单次查询扫码结果；success 返回凭据，其余返回 null */
export async function pollOnce(scode: string): Promise<ScanBotInfo | null> {
  const url = `${QR_QUERY_URL}?scode=${encodeURIComponent(scode)}`;
  const raw = await httpsGet(url);
  const resp = JSON.parse(raw);
  if (resp?.data?.status === 'success') {
    const botInfo = resp.data.bot_info;
    if (!botInfo?.botid || !botInfo?.secret) {
      throw new Error('扫码成功但未获取到 Bot 信息');
    }
    return { botId: botInfo.botid, secret: botInfo.secret };
  }
  return null;
}

/** 发起扫码：获取二维码并启动轮询；返回 scode/authUrl 供渲染二维码 */
export function startScan(onEvent: (e: ScanEvent) => void): Promise<ScanStartResult> {
  cancelScan();
  return fetchQRCode().then(({ scode, authUrl }) => {
    active = true;
    onEvent({ type: 'pending' });
    void runPollLoop(scode, onEvent, Date.now() + scanTiming.timeoutMs);
    return { scode, authUrl };
  });
}

async function runPollLoop(scode: string, onEvent: (e: ScanEvent) => void, deadline: number) {
  while (active) {
    try {
      const info = await pollOnce(scode);
      if (!active) return;
      if (info) {
        active = false;
        onEvent({ type: 'success', botId: info.botId, secret: info.secret });
        return;
      }
    } catch {
      // 单次请求网络抖动：忽略，继续轮询
    }
    if (Date.now() >= deadline) {
      active = false;
      onEvent({ type: 'timeout' });
      return;
    }
    await sleep(scanTiming.intervalMs);
  }
}

export function cancelScan(): void {
  active = false;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/wecom-scan.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 全量测试确认不回归**

Run: `npm run test:main`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git config user.name "walleliu1016"
git config user.email "walleliu1016@example.com"
git add src/main/wecom-scan.ts tests/main/wecom-scan.test.ts
git commit -m "feat: 企业微信扫码创建：主进程扫码模块与轮询"
```

---

### Task 2: IPC / preload / useElectron 接线

**Files:**
- Modify: `src/main/app.ts`（在 bot IPC 区域，`app:deleteBot` handler 之后追加）
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/src/composables/useElectron.ts`

**Interfaces:**
- Consumes: Task 1 的 `startScan`/`cancelScan`/`ScanEvent`。
- Produces（供 Task 3）：
  - IPC `bot:startScan`（invoke）→ `{ ok: true, scode, authUrl } | { ok: false, error }`。
  - IPC `bot:cancelScan`（invoke）→ `{ ok: true }`。
  - webContents 事件 `bot:scanResult` 推送 `ScanEvent`。
  - preload：`startWecomScan()` / `cancelWecomScan()`。
  - useElectron：`StartWecomScan()` / `CancelWecomScan()` / `EventsOn('bot:scanResult', cb)`（复用现有 `EventsOn`）。

- [ ] **Step 1: app.ts 注册 IPC**

在 `src/main/app.ts` 顶部 import 区（`import type { BotConfig } from './types/bot.js';` 之后）追加：

```ts
import { startScan as wecomStartScan, cancelScan } from './wecom-scan.js';
```

在 `app:deleteBot` handler（约 L1784，`return { ok: true };` 之后）追加：

```ts
    // 企业微信扫码创建：主进程发起 generate + 轮询，结果经 bot:scanResult 推送渲染进程
    ipcMain.handle('bot:startScan', async () => {
      try {
        const { scode, authUrl } = await wecomStartScan((e) => {
          if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('bot:scanResult', e);
          }
        });
        return { ok: true, scode, authUrl };
      } catch (e: any) {
        cancelScan();
        return { ok: false, error: e?.message ?? String(e) };
      }
    });
    ipcMain.handle('bot:cancelScan', () => {
      cancelScan();
      return { ok: true };
    });
```

- [ ] **Step 2: preload.ts 暴露方法**

在 `src/main/preload.ts` 的 `api` 对象中，`listBotBindings`（L44）之后追加：

```ts
  startWecomScan: () => ipcRenderer.invoke('bot:startScan'),
  cancelWecomScan: () => ipcRenderer.invoke('bot:cancelScan'),
```

（`eventsOn` 已存在，`bot:scanResult` 无需新增事件方法。）

- [ ] **Step 3: useElectron.ts 转发**

在 `src/renderer/src/composables/useElectron.ts` 顶部追加类型 import（`import type { ElectronAPI } ...` 之后）：

```ts
import type { ScanEvent } from '../../../main/wecom-scan.js';
```

在 `ListBotBindings`（L49）之后追加：

```ts
export const StartWecomScan = () => api().startWecomScan();
export const CancelWecomScan = () => api().cancelWecomScan();
export const OnWecomScanResult = (cb: (e: ScanEvent) => void) => EventsOn('bot:scanResult', cb);
```

- [ ] **Step 4: 主进程编译验证**

Run: `npx tsc`
Expected: 无 TS 错误。

- [ ] **Step 5: 全量测试确认不回归**

Run: `npm run test:main`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/main/app.ts src/main/preload.ts src/renderer/src/composables/useElectron.ts
git commit -m "feat: 企业微信扫码创建：IPC 与类型化转发接线"
```

---

### Task 3: 渲染进程二维码弹窗与表单入口

**Files:**
- Modify: `src/renderer/package.json`（新增 `qrcode` + `@types/qrcode`）
- Create: `src/renderer/src/components/QrScanDialog.vue`
- Modify: `src/renderer/src/components/BotAddDialog.vue`

**Interfaces:**
- Consumes: Task 2 的 `StartWecomScan` / `CancelWecomScan` / `OnWecomScanResult`，以及 `ScanEvent` 类型。
- Produces: `QrScanDialog` emit `success({ name, botId, secret })` / `close`。

- [ ] **Step 1: 安装 qrcode 依赖**

Run:
```bash
cd src/renderer && npm install qrcode && npm install -D @types/qrcode
```
Expected: `src/renderer/package.json` 的 `dependencies` 含 `qrcode`，`devDependencies` 含 `@types/qrcode`。

- [ ] **Step 2: 创建 QrScanDialog.vue**

创建 `src/renderer/src/components/QrScanDialog.vue`：

```vue
<template>
  <Teleport to="body">
    <div class="dialog-mask" @click.self="onCancel">
      <div class="dialog">
        <div class="dialog-head">
          <h3>扫码创建机器人</h3>
          <button class="close" aria-label="关闭" @click="onCancel">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">名称（选填）</label>
          <input class="v" v-model="name" placeholder="默认：企业微信机器人" />
        </div>

        <div class="qr-area">
          <div v-if="status === 'pending'">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="企业微信扫码" class="qr-img" />
            <p class="qr-hint">请用手机企业微信扫描二维码，确认后自动创建并绑定</p>
            <div class="qr-wait">
              <Icon name="loader" :size="14" class="spin" />
              <span>等待扫码...</span>
            </div>
          </div>
          <div v-else-if="status === 'timeout'" class="qr-state">
            <p>扫码超时，请重新生成。</p>
            <button class="retry" @click="start">重新生成</button>
          </div>
          <div v-else class="qr-state">
            <p>{{ error }}</p>
            <button class="retry" @click="start">重试</button>
          </div>
        </div>

        <div class="dialog-foot">
          <div class="spacer" />
          <button class="cancel" @click="onCancel">取消</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import QRCode from 'qrcode'
import Icon from './Icon.vue'
import { StartWecomScan, CancelWecomScan, OnWecomScanResult } from '../composables/useElectron'
import type { ScanEvent } from '../../../main/wecom-scan.js'

const emit = defineEmits<{
  (e: 'success', bot: { name: string; botId: string; secret: string }): void
  (e: 'close'): void
}>()

const name = ref('')
const qrDataUrl = ref('')
const status = ref<'pending' | 'timeout' | 'error'>('pending')
const error = ref('')
let unsub: (() => void) | null = null

async function start() {
  status.value = 'pending'
  error.value = ''
  qrDataUrl.value = ''
  try {
    const res: any = await StartWecomScan()
    if (!res?.ok) {
      status.value = 'error'
      error.value = res?.error || '获取二维码失败，请重试'
      return
    }
    qrDataUrl.value = await QRCode.toDataURL(res.authUrl, { width: 220, margin: 1 })
  } catch (e: any) {
    status.value = 'error'
    error.value = '获取二维码失败：' + (e?.message ?? e)
  }
}

function onScanEvent(e: ScanEvent) {
  if (e.type === 'success') {
    cleanup()
    emit('success', {
      name: name.value.trim() || '企业微信机器人',
      botId: e.botId,
      secret: e.secret,
    })
  } else if (e.type === 'timeout') {
    status.value = 'timeout'
  } else if (e.type === 'error') {
    status.value = 'error'
    error.value = e.message
  }
}

function cleanup() {
  if (unsub) { unsub(); unsub = null }
}

onMounted(() => {
  unsub = OnWecomScanResult(onScanEvent)
  void start()
})

onUnmounted(() => {
  cleanup()
  void CancelWecomScan()
})

function onCancel() {
  emit('close')
}
</script>

<style scoped>
.dialog-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
}
.dialog {
  width: 420px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px;
}
.dialog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dialog-head h3 { margin: 0; font-size: 16px; color: var(--text-primary); }
.close { background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 4px; }
.close:hover { color: var(--text-primary); }
.form-group { margin-bottom: 12px; }
.form-label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.form-group .v {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px; color: var(--text-primary);
  font-size: 12px; font-family: inherit; box-sizing: border-box;
}
.form-group .v:focus { outline: none; border-color: var(--accent); }
.qr-area {
  display: flex; flex-direction: column; align-items: center;
  padding: 12px; background: var(--bg-hover); border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.qr-img {
  width: 220px; height: 220px; background: #fff; padding: 8px;
  border-radius: 6px; box-sizing: border-box;
}
.qr-hint { font-size: 12px; color: var(--text-secondary); margin-top: 8px; text-align: center; }
.qr-wait { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); margin-top: 6px; }
.qr-wait .spin { animation: scan-spin 1s linear infinite; }
.qr-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; font-size: 12px; color: var(--text-secondary); }
.qr-state .retry {
  padding: 6px 14px; border-radius: var(--radius-md); border: 1px solid var(--accent);
  background: var(--accent); color: var(--text-inverse); cursor: pointer; font-size: 12px;
}
@keyframes scan-spin { to { transform: rotate(360deg); } }
.dialog-foot { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.dialog-foot .spacer { flex: 1; }
.dialog-foot button {
  padding: 7px 16px; border-radius: var(--radius-md); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); cursor: pointer;
  font-family: inherit;
}
.dialog-foot button.cancel:hover { background: var(--border); }
</style>
```

- [ ] **Step 3: 修改 BotAddDialog.vue**

在 `src/renderer/src/components/BotAddDialog.vue` 中：

template 的 `dialog-foot`（L31-35）改为：

```vue
        <div class="dialog-foot">
          <button class="scan" @click="showScan = true">扫码创建</button>
          <div class="spacer" />
          <button class="cancel" @click="onClose">取消</button>
          <button class="save" :disabled="!valid" @click="onSave">保存并绑定</button>
        </div>
```

`</template>` 闭合前（L38 之后）追加弹窗挂载：

```vue
    <QrScanDialog v-if="showScan" @success="onScanSuccess" @close="showScan = false" />
```

script 的 import 区（L42-46）：现有 `import { reactive, computed, onMounted, onUnmounted } from 'vue'` 追加 `ref`，并新增 `QrScanDialog` import：

```ts
import { reactive, computed, ref, onMounted, onUnmounted } from 'vue'
import QrScanDialog from './QrScanDialog.vue'
```

在 `form` 定义之后追加：

```ts
const showScan = ref(false)
```

在 `onSave` 函数之后追加：

```ts
async function onScanSuccess(scan: { name: string; botId: string; secret: string }) {
  showScan.value = false
  form.name = scan.name
  form.botId = scan.botId
  form.secret = scan.secret
  await onSave()
}
```

样式区（`dialog-foot button` 规则附近）追加：

```css
.dialog-foot button.scan { background: var(--bg-hover); border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 4: 渲染进程类型检查**

Run: `cd src/renderer && npx vue-tsc --noEmit`
Expected: 0 报错。

- [ ] **Step 5: 手动回归（npm run dev）**

Run: `npm run dev`，进入 BotManagement → 添加机器人 → 点击「扫码创建」。
- 弹窗出现二维码图片与「等待扫码...」。
- 手机企业微信扫码确认 → 弹窗自动关闭 → 列表出现新 bot，连接状态为已连接。
- 名称留空时 bot 名为「企业微信机器人」。
- 超时（不扫码等 5min 或临时缩短超时）→ 显示「扫码超时，请重新生成」。
- 关闭弹窗 → 无残留轮询（主进程日志无报错）。

- [ ] **Step 6: 全量测试确认不回归**

Run: `npm run test:main` 与 `cd src/renderer && npx vue-tsc --noEmit`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git config user.name "walleliu1016"
git config user.email "walleliu1016@example.com"
git add src/renderer/package.json src/renderer/package-lock.json src/renderer/src/components/QrScanDialog.vue src/renderer/src/components/BotAddDialog.vue
git commit -m "feat: 企业微信扫码创建：二维码弹窗与表单入口"
```

---

## 自检

- **Spec 覆盖**：端点/plat 映射/轮询参数 → Task 1；扫码流程与事件推送 → Task 2；二维码弹窗/名称默认/超时重试/自动保存 → Task 3；错误处理（generate 失败/超时/取消）→ Task 1+3；并发单例 → Task 1 `startScan` 先 `cancelScan`；凭据不写日志 → 实现无任何日志语句。
- **无占位符**：所有步骤含完整代码与精确命令。
- **类型一致性**：`ScanEvent`/`ScanStartResult`/`ScanBotInfo`/`getPlatCode`/`fetchQRCode`/`pollOnce`/`startScan`/`cancelScan`/`scanTiming` 在 Task 1 定义，Task 2/3 按相同签名消费；`StartWecomScan`/`CancelWecomScan`/`OnWecomScanResult` 在 Task 2 产出、Task 3 消费；IPC 通道名 `bot:startScan`/`bot:cancelScan`/`bot:scanResult` 在 Task 2 固定、Task 3 订阅一致。
