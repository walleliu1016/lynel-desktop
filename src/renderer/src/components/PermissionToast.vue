<template>
  <div v-if="visible" class="permission-overlay">
    <div class="permission-box">
      <small class="permission-label">需要你的授权</small>
      <h3 class="permission-title">{{ displayTitle }}</h3>
      <p class="permission-desc">{{ displayDesc }}</p>
      <div class="permission-meta">
        <div class="meta-row">
          <span>工具</span>
          <b>{{ toolName || 'Unknown' }}</b>
        </div>
        <div v-if="command" class="meta-row">
          <span>命令</span>
          <b>{{ command }}</b>
        </div>
        <div class="meta-row">
          <span>影响范围</span>
          <b>{{ impactScope }}</b>
        </div>
      </div>
      <div class="permission-actions">
        <button class="perm-deny" @click.stop="onDeny">拒绝</button>
        <button class="perm-allow" @click.stop="onAllow">允许</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ResolvePermission } from '../composables/useElectron'

const props = defineProps<{
  toolName: string
  toolInput?: Record<string, unknown>
  sessionId: string
  requestId: string
}>()

const emit = defineEmits<{
  (e: 'navigate', sessionId: string): void
}>()

const visible = ref(false)

watch(() => props.toolName, (name) => {
  visible.value = !!name
}, { immediate: true })

const displayTitle = computed(() => {
  if (props.toolName === 'Bash') return '执行 Bash 命令'
  if (props.toolName === 'Read') return '读取文件'
  if (props.toolName === 'Write') return '写入文件'
  if (props.toolName === 'Edit') return '编辑文件'
  if (props.toolName === 'MultiEdit') return '批量编辑文件'
  return `调用 ${props.toolName || '工具'}`
})

const command = computed(() => {
  const input = props.toolInput
  if (!input || typeof input !== 'object') return ''
  return String(input.command || input.file_path || input.pattern || input.url || input.query || '')
})

const displayDesc = computed(() => {
  if (props.toolName === 'Bash') return '将执行系统命令，可能修改当前项目文件或访问网络。'
  if (['Read', 'Write', 'Edit', 'MultiEdit'].includes(props.toolName)) return '将访问或修改当前项目内的文件。'
  return 'Claude 请求执行此工具，请确认是否允许。'
})

const impactScope = computed(() => '当前项目')

function onAllow() {
  if (props.requestId) {
    try { ResolvePermission(props.requestId, 'allow', 'main-window') } catch {}
  }
  visible.value = false
}

function onDeny() {
  if (props.requestId) {
    try { ResolvePermission(props.requestId, 'deny', 'main-window') } catch {}
  }
  visible.value = false
}
</script>

<style scoped>
.permission-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(13, 19, 33, 0.65);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.permission-box {
  width: min(440px, calc(100% - 40px));
  padding: 20px;
  border-radius: 16px;
  background: var(--bg-panel);
  border: 1px solid var(--status-error-soft);
  box-shadow: 0 25px 80px rgba(13, 24, 41, 0.28);
}
.permission-label {
  display: block;
  margin-bottom: 8px;
  color: var(--status-error);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.3px;
}
.permission-title {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--text-primary);
}
.permission-desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.permission-meta {
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--bg-primary);
  margin-bottom: 16px;
}
.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
}
.meta-row:first-child { margin-top: 0; }
.meta-row span { font-size: 11px; color: var(--text-tertiary); }
.meta-row b {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 600;
  text-align: right;
  word-break: break-all;
}
.permission-actions {
  display: flex;
  gap: 8px;
}
.permission-actions button {
  flex: 1;
  height: 38px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.perm-allow {
  border: none;
  background: var(--accent);
  color: white;
}
.perm-allow:hover { background: var(--accent-deep); }
.perm-deny {
  border: 1px solid var(--status-error);
  background: transparent;
  color: var(--status-error);
}
.perm-deny:hover { background: var(--status-error-soft); }
</style>
