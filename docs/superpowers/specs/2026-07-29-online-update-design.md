# 在线升级方案设计

## 概述

为 Lynel Desktop（Electron 43 + electron-builder 26）增加在线升级（auto-update）能力，支持 Windows (NSIS)、macOS (DMG)、Linux (AppImage) 三平台。

## 核心决策

| 维度 | 结论 |
|------|------|
| 更新源 | GitHub Releases（主）+ 私有 HTTP 云服务（备），双源 fallback |
| 平台 | Windows + macOS + Linux，全量覆盖 |
| 更新通道 | 仅 stable 走自动更新，beta 手动安装 |
| 更新 UX | 普通更新提示用户确认下载，关键更新支持服务端标记 forceUpdate 强制 |
| 代码签名 | 当前暂无证书（macOS 上线前必须补齐），方案先跳过签名校验 |
| 技术选型 | electron-updater 做下载执行引擎，自研双源检测 + fallback 切换 |

## 架构

更新模块位于主进程 `src/main/`，通过 IPC 与前端通信。

```
src/main/updater/
├── index.ts              # 对外入口，初始化 & 注册 IPC handler
├── checker.ts            # 版本检测（GitHub → HTTP fallback）
├── downloader.ts         # 下载进度管理
├── channel.ts            # 通道管理
└── types.ts              # 类型定义
```

**与现有架构的关系：**

- `app.ts` 中调用 `initUpdater()` 注册 IPC handler，复用现有 `ipcMain.handle` 模式
- 前端通过 `useElectron.ts` 暴露方法调用
- `electron-builder.yml` 增加 `publish` 配置，生成 latest.yml / blockmap 元数据
- 更新配置持久化到 `electron-store`

## 双源 fallback 检测流程

```
checkForUpdates()
  ├─ 1. GitHub Releases (latest.yml, 10s timeout)
  │    └─ 失败/超时 → 进入 fallback
  └─ 2. 云服务 HTTP API (10s timeout)
       └─ 失败 → 通知前端"检查更新失败"
```

**关键设计：**

- 检测阶段自研，直接发 HTTP 请求获取版本信息，不依赖 electron-updater 的 provider
- 两个源的版本信息格式统一，解析逻辑共用
- electron-updater 只承担下载执行职责

## 云服务接口协议

### 检查更新

```
GET /api/update/check?platform={platform}&arch={arch}&version={currentVersion}&channel=stable

参数:
  platform    win | mac | linux
  arch        x64 | arm64
  version     当前版本号，如 "0.0.13"
  channel     stable（仅 stable 走自动更新）
```

**响应（有新版本）：**

```json
{
  "hasUpdate": true,
  "version": "0.0.14",
  "releaseDate": "2026-07-30T10:00:00Z",
  "releaseNotes": "更新日志 markdown 文本",
  "forceUpdate": false,
  "downloadUrl": "https://dl.example.com/releases/0.0.14/lynel-desktop-0.0.14-x64.exe",
  "sha512": "abc123...",
  "size": 89456789
}
```

**响应（已是最新）：**

```json
{ "hasUpdate": false }
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| hasUpdate | bool | 是 | 是否有新版本 |
| version | string | 否 | 最新版本号，仅 hasUpdate=true 时 |
| releaseDate | string | 否 | ISO 8601 时间戳 |
| releaseNotes | string | 否 | 更新日志，markdown 纯文本 |
| forceUpdate | bool | 否 | 是否强制更新，默认 false |
| downloadUrl | string | 否 | 安装包直链地址，支持 HTTP Range |
| sha512 | string | 否 | 安装包 SHA-512 校验值 |
| size | number | 否 | 安装包大小（bytes） |

**设计决策：**

- 版本号比较放在服务端，客户端只传当前版本号，后续灰度/A/B 测试无需改客户端
- downloadUrl 直链支持 HTTP Range，electron-updater 自动做断点续传
- 仅全量下载，增量包（blockmap）由 GitHub 源提供，云服务保持协议简洁

## 更新 UX 流程

```
应用启动 / 定时检查(每4h) / 用户手动检查
  → checkForUpdates() 双源检测
    ├── 已是最新 → 无动作
    └── 发现新版本 → 判断 forceUpdate
          ├── forceUpdate=true  → 强制更新弹窗（不可关闭）
          └── false             → 通知栏/设置页角标提示，用户主动触发
                → 下载进度条（百分比 + 速度）
                → 下载完成，弹窗 "重启安装 [立即重启][稍后]"
                → quitAndInstall → 平台安装 + app.quit()
```

- 普通更新不弹窗打断用户，仅在设置页和标题栏显示"新版本可用"角标
- 下载进度每 500ms 节流推送前端
- 增量更新：electron-updater 默认使用 blockmap 差分下载，无需额外设计

## IPC 接口

```
主进程 → 前端（推送）
  'update:state' → { status: 'checking'|'available'|'downloading'|'downloaded'|'error',
                     data?: { version, percent, speed, error } }

前端 → 主进程（invoke）
  'app:checkUpdate'     → { hasUpdate, version, releaseDate, releaseNotes, forceUpdate }
  'app:downloadUpdate'  → void
  'app:quitAndInstall'  → void
  'app:getUpdateStatus' → { status, lastCheckTime, currentVersion }
```

- 状态变更走 push 模式（`webContents.send`），避免前端轮询
- 与现有 `preload.ts` → `useElectron.ts` 模式一致

## 设置页面

Settings 页面增加"在线升级"区域：

- 当前版本号 + 手动[检查更新]按钮
- 更新通道展示（仅 stable，beta 不在此管理）
- 更新源配置：GitHub 主源 / HTTP 云服务备源，可启用/禁用和调整优先级
- 云服务地址输入框
- 状态区：已是最新 / 新版本可用[下载] / 下载进度 / 错误信息+重试

## 异常处理

| 场景 | 处理方式 |
|------|----------|
| GitHub 超时(10s) | 不报错，自动切 fallback HTTP |
| GitHub + HTTP 均失败 | 前端显示"检查更新失败，请检查网络" |
| 下载中断/网络断开 | electron-updater 自动断点续传 |
| sha512 校验失败 | 丢弃文件重新下载，超过 3 次报错 |
| 用户下载中关闭应用 | 下次启动保留临时文件，续传继续 |
| 强制更新弹窗+用户强制退出 | 下次启动重新检测并弹窗 |
| 磁盘空间不足 | 下载前预检查剩余空间，不足弹窗提示 |
| macOS 未签名 | 当前阶段跳过签名校验，后续补证书后启用 |

## 外部依赖

- `electron-updater`：下载执行引擎（差分更新、校验、各平台安装）
- 云服务需实现上述接口协议

## 不纳入本期范围

- 代码签名证书（后续单独处理，macOS 上线前必须补齐）
- beta 通道自动更新（仅手动安装）
- 灰度发布 / A/B 测试（协议已预留空间，云服务端可控）
