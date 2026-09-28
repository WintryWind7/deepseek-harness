import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  MAX_BODY,
  MAX_PROMPTS,
  applyReplacement,
  emptyLibrary,
  parseLibrary,
  readLibraryFile,
  writeLibraryFile,
} from './library.js'

const prompt = { id: 'alpha', title: 'Title', body: 'Body' }

test('a missing file is an empty library', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-library-'))
  try {
    const read = await readLibraryFile(join(dir, 'prompt-library.json'))
    assert.deepEqual(read, { ok: true, value: emptyLibrary() })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a save round-trips and the next save must carry the new revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-library-'))
  const file = join(dir, 'prompt-library.json')
  try {
    const first = applyReplacement(emptyLibrary(), { revision: 0, prompts: [{ ...prompt, title: '  Title  ' }] })
    assert.equal(first.ok, true)
    assert.equal(first.value.revision, 1)
    assert.equal(first.value.prompts[0].title, 'Title')
    await writeLibraryFile(file, first.value)
    const read = await readLibraryFile(file)
    assert.deepEqual(read, { ok: true, value: first.value })

    const stale = applyReplacement(first.value, { revision: 0, prompts: [] })
    assert.deepEqual(stale, { ok: false, error: 'conflict', revision: 1 })
    const second = applyReplacement(first.value, { revision: 1, prompts: [] })
    assert.equal(second.ok, true)
    assert.equal(second.value.revision, 2)
    await writeLibraryFile(file, second.value)
    const emptied = await readLibraryFile(file)
    assert.deepEqual(emptied.value.prompts, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a truncated file is unreadable and is not treated as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-library-'))
  const file = join(dir, 'prompt-library.json')
  try {
    await writeFile(file, '{', 'utf8')
    const read = await readLibraryFile(file)
    assert.deepEqual(read, { ok: false, error: 'unreadable' })
    assert.equal(parseLibrary('[]').ok, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects an empty title, a duplicate id, an oversized list, and an oversized body', () => {
  const current = emptyLibrary()
  assert.equal(applyReplacement(current, { revision: 0, prompts: [{ ...prompt, title: '   ' }] }).error, 'invalid')
  assert.equal(applyReplacement(current, {
    revision: 0,
    prompts: [prompt, { ...prompt, title: 'Other' }],
  }).error, 'invalid')
  assert.equal(applyReplacement(current, {
    revision: 0,
    prompts: Array.from({ length: MAX_PROMPTS + 1 }, (_item, index) => ({ ...prompt, id: `id${index}` })),
  }).error, 'invalid')
  assert.equal(applyReplacement(current, {
    revision: 0,
    prompts: [{ ...prompt, body: 'x'.repeat(MAX_BODY + 1) }],
  }).error, 'invalid')
  assert.equal(applyReplacement(current, { revision: 0, prompts: [{ ...prompt, id: 'has space' }] }).error, 'invalid')
})
