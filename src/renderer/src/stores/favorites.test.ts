// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFavoritesStore, type FavoriteSession } from './favorites'
import { useSessionsStore } from './sessions'

function mkFav(sessionId = 's-1'): FavoriteSession {
  return {
    sessionId,
    workdir: '/p1',
    project: 'p1',
    aiTitle: '旧 AI 标题',
    firstPrompt: '旧首条',
    userTitle: undefined,
    lastOpenedAt: Date.now(),
    favoritedAt: Date.now(),
    state: 'idle',
  }
}

describe('favorites store 标题联动', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('applySessionTitle(user) 更新收藏项 userTitle', () => {
    const favs = useFavoritesStore()
    favs.favorites.push(mkFav())
    favs.applySessionTitle('s-1', '用户改名', 'user')
    expect(favs.favorites[0].userTitle).toBe('用户改名')
  })

  it('applySessionTitle(ai/first_prompt) 更新对应字段', () => {
    const favs = useFavoritesStore()
    favs.favorites.push(mkFav())
    favs.applySessionTitle('s-1', 'AI 新标题', 'ai')
    expect(favs.favorites[0].aiTitle).toBe('AI 新标题')
    favs.applySessionTitle('s-1', '首条新文案', 'first_prompt')
    expect(favs.favorites[0].firstPrompt).toBe('首条新文案')
  })

  it('未知 sessionId 不报错、不改列表', () => {
    const favs = useFavoritesStore()
    favs.favorites.push(mkFav())
    favs.applySessionTitle('missing', '新名', 'user')
    expect(favs.favorites[0].userTitle).toBeUndefined()
  })

  it('sessions.applyTitleChange 联动收藏夹（改会话名后收藏夹同步）', () => {
    const sessions = useSessionsStore()
    const favs = useFavoritesStore()
    favs.favorites.push(mkFav('s-1'))
    sessions.list = [{ id: 's-1', workdir: '/p1', project: 'p1', mtime: 1, msg_count: 0, first_prompt: '', ai_title: '', size: 0 }] as any
    sessions.applyTitleChange('s-1', '新名', 'user')
    expect(favs.favorites[0].userTitle).toBe('新名')
    // 会话列表项同样更新
    expect(sessions.list[0].user_title).toBe('新名')
  })
})
