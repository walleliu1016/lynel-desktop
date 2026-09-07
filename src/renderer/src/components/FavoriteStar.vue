<template>
  <button
    class="fav-star"
    :class="{ active }"
    :aria-label="active ? '取消收藏' : '收藏会话'"
    :title="active ? '取消收藏' : '收藏会话'"
    @click.stop="$emit('toggle')"
  >
    <Icon name="star" :size="size" :fill="active" />
  </button>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'
import { computed } from 'vue'
import { useFavoritesStore } from '../stores/favorites'

const props = withDefaults(defineProps<{ sessionId: string; size?: number }>(), { size: 13 })
const emit = defineEmits<{ (e: 'toggle'): void }>()

const favorites = useFavoritesStore()
const active = computed(() => favorites.isFavorite(props.sessionId))
</script>

<style scoped>
.fav-star {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: 6px;
  color: var(--text-tertiary); cursor: pointer; flex-shrink: 0;
  padding: 0;
}
.fav-star:hover { background: var(--bg-input); color: var(--text-primary); }
.fav-star.active { color: var(--accent); }
</style>
