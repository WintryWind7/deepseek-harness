import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { commitsOnMain, resolveCommit, resolveSessionHead } from '../src/git.ts'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout.trim()
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'verify-queue-git-'))
  await git(root, ['init'])
  await git(root, ['config', 'user.email', 'verify@example.com'])
  await git(root, ['config', 'user.name', 'Verify Queue'])
  await writeFile(join(root, 'README.md'), 'one\n', 'utf8')
  await git(root, ['add', 'README.md'])
  await git(root, ['commit', '-m', 'first'])
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') await git(root, ['branch', '-M', 'main'])
  return root
}

describe('verify-queue git', () => {
  it('treats a commit as on main only after it is reachable from main', async () => {
    const root = await initRepo()
    const first = await resolveCommit(root, 'HEAD')
    expect(await commitsOnMain(root, [])).toBe(false)
    expect(await commitsOnMain(root, [first])).toBe(true)
    await git(root, ['checkout', '-b', 'agent/session-1'])
    await writeFile(join(root, 'fix.txt'), 'x\n', 'utf8')
    await git(root, ['add', 'fix.txt'])
    await git(root, ['commit', '-m', 'fix'])
    const fix = await resolveCommit(root, 'HEAD')
    expect(await commitsOnMain(root, [fix])).toBe(false)
    await git(root, ['checkout', 'main'])
    await git(root, ['merge', '--ff-only', 'agent/session-1'])
    expect(await commitsOnMain(root, [fix])).toBe(true)
  })

  it('reads HEAD from the session worktree when that directory exists', async () => {
    const root = await initRepo()
    const mainHead = await resolveCommit(root, 'HEAD')
    const worktree = join(root, '.dsh', 'worktrees', 'session-abc')
    await mkdir(join(root, '.dsh', 'worktrees'), { recursive: true })
    await git(root, ['worktree', 'add', '-b', 'agent/session-abc', worktree])
    await writeFile(join(worktree, 'fix.txt'), 'y\n', 'utf8')
    await git(worktree, ['add', 'fix.txt'])
    await git(worktree, ['commit', '-m', 'worktree fix'])
    const wtHead = await resolveSessionHead(root, 'session-abc')
    expect(wtHead).not.toBe(mainHead)
    expect(await resolveSessionHead(root, 'missing-session')).toBe(mainHead)
  })

  it('rejects a rev-parse that does not return a SHA', async () => {
    const root = await initRepo()
    await expect(resolveCommit(root, 'HEAD', async () => ({ stdout: 'not-a-sha\n', stderr: '' })))
      .rejects.toThrow(/did not return a SHA/)
  })

  it('rejects a missing commit and a repo without main or master', async () => {
    const root = await initRepo()
    await expect(resolveCommit(root, 'no-such-rev')).rejects.toThrow()
    await git(root, ['branch', '-M', 'develop'])
    const first = await resolveCommit(root, 'HEAD')
    await expect(commitsOnMain(root, [first])).rejects.toThrow(/neither refs\/heads\/main/)
  })
})
