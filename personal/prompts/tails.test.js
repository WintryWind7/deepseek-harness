import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  MAX_TAIL,
  applyTails,
  emptyTails,
  parseTails,
  personaHidesTail,
  readTailsFile,
  writeTailsFile,
} from './tails.js'

const known = new Set(['main-dev', 'minimal'])

test('a missing file is an empty tail document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-tails-'))
  try {
    const read = await readTailsFile(join(dir, 'prompt-tails.json'))
    assert.deepEqual(read, { ok: true, value: emptyTails() })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a save trims, drops empty and unknown ids, and requires the new revision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-tails-'))
  const file = join(dir, 'prompt-tails.json')
  try {
    const first = applyTails(emptyTails(), {
      revision: 0,
      tails: {
        'main-dev': '  回复保持简短。  ',
        'minimal': '   ',
        'gone': '丢弃',
      },
    }, known)
    assert.equal(first.ok, true)
    assert.equal(first.value.revision, 1)
    assert.deepEqual(first.value.tails, { 'main-dev': '回复保持简短。' })
    await writeTailsFile(file, first.value)
    const read = await readTailsFile(file)
    assert.deepEqual(read, { ok: true, value: first.value })

    const stale = applyTails(first.value, { revision: 0, tails: {} }, known)
    assert.deepEqual(stale, { ok: false, error: 'conflict', revision: 1 })
    const second = applyTails(first.value, { revision: 1, tails: {} }, known)
    assert.equal(second.ok, true)
    assert.deepEqual(second.value.tails, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a truncated file is unreadable and is not treated as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-tails-'))
  const file = join(dir, 'prompt-tails.json')
  try {
    await writeFile(file, '{', 'utf8')
    const read = await readTailsFile(file)
    assert.deepEqual(read, { ok: false, error: 'unreadable' })
    assert.equal(parseTails('[]').ok, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects a bad id, a non-string, and an oversized tail', () => {
  const current = emptyTails()
  assert.equal(applyTails(current, { revision: 0, tails: { 'Has Space': 'x' } }, known).error, 'invalid')
  assert.equal(applyTails(current, { revision: 0, tails: { 'main-dev': 1 } }, known).error, 'invalid')
  assert.equal(applyTails(current, {
    revision: 0,
    tails: { 'main-dev': 'x'.repeat(MAX_TAIL + 1) },
  }, known).error, 'invalid')
  assert.equal(applyTails(current, { revision: 0, tails: null }, known).error, 'invalid')
})

test('persona complete is the persona key, not a line inside the prompt text', () => {
  assert.equal(personaHidesTail(`- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    complete: true
- id: other
  name: other
`), true)
  assert.equal(personaHidesTail(`- name: '@deepseek-ai/dsh-persona'
  config:
    complete: true
`), true)
  assert.equal(personaHidesTail(`- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: |-
      complete: true
    suffix: ''
- id: other
  name: other
  config:
    complete: true
`), false)
  assert.equal(personaHidesTail(`- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: You are a coding agent.
`), false)
})
