<template>
  <div class="headers-pane">
    <div class="block">
      <div class="h">
        <span>request headers</span>
        <span class="copy-btn" title="复制全部" @click="copyHeaders(reqHeaders)">copy</span>
      </div>
      <table v-if="Object.keys(reqHeaders).length" class="headers-table">
        <tr v-for="(val, key) in reqHeaders" :key="key">
          <td class="key">{{ key }}</td>
          <td class="val">{{ String(val) }}</td>
        </tr>
      </table>
      <div v-else class="empty-row">暂无请求头</div>
    </div>
    <div class="block">
      <div class="h">
        <span>response headers</span>
        <span class="copy-btn" title="复制全部" @click="copyHeaders(resHeaders)">copy</span>
      </div>
      <table v-if="Object.keys(resHeaders).length" class="headers-table">
        <tr v-for="(val, key) in resHeaders" :key="key">
          <td class="key">{{ key }}</td>
          <td class="val">{{ String(val) }}</td>
        </tr>
      </table>
      <div v-else class="empty-row">暂无响应头</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ClipboardWrite } from '../../../composables/useElectron'

const props = defineProps<{ detail: any }>()

const reqHeaders = computed<Record<string, unknown>>(() => {
  return props.detail?.request?.headers || {}
})

const resHeaders = computed<Record<string, unknown>>(() => {
  return props.detail?.response?.headers || {}
})

function copyHeaders(obj: Record<string, unknown>) {
  const text = JSON.stringify(obj, null, 2)
  void ClipboardWrite(text)
}
</script>

<style scoped>
.headers-pane { padding: 12px; overflow: auto; }
.block {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.h {
  padding: 6px 12px;
  background: var(--bg-input);
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
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
}
.copy-btn:hover { opacity: 1; }
.headers-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.headers-table td {
  padding: 4px 8px;
  font-family: var(--font-mono);
  vertical-align: top;
}
.headers-table tr:nth-child(even) { background: var(--bg-input); }
.key {
  color: var(--accent);
  white-space: nowrap;
  width: 1%;
  font-size: 11px;
}
.val {
  word-break: break-all;
  color: var(--text-primary);
  font-size: 11px;
}
.empty-row {
  padding: 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}
</style>
