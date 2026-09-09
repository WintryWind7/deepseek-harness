import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  createWorktree, currentBranch, ensureWorktree, GitError, listLocalBranches, listWorktrees,
  parseWorktrees, sanitizeBranchName, worktreeSlot,
} from '../src/git.ts'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout.trim()
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worktree-bind-git-'))
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

describe('sanitizeBranchName', () => {
  it('accepts a simple name and rejects illegal forms', () => {
    expect(sanitizeBranchName(' feat/x ')).toBe('feat/x')
    expect(() => sanitizeBranchName('')).toThrow(/non-empty/)
    expect(() => sanitizeBranchName('-x')).toThrow(/start with/)
    expect(() => sanitizeBranchName('a b')).toThrow(/illegal character/)
    expect(() => sanitizeBranchName('a..b')).toThrow(/illegal sequence/)
    expect(() => sanitizeBranchName('/a')).toThrow(/start or end/)
    expect(() => sanitizeBranchName('a.')).toThrow(/suffix/)
    expect(() => sanitizeBranchName('@')).toThrow(/"@"/)
    expect(() => sanitizeBranchName('a.lock')).toThrow(/suffix/)
    expect(() => sanitizeBranchName('a@{b')).toThrow(/illegal sequence/)
    expect(() => sanitizeBranchName('a//b')).toThrow(/illegal sequence/)
    expect(() => sanitizeBranchName('a/')).toThrow(/start or end/)
  })
})

describe('parseWorktrees', () => {
  it('reads porcelain entries including detached HEAD', () => {
    const entries = parseWorktrees([
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repo/.dsh/worktrees/feat',
      'HEAD def',
      'detached',
      '',
    ].join('\n'))
    expect(entries).toEqual([
      { path: '/repo', branch: 'main', main: true },
      { path: '/repo/.dsh/worktrees/feat', branch: undefined, main: false },
    ])
  })
})

describe('worktree git', () => {
  it('creates a linked worktree without moving main', async () => {
    const root = await initRepo()
    expect(await currentBranch(root)).toBe('main')
    expect(await listLocalBranches(root)).toEqual(['main'])
    const created = await createWorktree(root, 'feat/x')
    expect(created.branch).toBe('feat/x')
    expect(created.path).toBe(worktreeSlot(root, 'feat/x'))
    expect(await currentBranch(root)).toBe('main')
    expect(await currentBranch(created.path)).toBe('feat/x')
    const reused = await ensureWorktree(root, 'feat/x')
    expect(reused.branch).toBe('feat/x')
    expect(reused.main).toBe(false)
    const main = await ensureWorktree(root, 'main')
    expect(main.main).toBe(true)
    expect(main.branch).toBe('main')
    const trees = await listWorktrees(root)
    expect(trees.some(tree => tree.branch === 'feat/x')).toBe(true)
    await git(root, ['checkout', '--detach'])
    expect(await currentBranch(root)).toBeUndefined()
  })

  it('wraps a failing git invocation', async () => {
    const root = await initRepo()
    await expect(ensureWorktree(root, 'missing-branch')).rejects.toBeInstanceOf(GitError)
    expect(await listLocalBranches(root, async () => ({ stdout: '\n\n', stderr: '' }))).toEqual([])
    expect(await currentBranch(root, async () => ({ stdout: 'HEAD\n', stderr: '' }))).toBeUndefined()
  })
})
