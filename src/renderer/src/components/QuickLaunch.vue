<template>
  <form class="quick-launch" @submit.prevent="onSubmit">
    <textarea
      v-model="prompt"
      class="ql-input"
      rows="2"
      :placeholder="`你想让 ${agentMeta(agent).short} 做什么？`"
      :disabled="loading"
      @keydown.enter="onEnter"
    />
    <div class="ql-bottom">
      <div class="ql-left">
        <AgentSelect v-model="agent" class="ql-agent" />
        <button type="button" class="ql-dir" :title="workdir || '未选择，使用默认目录'" :disabled="loading" @click="onPick">
          <Icon name="folder-open" :size="13" />
          <span class="ql-dir-text">{{ workdir || '默认目录' }}</span>
          <Icon name="chevron-down" :size="11" class="ql-chevron" />
        </button>
        <div class="ql-bot-wrap">
          <span class="ql-bot-label">Bot</span>
          <Select
            v-model="selectedBot"
            :options="botSelectOptions"
            size="sm"
            placeholder="不绑定"
            :disabled="loading"
            auto-height
            class="ql-bot"
          />
        </div>
      </div>
      <button type="submit" class="ql-send" :disabled="!prompt.trim() || loading">
        <span v-if="loading" class="ql-spinner" />
        <Icon v-else name="send" :size="14" />
      </button>
    </div>
    <BotAddDialog
      v-if="showBotAddDialog"
      @saved="onBotAdded"
      @close="showBotAddDialog = false"
    />
  </form>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Icon from './Icon.vue'
import AgentSelect from './AgentSelect.vue'
import Select, { type SelectOption } from './Select.vue'
import BotAddDialog from './BotAddDialog.vue'
import { agentMeta, type AgentKind } from '../types/agents'
import { PickDirectory } from '../composables/useElectron'
import { useBotsStore } from '../stores/bots'
import { useSessionsStore } from '../stores/sessions'
import { pushToast } from '../composables/useToast'

const props = defineProps<{ loading?: boolean }>()
const emit = defineEmits<{
  (e: 'create', workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind): void
}>()

const workdir = ref('')
const prompt = ref('')
const agent = ref<AgentKind>('claude')
const selectedBot = ref('')
const showBotAddDialog = ref(false)

const botsStore = useBotsStore()
const sessions = useSessionsStore()
const botOptions = computed(() => botsStore.bots)

onMounted(() => {
  void botsStore.load()
  void sessions.loadBotBindings()
})

function isBotAvailable(botId: string): boolean {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  return !sessionId
}

function getBotBoundSessionName(botId: string): string | undefined {
  const sessionId = sessions.botBindings[botId] || sessions.sessionBots[botId]
  if (!sessionId) return undefined
  return sessions.getBotBoundSessionName(botId)
}

// 「＋ 去添加」置顶（与右键绑定浮层一致），随后是不绑定与 bot 列表
const botSelectOptions = computed<SelectOption[]>(() => [
  { value: '__add__', label: '＋ 去添加' },
  { value: '', label: '不绑定' },
  ...botOptions.value.map((b) => ({
    value: b.id,
    label: getBotBoundSessionName(b.id) ? `${b.name}（已绑定 ${getBotBoundSessionName(b.id)}）` : b.name,
    disabled: !isBotAvailable(b.id),
  })),
])

// 选中「去添加」特殊项：重置为不绑定并弹出添加机器人弹窗
watch(selectedBot, (v) => {
  if (v === '__add__') {
    selectedBot.value = ''
    showBotAddDialog.value = true
  }
})

function onBotAdded(botId: string) {
  showBotAddDialog.value = false
  selectedBot.value = botId
  pushToast({ level: 'info', source: 'bot', message: '已添加机器人，将绑定到新会话' })
}

function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.shiftKey) return
  e.preventDefault()
  onSubmit()
}

async function onPick() {
  try {
    const dir = await PickDirectory()
    if (dir) workdir.value = dir
  } catch {}
}

function onSubmit() {
  if (!prompt.value.trim() || props.loading) return
  emit('create', workdir.value.trim(), prompt.value.trim(), [], selectedBot.value || undefined, agent.value)
}
</script>

<style scoped>
.quick-launch {
  display: flex; flex-direction: column; gap: 10px;
  padding: 2px;
}
.ql-agent { width: auto; min-width: 150px; max-width: 210px; flex-shrink: 0; }
.ql-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  color: var(--text-primary); font-size: var(--fs-body); font-family: inherit;
  resize: none; line-height: 1.5;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ql-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft-bg); }
.ql-input::placeholder { color: var(--text-tertiary); }
.ql-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ql-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ql-dir {
  display: flex; align-items: center; gap: 6px; max-width: 200px;
  padding: 6px 10px; border-radius: var(--radius-md);
  border: none; background: transparent;
  color: var(--text-secondary); font-size: var(--fs-body-sm); cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.ql-dir:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.ql-dir-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ql-chevron { color: var(--text-tertiary); flex-shrink: 0; }
.ql-bot-wrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ql-bot-label { font-size: var(--fs-caption); color: var(--text-secondary); font-weight: 600; flex-shrink: 0; white-space: nowrap; }
.ql-bot { max-width: 160px; }
.ql-send {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%;
  border: none; background: var(--accent);
  color: var(--text-inverse); display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: filter 0.15s, transform 0.1s;
}
.ql-send:hover:not(:disabled) { filter: brightness(1.06); }
.ql-send:active:not(:disabled) { transform: scale(0.97); }
.ql-send:disabled { opacity: 0.45; cursor: not-allowed; }
.ql-spinner {
  width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--text-inverse); border-radius: 50%;
  animation: ql-spin 0.75s linear infinite;
}
@keyframes ql-spin { to { transform: rotate(360deg); } }
/* reset.css 在系统「减少动态效果」时会把所有动画压成 0.01ms/1 次，
   loading 转圈是状态反馈动画，仍需保持旋转，故在此豁免 */
@media (prefers-reduced-motion: reduce) {
  .ql-spinner {
    animation: ql-spin 0.75s linear infinite !important;
  }
}
</style>
