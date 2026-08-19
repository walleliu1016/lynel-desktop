# Lynel Desktop

跨平台多 Agent 会话管理桌面 App —— 把 Claude Code / Codex / OpenCode / OMP 等终端 CLI 包成一个能登录、能拦截权限、能查看 Trace 的本地 GUI。

---

## 为什么做这个

Claude CLI 本身很强大，但日常使用有三个痛点：

1. **多会话管理困难** —— 没法一眼看到所有历史会话和当前状态
2. **权限弹窗打断流程** —— PermissionRequest 弹在终端里，需要切回去手动确认
3. **远程协作不便** —— 离开电脑就没法看进度、发任务、审批权限

Lynel Desktop 把这几件事变成一个 native 窗口：图形化管理多会话、可视化每次请求、企业微信远程收发消息与审批、云端同步。

## 功能

- **UM 账户登录** — 登录页输入用户名；可选开启云服务（服务地址 + PIN+Token 云端校验）
- **多 Agent 支持** — 托管 Claude Code / Codex / OpenCode / OMP 四种终端 CLI，按 agent 注入本地代理、按类型恢复会话
- **Agent 启停开关** — 设置 → 通用 中逐个启用 / 停用非 Claude Agent；关闭后前端隐藏、主进程拒绝创建
- **Agent 类型标识** — 会话列表 / 终端 tab / 历史会话按 agent 显示徽标，新建会话可选 agent
- **历史会话自动扫描** — 读取 `~/.claude/projects/` 与 recent-sessions.json，文件变化即时刷新
- **两栏布局** — 左侧栏（入口 + 会话列表，可折叠）| 中间内容区（标签页 + 每会话「终端 / Trace」子页）
- **xterm.js 原生终端** — 中间区域嵌入 xterm.js，PTY 驱动交互式 agent，右键复制粘贴、Ctrl+滚轮调字号
- **Trace 面板** — 每个会话独立的请求可视化子页，含状态、模型、Token、延迟、总费用、请求详情
- **API 网关代理** — 本地拦截 API 流量，按 agent 适配 Anthropic / OpenAI Responses / Chat 格式，提取阶段数据
- **权限仲裁器** — 统一管理权限请求，支持主窗口 / 企业微信多通道审批
- **多 Bot 管理** — 支持配置多个企业微信机器人，每个 Bot 绑定不同会话
- **企业微信双向通道** — 远程收发消息、权限审批、AskUserQuestion 问答（模板卡片）、终端截图、控制指令（`/interrupt`、`/screenshot` 等）、引用消息快捷回复
- **云端上行通道** — 阶段事件批量推送 + 会话元数据同步至云服务
- **在线升级** — GitHub Releases 为主源、云服务为兜底，自动/手动检查更新
- **窗口注意力** — 权限待审批时任务栏闪烁 / dock 弹跳 / 系统通知提醒
- **VS Code 扩展** — 独立于桌面端运行，在 VS Code 内嵌 Claude 终端，共享企业微信机器人与数据目录

## 安装

从 [GitHub Releases](https://github.com/walleliu1016/lynel-desktop/releases) 下载对应平台的安装包：

- **macOS**：下载 `.dmg`，将 App 拖入「应用程序」文件夹。首次运行需在终端执行 `xattr -cr` 命令移除隔离属性，具体步骤见[使用指南](docs/user-guide.md#macos)
- **Windows**：下载 `.exe` 安装程序，双击安装
- **Linux**：下载 `.AppImage`，赋予可执行权限后运行。部分系统需安装 `fuse`，具体步骤见[使用指南](docs/user-guide.md#linux)

## 快速开始

1. 启动应用，输入 UM 账户名登录（可开启云服务以便手机远程操作）。
2. 在首页输入第一条提示词，选择 Agent，回车创建会话。
3. 要使用 Codex / OpenCode / OMP，先到 **设置 → 通用** 打开对应「Agent 启用」开关。
4. 想远程协作：在企业微信创建机器人 → **设置 → 机器人** 添加 → **先给机器人发一条消息** → 右键会话绑定即可。

完整说明见[使用指南](docs/user-guide.md)。

## 日志查看

各平台日志路径见[使用指南 — 数据与日志位置](docs/user-guide.md#十三数据与日志位置)。

## 技术栈

桌面壳 Electron、前端 Vue 3 + TypeScript + Pinia、主进程 Node.js、持久化 electron-store + 本地 JSON、日志 electron-log、打包 electron-builder。

## License

MIT
