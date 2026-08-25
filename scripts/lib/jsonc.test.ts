import { describe, expect, it } from 'vitest'
import { parseJsonc, stripJsonc } from './jsonc'

describe('parseJsonc', () => {
  it('行コメントと末尾カンマを含む設定を解析する', () => {
    const source = `{
      // wrangler の設定例
      "name": "cc-api",
      "d1_databases": [
        {
          "binding": "DB",
          "migrations_dir": "../../infrastructure/migrations",
        },
      ],
    }`

    expect(parseJsonc(source)).toEqual({
      name: 'cc-api',
      d1_databases: [{ binding: 'DB', migrations_dir: '../../infrastructure/migrations' }],
    })
  })

  it('ブロックコメントを除去する', () => {
    expect(parseJsonc('{ /* 注記 */ "a": 1 }')).toEqual({ a: 1 })
  })

  it('文字列リテラル内のコメント記号を保持する', () => {
    const source = '{ "issuer": "https://auth.example.com", "glob": "/* not a comment */" }'

    expect(parseJsonc(source)).toEqual({
      issuer: 'https://auth.example.com',
      glob: '/* not a comment */',
    })
  })

  it('エスケープされた引用符をまたいで文字列を終了しない', () => {
    const source = '{ "quoted": "say \\"hi\\" // still string", "next": 1 }'

    expect(parseJsonc(source)).toEqual({ quoted: 'say "hi" // still string', next: 1 })
  })

  it('文字列内の末尾カンマ相当の並びを削除しない', () => {
    expect(parseJsonc('{ "a": "value, ", "b": [1, 2,] }')).toEqual({ a: 'value, ', b: [1, 2] })
  })

  it('stripJsonc は素の JSON を変更しない', () => {
    const source = '{"a":1,"b":[2,3]}'

    expect(stripJsonc(source)).toBe(source)
  })
})
