<template>
  <div class="tools-pane">
    <div v-if="tools.length" class="toolbar">
      <input v-model="filter" placeholder="搜索工具..." class="tool-filter" />
      <span class="count">{{ filtered.length }} / {{ tools.length }}</span>
    </div>
    <div v-for="(t, i) in filtered" :key="i" class="block">
      <div class="h">
        <span>{{ t.name }}</span>
        <span class="copy-btn" title="复制 schema" @click="copySchema(t.schema)">copy</span>
      </div>
      <Markdown v-if="t.description" :text="t.description" />
      <FoldingPre :text="'— schema —\n' + t.schema" />
    </div>
    <div v-if="!tools.length" class="empty">暂无工具定义</div>
    <div v-else-if="!filtered.length" class="empty">无匹配工具</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import FoldingPre from '../FoldingPre.vue'
import Markdown from '../Markdown.vue'

const props = defineProps<{ detail: any }>()

const filter = ref('')

const tools = computed(() => {
  const list = props.detail?.request?.body?.tools || []
  return list.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    schema: JSON.stringify(t.input_schema || {}, null, 2),
  }))
})

const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  if (!q) return tools.value
  return tools.value.filter((t: { name: string; description: string; schema: string }) =>
    t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  )
})

function copySchema(schema: string) {
  navigator.clipboard.writeText(schema)
}
</script>

<style scoped>
.tools-pane { padding: 12px; overflow: auto; }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.tool-filter { flex: 1; padding: 6px 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 12px; font-family: var(--font-mono); }
.tool-filter:focus { outline: none; border-color: var(--accent); }
.tool-filter::placeholder { color: var(--text-tertiary); }
.count { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; font-family: var(--font-mono); }
.block {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.h {
  padding: 6px 12px;
  background: var(--bg-input);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.copy-btn {
  cursor: pointer;
  font-size: 10px;
  color: var(--accent);
  opacity: 0.6;
  transition: opacity 120ms;
  font-weight: 400;
}
.copy-btn:hover { opacity: 1; }
.tool-desc {
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
