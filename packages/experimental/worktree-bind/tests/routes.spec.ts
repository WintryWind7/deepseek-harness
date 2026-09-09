import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { promptText, worktreeVariable } from '../src/prompt.ts'
import {
  handleClear, handleCreate, handleSelect, handleState, lostReason, materializeBinding,
  restoreBinding, type RouteDeps,
} from '../src/routes.ts'
import { markerDir, markerPath, writeMarker } from '../src/markers.ts'
import { worktreeSlot } from '../src/git.ts'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout.trim()
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worktree-bind-routes-'))
  await git(root, ['init'])
  await git(root, ['config', 'user.email', 'bind@example.com'])
  await git(root, ['config', 'user.name', 'Worktree Bind'])
  await writeFile(join(root, 'README.md'), 'one\n', 'utf8')
  await git(root, ['add', 'README.md'])
  await git(root, ['commit', '-m', 'first'])
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') await git(root, ['branch', '-M', 'main'])
  return root
}

function deps(cwd: string): RouteDeps {
  return { store: new Map(), restored: new Map(), cwdOf: id => id === 's1' ? cwd : undefined }
}

describe('promptText', () => {
  it('names the worktree path and branch', () => {
    const text = promptText({ path: 'D:/repo/.dsh/worktrees/feat', branch: 'feat' })
    expect(text).toContain('D:/repo/.dsh/worktrees/feat')
    expect(text).toContain('feat')
    expect(promptText({ path: '/x', branch: null })).toContain('detached HEAD')
  })

  it('leaves {{worktree}} empty for main and master', () => {
    expect(worktreeVariable(undefined)).toBe('')
    expect(worktreeVariable({ path: 'D:/repo', branch: 'main' })).toBe('')
    expect(worktreeVariable({ path: 'D:/repo', branch: 'master' })).toBe('')
    expect(worktreeVariable({ path: 'D:/repo/.dsh/worktrees/feat', branch: 'feat' })).toContain('feat')
  })
})

describe('routes', () => {
  it('creates, lists, selects, and clears a session binding', async () => {
    const cwd = await initRepo()
    const d = deps(cwd)
    expect((await handleState(d, undefined)).error).toMatch(/sessionId/)
    expect((await handleState(d, 'missing')).error).toMatch(/cwd/)
    const created = await handleCreate(d, 's1', 'feat/one')
    expect(created.ok).toBe(true)
    expect(created.selected).toEqual({
      path: worktreeSlot(cwd, 'feat/one'),
      branch: 'feat/one',
      pending: 'create',
    })
    expect((await handleState(d, 's1')).branches.some(branch => branch.name === 'feat/one')).toBe(false)
    const materialized = await materializeBinding(cwd, created.selected!)
    expect(materialized.pending).toBeUndefined()
    expect(materialized.branch).toBe('feat/one')
    const again = await materializeBinding(cwd, {
      path: worktreeSlot(cwd, 'feat/one'),
      branch: 'feat/one',
      pending: 'create',
    })
    expect(again.branch).toBe('feat/one')
    expect((await handleState(d, 's1')).branches.some(branch => branch.name === 'feat/one')).toBe(true)
    expect(await handleSelect(d, 's1', 'main', { current: true })).toMatchObject({
      ok: true,
      selected: { path: cwd, branch: 'main' },
    })
    expect(await handleClear(d, 's1')).toEqual({ ok: true, selected: null })
    expect((await handleState(d, 's1')).selected).toBeNull()
  })

  it('rejects illegal names and missing sessions on mutations', async () => {
    const cwd = await initRepo()
    const d = deps(cwd)
    expect((await handleCreate(d, 's1', '-bad')).ok).toBe(false)
    expect((await handleSelect(d, 's1', '')).ok).toBe(false)
    expect((await handleSelect(d, 'nope', 'main')).ok).toBe(false)
    expect((await handleClear(d, '')).ok).toBe(false)
    expect((await handleSelect(d, 's1', 'later')).ok).toBe(true)
    expect((await handleSelect(d, 's1', 'main', { worktreePath: cwd })).selected).toEqual({
      path: cwd,
      branch: 'main',
    })
    expect(await materializeBinding(cwd, { path: cwd, branch: 'main' })).toEqual({
      path: cwd,
      branch: 'main',
    })
  })

  it('rejects bind mutations after the conversation has started', async () => {
    const cwd = await initRepo()
    const d = { ...deps(cwd), started: () => true }
    expect((await handleCreate(d, 's1', 'feat/late')).ok).toBe(false)
    expect((await handleSelect(d, 's1', 'main')).ok).toBe(false)
    expect((await handleClear(d, 's1')).ok).toBe(false)
  })
})

describe('markers', () => {
  it('persists a binding and restores it into a fresh store', async () => {
    const cwd = await initRepo()
    const d = deps(cwd)
    await handleCreate(d, 's1', 'feat/persist')
    expect(existsSync(markerPath(cwd, 's1'))).toBe(true)
    const fresh = deps(cwd)
    expect(fresh.store.has('s1')).toBe(false)
    expect(restoreBinding(fresh, 's1', cwd)).toBe('restored')
    expect(fresh.store.get('s1')).toMatchObject({ branch: 'feat/persist', pending: 'create' })
    expect(restoreBinding(fresh, 's1', cwd)).toBe('restored')
    expect((await handleState(fresh, 's1')).selected?.branch).toBe('feat/persist')
    expect((await handleState(deps(cwd), 's2')).selected).toBeNull()
  })

  it('keeps an unfulfilled pending binding restorable before the worktree exists', async () => {
    const cwd = await initRepo()
    const d = deps(cwd)
    await handleSelect(d, 's1', 'main')
    const fresh = deps(cwd)
    expect(existsSync(worktreeSlot(cwd, 'main'))).toBe(false)
    expect(restoreBinding(fresh, 's1', cwd)).toBe('restored')
    expect(fresh.store.get('s1')?.pending).toBe('ensure')
  })

  it('reports a materialized binding as lost when the worktree path is gone', async () => {
    const cwd = await initRepo()
    const d = deps(cwd)
    const created = await handleCreate(d, 's1', 'feat/lost')
    const materialized = await materializeBinding(cwd, created.selected!)
    await writeMarker(cwd, 's1', materialized)
    await rm(worktreeSlot(cwd, 'feat/lost'), { recursive: true, force: true })
    const fresh = deps(cwd)
    expect(restoreBinding(fresh, 's1', cwd)).toBe('lost')
    expect(fresh.store.has('s1')).toBe(false)
    expect(lostReason(fresh, 's1')).toContain('feat/lost')
    const state = await handleState(fresh, 's1')
    expect(state.selected).toBeNull()
    expect(state.error).toContain('feat/lost')
  })

  it('downgrades a restored binding when the worktree branch drifted', async () => {
    const cwd = await initRepo()
    const d = deps(cwd)
    const created = await handleCreate(d, 's1', 'feat/drift')
    const materialized = await materializeBinding(cwd, created.selected!)
    await writeMarker(cwd, 's1', materialized)
    await git(worktreeSlot(cwd, 'feat/drift'), ['switch', '-c', 'feat/other'])
    const fresh = deps(cwd)
    expect(restoreBinding(fresh, 's1', cwd)).toBe('restored')
    await expect.poll(() => restoreBinding(fresh, 's1', cwd)).toBe('lost')
    expect(fresh.store.has('s1')).toBe(false)
    expect(lostReason(fresh, 's1')).toContain('feat/other')
  })

  it('treats a corrupt marker as lost and lets clear remove it', async () => {
    const cwd = await initRepo()
    await mkdir(markerDir(cwd), { recursive: true })
    await writeFile(markerPath(cwd, 's1'), 'not json', 'utf8')
    const d = deps(cwd)
    expect(restoreBinding(d, 's1', cwd)).toBe('lost')
    expect(lostReason(d, 's1')).toContain('损坏')
    expect((await handleClear(d, 's1')).ok).toBe(true)
    expect(existsSync(markerPath(cwd, 's1'))).toBe(false)
    expect(restoreBinding(deps(cwd), 's1', cwd)).toBe('unbound')
  })
})
