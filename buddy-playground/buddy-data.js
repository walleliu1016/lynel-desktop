/* ============================================================
 * buddy-data.js — Buddy 全部数据与纯逻辑（从 lynel-desktop
 * src/renderer/src/data/buddies/ 逐字移植，去 TS 类型注解）。
 * 经典 script（非 module）：顶层 const/function 进全局词法作用域，
 * 供 buddy.js 直接访问；file:// 双击打开无 CORS 限制。
 * ============================================================ */

// ---- types.ts ----
const BUDDY_STAT_KEYS = ['debugging', 'patience', 'chaos', 'wisdom', 'snark']

// ---- presets.ts ----
const BUDDY_SPECIES = [
  {
    id: 'duck',
    name: '小鸭',
    rarity: 'common',
    frames: [
      [' ', '    __      ', '  <({E} )___ ', ' (  ._>    ', '   `--´     '],
      [' ', '    __      ', '  <({E} )___ ', ' (  ._>    ', '   `--´~    '],
      [' ', '    __      ', '  <({E} )___ ', ' (  .__>   ', '   `--´     '],
    ],
  },
  {
    id: 'goose',
    name: '大鹅',
    rarity: 'uncommon',
    frames: [
      [' ', '    ({E}>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
      [' ', '    ({E}>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
      [' ', '    ({E}>>   ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ],
  },
  {
    id: 'blob',
    name: '果冻',
    rarity: 'common',
    frames: [
      [' ', '   .----.   ', '  ( {E}  {E} ) ', '  (      )  ', '   `----´   '],
      [' ', '  .------.  ', '  ( {E}  {E} ) ', '  (      )  ', '  `------´  '],
      [' ', '    .--.    ', '   ({E} {E})  ', '   (    )   ', '    `--´    '],
    ],
  },
  {
    id: 'cat',
    name: '猫咪',
    rarity: 'rare',
    frames: [
      [' ', '   /\\_/\\   ', '  ( {E}   {E}) ', '  (  ω  )   ', '  (")_(")   '],
      [' ', '   /\\_/\\   ', '  ( {E}   {E}) ', '  (  ω  )   ', '  (")_(")~  '],
      [' ', '   /\\-/\\   ', '  ( {E}   {E}) ', '  (  ω  )   ', '  (")_(")   '],
    ],
  },
  {
    id: 'dragon',
    name: '小龙',
    rarity: 'epic',
    frames: [
      [' ', '  /^\\  /^\\ ', ' <  {E}  {E}  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
      [' ', '  /^\\  /^\\ ', ' <  {E}  {E}  > ', ' (        ) ', '  `-vvvv-´  '],
      ['  ~ ~       ', '  /^\\  /^\\ ', ' <  {E}  {E}  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
    ],
  },
  {
    id: 'octopus',
    name: '章鱼',
    rarity: 'epic',
    frames: [
      [' ', '   .----.   ', '  ( {E}  {E} ) ', '  (______) ', '  /\\/\\/\\/\\  '],
      [' ', '   .----.   ', '  ( {E}  {E} ) ', '  (______) ', '  \\/\\/\\/\\/  '],
      ['     o      ', '   .----.   ', '  ( {E}  {E} ) ', '  (______) ', '  /\\/\\/\\/\\  '],
    ],
  },
  {
    id: 'owl',
    name: '猫头鹰',
    rarity: 'rare',
    frames: [
      [' ', '   /\\  /\\   ', '  (({E})({E})) ', '  (  ><  )  ', '   `----´   '],
      [' ', '   /\\  /\\   ', '  (({E})({E})) ', '  (  ><  )  ', '   .----.   '],
      [' ', '   /\\  /\\   ', '  (({E})(-))  ', '  (  ><  )  ', '   `----´   '],
    ],
  },
  {
    id: 'penguin',
    name: '企鹅',
    rarity: 'uncommon',
    frames: [
      [' ', '   .---.    ', '  ({E}>{E})    ', ' /(   )\\   ', '   `---´    '],
      [' ', '   .---.    ', '  ({E}>{E})    ', ' |(   )|   ', '   `---´    '],
      ['   .---.    ', '  ({E}>{E})    ', ' /(   )\\   ', '   `---´    ', '    ~ ~     '],
    ],
  },
  {
    id: 'turtle',
    name: '乌龟',
    rarity: 'uncommon',
    frames: [
      [' ', '   _,--._ ', '  ( {E}  {E} ) ', ' /[______]\\ ', '  ``    ``  '],
      [' ', '   _,--._ ', '  ( {E}  {E} ) ', ' /[______]\\ ', '  ``    ``  '],
      [' ', '   _,--._ ', '  ( {E}  {E} ) ', ' /[======]\\ ', '  ``    ``  '],
    ],
  },
  {
    id: 'snail',
    name: '蜗牛',
    rarity: 'common',
    frames: [
      [' ', ' {E}    .--. ', '  \\  ( @ ) ', '   \\_`--´  ', ' ~~~~~~~    '],
      [' ', ' {E}    .--. ', '  |  ( @ ) ', '   \\_`--´  ', ' ~~~~~~~    '],
      [' ', ' {E}    .--. ', '  \\  ( @ ) ', '   \\_`--´  ', '  ~~~~~~    '],
    ],
  },
  {
    id: 'ghost',
    name: '幽灵',
    rarity: 'epic',
    frames: [
      [' ', '   .----.   ', '  / {E}  {E} \\ ', '  |      |  ', '  ~`~``~`~  '],
      [' ', '   .----.   ', '  / {E}  {E} \\ ', '  |      |  ', '  `~`~~`~`  '],
      ['    ~ ~     ', '   .----.   ', '  / {E}  {E} \\ ', '  |      |  ', '  ~~`~~`~~  '],
    ],
  },
  {
    id: 'axolotl',
    name: '蝾螈',
    rarity: 'rare',
    frames: [
      [' ', '}~(______)~{', '}~({E} .. {E})~{', '  ( .--. )  ', '  (_/  \\_)  '],
      [' ', '~}(______){~', '~}({E} .. {E}){~', '  ( .--. )  ', '  (_/  \\_)  '],
      [' ', '}~(______)~{', '}~({E} .. {E})~{', '  (  --  )  ', '  ~_/  \\_~  '],
    ],
  },
  {
    id: 'capybara',
    name: '水豚',
    rarity: 'uncommon',
    frames: [
      [' ', '  n______n  ', ' ( {E}    {E} ) ', '  (  oo  )  ', '  `------´  '],
      [' ', '  n______n  ', ' ( {E}    {E} ) ', '  (  Oo  )  ', '  `------´  '],
      ['    ~ ~     ', '  u______n  ', ' ( {E}    {E} ) ', '  (  oo  )  ', '  `------´  '],
    ],
  },
  {
    id: 'cactus',
    name: '仙人掌',
    rarity: 'common',
    frames: [
      [' ', '  n ____ n  ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
      [' ', '    ____    ', ' n |{E}  {E}| n ', ' |_|    |_| ', '   |    |   '],
      ['    n  n    ', ' | ____ |  ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
    ],
  },
  {
    id: 'robot',
    name: '机器人',
    rarity: 'rare',
    frames: [
      [' ', '   .[||].   ', '  [ {E}  {E} ] ', '  [ ==== ]  ', '  `------´  '],
      [' ', '   .[||].   ', '  [ {E}  {E} ] ', '  [ -==- ]  ', '  `------´  '],
      ['     *      ', '   .[||].   ', '  [ {E}  {E} ] ', '  [ ==== ]  ', '  `------´  '],
    ],
  },
  {
    id: 'rabbit',
    name: '兔子',
    rarity: 'common',
    frames: [
      [' ', '   (\\__/)   ', '  ( {E}  {E} ) ', ' =(  ..  )= ', '  (")__(")  '],
      [' ', '   (|__/)   ', '  ( {E}  {E} ) ', ' =(  ..  )= ', '  (")__(")  '],
      [' ', '   (\\__/)   ', '  ( {E}  {E} ) ', ' =( . . )= ', '  (")__(")  '],
    ],
  },
  {
    id: 'mushroom',
    name: '蘑菇',
    rarity: 'common',
    frames: [
      [' ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
      [' ', ' .-O-oo-O-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
      [' . o  .     ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
    ],
  },
  {
    id: 'chonk',
    name: '胖橘',
    rarity: 'legendary',
    frames: [
      [' ', '   /\\  /\\   ', '  ( {E}  {E} ) ', '  (  ..  )  ', '  `------´  '],
      [' ', '   /\\  /|   ', '  ( {E}  {E} ) ', '  (  ..  )  ', '  `------´  '],
      [' ', '   /\\  /\\   ', '  ( {E}  {E} ) ', '  (  ..  )  ', '  `------´~ '],
    ],
  },
]

function getBuddySpecies(id) {
  return BUDDY_SPECIES.find((s) => s.id === id) ?? BUDDY_SPECIES[0]
}

// ---- appearance.ts ----
const BUDDY_EYES = ['·', '✦', '×', '◉', '@', '°']
const BUDDY_HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck']
const HAT_LINES = {
  none: '',
  crown: ' \\^^^/ ',
  tophat: ' [___] ',
  propeller: '  -+-  ',
  halo: '  ( )  ',
  wizard: '  /^\\  ',
  beanie: ' (___) ',
  tinyduck: '   ,>  ',
}
const HAT_OPTIONS = [
  { value: 'none', label: '无', art: '' },
  { value: 'crown', label: '皇冠', art: HAT_LINES.crown.trim() },
  { value: 'tophat', label: '礼帽', art: HAT_LINES.tophat.trim() },
  { value: 'propeller', label: '竹蜻蜓', art: HAT_LINES.propeller.trim() },
  { value: 'halo', label: '光环', art: HAT_LINES.halo.trim() },
  { value: 'wizard', label: '巫师帽', art: HAT_LINES.wizard.trim() },
  { value: 'beanie', label: '贝雷帽', art: HAT_LINES.beanie.trim() },
  { value: 'tinyduck', label: '小鸭', art: HAT_LINES.tinyduck.trim() },
]
const FACES = {
  duck: (e) => `(${e}>`,
  goose: (e) => `(${e}>`,
  blob: (e) => `(${e}${e})`,
  cat: (e) => `=${e}ω${e}=`,
  dragon: (e) => `<${e}~${e}>`,
  octopus: (e) => `~(${e}${e})~`,
  owl: (e) => `(${e})(${e})`,
  penguin: (e) => `(${e}>)`,
  turtle: (e) => `[${e}_${e}]`,
  snail: (e) => `${e}(@)`,
  ghost: (e) => `/${e}${e}\\`,
  axolotl: (e) => `}${e}.${e}{`,
  capybara: (e) => `(${e}oo${e})`,
  cactus: (e) => `|${e} ${e}|`,
  robot: (e) => `[${e}${e}]`,
  rabbit: (e) => `(${e}..${e})`,
  mushroom: (e) => `|${e} ${e}|`,
  chonk: (e) => `(${e}.${e})`,
}
function getFace(speciesId, eye) {
  const gen = FACES[speciesId]
  return gen ? gen(eye) : ''
}

// ---- rarity.ts ----
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }
const RARITY_STARS = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
}
const RARITY_COLORS = {
  common: '#8b949e',
  uncommon: '#3fb950',
  rare: '#a371f7',
  epic: '#f778ba',
  legendary: '#d29922',
}
const RARITY_FLOOR = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }
const STAT_COLORS = {
  debugging: '#58a6ff',
  patience: '#3fb950',
  chaos: '#f85149',
  wisdom: '#a371f7',
  snark: '#d29922',
}

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function rollStats(seed, rarity) {
  const rng = mulberry32(seed)
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, BUDDY_STAT_KEYS)
  let dump = pick(rng, BUDDY_STAT_KEYS)
  while (dump === peak) dump = pick(rng, BUDDY_STAT_KEYS)

  const stats = {}
  for (const n of BUDDY_STAT_KEYS) {
    if (n === peak) stats[n] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    else if (n === dump) stats[n] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    else stats[n] = floor + Math.floor(rng() * 40)
  }
  return stats
}

function rollSpeciesStats(species, rarity = species.rarity) {
  return rollStats(hashString(`${species.id}|${rarity}`), rarity)
}

// ---- quips.ts ----
const QUIPS = [
  { group: 'idle', text: '好无聊，敲点代码？' },
  { group: 'idle', text: '我在这站多久了？' },
  { group: 'idle', text: '快给我点活儿干。', affinity: { chaos: 70 } },
  { group: 'idle', text: '要不要检查下你最近的 bug？', affinity: { debugging: 70 } },
  { group: 'working', text: '跑起来了，趁现在别碰它。', affinity: { patience: 70 } },
  { group: 'working', text: '这编译又过了？运气不错。', affinity: { chaos: 60 } },
  { group: 'working', text: '我在盯输出流，你专心写。' },
  { group: 'awaiting', text: '它在等一个笨蛋点允许。', affinity: { snark: 60 } },
  { group: 'awaiting', text: '审批按钮又找不到在哪了？', affinity: { patience: 30 } },
  { group: 'awaiting', text: '这个权限有坑，先想想再放行。', affinity: { debugging: 60 } },
  { group: 'done', text: '干得漂亮！', affinity: { snark: 20 } },
  { group: 'done', text: '我早说能跑通。', affinity: { snark: 80 } },
  { group: 'done', text: '进度条拉满，收工！' },
  { group: 'interact', text: '嗯？别闹。' },
  { group: 'interact', text: '再摸我可要收钱了。', affinity: { snark: 70 } },
  { group: 'interact', text: '舒服…继续。', affinity: { chaos: 30 } },
]

function pickQuip(group, stats, rng = Math.random) {
  const pool = QUIPS.filter((q) => q.group === group)
  if (!pool.length) return ''
  const weights = pool.map((q) => weightFor(q, stats))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i].text
  }
  return pool[pool.length - 1].text
}

function weightFor(q, stats) {
  let w = 1
  if (!q.affinity) return w
  for (const [key, threshold] of Object.entries(q.affinity)) {
    if (stats[key] >= threshold) w += 2
  }
  return w
}

// ---- buddyStats.ts ----
const EVENT_DELTAS = {
  error: { debugging: 0.5, chaos: 0.2 },
  interrupt: { chaos: 0.5 },
  awaiting: { patience: 0.5 },
  request: { wisdom: 0.4, debugging: 0.1 },
  done: { snark: 0.3, wisdom: 0.2 },
}
const MAX_DELTA = 0.5
const DECAY_RATE = 0.1

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

function createStats(baseline) {
  return { ...baseline }
}

function applyEvent(stats, kind) {
  const next = { ...stats }
  const delta = EVENT_DELTAS[kind]
  for (const [k, d] of Object.entries(delta)) {
    next[k] = clamp(next[k] + d, 0, 100)
  }
  return next
}

function decay(stats, baseline) {
  const next = { ...stats }
  for (const key of Object.keys(next)) {
    const base = baseline[key]
    if (next[key] > base) next[key] = clamp(next[key] - DECAY_RATE, base, 100)
    else if (next[key] < base) next[key] = clamp(next[key] + DECAY_RATE, 0, base)
  }
  return next
}

function resetToBaseline(baseline) {
  return { ...baseline }
}

const BUDDY_MAX_DELTA = MAX_DELTA

// ---- validate.ts ----
const MAX_ASCII_LINES = 40
const MAX_ASCII_WIDTH = 80

function validateCustomAscii(input) {
  const normalized = input.replace(/\r/g, '')
  if (!normalized.trim()) return { ok: false, error: '内容为空' }
  const lines = normalized.split('\n')
  if (lines.length > MAX_ASCII_LINES) {
    return { ok: false, error: `行数超过上限 ${MAX_ASCII_LINES} 行` }
  }
  for (const line of lines) {
    if (line.length > MAX_ASCII_WIDTH) {
      return { ok: false, error: `单行宽度超过上限 ${MAX_ASCII_WIDTH} 字符` }
    }
  }
  return { ok: true, lines }
}

function applyCustomAscii(ascii) {
  const r = validateCustomAscii(ascii)
  if (!r.ok) return null
  const lines = r.lines.slice()
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.length ? lines : null
}
