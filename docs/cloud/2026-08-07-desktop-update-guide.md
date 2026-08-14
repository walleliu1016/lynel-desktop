# Desktop 在线更新对接指南

> 日期：2026-08-14（v2，同步自研下载器重构）
> 目标读者：云服务端开发者（实现更新检查与安装包分发）

## 一、背景

Desktop 客户端需要自动检查更新并下载安装新版本。逻辑在客户端 `src/main/updater/` 实现，采用**双源 fallback**：

1. **GitHub Releases**（优先）：`api.github.com/repos/walleliu1016/lynel-desktop/releases/latest`
2. **云服务 HTTP API**（fallback）：`GET /api/update/check`，由本指南定义

云服务地址通过设置页 `cloud_service_url` 配置，启用后即作为 HTTP fallback 源。

**客户端行为**：每次启动后 5 秒 + 每 4 小时定时检查；也支持设置页手动检查。云服务不可达时不影响客户端，仅记录日志。

**下载实现**：自研 Node 下载器（`downloader.ts`），直接用 Node `https/http` 拉取 `downloadUrl`，**不再依赖 electron-updater**（其 generic provider 无法读 `file://` 且硬性要求 sha512，不适用于当前发布流程）。

## 二、检查更新接口

### 2.1 请求

```
GET /api/update/check
```

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| platform | string | 是 | `win` / `mac` / `linux` |
| arch | string | 是 | `x64` / `arm64` |
| version | string | 是 | 客户端当前版本号，如 `0.0.17` |
| channel | string | 是 | 固定 `stable`（仅 stable 走自动更新） |

### 2.2 响应（有新版本，HTTP 200）

```json
{
  "hasUpdate": true,
  "version": "0.0.18",
  "releaseDate": "2026-08-07T10:00:00Z",
  "releaseNotes": "更新日志 markdown 文本",
  "forceUpdate": false,
  "downloadUrl": "https://dl.example.com/releases/0.0.18/lynel-desktop-0.0.18-mac-arm64.dmg",
  "sha512": "abc123...",
  "size": 89456789
}
```

### 2.3 响应（已是最新，HTTP 200）

```json
{ "hasUpdate": false }
```

### 2.4 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| hasUpdate | bool | 是 | 是否有新版本 |
| version | string | 否 | 最新版本号，仅 hasUpdate=true 时返回 |
| releaseDate | string | 否 | ISO 8601 时间戳 |
| releaseNotes | string | 否 | 更新日志，markdown 纯文本 |
| forceUpdate | bool | 否 | 是否强制更新，默认 false；true 时客户端定时检查会主动推送通知 |
| downloadUrl | string | 否 | 安装包直链地址，必须完整 URL（http/https） |
| sha512 | string | 否 | 安装包 SHA-512 校验值 |
| size | number | 否 | 安装包大小（bytes） |

### 2.5 版本比较

- **以服务端比较为主**：服务端判断 `version` 是否比客户端新，后续灰度/A/B 无需改客户端。
- **客户端兜底**：客户端用 `isNewerVersion` 再做一次"严格大于"比较，服务端误报同版本/降级时客户端直接视为无更新。

### 2.6 错误处理

| 场景 | 服务端行为 | 客户端行为 |
|------|-----------|-----------|
| 接口 5xx / 404 | 返回错误状态码 | 视为该源不可用，记录日志，fallback GitHub |
| 请求超时 | — | 10s 超时后按失败处理 |
| 字段缺失（如 sha512） | 可省略 | 客户端不阻塞，仅记录日志 |

## 三、架构区分（重点）

客户端请求时携带 `arch` 参数，**云服务端必须按 `platform` + `arch` 组合返回对应架构的安装包**。

### 3.1 各平台安装包映射

| platform | arch | 文件格式 | 说明 |
|----------|------|---------|------|
| win | x64 | `.exe` | NSIS 安装包 |
| mac | x64 | `.dmg` | Intel 芯片 |
| mac | arm64 | `.dmg` | Apple Silicon 芯片 |
| linux | x64 | `.AppImage` | |
| linux | arm64 | `.AppImage` | |

> **mac 必须区分 `x64` 与 `arm64`**：同一版本需分别提供 Intel 与 Apple Silicon 两套 `.dmg`，`downloadUrl` 按请求的 `arch` 返回对应文件。若只出 universal 包，则两架构可共用同一 URL，但需在文档中注明。

### 3.2 文件名约定

建议命名包含版本 + 平台 + 架构，便于排查：

```
lynel-desktop-<version>-<platform>-<arch>.<ext>
示例：lynel-desktop-0.0.18-mac-arm64.dmg
```

## 四、下载接口（downloadUrl 直链）

### 4.1 实现方式（二选一）

**方式 A：对象存储 / CDN 静态直链（推荐）**

版本发布时把安装包上传到 OSS / COS / S3 等对象存储，`downloadUrl` 直接返回公网直链：

```json
"downloadUrl": "https://cdn.example.com/lynel/0.0.18/lynel-desktop-0.0.18-mac-arm64.dmg"
```

**方式 B：云服务自建下载接口**

```json
"downloadUrl": "https://api.example.com/api/update/download?version=0.0.18&platform=mac&arch=arm64"
```

### 4.2 硬性要求

- **必须是完整 URL，且协议为 `https` / `http`**：客户端自研下载器只支持这两种协议，其它协议（如 `file://`）直接拒绝。
- **无需额外鉴权**：客户端直接 GET，不携带 token。
- **响应状态码 2xx**：非 2xx（如 404/403）客户端判定下载失败并删除临时文件。
- **文件大小尽量通过 `content-length` 返回**：用于下载进度百分比；缺失时客户端回退到响应里的 `size` 字段。
- **支持 HTTP Range 为可选**：自研下载器为一次性流式下载，不做断点续传；若服务端/对象存储支持 Range 则更健壮，但**不是硬性要求**。
- **连接超时 30s**：客户端下载连接超过 30s 无响应会主动中断并报错，避免 UI 一直停在 0%。

## 五、客户端关键实现

### 5.1 检查流程

```
checkForUpdates()
  ├─ 1. GitHub Releases API（10s 超时）
  │    └─ 失败/超时 → fallback
  └─ 2. 云服务 /api/update/check（10s 超时）
       └─ 失败 → 前端提示"检查更新失败"
```

### 5.2 下载流程（自研下载器）

```
拿到 hasUpdate=true → 点击"下载更新"
  → Node https/http GET downloadUrl（0% 立即上报）
  → 流式写临时文件 <tmp>/lynel-desktop-<version>.<ext>
  → 进度上报（256KB 节流）→ downloaded 状态
  → 点击"重启安装" → quitAndInstall()
```

### 5.3 安装流程（按平台）

| 平台 | 方式 | 说明 |
|------|------|------|
| win | `spawn <exe> /S`（detached） | NSIS 静默安装，安装器接管并退出旧进程 |
| mac | `spawn open <dmg>` | 挂载后由用户拖入 Applications |
| linux | `chmod +x` 后 `spawn <AppImage>` | 直接启动 |

### 5.4 相关代码

| 文件 | 职责 |
|------|------|
| `src/main/updater/checker.ts` | 双源检查（GitHub + 云服务），版本比较兜底 |
| `src/main/updater/downloader.ts` | 自研 Node 下载器 + 分平台安装 |
| `src/main/updater/index.ts` | IPC 注册、定时检查、`update:state` 状态推送 |

## 六、接口对接示例

```bash
# 检查是否有新版本（mac arm64）
curl "http://<cloud-host>/api/update/check?platform=mac&arch=arm64&version=0.0.17&channel=stable"

# 响应示例
{"hasUpdate":true,"version":"0.0.18","releaseDate":"2026-08-07T10:00:00Z",
 "releaseNotes":"## 新功能\n- xxx","forceUpdate":false,
 "downloadUrl":"https://cdn.example.com/lynel/0.0.18/lynel-desktop-0.0.18-mac-arm64.dmg",
 "sha512":"abc123...","size":89456789}
```

## 七、验收清单

- [ ] `/api/update/check` 支持 `platform` / `arch` / `version` / `channel` 四个参数
- [ ] mac 按 `arch` 区分 x64 / arm64 返回不同 `downloadUrl`
- [ ] 已是最新时返回 `{"hasUpdate": false}`
- [ ] `downloadUrl` 为完整 URL（http/https），GET 无需鉴权
- [ ] 下载响应为 2xx，尽量携带 `content-length`
- [ ] 各平台安装包扩展名符合约定（`.exe` / `.dmg` / `.AppImage`）
- [ ] `sha512` / `size` / `releaseDate` / `releaseNotes` / `forceUpdate` 字段可返回
