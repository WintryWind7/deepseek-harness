import { describe, expect, it } from 'vitest'
import { buildBranchTree, filterBranches, openFoldersFor } from '../src/client/tree.ts'

describe('branch tree', () => {
  it('nests names on slash and opens ancestor folders', () => {
    expect(buildBranchTree(['main', 'feat/one', 'feat/two'])).toEqual([
      { kind: 'leaf', name: 'main', branch: 'main' },
      {
        kind: 'folder',
        name: 'feat',
        path: 'feat',
        children: [
          { kind: 'leaf', name: 'one', branch: 'feat/one' },
          { kind: 'leaf', name: 'two', branch: 'feat/two' },
        ],
      },
    ])
    expect([...openFoldersFor('feat/a/b')]).toEqual(['feat', 'feat/a'])
    expect(openFoldersFor(null).size).toBe(0)
  })

  it('filters by substring and skips empty segments', () => {
    expect(filterBranches(['main', 'feat/one'], 'FEAT')).toEqual(['feat/one'])
    expect(filterBranches(['main'], '   ')).toEqual(['main'])
    expect(buildBranchTree(['/', ''])).toEqual([])
  })
})
