<!-- Tab → 组件 的**唯一**映射。
     设置有两个入口（登录页的 SettingsDialog 弹窗、登录后 HomeView 的 SettingsTab 标签页），
     它们共享 SettingsTabs 的菜单，但内容映射曾经各写一份 —— 加「定时任务」时就漏掉了登录后那个。
     两处都改成渲染本组件，菜单项（SettingsTabs.tabs）加一个就自动到处都有。 -->
<template>
  <GeneralTab v-if="active === 'general'" />
  <AppearanceTab v-else-if="active === 'appearance'" />
  <TasksTab v-else-if="active === 'tasks'" />
  <BuddyTab v-else-if="active === 'buddy'" />
  <CloudTab v-else-if="active === 'cloud'" />
  <ProviderTab v-else-if="active === 'provider'" />
  <BotManagement v-else-if="active === 'bot'" />
  <UpdaterTab v-else-if="active === 'updater'" />
</template>

<script setup lang="ts">
import GeneralTab from './settings/GeneralTab.vue'
import AppearanceTab from './settings/AppearanceTab.vue'
import TasksTab from './settings/TasksTab.vue'
import BuddyTab from './settings/BuddyTab.vue'
import CloudTab from './settings/CloudTab.vue'
import ProviderTab from './settings/ProviderTab.vue'
import BotManagement from './settings/BotManagement.vue'
import UpdaterTab from './settings/UpdaterTab.vue'
import type { Tab } from './SettingsTabs.vue'

defineProps<{ active: Tab }>()
</script>
