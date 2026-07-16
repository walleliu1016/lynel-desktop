<template>
  <div class="welcome-tab">
    <div class="card">
      <div class="brand">
        <div class="brand-name">
          <span class="brand-lynel">Lynel</span>
          <span class="brand-desktop">Desktop</span>
        </div>
        <button class="guide-btn" @click="$emit('guide')">
          <Icon name="help" :size="15" />
          <span>使用指南</span>
        </button>
      </div>
      <div class="start-section">
        <div class="section-title">Start</div>
        <button class="open-folder" @click="$emit('create')">
          <Icon name="plus" :size="16" />
          <span>Open Folder...</span>
        </button>
      </div>
      <div class="recent-section">
        <div class="section-header">
          <div class="section-title">Recent Sessions</div>
          <span v-if="recent.recentSessions.length" class="count">{{ recent.recentSessions.length }}</span>
        </div>
        <div v-if="recent.loading" class="loading">加载中...</div>
        <RecentSessionList
          v-else
          :list="recent.recentSessions"
          :limit="6"
          @select="$emit('open-recent', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import Icon from './Icon.vue'
import RecentSessionList from './RecentSessionList.vue'
import { useRecentStore } from '../stores/recent'
import type { RecentSession } from '../types/recent'

const recent = useRecentStore()

defineEmits<{
  create: []
  guide: []
  'open-recent': [item: RecentSession]
}>()

onMounted(() => {
  void recent.loadRecentSessions()
})
</script>

<style scoped>
.welcome-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  padding: 24px;
  min-height: 0;
  overflow: auto;
}
.card {
  width: min(520px, 100%);
  max-height: min(720px, calc(100% - 48px));
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
  padding: 28px 28px 22px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.brand-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 20px;
  font-weight: 700;
}
.brand-lynel { color: var(--accent); }
.brand-desktop { color: var(--status-error); font-weight: 500; }
.start-section { margin-bottom: 22px; }
.recent-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.open-folder {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.open-folder:hover {
  border-color: var(--accent);
  background: var(--accent-soft-bg);
  color: var(--accent);
}
.guide-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--text-inverse);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.guide-btn:hover { background: var(--accent-deep); }
.count {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft-bg);
  color: var(--accent);
}
.loading {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
