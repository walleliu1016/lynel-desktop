<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import Icon from './Icon.vue'
import DeepSeekLogo from './DeepSeekLogo.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useHarnessStore } from '../stores/harness'

/**
 * 侧栏底部的 Harness 维护入口：dsh 版本 + 重启 + 更新。
 *
 * 为什么放在这里：dsh 是主进程常驻单例，装完插件（改 `~/.dsh` profile）后不热加载，
 * 必须重启才生效；打开 Harness 时侧栏会自动折叠，所以入口要在折叠态也可达 —— 即
 * 底部与「使用指南 / 设置」并列的那一组按钮。
 */
const props = withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

const harness = useHarnessStore()
const open = ref(false)
const confirmUpdate = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const position = ref({ bottom: 0, left: 0 })

const PANEL_WIDTH = 264

/** 悬浮提示：耗时操作进行中在图标上就能看出来（面板关掉也不丢状态） */
const triggerTip = computed(() => {
  if (harness.updating) return '正在更新 dsh…'
  if (harness.restarting) return '正在重启 Harness…'
  return 'DeepSeek Harness'
})

/** 「更新」入口的文案：不可用 → 重新安装（装坏时它同时也是唯一的修复入口） */
const updateActionText = computed(() => {
  if (harness.updating) return '更新中，请稍候…'
  if (harness.needsInstall) return '重新安装 dsh'
  return `更新到 ${harness.version?.latest ?? ''}`
})

const confirmTitle = computed(() =>
  harness.needsInstall ? '重新安装 DeepSeek Harness' : '更新 DeepSeek Harness')

const confirmMessage = computed(() =>
  harness.needsInstall
    ? '将执行 npm install -g @deepseek-ai/dsh@latest 重新安装（当前 dsh 无法执行）。需要联网，可能耗时数十秒，期间请不要退出应用。'
    : '会先停止当前 Harness（更新期间页面会中断），装好后自动重新启动。需要联网，可能耗时数十秒，期间请不要退出应用。')

const panelStyle = computed(() => ({
  bottom: `${position.value.bottom}px`,
  left: `${position.value.left}px`,
  width: `${PANEL_WIDTH}px`,
}))

/** 按钮在左栏底部，面板向上弹出（用 bottom 定位，无需预知面板高度） */
function updatePosition() {
  const rect = triggerRef.value?.getBoundingClientRect()
  if (!rect) return
  let left = rect.left
  if (left + PANEL_WIDTH > window.innerWidth - 8) left = window.innerWidth - PANEL_WIDTH - 8
  position.value = {
    bottom: window.innerHeight - rect.top + 8,
    left: Math.max(8, left),
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close()
  }
}

function toggle() {
  open.value = !open.value
  if (!open.value) return
  nextTick(updatePosition)
  // 打开即查一次，避免显示上次留下的陈旧版本号；更新中 npm 被占用，查询没有意义
  if (!harness.pending) void harness.checkVersion()
}

function close() {
  open.value = false
}

function onRestart() {
  close()
  void harness.restart()
}

function onUpdateClick() {
  close()
  confirmUpdate.value = true
}

function onUpdateConfirm() {
  confirmUpdate.value = false
  void harness.update()
}

watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('resize', updatePosition)
  else window.removeEventListener('resize', updatePosition)
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updatePosition)
})
</script>

<template>
  <div ref="triggerRef" class="harness-menu" :class="{ collapsed }">
    <button
      class="top-btn tooltip-wrap"
      aria-label="DeepSeek Harness"
      :class="{ active: open, working: harness.pending }"
      @click="toggle"
    >
      <!-- 更新 / 重启进行中：图标转圈，面板关掉也能看见后台还在干活 -->
      <Icon v-if="harness.pending" name="loader" :size="collapsed ? 16 : 13" class="spin" />
      <DeepSeekLogo v-else :size="collapsed ? 16 : 13" />
      <span class="tooltip">{{ triggerTip }}</span>
    </button>
  </div>

  <Teleport to="body">
    <div v-if="open" class="hm-overlay" @click.self="close">
      <div class="hm-panel" :style="panelStyle" role="dialog" aria-label="DeepSeek Harness">
        <div class="hm-head">
          <DeepSeekLogo :size="14" />
          <span class="hm-title">DeepSeek Harness</span>
        </div>

        <!-- 耗时操作进行中：进度行取代版本行，转圈表示还在跑 -->
        <div v-if="harness.pending" class="hm-progress">
          <Icon name="loader" :size="13" class="spin" />
          <span>{{ harness.busyText }}</span>
        </div>
        <div v-else class="hm-row hm-version">
          <span v-if="harness.checking" class="hm-muted">查询版本中…</span>
          <span v-else-if="harness.needsInstall" class="hm-bad">dsh 不可用</span>
          <span v-else-if="harness.version" class="hm-ver">
            dsh {{ harness.version.current }}
            <span v-if="harness.hasUpdate" class="hm-new">→ {{ harness.version.latest }}</span>
          </span>
          <span v-else class="hm-muted">版本未知</span>
          <button class="hm-link" :disabled="harness.checking" @click="harness.checkVersion()">检查更新</button>
        </div>

        <div class="hm-divider" />

        <button class="hm-action" :disabled="harness.busy" @click="onRestart">
          <Icon :name="harness.restarting ? 'loader' : 'refresh-cw'" :size="14" :class="{ spin: harness.restarting }" />
          <span>{{ harness.restarting ? '重启中…' : '重启 Harness' }}</span>
        </button>
        <!-- 更新中也保留这一行（此时 hasUpdate 已被置为 false），否则按钮会中途消失；
             dsh 装坏 / 没装时同样的入口变成「重新安装」，否则用户没有出路 -->
        <button
          v-if="harness.hasUpdate || harness.needsInstall || harness.updating"
          class="hm-action"
          :disabled="harness.busy"
          @click="onUpdateClick"
        >
          <Icon
            :name="harness.updating ? 'loader' : harness.needsInstall ? 'refresh-cw' : 'arrow-down'"
            :size="14"
            :class="{ spin: harness.updating }"
          />
          <span>{{ updateActionText }}</span>
        </button>

        <!-- dsh 不可执行的真实原因（未安装 / 依赖残缺），别在面板里藏起来 -->
        <p v-if="!harness.pending && harness.needsInstall && harness.version?.error" class="hm-error">
          {{ harness.version.error }}
        </p>
        <!-- 失败原因留在面板里：toast 会消失，这里不会 -->
        <p v-if="harness.updateError" class="hm-error">{{ harness.updateError }}</p>
        <p class="hm-hint">装完插件后重启才会生效；重启会中断 Harness 中正在进行的操作。</p>
      </div>
    </div>
  </Teleport>

  <ConfirmDialog
    :open="confirmUpdate"
    :title="confirmTitle"
    warning-title="将执行 npm install -g @deepseek-ai/dsh@latest"
    :message="confirmMessage"
    :icon="harness.needsInstall ? 'refresh-cw' : 'arrow-down'"
    confirm-text="更新"
    @confirm="onUpdateConfirm"
    @cancel="confirmUpdate = false"
  />
</template>

<style scoped>
.harness-menu { display: inline-flex; }
.top-btn {
  height: 26px;
  min-width: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 7px;
  transition: color 0.12s, background 0.12s;
}
.top-btn:hover,
.top-btn.active { color: var(--text-primary); background: var(--bg-hover); }
/* 后台更新 / 重启期间：图标保持 accent 色，转圈更容易被注意到 */
.top-btn.working { color: var(--accent); }
.spin { animation: hm-spin 1s linear infinite; }
@keyframes hm-spin { to { transform: rotate(360deg); } }
/* reset.css 在系统「减少动态效果」时会把所有动画压成 0.01ms/1 次，
   转圈是"还在进行中"的状态反馈，必须豁免，否则看起来像卡住了 */
@media (prefers-reduced-motion: reduce) {
  .spin { animation: hm-spin 1s linear infinite !important; }
}
.tooltip-wrap { position: relative; }
.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--tooltip-bg);
  color: var(--tooltip-color);
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 30;
}
.tooltip-wrap:hover .tooltip { opacity: 1; }
/* 折叠态窄侧栏：tooltip 靠右弹出，避免上方放不下 / 被裁剪 */
.harness-menu.collapsed .tooltip {
  top: 50%;
  left: calc(100% + 8px);
  bottom: auto;
  transform: translateY(-50%);
  z-index: 100;
}

.hm-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: transparent;
}
.hm-panel {
  position: absolute;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hm-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 6px;
  color: var(--text-primary);
}
.hm-title { font-size: 12px; font-weight: 600; }
.hm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  font-size: 12px;
}
.hm-ver { color: var(--text-primary); }
.hm-new { color: var(--accent); }
.hm-muted { color: var(--text-tertiary); }
.hm-bad { color: var(--status-error); }
.hm-link {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
}
.hm-link:hover:not(:disabled) { color: var(--accent); background: var(--accent-soft-bg); }
.hm-link:disabled { cursor: default; opacity: 0.5; }
.hm-divider { height: 1px; background: var(--border); margin: 6px 4px; }
.hm-action {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.hm-action:hover:not(:disabled) { background: var(--accent-soft-bg); color: var(--accent); }
.hm-action:disabled { cursor: default; opacity: 0.5; }
.hm-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  font-size: 12px;
  color: var(--accent);
}
.hm-error {
  margin: 6px 6px 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--status-error);
  word-break: break-word;
}
.hm-hint {
  margin: 6px 6px 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
}
</style>
