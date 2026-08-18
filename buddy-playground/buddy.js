/* ============================================================
 * buddy.js — Buddy 渲染与交互。
 * 移植自 lynel-desktop 的 BuddyPet.vue（渲染/动画）与
 * useBuddyStats.ts（属性引擎）；Pinia store 耦合改为手动事件驱动。
 * 依赖 buddy-data.js（经典 script 全局作用域）。
 * ============================================================ */

// ---- 状态 ----
const state = {
  speciesId: 'duck',
  eye: '·',
  hat: 'none',
  shiny: false,
  rarity: null, // null = 跟随物种
  tilt: 8,
  floatAmp: 3,
  customAscii: '',
  petState: 'idle', // idle / thinking / celebration / alarm
}

let species = getBuddySpecies(state.speciesId)
let baseline = rollSpeciesStats(species, currentRarity())
let stats = { ...baseline }

// ---- 动画常量（与 BuddyPet.vue 完全一致） ----
const DAMP = 0.3
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]
const BUBBLE_MS = 3000
const DECAY_INTERVAL_MS = 30_000

let tick = 0
let frame = 0
let rafId = 0
let targetTiltX = 0
let targetTiltY = 0
let tiltX = 0
let tiltY = 0
let squish = 1
let bubbleTimer = null
let lastText = ''
let decayTimer = null

// ---- DOM 引用 ----
function $(id) {
  return document.getElementById(id)
}
const stage = $('stage')
const bodyEl = $('body')
const pre = $('pre')
const bubbleEl = $('bubble')
const buddyEl = $('buddy')
const rarityBadge = $('rarityBadge')
const speciesName = $('speciesName')
const faceText = $('faceText')
const shinyBadge = $('shinyBadge')
const statRows = $('statRows')
const statValueEls = {}

// ---- 派生值 ----
function currentRarity() {
  return state.rarity || species.rarity
}
function currentCustomFrames() {
  return applyCustomAscii(state.customAscii) || null
}

// ---- 帧解析（移植 BuddyPet.resolveFrame） ----
function resolveFrame() {
  switch (state.petState) {
    case 'thinking':
      return { idx: 1, eye: '.' }
    case 'celebration':
      return { idx: 2, eye: '^' }
    case 'alarm':
      return { idx: 0, eye: '!' }
    default: {
      const step = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length]
      return { idx: step === -1 ? 0 : step % 3, eye: step === -1 ? '-' : state.eye }
    }
  }
}

// ---- 帧文本（移植 BuddyPet.frameText） ----
function computeFrameText() {
  const frames = currentCustomFrames()
  if (frames && frames.length) return frames.join('\n')
  const { idx, eye } = resolveFrame()
  const body = species.frames[idx].map((l) => l.replaceAll('{E}', eye))
  const lines = [...body]
  if (state.hat !== 'none' && !lines[0].trim()) lines[0] = HAT_LINES[state.hat]
  if (!lines[0].trim() && species.frames.every((f) => !f[0].trim())) lines.shift()
  return lines.join('\n')
}

// ---- 气泡（移植 BuddyPet.showBubble） ----
function showBubble(group) {
  bubbleEl.textContent = pickQuip(group, stats)
  bubbleEl.classList.remove('hidden')
  bubbleEl.classList.remove('pop')
  // 强制 reflow 以重触发 pop 动画
  void bubbleEl.offsetWidth
  bubbleEl.classList.add('pop')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => {
    bubbleEl.classList.add('hidden')
  }, BUBBLE_MS)
}

// ---- 动画主循环（移植 BuddyPet.runFloat：rAF 驱动） ----
function runFloat() {
  frame += 1
  if (frame % 30 === 0) tick += 1
  // 交互状态阻尼逼近（3D 倾斜 / 点击挤压回弹）
  tiltX += (targetTiltX - tiltX) * DAMP
  tiltY += (targetTiltY - tiltY) * DAMP
  squish += (1 - squish) * DAMP
  const y = Math.sin(frame * 0.05) * state.floatAmp
  const breathe = 1 + Math.sin(frame * 0.1) * 0.01
  const scale = breathe * squish
  bodyEl.style.transform = `translateY(${y}px) scale(${scale}) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`
  // 帧文本仅变化时写 DOM（idle 动画 / 眼睛 / 状态切换）
  const text = computeFrameText()
  if (text !== lastText) {
    pre.textContent = text
    lastText = text
  }
  rafId = requestAnimationFrame(runFloat)
}

// ---- 交互（移植 BuddyPet onInteract / onHover） ----
bodyEl.addEventListener('click', () => {
  squish = 0.96
  showBubble('interact')
})
bodyEl.addEventListener('mouseenter', () => {
  targetTiltX = -state.tilt
  targetTiltY = state.tilt
})
bodyEl.addEventListener('mouseleave', () => {
  targetTiltX = 0
  targetTiltY = 0
})

// ---- 属性引擎（移植 useBuddyStats，去 Pinia） ----
function applyEventKind(kind) {
  stats = applyEvent(stats, kind)
  if (kind === 'done') stats = resetToBaseline(baseline) // 完成归零回基线
  renderStats()
}

function decayOnce() {
  stats = decay(stats, baseline)
  renderStats()
}

function resetStats() {
  stats = resetToBaseline(baseline)
  renderStats()
}

function startDecay() {
  stopDecay()
  decayTimer = setInterval(decayOnce, DECAY_INTERVAL_MS)
}
function stopDecay() {
  if (decayTimer) {
    clearInterval(decayTimer)
    decayTimer = null
  }
}

// ---- 元信息渲染（稀有度徽标 / 名称 / 表情 / SHINY） ----
function renderMeta() {
  const r = currentRarity()
  const color = RARITY_COLORS[r]
  rarityBadge.textContent = `${RARITY_STARS[r]} ${r}`
  rarityBadge.style.color = color
  speciesName.textContent = species.name
  speciesName.style.color = color
  faceText.textContent = getFace(species.id, state.eye)
  shinyBadge.classList.toggle('hidden', !state.shiny)
  stage.style.borderColor = color + '66'
  buddyEl.classList.toggle('shiny', state.shiny)
}

// ---- 属性条渲染 ----
function buildStatRows() {
  statRows.innerHTML = ''
  for (const key of BUDDY_STAT_KEYS) {
    const row = document.createElement('div')
    row.className = 'stat-row'
    const label = document.createElement('span')
    label.className = 'stat-label'
    label.textContent = key.toUpperCase()
    const bar = document.createElement('div')
    bar.className = 'stat-bar'
    const fill = document.createElement('div')
    fill.className = 'stat-fill'
    fill.style.background = STAT_COLORS[key]
    bar.appendChild(fill)
    const val = document.createElement('span')
    val.className = 'stat-val'
    row.appendChild(label)
    row.appendChild(bar)
    row.appendChild(val)
    statRows.appendChild(row)
    statValueEls[key] = { fill, val }
  }
}

function renderStats() {
  for (const key of BUDDY_STAT_KEYS) {
    const v = Math.round(stats[key])
    statValueEls[key].fill.style.width = v + '%'
    statValueEls[key].val.textContent = String(v)
  }
}

// ---- 控件填充与绑定 ----
function populate() {
  // 物种
  const speciesSel = $('species')
  speciesSel.innerHTML = ''
  for (const s of BUDDY_SPECIES) {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = `${s.name} · ${RARITY_STARS[s.rarity]} ${s.rarity}`
    speciesSel.appendChild(opt)
  }
  speciesSel.value = state.speciesId

  // 帽子
  const hatSel = $('hat')
  hatSel.innerHTML = ''
  for (const h of HAT_OPTIONS) {
    const opt = document.createElement('option')
    opt.value = h.value
    opt.textContent = h.art ? `${h.label} ${h.art}` : h.label
    hatSel.appendChild(opt)
  }
  hatSel.value = state.hat

  // 稀有度
  const raritySel = $('rarity')
  raritySel.innerHTML = ''
  const follow = document.createElement('option')
  follow.value = ''
  follow.textContent = '跟随物种'
  raritySel.appendChild(follow)
  for (const r of RARITIES) {
    const opt = document.createElement('option')
    opt.value = r
    opt.textContent = `${RARITY_STARS[r]} ${r}`
    raritySel.appendChild(opt)
  }
  raritySel.value = state.rarity || ''

  // 眼睛
  const eyeRow = $('eyeRow')
  eyeRow.innerHTML = ''
  for (const e of BUDDY_EYES) {
    const btn = document.createElement('button')
    btn.className = 'eye-btn' + (e === state.eye ? ' active' : '')
    btn.textContent = e
    btn.dataset.eye = e
    btn.addEventListener('click', () => {
      state.eye = e
      for (const b of eyeRow.children) b.classList.toggle('active', b.dataset.eye === e)
      renderMeta()
    })
    eyeRow.appendChild(btn)
  }

  // 状态按钮
  const stateBtns = $('stateBtns')
  stateBtns.innerHTML = ''
  const STATE_DEFS = [
    { key: 'idle', label: '空闲' },
    { key: 'thinking', label: '思考' },
    { key: 'celebration', label: '庆祝' },
    { key: 'alarm', label: '警觉' },
  ]
  for (const def of STATE_DEFS) {
    const btn = document.createElement('button')
    btn.className = 'ctrl-btn' + (def.key === state.petState ? ' active' : '')
    btn.textContent = def.label
    btn.addEventListener('click', () => {
      state.petState = def.key
      for (const b of stateBtns.children) b.classList.toggle('active', b.dataset.key === def.key)
      if (def.key === 'alarm') showBubble('awaiting')
      else if (def.key === 'celebration') showBubble('done')
    })
    btn.dataset.key = def.key
    stateBtns.appendChild(btn)
  }

  // 事件按钮
  const eventBtns = $('eventBtns')
  eventBtns.innerHTML = ''
  const EVENT_DEFS = [
    { key: 'error', label: 'error 出错' },
    { key: 'interrupt', label: 'interrupt 中断' },
    { key: 'awaiting', label: 'awaiting 等待' },
    { key: 'request', label: 'request 请求' },
    { key: 'done', label: 'done 完成' },
    { key: 'decay', label: '衰减一步' },
    { key: 'reset', label: '重置' },
  ]
  for (const def of EVENT_DEFS) {
    const btn = document.createElement('button')
    btn.className = 'ctrl-btn'
    btn.textContent = def.label
    btn.addEventListener('click', () => {
      if (def.key === 'decay') decayOnce()
      else if (def.key === 'reset') resetStats()
      else applyEventKind(def.key)
    })
    eventBtns.appendChild(btn)
  }
}

function bindControls() {
  $('shiny').addEventListener('change', (e) => {
    state.shiny = e.target.checked
    renderMeta()
  })
  $('species').addEventListener('change', (e) => {
    state.speciesId = e.target.value
    species = getBuddySpecies(state.speciesId)
    baseline = rollSpeciesStats(species, currentRarity())
    resetStats()
    renderMeta()
  })
  $('hat').addEventListener('change', (e) => {
    state.hat = e.target.value
  })
  $('rarity').addEventListener('change', (e) => {
    state.rarity = e.target.value || null
    baseline = rollSpeciesStats(species, currentRarity())
    resetStats()
    renderMeta()
  })
  $('tilt').addEventListener('input', (e) => {
    state.tilt = Number(e.target.value)
    $('tiltVal').textContent = `${state.tilt}°`
  })
  $('float').addEventListener('input', (e) => {
    state.floatAmp = Number(e.target.value)
    $('floatVal').textContent = `${state.floatAmp}px`
  })
  $('ascii').addEventListener('input', (e) => {
    state.customAscii = e.target.value
    const err = $('asciiError')
    if (!state.customAscii) {
      err.textContent = ''
      return
    }
    const r = validateCustomAscii(state.customAscii)
    err.textContent = r.ok ? '' : r.error
    err.style.color = r.ok ? 'var(--status-ok)' : 'var(--status-error)'
  })
}

// ---- 初始化 ----
buildStatRows()
populate()
bindControls()
renderMeta()
renderStats()
startDecay()
rafId = requestAnimationFrame(runFloat)

// 页面卸载清理（可选，经典 script 下一般不会触发）
window.addEventListener('beforeunload', () => {
  stopDecay()
  cancelAnimationFrame(rafId)
  if (bubbleTimer) clearTimeout(bubbleTimer)
})
