import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearBinding, createBranch, loadState, selectBranch } from '../src/client/api.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('worktree-bind client api', () => {
  it('parses state and mutation envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/state')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cwd: 'D:/p', selected: null, branches: [], error: null }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, selected: { path: 'D:/p/wt', branch: 'feat' } }) }
    }))
    expect(await loadState('s1')).toMatchObject({ cwd: 'D:/p' })
    expect((await selectBranch('s1', 'feat')).ok).toBe(true)
    expect((await createBranch('s1', 'feat')).ok).toBe(true)
    expect((await clearBinding('s1')).ok).toBe(true)
  })

  it('maps HTTP and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/state')) return { ok: false, status: 500, json: async () => 1 }
      if (url.includes('/select')) return { ok: false, status: 400, json: async () => ({ error: 'nope' }) }
      throw new Error('offline')
    }))
    expect(await loadState('s1')).toMatchObject({ error: 'HTTP 500' })
    expect(await selectBranch('s1', 'feat')).toEqual({ ok: false, error: 'nope' })
    expect(await createBranch('s1', 'feat')).toEqual({ ok: false, error: 'offline' })
    expect(await clearBinding('s1')).toEqual({ ok: false, error: 'offline' })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw 'offline'
    }))
    expect(await selectBranch('s1', 'feat')).toEqual({ ok: false, error: 'offline' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })))
    expect(await selectBranch('s1', 'feat')).toEqual({ ok: true })
  })
})
