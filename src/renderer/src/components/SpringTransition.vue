<template>
  <Transition :css="false" appear @enter="onEnter" @leave="onLeave">
    <slot />
  </Transition>
</template>

<script setup lang="ts">
import { useSpring } from '../composables/useSpring'
const { animateTo } = useSpring()
function onEnter(el: Element, done: () => void) {
  const e = el as HTMLElement
  e.style.opacity = '0'
  e.style.transform = 'scale(0.96)'
  animateTo(e, { opacity: 1, transform: 'scale(1)' }, { onComplete: done })
}
function onLeave(el: Element, done: () => void) {
  const e = el as HTMLElement
  animateTo(e, { opacity: 0, transform: 'scale(0.96)' }, { duration: 0.25, onComplete: done })
}
</script>
