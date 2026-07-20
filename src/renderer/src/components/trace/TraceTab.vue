<template>
  <div class="trace-tab">
    <TraceHeader
      :stats="trace.stats"
      :models="trace.availableModels"
      :model-filter="trace.modelFilter"
      :errors-only="trace.errorsOnly"
      @update:model-filter="(v: string) => (trace.modelFilter = v)"
      @update:errors-only="(v: boolean) => (trace.errorsOnly = v)"
      @reload="trace.load()"
    />
    <div class="trace-body">
      <RequestList
        :requests="trace.filteredRequests"
        :selected-seq="trace.selectedSeq"
        :picks="trace.picks"
        @select="(seq: number) => trace.select(seq)"
        @pick="(seq: number) => trace.togglePick(seq)"
      />
      <RequestDetailPane
        :detail="trace.detail"
        :diff-result="trace.diffResult"
        @export="(format) => exportDetail(format)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useTraceStore } from '../../stores/trace'
import TraceHeader from './TraceHeader.vue'
import RequestList from './RequestList.vue'
import RequestDetailPane from './RequestDetailPane.vue'

const props = defineProps<{
  workDir: string
  sessionId: string
}>()

const trace = useTraceStore()

onMounted(() => {
  trace.setSession(props.workDir, props.sessionId)
  trace.load()
})

watch(() => props.sessionId, (sid) => {
  if (sid) {
    trace.setSession(props.workDir, sid)
    trace.load()
  }
})

async function exportDetail(format: 'raw' | 'md' | 'json' | 'har') {
  if (trace.selectedSeq == null) return
  const text = await trace.exportRequest(trace.selectedSeq, format)
  if (text) {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trace-${trace.sessionId.slice(0, 8)}-${String(trace.selectedSeq).padStart(4, '0')}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }
}
</script>

<style scoped>
.trace-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.trace-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
</style>
