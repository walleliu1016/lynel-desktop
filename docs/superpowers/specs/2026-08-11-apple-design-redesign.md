# Apple Design UI 重构设计文档

日期：2026-08-11

## 背景

当前 UI 为浅色唯一主题（红蓝品牌渐变），三段式布局（SessionList | GlobalTabs+content | TraceSidebar），整体观感偏 Chrome 工具风：顶部标签带弧角裙边、字号偏小（10–16px）、组件内大量硬编码颜色与 CSS 变量混用、无深色模式、无统一动效语言。

目标：以 Apple 设计语言（流体动效、材质层次、明暗自适应、克制排版）重构整个应用 UI，覆盖登录页、首页、三栏工作区、终端、设置、Trace 全部界面。

## 需求确认（与用户逐项确认）

- **范围**：全量改造所有界面（登录、首页、三栏布局、终端、设置、Trace）。
- **主题**：引入完整深色 + 浅色双主题，`system` 跟随系统切换。
- **品牌**：保留红蓝渐变于 Logo/标题；交互元素收敛为单一蓝色强调色。
- **动效**：全面引入弹簧动效（Motion 库），打断可逆、跟手。
- **终端**：8 套 xterm 配色预设保留，只改 UI 层。
- **顶部 Tab**：去掉 Chrome 弧角裙边，改为精简胶囊 + 底部分隔线 + 选中色块。
- **执行架构**：Design Token + 轻量 UI Kit（方案 3）。

## 设计

### 1. 主题体系（双主题自适应）

- `main.ts` 主题启动逻辑扩展为三态 `light / dark / system`：
  - `system` 通过 `matchMedia('(prefers-color-scheme: dark)')` 监听实时切换。
  - 旧 `localStorage['lynel-desktop-theme'] === 'light'` 自动迁移，不破坏存量。
- `data-theme`（UI 主题）与 `data-term-theme`（终端配色）**完全解耦**：终端 8 套配色不动。
- 设置页「外观」新增「主题」分段控件（浅色 / 深色 / 跟随系统），即时生效（写 electron-store `settings.theme` + 应用 `data-theme`）。
- 新增完整 `[data-theme="dark"]` 令牌块。

### 2. 颜色令牌（Apple 风格）

组件内硬编码颜色（`#ef4444`、`#60a5fa`、`#047857`、`rgba(30,41,59,.92)` 等）全部迁移到语义化 token。

| 类别 | 浅色 | 深色 |
|---|---|---|
| `--bg-primary` | `#F5F5F7` | `#1C1C1E` |
| `--bg-panel` | `#FFFFFF` | `#2C2C2E` |
| `--bg-input` / `--bg-hover` | `#FFFFFF` / `#F0F0F2` | `#3A3A3C` / `#333335` |
| `--text-primary` | `#1D1D1F` | `#F5F5F7` |
| `--text-secondary` | `#6E6E73` | `#98989D` |
| `--text-tertiary` | `#86868B` | `#6E6E73` |
| `--accent` | `#0071E3` | `#0A84FF` |
| `--accent-deep` / `--accent-light` | `#0060DF` / `#5E9CFF` | `#0A84FF` / `#4DA3FF` |
| `--status-success` / `--status-warn` / `--status-error` | `#34C759` / `#FF9F0A` / `#FF3B30` | 同左（soft 背景做明度适配） |
| `--brand-grad` | 红蓝渐变保留 | 同左 |
| `--border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.12)` |
| `--border-strong` | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.18)` |

**硬约束**：交互元素（选中态 / 链接 / 按钮 / 指示条）一律用 `--accent`；红蓝渐变只出现在品牌处。

### 3. 字体与排版

- 字体族：`system-ui` 栈（macOS→SF Pro，Windows→Segoe UI）；`--font-mono` 保留给数字 / 代码。
- 字号上调一档：`--fs-caption:12px / body-sm:13px / body:14px / title:18px / hero:30px`。
- Apple 排版法则：大标题负字距（`-0.02em`）、正文 `0`、小字号微正（`+0.01em`）；大标题收紧行高。

### 4. 圆角 / 阴影 / 材质

- 圆角：`sm:8 / md:10 / lg:14 / pill:999`。
- 阴影改分层材质阴影（浅色轻盈、深色深邃），供浮层 / 弹窗 / 侧栏使用。
- 新增 `--material-*` token + `.material` 工具类：`backdrop-filter: blur(20px) saturate(180%)` + 半透明底。
- **毛玻璃只用于浮层**（标题栏 hover、tooltip、弹窗、右键菜单、PermissionToast、TraceOverlay）；主面板保持不透明保证阅读与性能。

### 5. UI Kit（轻量原语）

- `useSpring` composable：封装 `motion.animate`，默认 critically damped（bounce 0 / duration 0.4），支持打断、速度传递；`prefers-reduced-motion` 时退化为 150ms 淡入。
- `SpringTransition.vue`：取代 `<Transition>`，用于弹窗 / 遮罩 / 浮层进场（scale 0.96→1 + opacity，spring），可打断。
- `Surface.vue`：材质面板（主题自适应毛玻璃 + 分层阴影）。
- Tooltip 统一：现有 4+ 处自定义 tooltip 收敛为 `--tooltip` 材质样式。
- 按钮 / 输入统一类：`btn-primary / btn-ghost / input / select / switch` 放 `styles/base.css`。
- 新增依赖：`src/renderer` 安装 `motion`。**若离线安装失败，回退为内置 rAF 弹簧（约 30 行），接口不变。**

### 6. 布局与核心组件

- **三段式骨架**：结构、折叠行为、macOS 红绿灯避让、Windows 自绘控制全保留。去掉三栏 `gap:1px` 拼缝，改各栏独立 hairline 边框。顶部操作行保持纯色面板 + hairline（不用 backdrop-filter，header 下方无内容滚动经过）。
- **GlobalTabs**：删除 `tab-bridge` SVG、大弧角、`active::before` 顶部色条。tab 高 32px、圆角 8px；hover 浅灰；active = 蓝色柔和底 + accent 文字 + 顶部 2px accent 指示条；容器底部 hairline。AgentBadge 与 `awaiting_permission` 提示保留。
- **SessionItem**：删除 active 左竖条，改整条圆角高亮块（radius 8px，`--accent-soft-bg`），选中标题转 accent。右键菜单 / Bot 选择器改 `Surface` + spring。
- **终端区**：终端本体、配色、loading 逻辑、右键复制菜单功能不动；只重写 loading 文案样式与终端右键菜单浮层。PermissionToast 改 spring 材质浮层。
- **TraceSidebar**：行选中态改圆角高亮；请求数 / 金额 / 刷新字号上调；数字保留 `--font-mono` + tabular-nums。
- **HomeView 顶部**：按钮统一「透明 → hover 浅灰胶囊」；云状态胶囊、账户区、win-controls 结构保留、token 化。

### 7. 视图重做

- **登录页**：居中 `Surface` 材质卡片（大圆角 + 分层阴影 + 毛玻璃），柔和渐变背景；输入框 hairline + focus accent ring；主按钮 press 微缩放；云服务区块展开用 spring。
- **首页 WelcomeTab**：品牌渐变 Logo 保留；tagline / badges 字号上调；QuickLaunch 与历史会话卡片 token 化；卡片用 `Surface` 材质。
- **设置页**：左导航 + 右内容沿用现有结构，Apple 系统设置观感；seg / Switch / 按钮统一 token 化；新增「主题」分段控件即时生效。
- **弹窗浮层**：NewSessionDialog / CloseSessionDialog / TraceOverlay 用 spring（scale 0.96→1 + opacity）+ 材质浮层；backdrop / Esc 关闭逻辑不动。

### 8. 动效规范（防过度设计）

| 场景 | 手法 |
|---|---|
| 弹窗 / 浮层 / 菜单 / 指示条 | 弹簧（bounce 0–0.15, duration 0.3–0.4） |
| hover / press / 颜色 / 边框 | CSS 过渡 150–200ms；`:active` 全局 scale 0.97 |
| 侧栏折叠展开 | 保留 0.2s ease（结构动画，避免布局抖动） |
| 无障碍 | 全部尊重 `prefers-reduced-motion`（reset.css + `useSpring` 双兜底） |

### 9. 迁移顺序与验收

- **顺序**：
  1. `motion` 依赖 + theme.css 双主题 token + `main.ts` 三态启动。
  2. base.css / UI Kit 原语（useSpring、SpringTransition、Surface、tooltip、按钮 / 输入类）。
  3. 组件逐层消费 token + 换样式（SessionItem、GlobalTabs、TraceSidebar、HomeView 顶部、终端区）。
  4. 视图重做（Login、Welcome、Settings、弹窗浮层）。
  5. tooltip / 按钮 / 输入收尾统一。
- **验收门**：`npm run test:main`、`cd src/renderer && npx vue-tsc --noEmit`、前端 vitest（AgentBadge / XtermTerminal / sessions）全绿；`npm run dev` 手动过登录 / 首页 / 会话 / 权限审批 / Trace。
- **边界**：不改任何 IPC / store / 组件模板结构（除非必要）；纯样式 + 少量封装层。
- **提交**：按 task 一个 commit；不改版本号（除非用户要求发布）。

## 设计决策记录

- 毛玻璃仅限浮层：header 与侧栏下方无内容滚动经过，backdrop-filter 无意义且耗性能。
- 强调色收敛：交互元素统一 `--accent` 蓝色，避免红蓝渐变在交互处反复出现造成视觉噪音。
- 侧栏折叠不上弹簧：宽度动画触发整列 reflow，弹簧会造成布局抖动，保留 ease。
- `motion` 库回退方案：离线时用内置 rAF 弹簧，接口不变，避免阻断实施。
