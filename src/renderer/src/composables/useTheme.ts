import { ref, type Ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'lynel-desktop-theme'
export const themeMode = ref<ThemeMode>('system') as Ref<ThemeMode>
let media: MediaQueryList | null = null
let onMedia: ((e: MediaQueryListEvent) => void) | null = null

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}
function apply() {
  document.documentElement.setAttribute('data-theme', resolve(themeMode.value))
}
function bindListener() {
  unbindListener()
  if (themeMode.value !== 'system' || typeof window === 'undefined') return
  media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null
  if (!media) return
  onMedia = () => apply()
  media.addEventListener('change', onMedia)
}
function unbindListener() {
  if (media && onMedia) media.removeEventListener('change', onMedia)
  media = null
  onMedia = null
}
export function initTheme(): void {
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch {}
  themeMode.value = (saved === 'light' || saved === 'dark' || saved === 'system') ? saved : 'system'
  apply()
  bindListener()
}
export function getThemeMode(): ThemeMode { return themeMode.value }
export function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
  try { localStorage.setItem(KEY, mode) } catch {}
  apply()
  bindListener()
}
