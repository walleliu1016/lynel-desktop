# 使用指南

## 下载与安装

从 GitHub Releases 页面下载对应平台的最新版本。

### macOS

下载 `.dmg` 文件，挂载后将 `Lynel Desktop.app` 拖入「应用程序」文件夹。

由于应用未进行 Apple 代码签名，首次打开时系统可能会拦截。有两种解决方式：

**方式一（命令行）：**
打开终端，运行以下命令移除隔离属性：

```bash
xattr -cr /Applications/Lynel\ Desktop.app
```

**方式二（图形界面）：**
1. 首次打开被拦截后，进入「系统设置 → 隐私与安全性」
2. 在「安全性」部分找到「已阻止使用『Lynel Desktop』」，点击「仍要打开」

之后即可正常启动，无需重复执行。

### Windows

下载 `.exe` 安装程序，双击运行，按向导完成安装。

### Linux

下载 `.AppImage` 文件，赋予可执行权限后运行：

```bash
chmod +x lynel-desktop-<version>-x64.AppImage
./lynel-desktop-<version>-x64.AppImage
```

部分系统可能需要安装 `fuse`：

```bash
sudo apt install fuse  # Ubuntu/Debian
```

## 首次使用

1. 启动应用后，进入登录页面
2. 首次运行需要设置用户名和密码（本地账户，不依赖网络）
3. 登录后自动扫描 `~/.claude/projects/` 下的所有历史会话并展示在左侧会话列表

## 基本操作

### 新建会话

- 选择 Project 目录后点击「新建会话」
- 输入初始 Prompt（可选），确认后启动交互式 Claude

### 切换会话

- 左侧 SessionList 点击任意会话切换
- 顶部 GlobalTabs 可快速切换已打开的会话

### 发送消息

- 在下方的 xterm 终端输入区域直接输入文本，按回车发送
- 外部脚本可通过 HTTP API 发送：`POST /api/send`

### 查看 Trace

- 右侧 TraceSidebar 展示当前会话的 API 请求列表
- 点击请求行展开 TraceOverlay 查看详情
- TraceSidebar 可点击收起按钮折叠

## 机器人管理（Bot）

Lynel Desktop 支持配置多个企业微信机器人，每个 Bot 可绑定到一个会话，实现远程消息推送和权限审批。

### 添加 Bot

1. 进入 **设置 → 机器人管理**，点击「添加 Bot」
2. 填写名称（任意标识）、来源（企业微信）、Bot ID 和 Secret
3. 保存后 Bot 自动连接

### 绑定会话

- **新建会话时**：在新建对话框中选中目标 Bot
- **已有会话**：右键会话列表中的目标会话，选择「绑定 Bot」

一个 Bot 只能绑定一个会话，一个会话也只能绑定一个 Bot。

### 远程操作

绑定后可在企业微信聊天中直接发消息，消息会自动路由到绑定的会话处理。权限请求和 AskUserQuestion 会通过模板卡片推送到企业微信，点击按钮即可审批。

#### 控制指令

在企业微信中发送以下特殊命令可远程操控 Claude 终端进程：

| 命令 | 效果 |
|------|------|
| `/interrupt` `/ctrl-c` `/ctrl+c` | 中断 Claude 当前生成（等同在终端按 Ctrl+C） |
| `/escape` `/esc` | 发送 Esc 键 |
| `/ctrl-d` | 发送 Ctrl+D（EOF） |

> 注意：控制指令仅在 PTY 层面生效，不会被当作文本消息转发给 Claude。

## 设置

通过标题栏的设置按钮进入设置页面：

- **通用** — 推送思考过程、推送工具调用等开关
- **Hooks** — 编辑 Claude hooks 配置（表单/JSON 双视图）
- **机器人管理** — 添加/编辑/删除 Bot，绑定会话
- **通道** — 配置企业微信、本地文件等输出通道

## 配置文件位置

| 内容 | 路径 |
|---|---|
| 应用配置 | macOS: `~/Library/Application Support/Lynel Desktop/` |
| | Windows: `%APPDATA%\Lynel Desktop\` |
| | Linux: `~/.config/Lynel Desktop/` |
| API 网关数据 | `~/.lynel-desktop/projects/` |
| Claude 配置 | `~/.claude/settings.json` |

## 查看日志

| 平台 | 日志路径 |
|---|---|
| macOS | `~/Library/Logs/Lynel Desktop/main.log` |
| Windows | `%USERPROFILE%\AppData\Roaming\Lynel Desktop\logs\main.log` |
| Linux | `~/.config/Lynel Desktop/logs/main.log` |

日志使用 `electron-log`，主进程和渲染进程分开写入，滚动保留。

## 常见问题

### macOS 提示「无法验证开发者」

参考上方安装章节的 xattr 命令移除隔离属性。

### 应用启动后黑屏

尝试在启动后打开 DevTools（菜单或快捷键）查看 Console 错误信息。开发模式推荐使用 `npm run dev`。

### 终端显示 loading 后无内容

xterm 容器尺寸调整或切换会话时会重新加载，等待几秒即可。如果长时间无响应，检查主进程日志。
