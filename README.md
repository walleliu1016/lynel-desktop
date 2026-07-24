# Lynel Desktop

跨平台 Claude 会话管理桌面 App —— 把 Claude CLI 包成一个能登录、能拦截权限、能查看 Trace 的本地 GUI。

---

## 为什么做这个

Claude CLI 本身很强大，但日常使用有三个痛点：

1. **多会话管理困难** —— 没法一眼看到所有历史会话和当前状态
2. **权限弹窗打断流程** —— PermissionRequest 弹在终端里，需要切回去手动确认
3. **Hooks 配置繁琐** —— 每次改 `settings.json` 都要开编辑器、背 schema

Lynel Desktop 把这三件事变成一个 native 窗口，同时保留 `claude -r <sid>` 在系统终端继续用的能力。

## 功能

- **本地账户密码登录** — bcrypt 哈希，5 次失败锁定
- **历史会话自动扫描** — 读取 `~/.claude/projects/`，文件变化即时刷新
- **xterm.js 原生终端** — 中间区域嵌入 xterm.js，PTY 驱动交互式 Claude
- **三段式布局** — 左侧会话列表 | 中间终端 | 右侧 Trace 面板，均可收起展开
- **API 网关代理** — 本地拦截 Claude API 流量，提取 prompt / tool_use / tool_result 等阶段数据
- **权限仲裁器** — 统一管理权限请求，支持主窗口/企业微信/灵动岛多通道审批
- **灵动岛悬浮窗** — iOS 风格常驻桌面顶部，hover 展开查看状态与审批
- **多 Bot 管理** — 支持配置多个企业微信机器人，每个 Bot 绑定不同会话
- **企业微信双向通道** — 远程接收消息、权限审批、AskUserQuestion 问答（模板卡片）、终端截图
- **云端上行通道** — 阶段事件批量推送 + 会话元数据同步至云服务
- **本地文件通道** — 阶段事件写入本地 JSONL/JSON
- **Hook 编辑器** — 13 类 Claude hooks 表单配置，自动备份
- **Trace 面板** — 实时 API 请求列表，含状态、模型、延迟、费用
- **主题切换** — dark-pro / light-pro 两种主题

## 安装

从 [GitHub Releases](https://github.com/walleliu1016/lynel-desktop/releases) 下载对应平台的安装包：

- **macOS**：下载 `.dmg`，将 App 拖入「应用程序」文件夹。首次运行需在终端执行 `xattr -cr` 命令移除隔离属性，具体步骤见[使用指南](docs/usage.md#macos)
- **Windows**：下载 `.exe` 安装程序，双击安装
- **Linux**：下载 `.AppImage`，赋予可执行权限后运行。部分系统需安装 `fuse`，具体步骤见[使用指南](docs/usage.md#linux)

## 快速开始

启动应用后设置本地账户密码，登录后自动加载所有历史会话。选择 Project 目录新建会话即可开始使用。

详细操作说明见[使用指南](docs/usage.md)。

## 日志查看

各平台日志路径见[使用指南 — 查看日志](docs/usage.md#查看日志)。

## 技术栈

桌面壳 Electron、前端 Vue 3 + TypeScript + Pinia、主进程 Node.js、持久化 electron-store + 本地 JSON、日志 electron-log、打包 electron-builder。

## License

MIT
