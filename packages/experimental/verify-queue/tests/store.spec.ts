import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import '../src/client.ts'
import { queueDir, readItems, readUi, writeItems, writeUi } from '../src/store.ts'
import type { VerifyQueueItem } from '../src/types.ts'

const item = (id: string): VerifyQueueItem => ({
  id,
  title: `fix ${id}`,
  sessionId: 'session-1',
  commits: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  createdAt: 1,
  verifiedAt: null,
})

describe('verify-queue store', () => {
  it('round-trips items and defaults missing files to empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verify-queue-'))
    expect(await readItems(root)).toEqual([])
    await writeItems(root, [item('a')])
    expect(await readItems(root)).toEqual([item('a')])
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(queueDir(root), 'items.json'), '{"items":null}\n', 'utf8')
    expect(await readItems(root)).toEqual([])
    const raw = await readFile(join(queueDir(root), 'items.json'), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('pins force the drawer open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verify-queue-ui-'))
    expect(await readUi(root)).toEqual({ open: false, pinned: false })
    await writeUi(root, { open: false, pinned: true })
    expect(await readUi(root)).toEqual({ open: true, pinned: true })
    await writeUi(root, { open: true, pinned: false })
    expect(await readUi(root)).toEqual({ open: true, pinned: false })
    await writeUi(root, { open: false, pinned: false })
    expect(await readUi(root)).toEqual({ open: false, pinned: false })
  })

  it('treats a non-object ui file as the default and rejects unreadable items JSON', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const root = await mkdtemp(join(tmpdir(), 'verify-queue-bad-'))
    const dir = queueDir(root)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'ui.json'), 'null\n', 'utf8')
    expect(await readUi(root)).toEqual({ open: false, pinned: false })
    await writeFile(join(dir, 'items.json'), '{not-json', 'utf8')
    await expect(readItems(root)).rejects.toThrow()
  })
})
