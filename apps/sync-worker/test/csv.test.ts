import { describe, expect, it } from 'vitest'
import { mapCsvRows, parseCsv } from '../src/csv'

describe('CSV ingestion', () => {
  it('supports BOM, quoted commas, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('\uFEFFID,件名,説明\r\n1,"請求, 修正","a\n""b"""\r\n')
    expect(rows).toEqual([
      ['ID', '件名', '説明'],
      ['1', '請求, 修正', 'a\n"b"'],
    ])
    expect(mapCsvRows(rows, { external_id: 'ID', title: '件名' })).toEqual([
      { external_id: '1', title: '請求, 修正' },
    ])
  })
})
