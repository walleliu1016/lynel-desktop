/** 把 ISO 8601 时间格式化成相对时间（「3 小时前」这类）。
 *
 *  超过 30 天改为直接显示日期：继续按天数算下去只会得到「89 天前」这种
 *  读不出时间感的值。解析失败返回空串，调用方原样渲染即可。
 *
 *  提交历史与行内 blame 共用这一份实现，避免两处口径漂移。 */
export function formatRelTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const minutes = Math.floor((Date.now() - t) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}
