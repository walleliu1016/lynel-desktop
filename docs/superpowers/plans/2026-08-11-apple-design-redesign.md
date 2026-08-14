# Apple Design UI 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Apple 设计语言（双主题 token + 弹簧动效 + 材质层次）全量重构 Lynel Desktop 前端 UI，不改任何 IPC / store 业务逻辑。

**Architecture:** 三层落地：① theme.css 双主题语义 token（light/dark）+ base.css 基础类 → ② UI Kit 原语（useTheme / useSpring / SpringTransition / Surface）→ ③ 组件与视图逐层消费 token 换样式。`data-theme` 与 `data-term-theme` 保持解耦，终端 8 套配色不动。

**Tech Stack:** Vue 3.5 `<script setup lang="ts">`、Pinia、Vite 8、TypeScript 6、`@lucide/vue`、xterm 6.1、`motion`（弹簧动效，离线时回退内置 rAF 弹簧）。

## Global Constraints

- 所有 UI 文案 / 注释 / commit message 用简体中文。
- 不改：IPC handler、store 业务逻辑（除 `stores/settings.ts` 主题迁移一行）、组件 `<template>` 结构（除 GlobalTabs 删 bridge SVG）、preload、终端配色块（`[data-term-theme=...]`）。
- 组件内禁止新增硬编码颜色；一律消费 theme.css token。既有硬编码按各 task 映射表迁移。
- 保留：`-webkit-app-region: drag` 拖拽区、macOS 红绿灯避让（`padding-left: 78/92px`）、Windows 自绘窗口控制（`padding-right: 96px`）、侧栏折叠行为。
- 动效尊重 `prefers-reduced-motion`（reset.css 全局兜底 + `useSpring` 内再兜一次）。
- 每 task 验收：`cd src/renderer && npx vue-tsc --noEmit` 全绿；`cd src/renderer && npx vitest run` 全绿；必要时 `npm run dev` 人工目验。
- 每个 task 单独 commit；不提交 `vscode-extension/*.vsix`、`dist/`、`dist-electron/`。
- 动效节奏：浮层/弹窗/指示条用弹簧（bounce 0–0.15 / duration 0.3–0.4）；hover/press/颜色用 CSS 过渡 150–200ms；全局 `:active { transform: scale(0.97) }`；侧栏折叠保留 0.2s ease。
- 交互元素一律 `--accent`；红蓝渐变只出现在品牌处（`--brand-grad`）。

---

## 设计令牌速查（各 task 自含，不再重复定义）

浅色（`[data-theme="light"]`，`:root` 默认）：

| 令牌 | 值 | 令牌 | 值 |
|---|---|---|---|
| `--bg-primary` | `#F5F5F7` | `--text-primary` | `#1D1D1F` |
| `--bg-panel` | `#FFFFFF` | `--text-secondary` | `#6E6E73` |
| `--bg-input` | `#FFFFFF` | `--text-tertiary` | `#86868B` |
| `--bg-hover` | `#F0F0F2` | `--text-inverse` | `#FFFFFF` |
| `--accent` | `#0071E3` | `--status-success` | `#34C759` |
| `--accent-deep` | `#0060DF` | `--status-warn` | `#FF9F0A` |
| `--accent-light` | `#5E9CFF` | `--status-error` | `#FF3B30` |
| `--accent-soft-bg` | `rgba(0,113,227,0.10)` | `--border` | `rgba(0,0,0,0.08)` |
| `--accent-soft-border` | `rgba(0,113,227,0.30)` | `--border-strong` | `rgba(0,0,0,0.12)` |
| `--accent-glow` | `rgba(0,113,227,0.20)` | `--status-*-soft` | `rgba(色,0.12)` |

深色（`[data-theme="dark"]`）：

| 令牌 | 值 | 令牌 | 值 |
|---|---|---|---|
| `--bg-primary` | `#1C1C1E` | `--text-primary` | `#F5F5F7` |
| `--bg-panel` | `#2C2C2E` | `--text-secondary` | `#98989D` |
| `--bg-input` | `#2C2C2E` | `--text-tertiary` | `#6E6E73` |
| `--bg-hover` | `#3A3A3C` | `--accent` | `#0A84FF` |
| `--accent-deep` | `#0071E3` | `--accent-light` | `#5E9CFF` |
| `--accent-soft-bg` | `rgba(10,132,255,0.16)` | `--border` | `rgba(255,255,255,0.12)` |
| `--status-success` | `#30D158` | `--status-warn` | `#FFD60A` |
| `--status-error` | `#FF453A` | `--border-strong` | `rgba(255,255,255,0.20)` |

通用新增：

- `--brand-grad: linear-gradient(135deg, #EF4444 0%, #3B82F6 100%)`（原值不变）。
- 字号：`--fs-caption:12px / --fs-body-sm:13px / --fs-body:14px / --fs-title:18px / --fs-hero:30px`。
- 圆角：`--radius-sm:8px / --radius-md:10px / --radius-lg:14px / --radius-pill:999px`。
- 阴影（浅色）：`--shadow-window: 0 24px 48px -12px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.06)`；`--shadow-panel: 0 0 0 1px var(--border), 0 2px 6px rgba(0,0,0,0.05)`；`--shadow-accent: 0 4px 14px var(--accent-glow)`。
- 材质：`--material-bg`（浅 `rgba(255,255,255,0.72)` / 深 `rgba(30,30,32,0.72)`）；`.material { background: var(--material-bg); backdrop-filter: blur(20px) saturate(180%); }`。
- 遮罩：`--scrim`（浅 `rgba(0,0,0,0.40)` / 深 `rgba(0,0,0,0.55)`），供弹窗/TraceOverlay 遮罩。
- 工具提示：`--tooltip-bg`（浅 `rgba(30,41,59,0.92)` / 深 `rgba(40,40,42,0.92)`）、`--tooltip-color: #FFF`。**不定义全局 `.tooltip` 类**（避免与 HomeView 等 scoped `.tooltip` 特异性冲突），各组件 tooltip 消费这两个 token。

---

### Task 1: 双主题令牌体系（theme.css + base.css）

**Files:**
- Modify: `src/renderer/src/styles/theme.css`
- Create: `src/renderer/src/styles/base.css`
- Modify: `src/renderer/src/main.ts`（加 `import './styles/base.css'`）

**Interfaces:**
- Produces: 全部设计令牌（上表）+ `.material` / `.tooltip` / `.btn-*` / `.input` / `.select` / `.seg` 基础类，供后续所有 task 消费。

- [ ] **Step 1: 重写浅色块为 Apple 调色板**

`theme.css` 中 `:root, [data-theme="light"] { ... }` 块按令牌速查表替换。保留结构注释与「对话历史渲染专用变量」「agent 类型标识配色」两组（其中对话渲染变量当前无消费者，属死 token，保留不动即可）。`--bg-titlebar: linear-gradient(180deg, #FFFFFF 0%, #F5F5F7 100%)`。`--brand-grad` 与 `--fs-*` 放浅色块内（`:root` 默认生效）。

- [ ] **Step 2: 新增深色块**

在浅色块后新增 `[data-theme="dark"] { ... }`，覆盖速查表深色列所有令牌。要点：
- `--bg-titlebar: linear-gradient(180deg, #2C2C2E 0%, #1C1C1E 100%)`。
- `--bg-terminal: #202024`；`--bg-terminal-header: #2C2C2E`；`--bg-terminal-loading: #1C1C1E`。
- `--scrollbar-thumb: #4A4A4C`；`--scrollbar-thumb-hover: #5A5A5C`。
- `--shadow-window: 0 24px 48px -12px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)`；`--shadow-panel`、`--shadow-card`、`--shadow-accent` 相应加深。
- `--session-item-hover-bg: #3A3A3C`；`--session-item-active-bg: #1E2A3A`（深蓝 tint）。
- `--switch-track: #4A4A4C`；`--switch-knob: #FFFFFF`。
- `--material-bg: rgba(30,30,32,0.72)`。
- `--tooltip-bg: rgba(40,40,42,0.92)`（供 base.css tooltip 用）。

- [ ] **Step 3: 新增 base.css**

`src/renderer/src/styles/base.css`（在 reset.css 之后、theme.css 之前 import 顺序不影响，因只依赖变量）：

```css
/* 材质浮层：仅用于真正浮在内容之上的元素 */
.material {
  background: var(--material-bg, rgba(255,255,255,0.72));
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}
/* 工具提示不定义全局类（避免与各组件 scoped .tooltip 冲突）；
   统一由 --tooltip-bg / --tooltip-color token 驱动，Task 13 逐个消费。 */
/* 基础按钮：主/幽灵/危险 */
.btn-primary {
  background: var(--accent); color: var(--text-inverse);
  border: none; border-radius: var(--radius-md);
  padding: 7px 14px; font-size: var(--fs-body-sm); font-weight: 500;
  transition: filter .15s, box-shadow .15s;
}
.btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
.btn-primary:active:not(:disabled) { transform: scale(0.97); }
.btn-primary:disabled { opacity: .4; }
.btn-ghost {
  background: var(--bg-input); color: var(--text-primary);
  border: 1px solid var(--border-strong); border-radius: var(--radius-md);
  padding: 6px 14px; font-size: var(--fs-body-sm);
  transition: border-color .15s, color .15s;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-danger { color: var(--status-error); }
/* 基础输入 / 下拉 */
.input {
  background: var(--bg-input); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: var(--fs-body-sm);
  font-family: inherit; outline: none; transition: border-color .15s, box-shadow .15s;
}
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-bg); }
/* 分段控件 */
.seg-group { display: inline-flex; gap: 2px; background: var(--bg-hover); border-radius: var(--radius-md); padding: 2px; }
.seg {
  padding: 4px 12px; border-radius: 8px; font-size: var(--fs-body-sm);
  color: var(--text-secondary); background: transparent; border: none;
  transition: background .15s, color .15s;
}
.seg.active { background: var(--bg-panel); color: var(--text-primary); box-shadow: var(--shadow-card); }
```

- [ ] **Step 4: 引入 base.css**

`src/renderer/src/main.ts` 在 `import './styles/reset.css'` 与 `import './styles/theme.css'` 之间加 `import './styles/base.css'`。

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`（无类型错误）。再在 DevTools 手动把 `<html data-theme>` 改为 `dark` 目验两套主题均有正确底色与文字对比度。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles/theme.css src/renderer/src/styles/base.css src/renderer/src/main.ts
git commit -m "style: 双主题令牌体系——Apple 调色板 + 深色块 + base.css 基础类"
```

---

### Task 2: 主题三态启动 + 设置持久化

**Files:**
- Create: `src/renderer/src/composables/useTheme.ts`
- Modify: `src/renderer/src/main.ts`
- Modify: `src/renderer/src/types/settings.ts`
- Modify: `src/renderer/src/stores/settings.ts`
- Modify: `src/renderer/src/components/settings/AppearanceTab.vue`

**Interfaces:**
- Produces: `useTheme.ts` 导出 `type ThemeMode = 'light'|'dark'|'system'`、`themeMode: Ref<ThemeMode>`、`initTheme(): void`、`getThemeMode(): ThemeMode`、`setThemeMode(mode: ThemeMode): void`。供 main.ts 与 AppearanceTab 消费。

- [ ] **Step 1: 新建 useTheme.ts**

```ts
import { ref, type Ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'lynel-desktop-theme'
export const themeMode = ref<ThemeMode>('system') as Ref<ThemeMode>
let media: MediaQueryList | null = null
let onMedia: ((e: MediaQueryListEvent) => void) | null = null

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}
function apply() {
  document.documentElement.setAttribute('data-theme', resolve(themeMode.value))
}
function bindListener() {
  unbindListener()
  if (themeMode.value !== 'system' || typeof window === 'undefined') return
  media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null
  if (!media) return
  onMedia = () => apply()
  media.addEventListener('change', onMedia)
}
function unbindListener() {
  if (media && onMedia) media.removeEventListener('change', onMedia)
  media = null
  onMedia = null
}
export function initTheme(): void {
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch {}
  themeMode.value = (saved === 'light' || saved === 'dark' || saved === 'system') ? saved : 'system'
  apply()
  bindListener()
}
export function getThemeMode(): ThemeMode { return themeMode.value }
export function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
  try { localStorage.setItem(KEY, mode) } catch {}
  apply()
  bindListener()
}
```

- [ ] **Step 2: main.ts 接入**

`src/renderer/src/main.ts` 删除原 localStorage 读取块（`let saved = ...` 到 `setAttribute`），改为：

```ts
import { initTheme } from './composables/useTheme'
// 主题在 app 挂载前同步应用，避免闪烁；useTheme 内部解析 system 并监听变化
initTheme()
```

- [ ] **Step 3: 扩展 Settings 类型**

`src/renderer/src/types/settings.ts:1`：`export type Theme = 'light' | 'dark' | 'system'`。

- [ ] **Step 4: 迁移 stores/settings.ts 强制逻辑**

`src/renderer/src/stores/settings.ts:33-36` 原「非 light 强制迁移 light」改为允许三值、未知回退 system：

```ts
if (raw && raw.theme !== 'light' && raw.theme !== 'dark' && raw.theme !== 'system') {
  raw.theme = 'system'
}
```

`defaultSettings()` 内 `theme: 'light'` 改为 `theme: 'system'`。`load()` 合并后追加：`if (cfg.theme) setThemeMode(cfg.theme as ThemeMode)`，并 `import { setThemeMode, type ThemeMode } from '../composables/useTheme'`。

- [ ] **Step 5: AppearanceTab 新增主题分段控件 + 修复终端配色选中 bug**

`src/renderer/src/components/settings/AppearanceTab.vue`：
- 修复第 19 行 `:class="{ active: cfg.theme === opt.id }"` → `cfg.terminal.theme === opt.id`（现有 bug）。
- 「字体」section 之前插入「主题」section：

```vue
<section class="section">
  <div class="section-title">主题</div>
  <div class="seg-group">
    <button v-for="o in themeOptions" :key="o.value" class="seg" :class="{ active: themeMode === o.value }" @click="onThemeChange(o.value)">
      {{ o.label }}
    </button>
  </div>
  <p class="form-hint">「跟随系统」将随操作系统深浅色自动切换；仅影响 UI 界面，终端配色独立。</p>
</section>
```

script 内：

```ts
import { getThemeMode, setThemeMode, type ThemeMode } from '../../composables/useTheme'
const themeOptions = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const
const themeMode = ref<ThemeMode>(getThemeMode())
function onThemeChange(m: ThemeMode) {
  themeMode.value = m
  setThemeMode(m)
  if (settings.cfg) { settings.cfg.theme = m; settings.markDirty() }
}
```

- [ ] **Step 6: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`cd src/renderer && npx vitest run`。`npm run dev` 后：切「深色」立即变暗、刷新后保持、切「跟随系统」后改系统深浅色实时联动、设置保存后重启仍在。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/composables/useTheme.ts src/renderer/src/main.ts src/renderer/src/types/settings.ts src/renderer/src/stores/settings.ts src/renderer/src/components/settings/AppearanceTab.vue
git commit -m "feat: 主题三态（浅色/深色/跟随系统）——useTheme 启动 + 设置持久化 + 外观控制"
```

---

### Task 3: 弹簧动效原语（motion 依赖 + useSpring + SpringTransition + Surface）

**Files:**
- Modify: `src/renderer/package.json`（新增依赖）
- Create: `src/renderer/src/composables/useSpring.ts`
- Create: `src/renderer/src/components/SpringTransition.vue`
- Create: `src/renderer/src/components/Surface.vue`

**Interfaces:**
- Produces: `useSpring()` 返回 `{ animateTo(el, target, opts) }`（`opts: { bounce?, duration?, onComplete? }`）；`SpringTransition.vue`（props 透传 `Transition` 的 name/tag 等，含默认 enter/leave spring）；`Surface.vue`（props `{ level?: 1|2|3; material?: boolean; rounded?: boolean }`）。

- [ ] **Step 1: 安装 motion**

Run: `cd src/renderer && pnpm add motion`（若 pnpm 不可用：`npm install motion`）。
若离线安装失败：跳过依赖，改用内置 rAF 弹簧——`useSpring.ts` 用下述回退实现（接口一致，后续 task 不受影响）：

```ts
// 离线回退：opacity 三次缓动补间 + transform 终值直设（不做插值），rAF 驱动，支持 interrupt
function springFallback(
  el: HTMLElement,
  target: { opacity?: number; transform?: string },
  opts: { duration?: number; onComplete?: () => void } = {},
) {
  const fromOpacity = parseFloat(el.style.opacity) || 0
  const toOpacity = typeof target.opacity === 'number' ? target.opacity : 1
  const dur = (opts.duration ?? 0.4) * 1000
  const t0 = performance.now()
  let raf = 0
  const step = (now: number) => {
    const t = Math.min((now - t0) / dur, 1)
    const e = 1 - Math.pow(1 - t, 3)
    el.style.opacity = String(fromOpacity + (toOpacity - fromOpacity) * e)
    if (typeof target.transform === 'string') el.style.transform = target.transform
    if (t < 1) raf = requestAnimationFrame(step)
    else opts.onComplete?.()
  }
  raf = requestAnimationFrame(step)
  return { stop: () => cancelAnimationFrame(raf) }
}
```

- [ ] **Step 2: 新建 useSpring.ts**

```ts
import { animate } from 'motion'

export interface SpringTarget { [k: string]: number | string }
export interface SpringOpts { bounce?: number; duration?: number; onComplete?: () => void }

export function useSpring() {
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  return {
    animateTo(el: HTMLElement | null | undefined, target: SpringTarget, opts: SpringOpts = {}) {
      if (!el) return null
      if (reduce) {
        for (const k of Object.keys(target)) { (el.style as any)[k] = String(target[k]) }
        opts.onComplete?.()
        return null
      }
      return animate(el, target as any, {
        type: 'spring',
        bounce: opts.bounce ?? 0,
        duration: opts.duration ?? 0.4,
        onComplete: opts.onComplete,
      })
    },
  }
}
```

（若 Task 3 Step 1 走了离线回退，则本文件改用 `springFallback` 实现，返回 `{ stop }`，不 import motion。）

- [ ] **Step 3: 新建 SpringTransition.vue**

```vue
<template>
  <Transition :css="false" @enter="onEnter" @leave="onLeave">
    <slot />
  </Transition>
</template>

<script setup lang="ts">
import { useSpring } from '../composables/useSpring'
const { animateTo } = useSpring()
function onEnter(el: Element, done: () => void) {
  const e = el as HTMLElement
  e.style.opacity = '0'
  e.style.transform = 'scale(0.96)'
  animateTo(e, { opacity: 1, transform: 'scale(1)' }, { onComplete: done })
}
function onLeave(el: Element, done: () => void) {
  const e = el as HTMLElement
  animateTo(e, { opacity: 0, transform: 'scale(0.96)' }, { duration: 0.25, onComplete: done })
}
</script>
```

- [ ] **Step 4: 新建 Surface.vue**

```vue
<template>
  <div class="surface" :class="[`lv${level}`, { material, rounded }]">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ level?: 1 | 2 | 3; material?: boolean; rounded?: boolean }>(), {
  level: 1, material: false, rounded: true,
})
</script>

<style scoped>
.surface { background: var(--bg-panel); border: 1px solid var(--border); }
.surface.lv2 { background: var(--bg-input); box-shadow: var(--shadow-panel); }
.surface.lv3 { box-shadow: var(--shadow-window); }
.surface.rounded { border-radius: var(--radius-lg); }
</style>
```

（`.material` 由 base.css 的 `.material` 类补充 backdrop-filter。）

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。在 `WelcomeTab` 临时包一层 `<SpringTransition>` 目验缩放+淡入手感（验收后移除，Task 10 正式接入）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/package.json src/renderer/package-lock.json src/renderer/pnpm-lock.yaml src/renderer/src/composables/useSpring.ts src/renderer/src/components/SpringTransition.vue src/renderer/src/components/Surface.vue
git commit -m "feat: 弹簧动效原语——useSpring + SpringTransition + Surface 材质面板"
```

---

### Task 4: GlobalTabs 胶囊化（去 Chrome 裙边）

**Files:**
- Modify: `src/renderer/src/components/GlobalTabs.vue`

**Interfaces:**
- Consumes: `--accent-soft-bg`、`--border-strong`、`--radius-sm`、`--status-error-soft`。
- Produces: 无（纯样式）。

- [ ] **Step 1: 删除 bridge SVG**

`GlobalTabs.vue` `<template>` 中删除 `tab.id === activeId` 时的两处 `.tab-bridge` span 块（`<span class="tab-bridge left">…svg…</span>` 与 right）。

- [ ] **Step 2: 替换 .tab 样式**

scoped `<style>` 中 `.tab`、`.tab.active`、`.tab.active::before`、`.tab-bridge` 相关规则整体替换：

```css
.tab {
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  max-width: 180px; min-width: 72px;
  cursor: pointer; -webkit-app-region: no-drag;
  border: none; background: transparent;
  border-radius: var(--radius-sm);
  font-size: var(--fs-body-sm); color: var(--text-secondary);
  position: relative; margin: 2px 2px 4px;
  transition: background .15s, color .15s;
}
.tab:hover { background: var(--bg-hover); color: var(--text-primary); }
.tab.active { background: var(--accent-soft-bg); color: var(--accent); }
.tab.active::before {
  content: ''; position: absolute; top: -2px; left: 8px; right: 8px; height: 2px;
  background: var(--accent); border-radius: 2px;
}
.tab.active.awaiting::before { background: var(--status-error); }
```

删除原 `.tab-bridge` 全部规则。`.tab.active .tab-icon` 改 `color: var(--accent)`（保留）。

- [ ] **Step 3: 容器与 .tab-new 微调**

`.global-tabs` 改 `height: 32px; min-height: 32px; align-items: center; padding: 0 6px; border-bottom: 1px solid var(--border-strong);`。`.tab-new` 保持 28px 圆形 hover 胶囊即可（`border-radius: var(--radius-sm)`）。

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 目验：无裙边、active 为蓝底胶囊+顶部指示条、awaiting 时指示条变红。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GlobalTabs.vue
git commit -m "style: GlobalTabs 胶囊化——去 Chrome 弧角裙边，蓝色选中胶囊+顶部指示条"
```

---

### Task 5: SessionList / SessionItem 选中态 + 右键菜单材质

**Files:**
- Modify: `src/renderer/src/components/SessionItem.vue`
- Modify: `src/renderer/src/components/SessionList.vue`

**Interfaces:**
- Consumes: `--accent-soft-bg`、`--session-item-hover-bg/active-bg`、`--radius-sm`、`--material-bg`、`--fs-*`、`--status-*-soft`。
- Produces: 无。

- [ ] **Step 1: SessionItem 选中改圆角块**

`SessionItem.vue` scoped CSS：
- 删除 `.session-item.active::before` 左竖条规则。
- `.session-item` 改 `padding: 10px; border-radius: var(--radius-sm); gap: 10px;`，保留 hover。
- `.session-item.active { background: var(--session-item-active-bg); }`，并新增 `.session-item.active .title { color: var(--accent); }`。
- `.title` 字号改 `var(--fs-body)`；`.time` 改 `var(--fs-caption)`；`.meta` 改 `var(--fs-body-sm)`；`.event` 改 `var(--fs-body-sm)`。
- 硬编码迁移：`.bot-tag` 的 `rgba(59,130,246,0.12)`→`var(--accent-soft-bg)`、`#60a5fa`→`var(--accent-light)`；`.bound-hint` 的 `#047857`→`var(--status-success)`；`.bot-picker .menu-item:hover` 的 `rgba(128,128,128,0.2)`→`var(--bg-hover)`。

- [ ] **Step 2: 右键菜单 / Bot picker 改材质**

`.context-menu` 加类 `material`（或在 scoped CSS 补 `backdrop-filter`），并保持 `box-shadow: var(--shadow-window)`。`.menu-item:hover` 的 `var(--session-item-hover-bg)` 改 `var(--bg-hover)`。`.picker-title` 字号改 `var(--fs-body-sm)`。

- [ ] **Step 3: SessionList 分组标题与骨架**

`SessionList.vue`：`.sidehead-toggle` 改 `font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .5px;`（Apple 分组标题风）；`.empty` 改 `var(--fs-body-sm)`。

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`（AgentBadge.test.ts 需仍绿）。`npm run dev` 目验：选中整条圆角高亮、右键菜单毛玻璃、Bot 选择器材质。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SessionItem.vue src/renderer/src/components/SessionList.vue
git commit -m "style: 会话列表选中改圆角高亮块，右键菜单/Bot 选择器材质化"
```

---

### Task 6: HomeView 顶部 + 三栏 hairline 边框

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

**Interfaces:**
- Consumes: `--border`、`--bg-hover`、`--radius-sm`、`--fs-*`、`--status-*-soft`、`--brand-grad`、`--accent-soft-*`。
- Produces: 无。

- [ ] **Step 1: 品牌字用 --brand-grad**

`.brand-title`、`.brand-inline` 的 `background: linear-gradient(135deg, #ef4444, #3b82f6)` 两处替换为 `background: var(--brand-grad)`；其余（`-webkit-background-clip` 等）保留。

- [ ] **Step 2: 顶部按钮统一胶囊**

`.top-btn` 改 `height: 26px; min-width: 26px; border-radius: 7px;`，hover 底改 `var(--bg-hover)`（原 `var(--bg-input)`）。`.home-entry` 的边框由 `var(--border)` 改 `var(--border-strong)`，hover 时边框 `var(--accent)` 保留，字号改 `var(--fs-body-sm)`。

- [ ] **Step 3: 三栏拼缝改 hairline**

`.layout { gap: 1px; background: var(--border); }` 改为 `gap: 0; background: transparent;`。为 `.left`、`.center`、TraceSidebar 补独立边框：`.left { border-right: 1px solid var(--border); }`；`.center { border-right: 1px solid var(--border); }`（TraceSidebar 自带 `border-left` 保留）。`.left-top`、`.center-top` 高度保持 40px，字号统一 `--fs-body-sm`。

- [ ] **Step 4: 云状态 / 账户 / 窗口控制 token 化**

`.cloud-status` 各态硬编码色（`#a7f3d0`、`#047857`、`#fecaca`、`#b91c1c`、`#fde68a`、`#b45309`、`#ef4444`、`#f59e0b`）迁移到 `--status-success-soft`/`--status-error`/`--status-warn` 等 token。`.avatar` 保持 `--accent` 底 + 白字；字号改 `var(--fs-caption)`。`.win-btn` hover 的 `rgba(0,0,0,0.06)` 改 `var(--bg-hover)`。

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 目验：三栏分隔为细线、拖拽区可拖、Windows 窗口控制按钮正常、macOS 红绿灯避让正常。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "style: HomeView 顶部统一胶囊按钮 + 三栏 hairline 边框 + 品牌渐变 token 化"
```

---

### Task 7: 终端区（loading + 右键菜单 + PermissionToast）

**Files:**
- Modify: `src/renderer/src/components/SessionTabContent.vue`
- Modify: `src/renderer/src/components/XtermTerminal.vue`
- Modify: `src/renderer/src/components/PermissionToast.vue`

**Interfaces:**
- Consumes: `--fs-*`、`--accent-*`、`--material-bg`、`--status-*`、`--radius-*`。
- Produces: 无。

- [ ] **Step 1: SessionTabContent loading 文案**

`.loading-text` 字号改 `var(--fs-body-sm)`；`.spinner-static` 的 `border: 3px solid var(--border)` 改 `var(--border-strong)`、`border-top-color: var(--accent)` 保留。

- [ ] **Step 2: XtermTerminal 右键菜单材质**

`.term-ctx-menu` 加 `material` 类 + `box-shadow: var(--shadow-window)`；`.menu-item` hover 底改 `var(--bg-hover)`。**不改任何 xterm 逻辑、主题同步、loading/exited 逻辑。**

- [ ] **Step 3: PermissionToast 改材质 + spring**

`PermissionToast.vue`：最外层遮罩与卡片按现有 `.overlay/.toast` 结构，遮罩硬编码色迁移为 `--status-*` 对应 soft/深色；卡片加 `material` 类 + `border-radius: var(--radius-lg)`。用 `SpringTransition` 包裹卡片入场（scale 0.96→1）。不动按钮、工具输入展示逻辑。

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`（XtermTerminal.test.ts 需仍绿）。`npm run dev` 触发一次权限请求目验 PermissionToast 材质与进场动画。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SessionTabContent.vue src/renderer/src/components/XtermTerminal.vue src/renderer/src/components/PermissionToast.vue
git commit -m "style: 终端区重样式——loading 文案、右键菜单材质、PermissionToast 弹簧浮层"
```

---

### Task 8: TraceSidebar / TraceOverlay

**Files:**
- Modify: `src/renderer/src/components/trace/TraceSidebar.vue`
- Modify: `src/renderer/src/components/trace/TraceOverlay.vue`

**Interfaces:**
- Consumes: `--accent-soft-bg`、`--radius-sm`、`--fs-*`、`--status-*`、`--material-bg`、`--shadow-window`。
- Produces: 无。

- [ ] **Step 1: TraceSidebar 行选中改圆角块**

`.thumb-row` 改 `border-left: none; border-radius: var(--radius-sm); padding: 8px 10px; margin: 0 6px 2px;`；`.thumb-row.selected` 改 `background: var(--accent-soft-bg)`（去掉 `border-left-color`）。字号：`.row-top` 改 `var(--fs-body-sm)`，`.meta/.metric` 改 `var(--fs-caption)`，`.stat-cost` 改 `var(--fs-caption)`。`.stats-bar/.trace-toolbar` 高度保持 40/32px。

- [ ] **Step 2: TraceOverlay 材质 + spring**

`TraceOverlay.vue`：`.overlay` 遮罩色迁移为 `--status-*` 对应深色（或 `rgba(0,0,0,.25)` 深/`rgba(0,0,0,.4)` 浅由 token 控制，可在 theme.css 增 `--scrim`）。请求详情面板加 `material` 类 + `border-radius: var(--radius-lg)` + `--shadow-window`，用 `SpringTransition` 包裹进场。

- [ ] **Step 3: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 点开 trace 行目验 overlay 材质与进场、列表分页加载正常。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/trace/TraceSidebar.vue src/renderer/src/components/trace/TraceOverlay.vue
git commit -m "style: Trace 侧栏选中改圆角高亮，Overlay 材质化+弹簧进场"
```

---

### Task 9: LoginView 重做

**Files:**
- Modify: `src/renderer/src/views/LoginView.vue`

**Interfaces:**
- Consumes: `--brand-grad`、`--fs-*`、`--radius-*`、`--shadow-*`、`--material-bg`、`--accent-*`。
- Produces: 无。

- [ ] **Step 1: 品牌与文案**

`.brand-row` 字号改 `var(--fs-hero)`（30px），`letter-spacing: -0.02em`；`.brand-lynel` 用 `var(--accent)`；`.login-tagline` 改 `var(--fs-body)`、`color: var(--text-secondary)`、`max-width: 280px`。

- [ ] **Step 2: 表单容器改材质卡片**

`.login-body` 的 `background: radial-gradient(ellipse at top, ...)` 改 `background: var(--bg-primary)`。表单外包一层 `.login-card`（`Surface material rounded` 思路）：`background: var(--material-bg); backdrop-filter: blur(20px) saturate(180%); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-window); padding: 24px 22px; width: 300px;`，居中显示。

- [ ] **Step 3: 输入 / 按钮**

`.form-input` 改 hairline：`border: 1px solid var(--border-strong); border-radius: var(--radius-md);`，focus 加 `box-shadow: 0 0 0 3px var(--accent-soft-bg)`。`.login-btn` 改 `background: var(--accent)`（去掉渐变），hover `brightness(1.06)`，`transform: scale(.98)` on active，字号 `var(--fs-body)`. `.form-label` 保留大写+字距。

- [ ] **Step 4: 云服务区块**

`.cloud-section` 的 `background: var(--bg-input)` 改 `var(--bg-hover)`；工具提示 `data-tooltip` 用 `--tooltip-bg`（可选，保留现实现）。

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 登出后目验登录卡片、浅深两态、窗口尺寸逻辑（`applyLoginLayout` 不受影响）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/views/LoginView.vue
git commit -m "style: 登录页 Apple 卡片化——材质卡片、hairline 输入、主按钮收敛"
```

---

### Task 10: WelcomeTab / QuickLaunch / RecentSessionList

**Files:**
- Modify: `src/renderer/src/components/WelcomeTab.vue`
- Modify: `src/renderer/src/components/QuickLaunch.vue`
- Modify: `src/renderer/src/components/RecentSessionList.vue`

**Interfaces:**
- Consumes: `--brand-grad`、`--fs-*`、`--radius-*`、`--shadow-*`、`--material-bg`、`--accent-*`、`--border`。
- Produces: 无。

- [ ] **Step 1: WelcomeTab hero**

`.card` 改 `max-width: 860px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-panel);`（保持现有结构）。`.brand-name` 字号改 `var(--fs-hero)`、`letter-spacing: -0.02em`；`.brand-lynel` 用 `var(--accent)`。`.tagline` 改 `var(--fs-body)`。`.badge` 改 `background: var(--accent-soft-bg); color: var(--accent);`。`.section-title` 改 `var(--fs-caption)` 大写+字距。

- [ ] **Step 2: QuickLaunch**

`QuickLaunch.vue`（先读文件确认 class）：agent 下拉/输入框/按钮对齐 `--fs-*`；主输入框 hairline + focus ring；发送按钮用 `btn-primary` 样式（`background: var(--accent)`）；目录选择为 `btn-ghost`。硬编码色迁移为 token。

- [ ] **Step 3: RecentSessionList**

`.recent-session-item` hover/active 保持 `--session-item-hover-bg`，radius 用 `var(--radius-sm)`；`scale(0.995)` active 保留；标题/元信息字号改 `--fs-body-sm/--fs-caption`。

- [ ] **Step 4: 接入 SpringTransition（可选亮点）**

`.card` 外层可用 `<SpringTransition>` 包一层实现首屏卡片 spring 入场；`prefers-reduced-motion` 自动退化。

- [ ] **Step 5: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 首页目验 hero/QuickLaunch/历史会话三态、深浅色。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/WelcomeTab.vue src/renderer/src/components/QuickLaunch.vue src/renderer/src/components/RecentSessionList.vue
git commit -m "style: 首页 Apple 化——hero 排版、QuickLaunch 与历史会话 token 化"
```

---

### Task 11: 设置页布局与控件（Switch / Select / 各设置 tab）

**Files:**
- Modify: `src/renderer/src/components/Switch.vue`
- Modify: `src/renderer/src/components/Select.vue`
- Modify: `src/renderer/src/components/SettingsTab.vue`、`SettingsTabs.vue`、`SettingsSidebar.vue`
- Modify: `src/renderer/src/components/settings/`（GeneralTab、ChannelTab、CloudTab、ProviderTab、UpdaterTab、BotManagement 及 FeishuConfig/LocalFileConfig/WeComConfig）

**Interfaces:**
- Consumes: `--accent`、`--bg-hover`、`--radius-*`、`--fs-*`、`--border`、`--shadow-popover`（Select 已有）、`--status-*`。
- Produces: 无。

- [ ] **Step 1: Switch / Select token 化**

`Switch.vue`：checked 用 `--accent`（已有）；track 尺寸微调为高 22px、radius pill；补齐 hover 态（`filter: brightness(1.04)`）。`Select.vue`：`.ls-trigger`/`.ls-panel` 保持结构，`.ls-panel` 加 `box-shadow: var(--shadow-window)`，hover 项 `--accent-soft-bg`；硬编码 `--shadow-popover` fallback `rgba` 迁移。

- [ ] **Step 2: 设置布局**

`SettingsTab/SettingsTabs/SettingsSidebar.vue`（先读文件确认结构）：侧栏导航项选中态改圆角高亮块（`--accent-soft-bg`）+ accent 文字；分组标题 `--fs-caption` 大写；内容区标题字号 `--fs-title`。

- [ ] **Step 3: 各设置 tab 统一**

逐个把硬编码色迁移为 token：`CloudTab.vue` `.dot` 的 `#22c55e/#ef4444/#f59e0b` → `--status-success/--status-error/--status-warn`；`ChannelTab.vue:250` 与 `UpdaterTab.vue:198` 遮罩 `rgba(...)` 迁移为 `--scrim`（在 theme.css 补 `--scrim`：浅 `rgba(0,0,0,0.4)` / 深 `rgba(0,0,0,0.55)`）；`ProviderTab.vue` 底栏浮层 shadow `rgba(0,0,0,0.3)` 改 `--shadow-window`。按钮统一用 base.css 的 `.btn-primary/.btn-ghost/.btn-danger` 类（或等价 token 样式）。

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 打开设置各 tab 目验 Switch/Select/导航/深浅色。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Switch.vue src/renderer/src/components/Select.vue src/renderer/src/components/SettingsTab.vue src/renderer/src/components/SettingsTabs.vue src/renderer/src/components/SettingsSidebar.vue src/renderer/src/components/settings/
git commit -m "style: 设置页统一——Switch/Select 增强、侧栏圆角高亮、硬编码色 token 化"
```

---

### Task 12: 弹窗浮层（New / Close / Settings Dialog + spring）

**Files:**
- Modify: `src/renderer/src/components/NewSessionDialog.vue`
- Modify: `src/renderer/src/components/CloseSessionDialog.vue`
- Modify: `src/renderer/src/components/SettingsDialog.vue`

**Interfaces:**
- Consumes: `SpringTransition`、`--material-bg`、`--scrim`、`--radius-*`、`--shadow-window`、`--fs-*`。
- Produces: 无。

- [ ] **Step 1: 遮罩统一 --scrim**

三个 Dialog 的 `.overlay` 遮罩硬编码 `rgba(0,0,0,0.5)`（New:207、Close:76、Settings:50）改 `background: var(--scrim)`。若 theme.css 尚无 `--scrim`，在 Task 11 Step 3 已补；若漏则本 task 在浅色/深色块补。

- [ ] **Step 2: 面板材质 + spring**

三个 `.dialog` 面板加 `material` 类 + `border-radius: var(--radius-lg)` + `box-shadow: var(--shadow-window)`；用 `<SpringTransition>` 包裹 `.dialog`（或根 `v-if` 块），实现 scale 0.96→1 进场、离场反向。backdrop 点击 / Esc / 关闭逻辑**不动**。

- [ ] **Step 3: 按钮 / 输入统一**

三个 Dialog 内 `.btn-cancel` 用 `btn-ghost`、主按钮用 `btn-primary`（或等价 token 样式）；`NewSessionDialog` 的表单输入改 `.input` 类。字号按 `--fs-body-sm/--fs-body`。

- [ ] **Step 4: 验证**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`npx vitest run`。`npm run dev` 打开/关闭 NewSessionDialog、CloseSessionDialog（运行中会话关 tab）、登录页设置弹窗目验 spring + 材质 + 深浅色。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NewSessionDialog.vue src/renderer/src/components/CloseSessionDialog.vue src/renderer/src/components/SettingsDialog.vue src/renderer/src/styles/theme.css
git commit -m "style: 弹窗统一材质+弹簧进场，遮罩收敛到 --scrim"
```

---

### Task 13: ToastCenter / SessionTooltip / 全局收尾 + 全量验收

**Files:**
- Modify: `src/renderer/src/components/ToastCenter.vue`
- Modify: `src/renderer/src/components/SessionTooltip.vue`
- Modify: `src/renderer/src/components/GuideTab.vue`（如含硬编码色）
- Modify: `src/renderer/src/components/trace/detail/`（Card/FlowPane 等如含硬编码色）

**Interfaces:**
- Consumes: `--material-bg`、`--tooltip-bg`、`--fs-*`、`--status-*`、`--radius-*`、`SpringTransition`。
- Produces: 无。

- [ ] **Step 1: ToastCenter 材质 + spring**

`ToastCenter.vue`（全局样式非 scoped）把 toast 卡片改材质浮层：`background: var(--material-bg); backdrop-filter: blur(20px) saturate(180%); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-window);`。进场动画若为 CSS 则改用 `SpringTransition` 或保持 `TransitionGroup` + 调整进入 keyframe 为 150-200ms 淡入+微上移。

- [ ] **Step 2: SessionTooltip 统一**

`SessionTooltip.vue` 的 tooltip 容器用 `--tooltip-bg`/`--shadow-panel`，字号 `--fs-caption`，radius `--radius-sm`；去掉组件内硬编码背景色。

- [ ] **Step 3: 收尾扫描**

`grep -rn "#[0-9a-fA-F]\{3,6\}\|rgba(" src/renderer/src/components src/renderer/src/views --include=*.vue`，将仍残留的硬编码颜色按 token 迁移（AppearanceTab 终端配色表 hex 属合理保留）。`GuideTab.vue`、`trace/detail/Card.vue`（`#c00`→`var(--status-error)`）、`FlowPane.vue`（`#b48ead`→token）等一并处理。

- [ ] **Step 4: 全量验收**

Run: `cd src/renderer && npx vue-tsc --noEmit`；`cd src/renderer && npx vitest run`；`npm run test:main`（根目录，主进程测试）。`npm run dev` 全流程走查：登录 → 首页 → 新建/打开会话 → 终端交互 → 权限审批弹窗 → Trace 侧栏/Overlay → 设置各 tab → 深/浅/跟随系统三态 → Windows/macOS 窗口控制。与用户逐屏确认视觉。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ToastCenter.vue src/renderer/src/components/SessionTooltip.vue src/renderer/src/components/GuideTab.vue src/renderer/src/components/trace/detail/
git commit -m "style: 全局收尾——Toast/Tooltip 材质化，硬编码色全量 token 化"
```

---

## Self-Review 记录

- **Spec 覆盖**：① 双主题 token → Task 1/2；② UI Kit（useSpring/SpringTransition/Surface/tooltip/按钮）→ Task 3 + base.css（Task 1）；③ 布局组件（三栏/tab/会话列表/终端/Trace）→ Task 4/5/6/7/8；④ 视图（登录/首页/设置）→ Task 9/10/11；⑤ 弹窗浮层 → Task 12；⑥ 收尾（Toast/Tooltip）→ Task 13；动效规范与 reduced-motion 散落各 task + Task 3 兜底；验收门在每 task 与 Task 13 Step 4。全部覆盖。
- **占位符扫描**：无 TBD/TODO；每个 task 的代码/命令均为具体内容。
- **类型一致性**：`useTheme` 的 `ThemeMode/initTheme/getThemeMode/setThemeMode` 在 Task 2 定义并被 Task 2 自身消费；`useSpring` 的 `animateTo` 在 Task 3 定义并被 Task 7/8/10/12/13 消费；`SpringTransition`/`Surface` 在 Task 3 定义并消费；`--scrim` 在 Task 11/12 引用，统一归 Task 11 在 theme.css 补充。`--fs-*`/`--material-bg`/`--brand-grad`/`--radius-pill` 在 Task 1 定义。
