<template>
  <form class="quick-launch" @submit.prevent="onSubmit">
    <div class="ql-top">
      <AgentSelect v-model="agent" class="ql-agent" />
    </div>
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
        <button type="button" class="ql-dir" :title="workdir || '未选择，使用默认目录'" :disabled="loading" @click="onPick">
          <Icon name="folder-open" :size="13" />
          <span class="ql-dir-text">{{ workdir || '默认目录' }}</span>
          <Icon name="chevron-down" :size="11" class="ql-chevron" />
        </button>
        <select class="ql-bot" v-model="selectedBot" :disabled="loading">
          <option value="">不绑定</option>
          <option v-for="b in botOptions" :key="b.id" :value="b.id" :disabled="!isBotAvailable(b.id)">
            {{ b.name }}{{ getBotBoundSessionName(b.id) ? `（已绑定 ${getBotBoundSessionName(b.id)}）` : '' }}
          </option>
        </select>
      </div>
      <button type="submit" class="ql-send" :disabled="!prompt.trim() || loading">
        <span v-if="loading" class="ql-spinner" />
        <Icon v-else name="send" :size="14" />
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import AgentSelect from './AgentSelect.vue'
import { agentMeta, type AgentKind } from '../types/agents'
import { PickDirectory } from '../composables/useElectron'
import { useBotsStore } from '../stores/bots'
import { useSessionsStore } from '../stores/sessions'

const props = defineProps<{ loading?: boolean }>()
const emit = defineEmits<{
  (e: 'create', workdir: string, prompt: string, extraArgs: string[], botId?: string, agent?: AgentKind): void
}>()

const workdir = ref('')
const prompt = ref('')
const agent = ref<AgentKind>('claude')
const selectedBot = ref('')

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
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  padding: 10px 12px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.quick-launch:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft-bg);
}
.ql-top { display: flex; }
.ql-agent { width: auto; min-width: 140px; padding: 6px 10px; font-size: 12px; }
.ql-input {
  width: 100%; border: none; outline: none; background: transparent;
  color: var(--text-primary); font-size: 14px; font-family: inherit;
  resize: none; line-height: 1.5;
}
.ql-input::placeholder { color: var(--text-tertiary); }
.ql-bottom { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ql-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ql-dir {
  display: flex; align-items: center; gap: 6px; max-width: 200px;
  padding: 5px 10px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-panel);
  color: var(--text-secondary); font-size: 12px; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.ql-dir:hover:not(:disabled) { border-color: var(--accent); color: var(--text-primary); }
.ql-dir-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ql-chevron { color: var(--text-tertiary); flex-shrink: 0; }
.ql-bot {
  max-width: 160px; padding: 5px 8px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg-panel);
  color: var(--text-primary); font-size: 12px; font-family: inherit;
}
.ql-bot:focus { outline: none; border-color: var(--accent); }
.ql-send {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%;
  border: none; background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  color: var(--text-inverse); display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: filter 0.15s;
}
.ql-send:hover:not(:disabled) { filter: brightness(1.08); }
.ql-send:disabled { opacity: 0.45; cursor: not-allowed; }
.ql-spinner {
  width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--text-inverse); border-radius: 50%;
  animation: ql-spin 0.75s linear infinite;
}
@keyframes ql-spin { to { transform: rotate(360deg); } }
</style>
