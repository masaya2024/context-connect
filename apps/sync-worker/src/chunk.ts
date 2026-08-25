export interface TextChunk {
  ordinal: number
  text: string
  tokenEstimate: number
}

export function chunkText(content: string, maxChars = 1800, overlapChars = 200): TextChunk[] {
  if (!content.trim()) return []
  if (maxChars < 100 || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('Invalid chunk configuration')
  }
  const chunks: TextChunk[] = []
  let start = 0
  while (start < content.length) {
    let end = Math.min(content.length, start + maxChars)
    if (end < content.length) {
      const paragraph = content.lastIndexOf('\n\n', end)
      const line = content.lastIndexOf('\n', end)
      const boundary = Math.max(paragraph, line)
      if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary
    }
    const text = content.slice(start, end).trim()
    if (text)
      chunks.push({ ordinal: chunks.length, text, tokenEstimate: Math.ceil(text.length / 4) })
    if (end >= content.length) break
    start = Math.max(start + 1, end - overlapChars)
  }
  return chunks
}
