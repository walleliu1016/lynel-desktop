# Buddy 电子宠物设计

日期：2026-08-13

## 背景

Lynel Desktop 需要一个类似 Claude Code `/buddy` 的 ASCII 电子宠物陪伴功能。与终端版不同，lynel-desktop 是 Electron + Vue3 桌面应用，渲染介质是 DOM/CSS 而非终端，因此不采用 Ink 渲染，而是保留 ASCII 审美 + 叠加 DOM/CSS 的伪 3D 能力。

需求确认：常驻陪伴 + 特定时刻专属表现（启动等待、等待审批、会话完成等）；预设角色库可选 + 支持自定义粘贴 ASCII art；四类行为（表情状态联动 / 时间性动画 / 可交互 / 吐槽气泡）；保留稀有度 + 5 项属性系统（DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK），属性反哺行为。

## 方案

纯渲染进程实现，不触碰主进程逻辑。三个独立单元，职责单一、可独立测试：角色数据层、属性引擎、展示组件。单向数据流：`stores → useBuddyStats 派生 stats → BuddyPet 渲染`。

## 设计细节

### 1. 角色数据层（`src/renderer/src/data/buddies/`）

- `types.ts`：`BuddyRole` / `BuddyStats` / `BuddyFrameKey` 类型定义。
  - `BuddyStats`：5 项属性各为 `number`（0-100）。
  - `BuddyFrameKey`：`'idle' | 'thinking' | 'celebration' | 'alarm'`。
- `presets.ts`：内置角色库（TS 对象数组），每角色含：
  - `id`、`name`：唯一标识与展示名。
  - `rarity`：稀有度标签（角色固有属性，非随机）。
  - `personality`：性格倾向，驱动动画参数与吐槽风格（如 `chill` / `chaotic` / `nerd`）。
  - `frames`：多帧 ASCII，键为 `BuddyFrameKey`，值为字符串数组（多行字符画）。
  - `baseline`：5 项属性基线，默认全 50。
- 自定义角色由用户粘贴 ASCII，存 electron-store，运行时与 presets 合并（自定义角色走默认 `personality` 与 `baseline`）。

### 2. 属性引擎（`composables/useBuddyStats.ts`）

监听现有 stores（`sessions` 的 `state`/`activity`、`trace` 的请求数/token/错误/工具调用），把事件映射为属性增量：

| 属性 | 增量信号 |
|---|---|
| DEBUGGING | trace 出现 error / 工具失败 |
| CHAOS | 会话中断（state 快速跳动 / Ctrl+C）、报错频发 |
| PATIENCE | 处于 awaiting_permission 或长时间运行 |
| WISDOM | 请求数、token 用量、会话时长增长 |
| SNARK | 完成事件时微调，随会话推进小幅上浮 |

- **缓慢渐变**：单事件增量封顶（+0.5）；一段时间无事件则随时间衰减缓慢回落向基线，避免瞬间拉满。
- **会话独立**：挂载时从角色 baseline 起步，会话结束（done/ended）归零回 baseline，供下次会话重来。
- store 为空/未就绪时静默返回 baseline，不报错；状态事件缺失某信号时跳过该增量。

### 3. 展示组件（`components/buddy/BuddyPet.vue`）

纯展示 + 交互，props 接收 `role` / `stats` / `state`，不直接读 store，便于独立测试。

- **ASCII 渲染**：`<pre>` + 等宽字体，`fontSize` 用 CSS 变量控制；尺寸由角色帧的最大行宽/行高决定，内容居中。帧切换 = 换 `<pre>` 内容 + 淡入过渡。
- **伪 3D 动画**（全部 motion 库 JS 驱动，规避 `prefers-reduced-motion` 冻结）：
  - 呼吸/浮动：`animate()` 对容器做 y 轴正弦浮动 + 微 scale，无限循环。
  - 立体感：轻微 `rotateX/rotateY`（随指针 hover 倾斜，position 映射）+ 投影营造景深。
  - 状态切换：帧内容切换 + 缩放/旋转弹跳（如 celebration 帧 + 弹出动画）。
  - 动画参数受 `personality` 影响：CHAOS 高浮动幅度大节奏快，PATIENCE 高平稳。
- **时间性行为**：空闲时 idle/blink 帧低频交替 + 呼吸浮动，无会话事件也在动。
- **交互**：hover 触发反应动画（缩一缩/歪头）；点击弹出气泡（吐槽/亲昵文案），气泡为宠物上方绝对定位 div，几秒后消失，可排队多条。
- **降级**：自定义角色只有单帧时动画退化为通用浮动 + 立体感，不做表情帧切换；渲染异常经 `onErrorCaptured` 捕获，异常时整块 fallback 为不渲染（纯装饰，可降级）。

### 4. 吐槽系统（内容来源暂缓，先搭结构）

- 段子库按主题分组：`idle`（无聊吐槽）/ `working`（工作吐槽）/ `awaiting`（等待毒舌）/ `done`（鼓励/自夸）/ `interact`（被抚摸回应）。
- 选句加权：按角色属性决定——SNARK 高更爱选毒舌组、DEBUGGING 高选"代码专业"相关吐槽、CHAOS 高段子更疯。
- 段子库 + 加权器都是独立函数，方便后续替换为"模板 + 变量填充"或"AI 生成"。

### 5. 配置持久化

- 扩 `Settings` 接口：`buddyRoleId`（string）、`buddyCustomAscii`（string | undefined）、`buddyEnabled`（boolean）。
- 经现有 GetSettings/UpdateSettings IPC 链路读写 electron-store，与外观页同级。
- 自定义 ASCII 校验：非空、限行数/宽度、行宽不齐时给出明确错误提示；不做内容语义校验。

### 6. 可挂载位置

通用组件先在 3 个位置使用：欢迎页角落（常驻）、会话加载遮罩（等待特效）、等待审批时状态区（专属表现）。

## 改动范围

- 新增 `src/renderer/src/data/buddies/`（types.ts、presets.ts、吐槽段子库）。
- 新增 `src/renderer/src/composables/useBuddyStats.ts`。
- 新增 `src/renderer/src/components/buddy/BuddyPet.vue`。
- 扩 `src/renderer/src/types/settings.ts` 与默认设置。
- 在欢迎页 / 会话加载遮罩 / 等待审批状态区挂载 `BuddyPet`。
- 纯前端改动，主进程无改动。

## 测试

- `useBuddyStats`：纯函数级单测——给定事件序列 → 断言属性增量/阻尼/回落/归零（不依赖 Vue/Electron）。
- 吐槽加权器：给定属性组合 → 断言选句分组分布。
- 自定义 ASCII 校验器：非法输入 → 错误；合法 → 通过。
- BuddyPet 挂载渲染快照（可选，优先保纯逻辑测试）。
- 前端 `npx vue-tsc --noEmit` 类型检查；现有 `npm run test:main` 不受影响（纯前端改动）。
