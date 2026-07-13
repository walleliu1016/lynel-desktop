import { ref } from 'vue'

const visible = ref(false)
const message = ref('')
const type = ref<'success' | 'error'>('success')
let timer: ReturnType<typeof setTimeout> | null = null

export function showToast(msg: string, kind: 'success' | 'error' = 'success', duration = 2000) {
  message.value = msg
  type.value = kind
  visible.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    visible.value = false
  }, duration)
}

export function useToastState() {
  return { visible, message, type }
}
