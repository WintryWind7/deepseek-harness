import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import VerifyQueue from '../src/index.ts'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout.trim()
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'verify-queue-svc-'))
  await git(root, ['init'])
  await git(root, ['config', 'user.email', 'verify@example.com'])
  await git(root, ['config', 'user.name', 'Verify Queue'])
  await writeFile(join(root, 'README.md'), 'one\n', 'utf8')
  await git(root, ['add', 'README.md'])
  await git(root, ['commit', '-m', 'first'])
  if (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') {
    await git(root, ['branch', '-M', 'main'])
  }
  return root
}

describe('VerifyQueue', () => {
  it('records HEAD, stays recorded until merged, then accepts verify', async () => {
    const root = await repo()
    await git(root, ['checkout', '-b', 'agent/s1'])
    await writeFile(join(root, 'fix.txt'), 'x\n', 'utf8')
    await git(root, ['add', 'fix.txt'])
    await git(root, ['commit', '-m', 'fix'])
    const ctx = new Context()
    await ctx.plugin(VerifyQueue)
    const recorded = await ctx.verifyQueue.record(root, {
      title: '  nav arc  ',
      sessionId: 's1',
      commits: [],
      id: 'fixed-id',
    })
    expect(recorded.id).toBe('fixed-id')
    await ctx.verifyQueue.record(root, {
      title: 'other',
      sessionId: 's2',
      commits: [],
      id: 'other-id',
    })
    await ctx.verifyQueue.record(root, {
      title: 'nav arc 2',
      sessionId: 's1',
      commits: [],
      id: 'fixed-id',
    })
    expect(recorded.view.rows).toHaveLength(1)
    expect(recorded.view.rows[0]?.status).toBe('recorded')
    expect(recorded.view.rows[0]?.item.title).toBe('nav arc')
    await expect(ctx.verifyQueue.setVerified(root, { id: recorded.id, verified: true }))
      .rejects.toMatchObject({ code: 'verify-queue/invalid-path' })

    await git(root, ['checkout', 'main'])
    await git(root, ['merge', '--ff-only', 'agent/s1'])
    const onMain = await ctx.verifyQueue.view(root)
    expect(onMain.rows.find(row => row.item.id === recorded.id)?.status).toBe('on-main')
    const verified = await ctx.verifyQueue.setVerified(root, { id: recorded.id, verified: true })
    expect(verified.rows.find(row => row.item.id === recorded.id)?.status).toBe('verified')
    const cleared = await ctx.verifyQueue.setVerified(root, { id: recorded.id, verified: false })
    expect(cleared.rows.find(row => row.item.id === recorded.id)?.status).toBe('on-main')
  })

  it('rejects empty paths and missing items', async () => {
    const root = await repo()
    const ctx = new Context()
    await ctx.plugin(VerifyQueue)
    expect(remoteErrorOf(await ctx.verifyQueue.view('  ').catch((e: unknown) => e)))
      .toMatchObject({ code: 'verify-queue/invalid-path' })
    expect(remoteErrorOf(await ctx.verifyQueue.remove(root, 'missing').catch((e: unknown) => e)))
      .toMatchObject({ code: 'verify-queue/not-found', details: { id: 'missing' } })
    expect(remoteErrorOf(await ctx.verifyQueue.setVerified(root, { id: 'missing', verified: true })
      .catch((e: unknown) => e)))
      .toMatchObject({ code: 'verify-queue/not-found' })
    expect(remoteErrorOf(await ctx.verifyQueue.record(root, {
      title: '   ',
      sessionId: 's1',
      commits: [],
    }).catch((e: unknown) => e))).toMatchObject({ code: 'verify-queue/invalid-path' })
    expect(remoteErrorOf(await ctx.verifyQueue.record(root, {
      title: 'x',
      sessionId: '  ',
      commits: [],
    }).catch((e: unknown) => e))).toMatchObject({ code: 'verify-queue/invalid-path' })
  })

  it('pins the drawer open and remote methods match the in-process API', async () => {
    const root = await repo()
    const ctx = new Context()
    await ctx.plugin(VerifyQueue)
    const pinned = await ctx.verifyQueue.remoteSetUi(root, { open: false, pinned: true })
    expect(pinned.ui).toEqual({ open: true, pinned: true })
    const unpinned = await ctx.verifyQueue.remoteSetUi(root, { open: false, pinned: false })
    expect(unpinned.ui).toEqual({ open: false, pinned: false })
    const opened = await ctx.verifyQueue.remoteSetUi(root, { open: true, pinned: false })
    expect(opened.ui).toEqual({ open: true, pinned: false })
    const head = await git(root, ['rev-parse', 'HEAD'])
    await ctx.verifyQueue.record(root, {
      title: 'other',
      sessionId: 's2',
      commits: [head],
    })
    const { id } = await ctx.verifyQueue.record(root, {
      title: 'keep',
      sessionId: 's1',
      commits: [head],
    })
    const viewed = await ctx.verifyQueue.remoteView(root)
    expect(viewed.rows.some(row => row.item.id === id)).toBe(true)
    await ctx.verifyQueue.remoteSetVerified(root, { id, verified: true })
    const gone = await ctx.verifyQueue.remoteRemove(root, id)
    expect(gone.rows.some(row => row.item.id === id)).toBe(false)
  })
})
