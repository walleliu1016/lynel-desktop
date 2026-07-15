<template>
  <div class="tip" :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }" @mouseenter="$emit('mouseenter')" @mouseleave="$emit('mouseleave')">
    <div class="section">
      <div class="label">Session ID</div>
      <div class="mono-value">{{ meta.id }}</div>
    </div>
    <div class="section">
      <div class="label">Project</div>
      <div class="value">{{ meta.project || meta.workdir }}</div>
    </div>
    <div class="section">
      <div class="label">工作目录</div>
      <div class="value">{{ meta.workdir }}</div>
    </div>
    <div class="divider" />
    <div class="section" v-if="meta.user_title">
      <div class="label">用户标题</div>
      <div class="value">{{ meta.user_title }}</div>
    </div>
    <div class="section" v-if="meta.ai_title">
      <div class="label">AI 标题</div>
      <div class="value">{{ meta.ai_title }}</div>
    </div>
    <div class="section">
      <div class="label">首条提示</div>
      <div class="value">{{ meta.first_prompt?.slice(0, 80) || '-' }}{{ (meta.first_prompt?.length || 0) > 80 ? '…' : '' }}</div>
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
import { computed } from 'vue'
import type { SessionMeta } from '../types/session'

const props = defineProps<{ meta: SessionMeta; anchor: { x: number; y: number } }>()
defineEmits<{ (e: 'mouseenter'): void; (e: 'mouseleave'): void }>()

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
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  min-width: 320px;
  max-width: 400px;
  z-index: 1000;
  box-shadow: var(--shadow-window);
}
.section { margin-bottom: 8px; }
.section:last-child { margin-bottom: 0; }
.label {
  font-size: 9px; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px;
}
.value {
  font-size: 11px; color: var(--text-primary);
  line-height: 1.4; word-break: break-all;
}
.mono-value {
  font-size: 10px; font-family: var(--font-mono);
  color: var(--accent-light); word-break: break-all; line-height: 1.4;
}
.divider {
  border-top: 1px solid var(--border); margin: 10px 0;
}
.stats {
  display: flex; gap: 16px;
}
.stat {
  display: flex; flex-direction: column; gap: 1px;
}
.stat-v { font-size: 12px; color: var(--text-primary); font-weight: 500; }
.stat-k { font-size: 9px; color: var(--text-tertiary); }
</style>
