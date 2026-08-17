# Lynel Desktop 项目落地页设计

> 日期：2026-08-17
> 状态：已与用户逐节确认
> 目标：为 Lynel Desktop 设计一个项目展示、介绍、版本下载的营销落地页

## 一、背景与目标

Lynel Desktop 是跨平台多 Agent 会话管理桌面 App（托管 Claude Code / Codex / OpenCode / OMP，把 CLI 包成能登录、能拦截权限、能查看 Trace 的本地 GUI）。当前版本 0.0.21，安装包发布在 GitHub Releases，同时云服务提供下载分发。

需要一个**面向潜在最终用户**的营销落地页，核心目的是**促成下载试用**。

### 已确认的关键决策

| 维度 | 决策 |
|------|------|
| 定位 | 营销落地页，面向潜在用户，促成下载 |
| 技术形态 | 纯 HTML 单文件（内联 CSS + JS，零构建零依赖） |
| 下载源 | 云服务：base URL 用 `window.location.origin`，复用 desktop 更新接口约定 |
| 内容区块 | Hero / 痛点解决 / 功能亮点 / 界面展示 / 下载区 / 更新日志 / 页脚 |
| 视觉风格 | 浅色延续项目红蓝主题，交互与排版参考 paseo.sh 现代风格 |
| 截图素材 | Hero 1 张必需 + 若干可选，缺省用 CSS 界面示意兜底 |

## 二、视觉系统

### 配色（延续项目红蓝主题）

| 用途 | 值 |
|------|-----|
| 页面背景 | `#f7f8fa`，区块交替 `#ffffff` |
| 卡片背景 / 边框 | `#ffffff` / `#eef1f5` |
| 品牌蓝（主 CTA、标题强调、链接） | `#1e5af5` |
| 品牌红（次强调、痛点、badge） | `#e63946` |
| 标题文字 | `#0d1321` |
| 正文 | `#3f4756` |
| 弱化文字 | `#8a93a6` |
| 成功绿（版本状态） | `#10b981` |

### 字体与排版

- 正文 / 标题：系统字体栈 `"PingFang SC", "Microsoft YaHei", Inter, sans-serif`，标题加粗、字重 700/800
- 代码 / 终端 / 版本号：等宽 `"Source Code Pro", ui-monospace, monospace`
- 不使用外链字体，保证零外部依赖

### 圆角与阴影

- 按钮 8px、卡片 14px、大图/终端框 16px
- 阴影 `0 8px 30px rgba(13, 24, 41, 0.08)`，hover 加深

### 布局

- 内容容器 `max-width: 1120px` 居中
- 区块垂直间距 `clamp(64px, 10vw, 120px)`
- 全页响应式，移动端单列

## 三、页面结构与区块内容

### 1. 顶部导航（吸顶）

- Logo「Lynel Desktop」（红蓝点阵图标 + 字标）
- 导航：功能 / 界面 / 下载 / 更新日志
- 右侧「下载」按钮
- 滚动 40px 后毛玻璃模糊底 + 细阴影，淡入过渡

### 2. Hero

- 大标题：「把 Claude Code / Codex 等 CLI 装进一个本地窗口」，`Claude Code / Codex / OpenCode / OMP` 用红蓝交替高亮
- 副标题：多会话管理 · 统一权限审批 · 实时 Trace · 企业微信远程
- 平台检测下载按钮「下载 Windows 版」+ 副按钮「所有下载选项」+ 支持平台标识（macOS / Windows / Linux）
- 背景：红蓝光斑（radial-gradient 两个柔光层）缓慢漂浮呼吸动画
- **截图位①（必需）**：主窗口三段式全貌

### 3. 痛点 → 解决方案（3 列卡片）

| 痛点 | 解决 |
|------|------|
| 多会话难管理 | 会话列表一眼看清状态 |
| 权限弹窗打断 | 权限仲裁器统一审批 |
| Hooks 配置繁琐 | 临时 settings 注入零配置 |

### 4. 功能亮点网格（7 卡，每卡一句标题 + 一句说明）

1. 多 Agent 托管（Claude Code / Codex / OpenCode / OMP）
2. 权限仲裁器
3. Trace 面板（实时请求 / 模型 / 延迟 / 费用）
4. 企业微信双向通道
5. 云端上行
6. 历史会话自动扫描
7. **DeepSeek Harness 界面**：内嵌 DSH Web 前端，deepseek 驱动的会话界面，支持 Bot 绑定、提问接管（Ask 钩子）、轨迹实时转发

（功能网格内嵌截图位②③④，可选，见第六节表格）

### 5. 界面展示大区（3 幅大图，paseo「Review, preview, ship」风格）

- 图 A：xterm 终端里 agent 流式运行
- 图 B：DSH Web 界面（deepseek 会话界面，含绑定 Bot 按钮）
- 图 C：企业微信里收到的审批卡片 / 进度（体现远程控制）

### 6. 下载区（核心交互区，见第四节）

- 平台 tabs（Windows / macOS·Intel / macOS·Apple Silicon / Linux）
- 版本号 + 文件大小 + SHA-512 校验展示
- 主下载按钮 + 「所有下载选项」展开

### 7. 更新日志

- 优先版本列表接口，渲染最近 5 个版本（日期 + 说明）
- 接口缺失/失败时降级为单条最新版本

### 8. 页脚

- MIT License · GitHub 链接 · 使用文档 · 技术栈一行

## 四、下载交互逻辑

### 平台与架构检测

- 优先 `navigator.userAgentData`（Chromium）读平台；回退 UA 字符串解析
- 架构推断：UA 含 `arm64` / `aarch64` → arm64；`Win64` / `x64` / `WOW64` → x64；macOS 必须区分 x64 / arm64；无法识别回退 x64

### 接口调用（复用 desktop 更新约定，base = `window.location.origin`）

- 主请求：`GET /api/update/check?platform=<p>&arch=<a>&version=0&channel=stable`
  - 响应：`{ hasUpdate, version, releaseDate, releaseNotes, downloadUrl, sha512, size }`
- 主下载按钮：页面加载时按检测出的平台 + arch 调一次，拿到直链后按钮生效并显示「下载 Windows x64 版 · v0.0.21 · 89 MB」
- 「所有下载选项」：展开平台 tabs，点击某 tab 才懒加载对应 `check` 请求拿该平台直链（最多 4 个按需请求）

### 更新日志接口（可选增强）

- `GET /api/update/list`，响应格式沿用 check 字段风格、按版本倒序：
  ```json
  {
    "versions": [
      { "version": "0.0.21", "releaseDate": "2026-08-14T10:00:00Z", "releaseNotes": "…" }
    ]
  }
  ```
- 接口 404 / 失败 → 降级为单条：用 check 返回的 `version` + `releaseNotes`

### 降级链（保证页面永不空白，且不写死版本号）

1. 接口超时（10s，AbortController）或非 2xx → 按钮回退为相对模板链接 `/api/update/download?platform=win&arch=x64`（**不传 version**），并提示「自动检测失败，可手动选平台」
2. 完全无 JS → 页面静态可读，下载按钮直接用 `<a href>` 相对模板链接（同样不传 version）

> **关键约定**：`/api/update/download` 不传 `version` 参数时，云服务端返回**最新版**安装包。这是"落地页零写死版本"的前提，见第十节。

## 五、动效清单

- **滚动入场**：每区块 IntersectionObserver 触发 fade-up（淡入 + 上移 24px，500ms），区块内元素 staggered 60ms 逐个浮现
- **Hero 标题**：首屏逐行 reveal（clip + translateY），强调词红蓝交替轻微上浮
- **Hero 背景**：红蓝光斑缓慢漂浮呼吸动画（12s 循环）
- **按钮**：hover 背景过渡 + `scale(1.02)`，点击 `scale(0.98)`；下载按钮就绪状态过渡
- **卡片**（痛点/功能）：hover 上浮 4px + 阴影加深 + 顶部 2px 红/蓝渐变条滑入
- **截图位**：hover `scale(1.02)` + 阴影加深；加载时骨架/shimmer
- **平台 tabs**：切换时下载信息块淡入；检测中按钮显示 spinner
- **吸顶导航**：滚动 40px 后毛玻璃模糊底 + 细阴影淡入
- **CSS 终端示意动画**：光标闪烁 + 行逐行"打印"（仅无真实截图兜底时）
- **尊重 `prefers-reduced-motion`**：系统关动画时全部动效降级为纯淡入

## 六、文件结构与截图替换约定

### 文件位置

仓库根 `landing/index.html`（单文件自包含）。不会被 electron-builder 打包（`files` 只收 `dist-electron/` 与 renderer dist），不影响主程序构建；发布时直接拷到云服务。

### 单文件内部组织

```
landing/index.html
├─ <head>  SEO：title / description / Open Graph / favicon（内联 SVG 红蓝图标）
├─ CSS    根 CSS 变量 → 全局 → 各区块
├─ <body>
│   ├─ <header>  吸顶导航
│   ├─ <section class="hero">       截图位①
│   ├─ <section class="painpoints"> 痛点→解决 3 卡
│   ├─ <section class="features">   7 功能卡
│   ├─ <section class="showcase">   3 大图（截图位⑤⑥⑦）
│   ├─ <section class="download">   平台 tabs + 版本/大小/校验
│   ├─ <section class="changelog">  更新日志
│   └─ <section class="faq">        短 FAQ
├─ <footer>  MIT · GitHub · 文档
└─ <script>  平台检测 / fetch 封装(10s 超时) / 下载渲染 / scroll 动效 / tab 交互
```

### 截图位约定

每个截图位是 `<div class="shot" data-name="<hero|features|showcase>">` 包一个 `<img>` + 无图时的 CSS 兜底示意；替换时只需填 `<img src>`，注释内含尺寸建议。

| 截图位 | 内容 | 优先级 | 建议 |
|--------|------|--------|------|
| ① hero | 主窗口三段式全貌（左会话列表 / 中终端 / 右 Trace） | 必需 | 16:10，宽 ≥1600px |
| ② feature | 新建会话选 agent（含徽标） | 可选 | 16:10 |
| ③ feature | 权限审批卡片 | 可选 | 4:3 |
| ④ feature | Trace 请求详情 | 可选 | 16:10 |
| ⑤ showcase | xterm 终端流式运行 | 可选 | 16:10 |
| ⑥ showcase | DSH Web 界面（含绑定 Bot） | 可选 | 16:10 |
| ⑦ showcase | 企业微信审批卡片/进度 | 可选 | 9:16（竖屏） |

## 七、错误处理与边界

- fetch 超时（10s）/ 非 2xx → 降级静态链接 + 内联提示
- 平台 tabs 点击时按钮 loading 态（禁用 + spinner）
- 下载按钮始终保留 `href`（渐进增强）
- 平台无法识别 → 默认提供「选择你的平台」下拉

## 八、无障碍与性能

- 语义标签（header/main/section/footer/nav）
- `aria-label`（平台 tabs、下载按钮）、focus 可见样式、对比度达标
- `prefers-reduced-motion` 关闭动效
- 零外部依赖（无外链字体 / 库）
- 首屏图不 lazy，非首屏截图 `loading="lazy"`

## 九、测试计划

- 本地 `npx serve` 起静态服务，配 mock 的 `check` / `list` 响应验证主流程
- 手动清单：
  - 平台检测各平台（win / mac·x64 / mac·arm64 / linux）
  - 接口成功 / 超时 / 404 三条路径
  - 无 JS 降级
  - 移动端单列布局
  - `prefers-reduced-motion` 关闭动效

## 十、版本升级流程（落地页零写死版本）

落地页不写死任何版本号：最新版本、版本号、更新日志、下载链接全部来自云服务接口。

**升级流程 = 云服务侧发新包，HTML 零改动：**

1. 云服务上传新版安装包，更新 `/api/update/list`（新增一条）
2. 页面自动展示最新版本号 + 更新日志 + 对应平台下载直链
3. 降级链（接口挂/无 JS）走 `/api/update/download`，不传 `version` 时云服务返回最新版

**唯一的硬前提（需要云服务端配合）：**

- `/api/update/download` 不传 `version` 时必须返回最新版安装包
- 若云服务端无法做到，则需在 HTML 内维护一个 `DEFAULT_VERSION` 常量并随发版更新（作为备选，不推荐）

## 十一、待确认 / 后续

- `/api/update/list` 接口为可选增强；若云服务暂未提供，页面降级为单条最新版本，不影响主流程
- `/api/update/download` 无 version 返回最新版的行为需在云服务端确认
