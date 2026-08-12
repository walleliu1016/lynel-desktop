<template>
  <div class="tip" :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }" @mouseenter="$emit('mouseenter')" @mouseleave="onMouseLeave" @contextmenu.stop="onCtx">
    <div class="agent-row" v-if="meta.agent">
      <AgentBadge :agent="meta.agent" size="sm" />
      <span class="agent-name">{{ agentMeta(meta.agent).label }}</span>
    </div>
    <div class="line" v-if="botName">
      <span class="k">绑定 Bot</span>
      <span class="v" :title="botName">{{ botName }}</span>
    </div>
    <div class="line">
      <span class="k">SessionID</span>
      <span class="v mono" :title="meta.id">{{ meta.id }}</span>
    </div>
    <div class="line">
      <span class="k">项目</span>
      <span class="v" :title="meta.project || meta.workdir">{{ meta.project || meta.workdir }}</span>
    </div>
    <div class="line">
      <span class="k">工作目录</span>
      <span class="v" :title="meta.workdir">{{ meta.workdir }}</span>
    </div>
    <div class="divider" />
    <div class="line" v-if="meta.user_title">
      <span class="k">用户标题</span>
      <span class="v" :title="meta.user_title">{{ meta.user_title }}</span>
    </div>
    <div class="line" v-if="meta.ai_title">
      <span class="k">AI 标题</span>
      <span class="v" :title="meta.ai_title">{{ meta.ai_title }}</span>
    </div>
    <div class="line">
      <span class="k">首条提示</span>
      <span class="v" :title="meta.first_prompt || ''">{{ meta.first_prompt?.trim() || '-' }}</span>
    </div>
    <div class="divider" />
    <div class="stats">
      <div class="stat">
        <span class="stat-v">{{ meta.msg_count }}</span>
        <span class="stat-k">消息</span>
      </div>
      <div class="stat">
        <span class="stat-v">{{ formatSize }}</span>
        <span class="stat-k">大小</span>
      </div>
      <div class="stat">
        <span class="stat-v">{{ formatDate }}</span>
        <span class="stat-k">创建</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentBadge from './AgentBadge.vue'
import { agentMeta } from '../types/agents'
import { useSessionsStore } from '../stores/sessions'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ meta: SessionMeta; anchor: { x: number; y: number } }>()

const sessions = useSessionsStore()
const botName = computed(() => sessions.getSessionBotName(props.meta.id))
const emit = defineEmits<{ (e: 'mouseenter'): void; (e: 'mouseleave'): void }>()

const ctxOpen = ref(false)

function onCtx() {
  ctxOpen.value = true
  setTimeout(() => { ctxOpen.value = false }, 3000)
}

function onMouseLeave() {
  if (ctxOpen.value) return
  emit('mouseleave')
}

const formatDate = computed(() => {
  const d = new Date(props.meta.mtime * 1000)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
})
const formatSize = computed(() => {
  const s = props.meta.size
  if (s < 1024) return `${s} B`
  if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB`
  return `${(s / 1024 / 1024).toFixed(2)} MB`
})
</script>

<style scoped>
.tip {
  position: fixed;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  min-width: 300px;
  max-width: 400px;
  z-index: 1000;
  box-shadow: var(--shadow-window);
  color: var(--text-primary);
}
.agent-row {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 8px;
}
.agent-name {
  font-size: var(--fs-body); font-weight: 600; color: var(--text-primary);
}
.line {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0;
  font-size: var(--fs-body-sm);
}
.k {
  flex-shrink: 0; width: 68px;
  font-size: var(--fs-caption); color: var(--text-tertiary);
  white-space: nowrap;
}
.k::after { content: ':'; }
.v {
  flex: 1; min-width: 0;
  color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.v.mono {
  font-family: var(--font-mono); color: var(--accent);
}
.divider {
  border-top: 1px solid var(--border); margin: 8px 0;
}
.stats {
  display: flex; gap: 20px; padding-top: 2px;
}
.stat {
  display: flex; flex-direction: column; gap: 1px;
}
.stat-v { font-size: var(--fs-body-sm); color: var(--text-primary); font-weight: 500; }
.stat-k { font-size: 9px; color: var(--text-tertiary); }
</style>
