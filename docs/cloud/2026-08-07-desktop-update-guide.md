# Desktop 在线更新对接指南

> 日期：2026-08-07
> 目标读者：云服务端开发者（实现更新检查与安装包分发）

## 一、背景

Desktop 客户端需要自动检查更新并下载安装新版本。检查逻辑在客户端 `src/main/updater/` 实现，采用**双源 fallback**：

1. **GitHub Releases**（优先）：`api.github.com/repos/walleliu1016/lynel-desktop/releases/latest`
2. **云服务 HTTP API**（fallback）：`GET /api/update/check`，由本指南定义

云服务地址通过设置页 `cloud_service_url` 配置，启用后即作为 HTTP fallback 源。

**客户端行为**：每次启动后 5 秒 + 每 4 小时定时检查；也支持设置页手动检查。云服务不可达时不影响客户端，仅记录日志。

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

> 客户端传完整版本号，**版本比较由服务端完成**（后续灰度/A/B 无需改客户端）。

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
| forceUpdate | bool | 否 | 是否强制更新，默认 false |
| downloadUrl | string | 否 | 安装包直链地址，必须完整 URL（含协议头） |
| sha512 | string | 否 | 安装包 SHA-512 校验值 |
| size | number | 否 | 安装包大小（bytes） |

### 2.5 错误处理

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

### 3.3 客户端侧行为（服务端无需关心）

- 检查阶段：客户端解析响应，不自行匹配文件名，**完全以 `downloadUrl` 为准**。
- 下载阶段：客户端把 `downloadUrl` 原样写入临时 `latest.yml` 的 `path` 字段，交给 electron-updater 下载安装。
- 因此 `downloadUrl` 必须是完整 URL，**不能是相对路径**。

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

- **支持 HTTP Range**：客户端 electron-updater 下载时做断点续传，必须正确处理 `Range` 请求头。方式 B 用 Express `res.download()` / `res.sendFile()` 自带 Range 支持。
- **无需额外鉴权**：客户端直接 GET，不携带 token。
- **文件名含平台标识**：客户端按扩展名兜底识别 `.exe` / `.dmg` / `.AppImage`。

## 五、客户端关键实现

### 5.1 检查流程

```
checkForUpdates()
  ├─ 1. GitHub Releases API（10s 超时）
  │    └─ 失败/超时 → fallback
  └─ 2. 云服务 /api/update/check（10s 超时）
       └─ 失败 → 前端提示"检查更新失败"
```

### 5.2 下载流程

```
拿到 hasUpdate=true → 写临时 latest.yml（version/releaseDate/path/sha512）
  → electron-updater setFeedURL(file://临时目录)
  → downloadUpdate() 下载 + 下载进度推送
  → update-downloaded → 弹窗"重启安装"
  → quitAndInstall()
```

### 5.3 相关代码

| 文件 | 职责 |
|------|------|
| `src/main/updater/checker.ts` | 双源检查（GitHub + 云服务） |
| `src/main/updater/downloader.ts` | 写临时 latest.yml + electron-updater 下载安装 |
| `src/main/updater/index.ts` | IPC 注册、定时检查、状态推送 |

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
- [ ] `downloadUrl` 为完整 URL，支持 HTTP Range
- [ ] 各平台安装包扩展名符合约定（`.exe` / `.dmg` / `.AppImage`）
- [ ] `sha512` / `size` / `releaseDate` / `releaseNotes` 字段可返回
