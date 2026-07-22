<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BotMessageSquare,
  Link2Off,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleQuestionMark,
  Cloud,
  Copy,
  CornerDownLeft,
  Expand,
  FileText,
  FolderOpen,
  Loader2,
  MessageSquare,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Shrink,
  Smartphone,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  User,
  Wrench,
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
  help: CircleQuestionMark,
  settings: Settings,
  cloud: Cloud,
  bot: Bot,
  'bot-message-square': BotMessageSquare,
  'message-square': MessageSquare,
  send: Send,
  'file-text': FileText,
  'folder-open': FolderOpen,
  loader: Loader2,
  terminal: Terminal,
  'shield-alert': ShieldAlert,
  pencil: Pencil,
  smartphone: Smartphone,
  sparkles: Sparkles,
  wrench: Wrench,
  puzzle: Puzzle,
  'corner-down-left': CornerDownLeft,
  'refresh-cw': RefreshCw,
  search: Search,
  square: Square,
  'link-2-off': Link2Off,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'panel-right-close': PanelRightClose,
  'panel-right-open': PanelRightOpen,
  expand: Expand,
  shrink: Shrink,
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
