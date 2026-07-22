<template>
  <div class="response-pane">
    <div class="block">
      <div class="h">
        <span>usage</span>
        <span v-if="response?.streamed" class="tag tool">streamed</span>
      </div>
      <div v-if="usageEntries.length" class="usage-grid">
        <div v-for="e in usageEntries" :key="e.key" class="usage-item">
          <span class="uk">{{ e.label }}</span>
          <span class="uv">{{ e.value }}</span>
        </div>
      </div>
      <div v-else class="empty-row">暂无用量数据</div>
    </div>
    <div
      v-for="(b, i) in content"
      :key="i"
      :class="['block', isPaired(b) ? 'paired' : '']"
      :style="isPaired(b) && b.id ? { borderLeftColor: hueColor(b.id) } : undefined"
    >
      <div class="h">
        <span>{{ b.type === 'tool_use' ? `tool_use: ${b.name}` : b.type }}</span>
        <span class="tags">
          <span
            v-if="isPaired(b) && b.id"
            class="tag id"
            :style="{ background: hueBg(b.id), color: hueFg(b.id) }"
          >{{ String(b.id).slice(-8) }}</span>
        </span>
      </div>
      <Markdown v-if="b.type === 'text'" :text="blockText(b)" />
      <FoldingPre v-else :text="blockText(b)" />
    </div>
    <div v-if="response?.error" class="block err">
      <div class="h" style="color:var(--status-error)">error</div>
      <FoldingPre :text="JSON.stringify(response.error, null, 2)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FoldingPre from '../FoldingPre.vue'
import Markdown from '../Markdown.vue'
import { hueBg, hueColor, hueFg } from '../../../composables/useIdHue'

const props = defineProps<{ detail: any }>()
const response = computed(() => props.detail?.reassembled)
const content = computed(() => response.value?.content || [])

const USAGE_LABELS: Record<string, string> = {
  input_tokens: 'input tokens',
  output_tokens: 'output tokens',
  cache_read_input_tokens: 'cache read',
  cache_creation_input_tokens: 'cache write',
}

const usageEntries = computed(() => {
  const u = response.value?.usage
  if (!u) return []
  return Object.entries(u)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ({ key: k, label: USAGE_LABELS[k] || k, value: (v as number).toLocaleString() }))
})

function isPaired(b: any): boolean {
  return b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'skill'
}

function blockText(b: any): string {
  if (b.type === 'tool_use') return JSON.stringify(b.input, null, 2)
  if (b.type === 'thinking') return b.thinking ?? JSON.stringify(b)
  return b.text ?? JSON.stringify(b, null, 2)
}
</script>

<style scoped>
.response-pane { padding: 12px; overflow: auto; }
.block {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: 0 4px 4px 0;
}
.block.paired { border-left-width: 3px; }
.block.err { border-color: var(--status-error); }
.h {
  padding: 6px 12px;
  background: var(--bg-input);
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-mono);
}
.tags { display: flex; gap: 4px; align-items: center; }
.tag {
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-family: var(--font-mono);
}
.tag.tool { background: var(--accent); color: var(--text-inverse); }
.tag.id { letter-spacing: .3px; }
.usage-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; padding: 12px; }
.usage-item { display: flex; flex-direction: column; gap: 2px; }
.uk { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .3px; }
.uv { font-size: 14px; color: var(--text-primary); font-family: var(--font-mono); font-weight: 600; }
.empty-row { padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 12px; }
</style>
