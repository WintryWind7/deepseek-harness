import { describe, expect, it } from 'vitest'
import * as entry from '../src/index.ts'

describe('worktree-bind-web-profile', () => {
  it('loads the empty entry', () => {
    expect(Object.keys(entry)).toEqual([])
  })
})
