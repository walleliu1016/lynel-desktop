<template>
  <!-- Teleport 到 body：弹窗脱离 .home 的层级，避免被中间终端区域的合成层盖住右侧 -->
  <Teleport to="body">
  <div class="overlay" :class="{ open }" @click.self="open && $emit('close')">
    <SpringTransition>
    <div v-if="open" class="dialog">
      <div class="head">
        <h2>新建会话</h2>
        <button class="close" aria-label="关闭" title="关闭" @click="$emit('close')">
          <Icon name="close" :size="14" />
        </button>
      </div>
      <div class="body">
        <form @submit.prevent="onSubmit" class="new-form">
          <div class="form-group">
            <label class="form-label">工作目录</label>
            <div class="dir-row">
              <input class="form-input" v-model="workdir" placeholder="点击右侧按钮选择目录" readonly :disabled="loading" @click="onPick" />
              <button type="button" class="pick-btn" :disabled="loading" @click="onPick">选择…</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Agent 类型</label>
            <AgentSelect v-model="agent" />
          </div>
          <div class="form-group">
            <label class="form-label">提示词（可选）</label>
            <textarea class="form-input area" v-model="prompt" rows="4" :placeholder="isClaude ? '你想让 Claude 做什么？' : `你想让 ${agentMeta(agent).short} 做什么？`" :disabled="loading"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">{{ isClaude ? 'Claude 选项' : '启动选项' }}</label>
            <div v-if="isClaude" class="multi-select" :class="{ open: flagsOpen }">
              <div class="select-trigger" @click="flagsOpen = !flagsOpen">
                <span v-if="selectedFlags.length === 0" class="placeholder">无额外参数</span>
                <span v-else>{{ selectedFlags.join(', ') }}</span>
                <Icon name="chevron-down" :size="12" class="arrow" :class="{ flip: flagsOpen }" />
              </div>
              <div v-if="flagsOpen" class="select-dropdown">
                <label v-for="f in flagOptions" :key="f.value" class="flag-option" @click.stop>
                  <input type="checkbox" :value="f.value" v-model="selectedFlags" />
                  <span class="flag-label">{{ f.label }}</span>
                  <span class="flag-desc">{{ f.desc }}</span>
                </label>
              </div>
            </div>
            <div v-else class="option-disabled">该 agent 暂不支持额外参数</div>
          </div>
          <div class="form-group">
            <label class="form-label">绑定机器人（可选）</label>
            <Select v-model="selectedBot" :options="botSelectOptions" placeholder="不绑定" :disabled="loading" />
          </div>
          <div class="form-actions">
            <button type="button" class="cancel" :disabled="loading" @click="$emit('close')">取消</button>
            <button type="submit" class="primary" :disabled="!workdir.trim() || loading">
              <span v-if="loading" class="spinner" />
              {{ loading ? '创建中...' : '打开' }}
            </button>
          </div>
        </form>
      </div>
    </div>
    </SpringTransition>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import Icon from './Icon.vue'
import SpringTransition from './SpringTransition.vue'
import AgentSelect from './AgentSelect.vue'
import Select, { type SelectOption } from './Select.vue'
import { useBotsStore } from '../stores/bots'
import { useSessionsStore } from '../stores/sessions'
import { agentMeta, type AgentKind } from '../types/agents'
import { GetAppInfo, PickDirectory } from '../composables/useElectron'

const props = defineProps<{ open: boolean; loading?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind): void
}>()

const botsStore = useBotsStore()
const sessions = useSessionsStore()
const workdir = ref('')
const prompt = ref('')
const agent = ref<AgentKind>('claude')
const flagsOpen = ref(false)
const selectedFlags = ref<string[]>([])
const selectedBot = ref('')
const isClaude = computed(() => agent.value === 'claude')

function isBotAvailable(botId: string): boolean {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  return !sessionId
}

function getBotBoundSessionName(botId: string): string | undefined {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  if (!sessionId) return undefined
  return sessions.getBotBoundSessionName(botId)
}

const botSelectOptions = computed<SelectOption[]>(() => {
  const opts: SelectOption[] = [{ value: '', label: '不绑定' }]
  for (const b of botsStore.bots) {
    opts.push({
      value: b.id,
      label: getBotBoundSessionName(b.id) ? `${b.name}（已绑定 ${getBotBoundSessionName(b.id)}）` : b.name,
      disabled: !isBotAvailable(b.id),
    })
  }
  return opts
})

const flagOptions = [
  { value: '--verbose', label: '--verbose', desc: '输出详细的调试信息' },
  { value: '--debug', label: '--debug', desc: '启用调试模式' },
]

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    void botsStore.load()
    void sessions.loadBotBindings()
    workdir.value = ''
    prompt.value = ''
    agent.value = 'claude'
    selectedFlags.value = []
    selectedBot.value = ''
    flagsOpen.value = false
    // 工作目录默认 home：不手动选择则直接使用，避免必须点「选择…」
    try {
      const info = await GetAppInfo()
      if (info?.homeDir) workdir.value = info.homeDir
    } catch { /* ignore */ }
  }
})

watch(agent, () => {
  if (agent.value !== 'claude') {
    selectedFlags.value = []
    flagsOpen.value = false
  }
})

async function onPick() {
  try {
    const dir = await PickDirectory()
    if (dir) workdir.value = dir
  } catch {}
}

function onSubmit() {
  if (!workdir.value.trim() || props.loading) return
  emit('create', workdir.value.trim(), prompt.value.trim(), [...selectedFlags.value], selectedBot.value || undefined, agent.value)
}
</script>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  /* Teleport 到 body 顶层后，z-index 提到接近 toast，确保盖住终端合成层 */
  z-index: 9998;
  opacity: 0; pointer-events: none;
  transition: opacity 0.2s ease;
}
.overlay.open { opacity: 1; pointer-events: auto; }
.dialog {
  width: 520px;
  max-width: calc(100% - 40px);
  max-height: calc(100vh - 80px);
  background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px 10px; }
h2 { font-size: 14px; color: var(--text-primary); margin: 0; }
.close { color: var(--text-secondary); padding: 2px 6px; border-radius: var(--radius-sm); display: flex; align-items: center; }
.close:hover { background: var(--bg-hover); color: var(--text-primary); }
.body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px 20px 20px;
}
.new-form { display: flex; flex-direction: column; }
.form-group { margin-bottom: 12px; }
.form-label { display: block; font-size: 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
.dir-row { display: flex; gap: 8px; }
.dir-row .form-input { flex: 1; cursor: pointer; }
.form-input {
  width: 100%; background: var(--bg-input); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md); padding: 7px 10px;
  color: var(--text-primary); font-size: var(--fs-body-sm); font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-bg); }
.pick-btn {
  padding: 8px 14px; background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); color: var(--text-primary); font-size: 12px;
  white-space: nowrap; cursor: pointer;
}
.pick-btn:hover { background: var(--border); }
.area { resize: vertical; min-height: 80px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.cancel { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 6px 14px; font-size: var(--fs-body-sm); transition: border-color 0.15s, color 0.15s; }
.cancel:hover { border-color: var(--accent); color: var(--accent); }
.primary { padding: 7px 18px; background: var(--accent); color: var(--text-inverse); border: none; border-radius: var(--radius-md); font-size: var(--fs-body-sm); font-weight: 500; transition: filter 0.15s, box-shadow 0.15s; }
.primary:hover:not(:disabled) { filter: brightness(1.06); }
.primary:active:not(:disabled) { transform: scale(0.97); }
.primary:disabled { opacity: 0.7; cursor: not-allowed; display: inline-flex; align-items: center; gap: 6px; }
.cancel:disabled { opacity: 0.5; cursor: not-allowed; }
.form-input:disabled { opacity: 0.6; cursor: not-allowed; }
.pick-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spinner {
  width: 11px; height: 11px;
  border: 2px solid var(--border);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
/* reset.css 在系统「减少动态效果」时会把所有动画压成 0.01ms/1 次，
   loading 转圈是状态反馈动画，仍需保持旋转，故在此豁免 */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: spin 0.75s linear infinite !important;
  }
}

.option-disabled {
  padding: 8px 10px; background: var(--bg-input); border: 1px dashed var(--border);
  border-radius: var(--radius-md); font-size: 12px; color: var(--text-tertiary);
}
.multi-select { position: relative; user-select: none; }
.select-trigger {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 7px 10px;
  font-size: 12px; color: var(--text-primary); cursor: pointer;
}
.select-trigger:hover { border-color: var(--accent); }
.placeholder { color: var(--text-tertiary); }
.arrow { color: var(--text-tertiary); transition: transform 0.2s; flex-shrink: 0; }
.arrow.flip { transform: rotate(180deg); }
.select-dropdown {
  position: absolute; top: 100%; left: 0; right: 0;
  margin-top: 2px; background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-md); z-index: 10; padding: 4px;
  box-shadow: var(--shadow-window);
}
.flag-option {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer;
  font-size: 12px;
}
.flag-option:hover { background: var(--bg-input); }
.flag-option input[type="checkbox"] { accent-color: var(--accent); flex-shrink: 0; }
.flag-label { color: var(--text-primary); font-family: var(--font-mono); white-space: nowrap; }
.flag-desc { color: var(--text-tertiary); margin-left: auto; font-size: 11px; }
</style>
