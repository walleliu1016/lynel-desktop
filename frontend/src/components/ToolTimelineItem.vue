<template>
  <div
    class="timeline-item"
    :class="[statusClass, { expanded }]"
    tabindex="0"
    @click="expanded = !expanded"
    @keydown.enter="expanded = !expanded"
  >
    <div class="timeline-main">
      <div class="timeline-row">
        <span class="timeline-time">{{ formatTime(item.startedAt) }}</span>
        <span class="timeline-duration">{{ durationText }}</span>
      </div>
      <div class="timeline-row">
        <span class="badge" :class="badgeClass">{{ displayType }}</span>
        <span class="timeline-detail" :title="detailText">{{ detailText }}</span>
        <span class="timeline-status" :class="statusClass">{{ statusText }}</span>
      </div>
    </div>

    <div v-if="expanded" class="timeline-expanded" @click.stop
    >
      <div class="detail-header">
        <div class="detail-title-row"
          ><span class="badge" :class="badgeClass">{{ displayType }}</span><span class="detail-title">{{ item.name }}</span></div>
        <span class="detail-sub">{{ statusText }} · {{ durationText }}</span>
      </div>
      <div class="detail-meta">
        <div class="meta-row"
          ><span class="meta-label">开始</span><span class="meta-value">{{ formatDateTime(item.startedAt) }}</span></div>
        <div class="meta-row"
          ><span class="meta-label">结束</span><span class="meta-value">{{ formatDateTime(item.endedAt) }}</span></div>
        <div v-if="item.exitCode !== 0" class="meta-row"
          ><span class="meta-label">退出码</span><span class="meta-value error">{{ item.exitCode }}</span></div>
      </div>
      <div v-if="formattedInput" class="detail-section"
      >
        <div class="detail-label">{{ inputLabel }}</div>
        <pre>{{ formattedInput }}</pre>
      </div>
      <div v-if="formattedOutput" class="detail-section"
      >
        <div class="detail-label">输出</div>
        <pre>{{ formattedOutput }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolExecution } from '../types/session'

const props = defineProps<{ item: ToolExecution }>()

const expanded = ref(false)

const statusClass = computed(() => {
  if (props.item.status === 'running') return 'running'
  if (props.item.status === 'error') return 'error'
  return 'success'
})

const displayType = computed(() => {
  if (props.item.kind === 'llm') return 'LLM'
  return props.item.name
})

const inputLabel = computed(() => '输入')

const detailText = computed(() => {
  if (props.item.kind === 'llm') {
    return props.item.output || '生成回复'
  }
  return props.item.input || ''
})

const badgeClass = computed(() => {
  const name = props.item.name
  if (props.item.kind === 'llm') return 'badge-llm'
  if (name === 'Bash') return 'badge-bash'
  if (name === 'Read') return 'badge-read'
  if (name === 'Write' || name === 'MultiEdit') return 'badge-write'
  if (name === 'Edit') return 'badge-edit'
  if (name === 'Glob' || name === 'Grep') return 'badge-search'
  if (name === 'WebFetch' || name === 'WebSearch') return 'badge-web'
  if (name === 'Skill') return 'badge-skill'
  if (name === 'TodoWrite') return 'badge-todo'
  return 'badge-default'
})

const statusText = computed(() => {
  switch (props.item.status) {
    case 'running': return '运行中'
    case 'error': return '失败'
    case 'success': return '完成'
    default: return props.item.status
  }
})

const durationText = computed(() => {
  const ms = props.item.durationMs
  if (ms <= 0) {
    return props.item.status === 'running' ? '' : '0ms'
  }
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return rs > 0 ? `${m}m${rs}s` : `${m}m`
})

function formatMixedJson(s: string): string {
  if (!s) return ''
  try {
    const parsed = JSON.parse(s)
    return JSON.stringify(parsed, null, 2)
  } catch {
    // 混合文本：逐行尝试 JSON 格式化
    return s.split('\n').map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      try {
        const parsed = JSON.parse(trimmed)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return line
      }
    }).join('\n')
  }
}

const formattedInput = computed(() => formatMixedJson(props.item.input))
const formattedOutput = computed(() => formatMixedJson(props.item.output))

function formatTime(ts: number): string {
  if (!ts) return '--:--:--'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDateTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() &&
                  d.getMonth() === now.getMonth() &&
                  d.getDate() === now.getDate()
  const time = d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (sameDay) return time
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}
</script>

<style scoped>
.timeline-item {
  position: relative;
  padding: 7px 10px 7px 26px;
  margin: 4px 0;
  border-radius: var(--radius-md);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
  outline: none;
}
.timeline-item:hover,
.timeline-item:focus {
  background: var(--timeline-item-hover-bg);
}
.timeline-item.error {
  background: rgba(251, 113, 133, 0.16);
}
.timeline-item.error:hover,
.timeline-item.error:focus {
  background: rgba(251, 113, 133, 0.22);
}
.timeline-item::before {
  content: "";
  position: absolute;
  left: 10px;
  top: 11px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--status-success);
}
.timeline-item.running::before {
  background: var(--status-warn);
  animation: pulse 1.2s ease-in-out infinite;
}
.timeline-item.error::before {
  background: var(--status-error);
}
.timeline-item.llm::before {
  background: var(--accent);
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.timeline-item::after {
  content: "";
  position: absolute;
  left: 12px;
  top: 18px;
  bottom: -8px;
  width: 1px;
  background: var(--border);
}
.timeline-item:last-child::after {
  display: none;
}
.timeline-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.timeline-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.timeline-row:first-child {
  justify-content: space-between;
}
.timeline-time {
  color: var(--text-tertiary);
  font-size: 10px;
  font-family: var(--font-mono);
}
.timeline-detail {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.timeline-status {
  font-size: 10px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.timeline-status.running { color: var(--status-warn); }
.timeline-status.error { color: var(--status-error); }
.timeline-status.success { color: var(--status-success); }
.timeline-duration {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}
.timeline-expanded {
  margin-top: 8px;
  padding: 10px;
  background: var(--bg-input);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
  cursor: default;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.detail-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.detail-title {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-sub {
  color: var(--text-tertiary);
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}
.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.meta-label {
  color: var(--text-tertiary);
  font-size: 10px;
  flex-shrink: 0;
  width: 44px;
}
.meta-value {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.meta-value.error { color: var(--status-error); }
.detail-section {
  margin-top: 8px;
}
.detail-label {
  color: var(--text-tertiary);
  font-size: 10px;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.timeline-expanded pre {
  margin: 0;
  padding: 8px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
}
.timeline-expanded pre::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.timeline-expanded pre::-webkit-scrollbar-track {
  background: transparent;
}
.timeline-expanded pre::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 3px;
}
.timeline-expanded pre::-webkit-scrollbar-thumb:hover {
  background: #52525b;
}
.badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 9px;
  font-weight: 600;
  flex-shrink: 0;
}
.badge-bash { background: rgba(52, 211, 153, 0.12); color: #34D399; }
.badge-read { background: rgba(96, 165, 250, 0.12); color: #60A5FA; }
.badge-write { background: rgba(251, 191, 36, 0.12); color: #FBBF24; }
.badge-edit { background: rgba(251, 146, 60, 0.12); color: #FB923C; }
.badge-search { background: rgba(167, 139, 250, 0.12); color: #A78BFA; }
.badge-web { background: rgba(56, 189, 248, 0.12); color: #38BDF8; }
.badge-skill { background: rgba(139, 92, 246, 0.12); color: #C4B5FD; }
.badge-todo { background: rgba(132, 204, 22, 0.12); color: #A3E635; }
.badge-llm { background: rgba(139, 92, 246, 0.14); color: #C4B5FD; }
.badge-default { background: rgba(161, 161, 170, 0.12); color: var(--text-secondary); }
</style>
