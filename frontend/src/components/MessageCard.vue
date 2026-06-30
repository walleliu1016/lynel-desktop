<template>
  <div class="message-card" :class="roleClass">
    <div class="message-header">
      <span class="role-label">{{ roleLabel }}</span>
      <span v-if="tsLabel" class="time">{{ tsLabel }}</span>
    </div>
    <div class="message-content">
      <template v-for="(b, i) in blocks" :key="i">
        <TextBlock v-if="b.type === 'text'" :text="b.text" />
        <ThinkingBlock v-else-if="b.type === 'thinking'" :text="b.text" />
        <ImageBlock v-else-if="b.type === 'image'" :media-type="b.mediaType" :data="b.data" />
        <ToolUseBlock v-else-if="b.type === 'tool_use'" :name="b.name" :input="b.input" />
        <ToolResultBlock
          v-else-if="b.type === 'tool_result'"
          :content="b.content"
          :is-error="b.isError"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// 复刻参考实现的 .message 容器。
// role: 'user' (蓝)/ 'assistant' (灰白) / 'tool-reply' (黄—— tool_result 单独成行时)
// blocks 数组交给各子组件分发渲染。
import { computed } from 'vue'
import type { ContentBlock } from '../types/blocks'
import TextBlock from './blocks/TextBlock.vue'
import ThinkingBlock from './blocks/ThinkingBlock.vue'
import ImageBlock from './blocks/ImageBlock.vue'
import ToolUseBlock from './blocks/ToolUseBlock.vue'
import ToolResultBlock from './blocks/ToolResultBlock.vue'

const props = defineProps<{
  role: 'user' | 'assistant' | 'tool-reply'
  ts?: number
  blocks: ContentBlock[]
}>()

const roleLabel = computed(() => ({
  user: '你',
  assistant: 'Claude',
  'tool-reply': '工具',
}[props.role]))

const roleClass = computed(() => props.role)

const tsLabel = computed(() => {
  if (!props.ts) return ''
  return new Date(props.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})
</script>

<style scoped>
.message-card {
  margin: 8px 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: var(--message-card-shadow);
}
.message-card.user {
  background: var(--user-bg);
  border-left: 3px solid var(--user-border);
}
.message-card.assistant {
  background: var(--assistant-card-bg);
  border-left: 3px solid var(--border);
}
.message-card.tool-reply {
  background: var(--tool-reply-bg);
  border-left: 3px solid var(--tool-reply-border);
}
.message-card.tool-reply .role-label { color: var(--tool-reply-header); }

.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 11px;
  border-bottom: 1px solid var(--border);
}
.role-label {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
}
.message-card.user .role-label { color: var(--user-border); }
.time { color: var(--text-tertiary); font-size: 10px; }

.message-content { padding: 8px 12px; font-size: 13px; line-height: 1.6; }
</style>
