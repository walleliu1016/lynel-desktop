<!-- 单条工具调用的 StepCard：默认折叠成一行，靠 tname + summ 辨认「这步在干嘛」。
     Edit / Write 的 diff 是任务的核心产出 → 默认展开。
     左侧竖条按 tool_use.id 的色相着色（useIdHue），同一 id 的卡片颜色一致。 -->
<template>
  <div
    class="step-wrap"
    :class="{ err: item.status === 'error' }"
    :style="{ borderLeftColor: hueColor(item.id) }"
  >
    <div class="step" @click="open = !open">
      <Icon :name="open ? 'chevron-down' : 'chevron-right'" :size="12" class="cv" />
      <span class="tname">{{ item.name }}</span>
      <span class="summ">{{ item.summary }}</span>
      <span v-if="item.delta" class="delta">
        <span class="diff-add">+{{ item.delta.add }}</span>
        <span class="diff-del">−{{ item.delta.del }}</span>
      </span>
      <span class="stt" :class="'st-' + item.status">
        <Icon :name="statusIcon" :size="12" />{{ statusLabel }}
      </span>
    </div>
    <div v-if="open" class="open">
      <div class="io"><pre>{{ inputText }}</pre></div>
      <div v-if="item.output !== undefined" class="io">
        <pre v-if="isDiff" v-html="diffHtml" />
        <pre v-else>{{ item.output }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../Icon.vue'
import { hueColor } from '../../composables/useIdHue'
import type { StreamItem } from '../../types/tasks'

const props = defineProps<{ item: Extract<StreamItem, { kind: 'tool' }> }>()

const STATUS: Record<string, { icon: string; label: string }> = {
  ok: { icon: 'check', label: '成功' },
  // Icon.vue 未注册 `alert`，失败态统一用 `warning`（AlertTriangle）
  error: { icon: 'warning', label: '失败' },
  running: { icon: 'loader', label: '运行中' },
}

/** Edit / Write 的 diff 是任务的核心产出 → 默认展开 */
const isDiffTool = computed(() => props.item.name === 'Edit' || props.item.name === 'Write')
const open = ref(isDiffTool.value)
const statusIcon = computed(() => STATUS[props.item.status]?.icon ?? 'clock')
const statusLabel = computed(() => STATUS[props.item.status]?.label ?? props.item.status)
const inputText = computed(() => JSON.stringify(props.item.input, null, 2))
const isDiff = computed(() => isDiffTool.value && typeof props.item.output === 'string')

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const diffHtml = computed(() => {
  const raw = props.item.input
  const oldS = typeof raw.old_string === 'string' ? raw.old_string : ''
  const newS = typeof raw.new_string === 'string' ? raw.new_string : ''
  const del = oldS ? oldS.split('\n').map((l) => `<span class="diff-del">−${esc(l)}</span>`).join('\n') : ''
  const add = newS ? newS.split('\n').map((l) => `<span class="diff-add">+${esc(l)}</span>`).join('\n') : ''
  if (oldS || newS) return [del, add].filter(Boolean).join('\n')
  return esc(typeof props.item.input.content === 'string' ? props.item.input.content : '')
})
</script>

<style scoped>
/* 工具 StepCard：默认折叠成一行 */
.step-wrap {
  border: 1px solid var(--border); border-left-width: 3px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  margin: 3px 0 6px; background: var(--bg-card); overflow: hidden;
}
.step-wrap.err { border-color: var(--status-error); }
.step-wrap.err > .step { background: var(--status-error-soft); }
.step {
  display: flex; align-items: center; gap: 8px; padding: 5px 10px;
  cursor: pointer; font-size: var(--fs-caption);
}
.step:hover { background: var(--bg-hover); }
.step .cv { color: var(--text-tertiary); flex: none; }
.step .tname {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-primary); font-weight: 500; flex: none;
}
.step .summ {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}
.step .stt {
  flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 10px;
}
.step .delta {
  flex: none; display: inline-flex; gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px;
}
.step-wrap > .open { border-top: 1px solid var(--border); padding: 8px 10px; }

.io {
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 8px 10px;
}
.io + .io { margin-top: 6px; }
.io pre {
  margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  color: var(--text-primary);
}
.diff-del { color: var(--status-error); }
.diff-add { color: var(--status-success); }
.st-ok { color: var(--status-success); }
.st-error { color: var(--status-error); }
.st-running { color: var(--accent); }
</style>
