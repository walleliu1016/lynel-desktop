# Buddy 升级设计：18 物种 + 外观定制 + 稀有度驱动属性

> **目标**：把 Buddy 电子宠物从「3 角色静态帧」升级为参考实现（基于 Claude Code 泄漏的 buddy/sprites.ts，见 `~/Downloads/index.html`）的「物种基座 + 外观参数」动态组合模型，并在设置页提供完整设计与实时预览。
>
> **范围**：只做数据层 + 渲染层 + 设置页设计区。不做任何业务挂载扩展（用户明确暂不结合现有功能）。

## 背景与差距

参考实现可配置项：18 物种 × 3 帧动画、6 种眼睛、8 种帽子、5 档稀有度（带掉落权重/颜色/星标）、Shiny 特效、5 维属性（稀有度驱动 rollStats）。

当前实现：3 角色（duck/cat/dragon）× 4 组静态帧（idle/thinking/celebration/alarm）、固定 baseline、无外观定制、3D 倾斜写死（hover ±8°）。

## 数据模型

### types.ts

```ts
export type BuddyStatKey = 'debugging' | 'patience' | 'chaos' | 'wisdom' | 'snark'
export type BuddyStats = Record<BuddyStatKey, number>
export type BuddyFrameKey = 'idle' | 'thinking' | 'celebration' | 'alarm'

/** 稀有度：参考 5 档 */
export type BuddyRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** 眼睛字符（参考 EYES） */
export type BuddyEye = '·' | '✦' | '×' | '◉' | '@' | '°'

/** 帽子 id（参考 HATS） */
export type BuddyHat = 'none' | 'crown' | 'tophat' | 'propeller' | 'halo' | 'wizard' | 'beanie' | 'tinyduck'

/**
 * 物种基座：3 帧动画，每帧是字符串数组（行），含 {E} 眼睛占位符。
 * 渲染时用当前眼睛字符替换 {E}；帽子叠到首行；blink 时眼睛替换为 '-'
 * （全部移植参考 BODIES 数据，含 HAT_LINES 首行占位约定）。
 */
export interface BuddySpecies {
  id: string          // 英文 id，如 'duck'
  name: string        // 中文显示名，如 '小鸭'
  rarity: BuddyRarity // 物种固有稀有度（设计区可覆盖为其他档）
  frames: string[][]  // 3 帧，每帧为行数组
}
```

### 外观数据（appearance.ts）

```ts
export const BUDDY_EYES: BuddyEye[] = ['·', '✦', '×', '◉', '@', '°']
export const BUDDY_HATS: BuddyHat[] = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck']
export const HAT_LINES: Record<BuddyHat, string> = { none:'', crown:' \\^^^/ ', tophat:' [___] ', ... }  // 移植参考

/** 帽子显示名 + 字符画预览 */
export const HAT_OPTIONS: { value: BuddyHat; label: string; art: string }[]
```

### 稀有度与属性（rarity.ts）

```ts
export const RARITIES: BuddyRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']
export const RARITY_WEIGHTS: Record<BuddyRarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }
export const RARITY_STARS: Record<BuddyRarity, string> = { common: '★', ... }
export const RARITY_COLORS: Record<BuddyRarity, string> = { common: '#8b949e', ... }
export const RARITY_FLOOR: Record<BuddyRarity, number> = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }

/** 参考 rollStats：稀有度驱动，peak/dump 双极端，0-100 */
export function rollStats(seed: number, rarity: BuddyRarity): BuddyStats
```

**确定性 seed**：`seed = hashString(speciesId + '|' + rarity)`，mulberry32 伪随机。同一物种+稀有度属性固定可复现（设计区稳定，不改随机）。

## 渲染模型（BuddyPet.vue）

输入从 `role` 改为组合参数：

```ts
props = {
  species: BuddySpecies,   // 基座
  eye: BuddyEye,           // 当前眼睛
  hat: BuddyHat,           // 当前帽子
  shiny?: boolean,         // shiny 金色 + 光晕
  state?: SessionState | null, // → 帧键
  stats: BuddyStats,       // 仅用于 quip 吐槽
  tilt?: number,           // 3D hover 倾斜角（0 = 关闭 3D）
  floatAmp?: number,       // 呼吸浮动幅度 px（0 = 静止）
  customFrames?: string[]  // 自定义 ASCII 覆盖（非空则跳过动态组合）
}
```

**state → 帧 + 眼睛覆盖**（保留现有 4 状态语义，用眼睛字符表达状态差异）：

| frameKey | 帧索引 | eye | 说明 |
|---|---|---|---|
| idle | IDLE_SEQUENCE[tick]（含 -1 blink） | 所选 eye / blink 时 '-' | 参考 idle 动画 |
| thinking | 1 | '.' | 半闭眼思考 |
| celebration | 2 | '^' | 开心 |
| alarm | 0 | '!' | 警觉 |

渲染（移植参考 renderSprite）：

```ts
function renderLines(frameIdx: number, eye: string): string[] {
  if (customFrames?.length) return customFrames
  const body = species.frames[frameIdx].map(l => l.replaceAll('{E}', eye))
  let lines = [...body]
  if (hat !== 'none' && !lines[0].trim()) lines[0] = HAT_LINES[hat]
  if (!lines[0].trim() && species.frames.every(f => !f[0].trim())) lines.shift()
  return lines
}
```

**3D / 呼吸**：rAF 仍为 `el.style.transform` 唯一写入者，合成 `tilt`（hover 时 ±tilt°）与 `floatAmp`（正弦 y 位移）与 squish。`tilt=0` 关闭 3D 旋转，`floatAmp=0` 静止。

## settings 字段

```ts
buddyRoleId: string     // 保留，存物种 id
buddyEye: BuddyEye      // '·'
buddyHat: BuddyHat      // 'none'
buddyShiny: boolean     // false
buddy3DTilt: number     // 8（0 = 关闭 3D）
buddyFloatAmp: number   // 3（0 = 静止）
buddyCustomAscii: string // 保留
buddyEnabled: boolean   // 保留
```

## 属性引擎（useBuddyStats / buddyStats）

- `role`（物种）改由 `getBuddySpecies(buddyRoleId)` 返回。
- baseline = `rollStats(hashString(id + '|' + rarity), rarity)`，会话起步值由此生成。
- 事件增量 / decay / reset 逻辑不变（沿用 EVENT_DELTAS / MAX_DELTA / DECAY_RATE）。

## 组件接口调整

- `BuddyTab.vue`：设计区新增 物种(18) / 眼睛 / 帽子 / 稀有度 / shiny / 3D 倾斜滑块 / 呼吸滑块 / 自定义 ASCII；右侧属性条（rollStats 结果）+ 实时预览（传全部外观参数 + state=null）。
- `BuddyHost.vue`：从 settings 读 eye/hat/shiny/tilt/floatAmp + 物种 + customAscii 传 BuddyPet。
- `applyCustomAscii`：仍校验 + 剔除首尾空行，返回行数组（customFrames）而非 BuddyRole。

## 兼容性

- settings 旧字段 `buddyRoleId`/`buddyCustomAscii` 语义不变，旧值无缝迁移（物种 id 不变）。
- 自定义 ASCII 路径保留：粘贴后完全覆盖基座渲染，不做 eye/hat 替换。
- 现有测试随接口更新改写；新增 appearance/rarity 纯函数测试。

## 影响文件

- 数据层：`types.ts`、`presets.ts`（18 物种）、新增 `appearance.ts`、`rarity.ts`、`validate.ts`
- 渲染层：`BuddyPet.vue`、`BuddyHost.vue`、`useBuddyStats.ts`、`buddyStats.ts`
- 设置：`types/settings.ts`、`stores/settings.ts`、`settings/BuddyTab.vue`
- 测试：`presets.test.ts`、`validate.test.ts`、`BuddyPet.test.ts`、`BuddyTab.test.ts`、`buddyStats.test.ts`，新增 `appearance.test.ts`、`rarity.test.ts`
