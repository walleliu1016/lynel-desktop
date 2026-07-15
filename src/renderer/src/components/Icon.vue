<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  FileText,
  FolderOpen,
  MessageSquare,
  Minus,
  Plus,
  Send,
  Settings,
  Square,
  Trash2,
  User,
  X,
  Zap,
} from '@lucide/vue'

const props = defineProps<{
  name: string
  size?: number
  strokeWidth?: number
}>()

const icons: Record<string, unknown> = {
  minimize: Minus,
  maximize: Square,
  restore: Copy,
  close: X,
  back: ArrowLeft,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  plus: Plus,
  trash: Trash2,
  warning: AlertTriangle,
  user: User,
  zap: Zap,
  settings: Settings,
  cloud: Cloud,
  bot: Bot,
  'message-square': MessageSquare,
  send: Send,
  'file-text': FileText,
  'folder-open': FolderOpen,
}

const Comp = computed(() => icons[props.name] ?? null)
</script>

<template>
  <component
    :is="Comp"
    v-if="Comp"
    :size="size ?? 16"
    :stroke-width="strokeWidth ?? 2"
  />
</template>
