import { ref, computed } from 'vue'
import { useRecentStore } from '../stores/recent'

/**
 * 历史会话搜索：按 project / title (userTitle > firstPrompt > aiTitle) / workdir
 * 做大小写无关的子串匹配，search 为空时返回全量。
 *
 * 返回值用 ref 包装（而非 reactive 对象），方便模板里直接 v-model 绑 search.value
 * 并在插值里读 filtered.value。
 */
export function useRecentSessionSearch() {
  const recent = useRecentStore()
  const search = ref('')
  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return recent.recentSessions
    return recent.recentSessions.filter((s) => {
      const pn = s.project.toLowerCase()
      const wd = s.workdir.toLowerCase()
      const title = (s.userTitle || s.firstPrompt || s.aiTitle || '').toLowerCase()
      return pn.includes(q) || wd.includes(q) || title.includes(q)
    })
  })
  return { search, filtered }
}
