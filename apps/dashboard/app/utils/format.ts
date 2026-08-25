export const formatRelativeTime = (value: string, now = Date.now()): string => {
  const delta = Math.max(0, now - new Date(value).getTime())
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  return `${Math.floor(hours / 24)}日前`
}
