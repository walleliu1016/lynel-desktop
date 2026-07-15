<template>
  <div class="welcome-sidebar">
    <button class="new-btn" @click="$emit('create')">+ 打开 Session</button>
    <div class="search">搜索会话...</div>
    <div class="section-title">最近会话</div>
    <div v-if="recent.loading" class="loading">加载中...</div>
    <RecentSessionList
      v-else
      :list="recent.recentSessions"
      :limit="6"
      @select="$emit('open-recent', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import RecentSessionList from './RecentSessionList.vue'
import { useRecentStore } from '../stores/recent'
import type { RecentSession } from '../types/recent'

const recent = useRecentStore()

defineEmits<{
  create: []
  'open-recent': [item: RecentSession]
}>()

onMounted(() => {
  void recent.loadRecentSessions()
})
</script>

<style scoped>
.welcome-sidebar {
  display: flex;
  flex-direction: column;
  padding: 16px;
  min-height: 0;
  overflow: hidden;
}
.new-btn {
  background: var(--accent);
  color: white;
  border: none;
  padding: 10px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
  cursor: pointer;
}
.search {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}
.section-title {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  padding-left: 4px;
}
.loading {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
