# 企业微信 Bot 扫码一键创建设计方案

- 日期：2026-08-31
- 状态：已批准

## 背景

当前添加企业微信机器人需在 BotAddDialog 手动填写 name / Bot ID / Secret（`app:saveBot` → `wecomBots` map → `wecomChannel.updateBots` → `connectBot`，WSClient 连 `wss://openws.work.weixin.qq.com`）。用户需先去企业微信管理后台创建「智能机器人」并复制 Bot ID + Secret，繁琐易错。

企业微信官方提供扫码授权机制，可一键创建智能机器人并自动获取凭据：`wecom-openclaw-cli` 的 `scanQRCodeForBotInfo()` 已实现完整流程（qrcode.js），Lynel 可复用该机制。

## 目标

- 在 BotAddDialog 提供「扫码创建」入口，用户用手机企业微信扫码后自动创建机器人并拿到 botId/secret，免手填凭据，全程无感。
- 复用现有 bot 保存链路（`app:saveBot` → `connectBot`），不改变 BotConfig 结构。

## 决策

| 决策点 | 结论 |
|---|---|
| 扫码机制 | 复用企业微信官方端点：`generate` 拿 scode+auth_url，轮询 `query_result` 拿 botid/secret |
| 二维码渲染 | 渲染进程新增 `qrcode` 依赖，将 `auth_url` 转 dataURL 图片展示 |
| 轮询位置 | 主进程 `wecom-scan.ts` 单例轮询（3s 间隔、5min 超时），结果经 webContents 事件推送渲染进程 |
| 凭据流转 | botid/secret 仅在主/渲染进程内存中流转用于保存，不写日志 |
| Bot 名称 | 扫码对话框内选填，留空默认「企业微信机器人」 |
| 并发 | `scanState` 单例，重复 start 先取消旧扫描；弹窗卸载自动 cancel |

## 架构

```
渲染进程                                      主进程
─────────                                    ─────
BotAddDialog.vue
  └─ 扫码创建 ─► QrScanDialog.vue
        │ bot:startScan ─────────────────►  wecom-scan.ts
        │   ◄── { scode, auth_url }             fetchQRCode()  generate?source=wecom-cli&plat=<N>
        │  qrcode.toDataURL(auth_url) ──► img   轮询 timer (3s, 5min)
        │
        │ bot:scanResult (webContents.send) ◄─  pollResult(scode)  query_result?scode=
        │   success{botId,secret} / timeout / error
        │
        └─ store.save(bot) ─► app:saveBot ─► wecomChannel.updateBots ─► connectBot
        (关闭时 bot:cancelScan ─► 清 timer)
```

## 关键端点（企业微信官方）

- `GET https://work.weixin.qq.com/ai/qc/generate?source=wecom-cli&plat=<plat>` → `{ data: { scode, auth_url } }`
  - `plat`：darwin=1、win32=2、linux=3（`os.platform()`）。
- `GET https://work.weixin.qq.com/ai/qc/query_result?scode=<scode>` → `{ data: { status, bot_info: { botid, secret } } }`
  - `status === 'success'` 时取 `bot_info.botid` / `bot_info.secret`。
- 轮询间隔 3s，超时 5min（与官方 CLI 一致）。

## 数据流

1. 用户点击「扫码创建」→ `QrScanDialog` 打开 → `bot:startScan`。
2. 主进程 `fetchQRCode()` 拿 scode+auth_url 返回；渲染进程 `qrcode.toDataURL(auth_url)` 显示二维码。
3. 用户手机企业微信扫码并确认 → 企业微信侧一键创建智能机器人。
4. 主进程 `pollResult` 轮询到 success → `bot:scanResult` 推送 `{type:'success', botId, secret}`。
5. 渲染进程回填 `form.botId/form.secret`（名称取输入或默认）→ `store.save()` 保存并绑定。

## 组件清单

- **新增 `src/main/wecom-scan.ts`**：
  - `fetchQRCode(): Promise<{scode, auth_url}>`（Node https GET，解析失败抛错）
  - `pollResult(scode): Promise<{botid, secret}>`（轮询，timeout 抛 `SCAN_TIMEOUT`）
  - `startScan(onEvent): Promise<{scode, auth_url}>` / `cancelScan(): void`
  - 模块级 `scanState` 单例，管理当前轮询 timer 与事件回调。
- **修改 `src/main/app.ts`**：注册 `bot:startScan` / `bot:cancelScan`（invoke）与 `bot:scanResult`（webContents.send 推送）。
- **修改 `src/renderer/src/composables/useElectron.ts`**：加 `StartWecomScan` / `CancelWecomScan` / `OnWecomScanResult` 类型化转发。
- **新增 `src/renderer/src/components/QrScanDialog.vue`**：二维码弹窗（名称输入 + 二维码 + 等待/超时/错误态）。
- **修改 `src/renderer/src/components/BotAddDialog.vue`**：加「扫码创建」入口，收到 success 后自动保存。
- **新增依赖**：`src/renderer` 的 `qrcode` + `@types/qrcode`。

## 错误处理

| 场景 | 行为 |
|---|---|
| generate 失败（网络/响应格式异常） | 弹窗显示「获取二维码失败，请重试」，不启动轮询 |
| 扫码超时（5min） | 弹窗显示「扫码超时，请重新生成」+ 重新生成按钮 |
| 轮询期间单次请求网络抖动 | 忽略该次、继续轮询直到超时（与官方 CLI 一致） |
| 用户取消/关闭弹窗 | `bot:cancelScan` 停止主进程 timer |
| 并发 start | 先取消旧扫描再开新；弹窗卸载自动 cancel |
| secret 安全 | botid/secret 不写日志、不进 trace，仅内存流转 |

## 测试

- **`tests/main/wecom-scan.test.ts`**（mock https）：
  - `fetchQRCode`：正常解析；响应缺 scode/auth_url 抛错。
  - `pollResult`：success 返回 botid+secret；pending 继续；异常请求忽略。
  - `plat` 平台映射（darwin=1/win32=2/linux=3）。
- **渲染进程 UI 手动回归**：二维码渲染、扫码成功回填保存、超时重试、取消。
- **IPC 装配**：薄接线，跟随现有模式不单测（`tsc` + `test:main` + 手动回归覆盖）。

## 边界与限制

- 每次扫码创建的是全新的智能机器人（新 botid/secret），与已绑定机器人互不影响。
- 一个智能机器人同时只能被一个客户端长连接；Lynel 创建的机器人由 Lynel 自身连接。
- 企业微信侧有 3 分钟回复时限等既有约束，与本次扫码创建无关，不做额外处理。
- 不涉及 Windows/其他平台签名等无关改动。
