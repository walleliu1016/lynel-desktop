<template>
  <div class="system-pane">
    <div v-for="(s, i) in system" :key="i" class="block">
      <div class="h">
        <span>{{ s.label }}</span>
        <span class="tags">
          <span v-if="s.cache" class="tag cache">cache 1h</span>
          <span class="copy-btn" title="复制" @click="copyText(s.text)">copy</span>
        </span>
      </div>
      <Markdown :text="s.text" />
    </div>
    <div v-if="!system.length" class="empty">暂无系统提示</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Markdown from '../Markdown.vue'
import { ClipboardWrite } from '../../../composables/useElectron'

const props = defineProps<{ detail: any }>()
const system = computed(() => {
  const list = props.detail?.request?.body?.system || []
  return list.map((s: any, i: number) => ({
    label: `system[${i}]`,
    text: s.text || '',
    cache: !!s.cache_control,
  }))
})

function copyText(text: string) {
  void ClipboardWrite(text)
}
</script>

<style scoped>
.system-pane { padding: 12px; overflow: auto; }
.block {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.h {
  padding: 6px 12px;
  background: var(--bg-input);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
.tag {
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-family: var(--font-mono);
}
.tag.cache { background: var(--status-warn); color: var(--bg-primary); }
.copy-btn { cursor: pointer; font-size: 10px; color: var(--accent); opacity: 0.6; transition: opacity 120ms; margin-left: 8px; }
.copy-btn:hover { opacity: 1; }
.tags { display: flex; align-items: center; }
.empty { padding: 20px; text-align: center; color: var(--text-tertiary); }
</style>
