/**
 * wrangler.jsonc など JSONC 形式の設定ファイルを読み取るための最小パーサ。
 * 文字列リテラル内のコメント記号・カンマを誤検出しないようトークン単位で走査する。
 */
export const stripJsonc = (source: string): string => {
  let result = ''
  let index = 0
  let inString = false

  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]

    if (inString) {
      // エスケープ列は 2 文字まとめて transfer し、閉じ引用符の誤判定を防ぐ
      if (char === '\\') {
        result += char + (next ?? '')
        index += 2
        continue
      }
      if (char === '"') inString = false
      result += char
      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      index += 1
      continue
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }

    result += char
    index += 1
  }

  // 末尾カンマ（オブジェクト・配列の閉じ括弧直前）を除去する
  return result.replace(/,(?=\s*[}\]])/g, '')
}

export const parseJsonc = <T>(source: string): T => JSON.parse(stripJsonc(source)) as T

export const readJsoncFile = async <T>(path: string): Promise<T> =>
  parseJsonc<T>(await Bun.file(path).text())
