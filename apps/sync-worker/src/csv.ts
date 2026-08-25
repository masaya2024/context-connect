export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else quoted = false
      } else field += character
      continue
    }
    if (character === '"' && field.length === 0) quoted = true
    else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (quoted) throw new Error('Unclosed CSV quote')
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter((entry) => entry.some((value) => value.length > 0))
}

export function mapCsvRows(
  rows: string[][],
  mapping: Record<string, string>,
): Array<Record<string, string>> {
  const header = rows[0]
  if (!header) return []
  const indexes = new Map(header.map((name, index) => [name.trim(), index]))
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        Object.entries(mapping).map(([field, column]) => [
          field,
          row[indexes.get(column) ?? -1] ?? '',
        ]),
      ),
    )
}
