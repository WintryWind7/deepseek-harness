import { describe, expect, it } from 'vitest'
import { autoBranchName, unboundLabel } from '../src/client/display.ts'
import type { WorktreeBindState } from '@deepseek-ai/dsh-experimental-worktree-bind/src/wire.ts'

function state(names: string[]): WorktreeBindState {
  return {
    cwd: 'D:/p',
    selected: null,
    branches: names.map(name => ({ name, worktreePath: null, current: name === names[0] })),
    error: null,
  }
}

describe('display helpers', () => {
  it('names the auto worktree after the session id', () => {
    expect(autoBranchName('session-12')).toBe('agent/session-12')
  })

  it('falls back to main, then master, then main', () => {
    expect(unboundLabel(null)).toBe('main')
    expect(unboundLabel(state(['personal', 'main']))).toBe('main')
    expect(unboundLabel(state(['master', 'personal']))).toBe('master')
    expect(unboundLabel(state(['personal']))).toBe('main')
  })
})
