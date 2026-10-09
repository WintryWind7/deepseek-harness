/**
 * Per-preset system-prompt tails used by @wintry/prompts.
 *
 * The profile directory holds one JSON document, separate from the prompt
 * library. A save replaces that document only when its revision still matches
 * the caller's. Empty text is omitted. Text is appended later by the host
 * plugin; this module only stores and validates it.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

/** Characters allowed in one stored tail, after trimming. */
export const MAX_TAIL = 20_000

const ID_PATTERN = /^[a-z][a-z0-9-]{0,79}$/

/** A tail file that has never been saved. */
export function emptyTails() {
  return { revision: 0, tails: {} }
}

/**
 * Read the tail file, treating a missing file as an empty revision 0.
 * @param file - absolute path of the profile JSON document.
 * @returns the document, or `unreadable` when the file exists but is not one.
 */
export function readTailsFileSync(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, value: emptyTails() }
    return { ok: false, error: 'unreadable' }
  }
  return parseTails(text)
}

/**
 * Read the tail file, treating a missing file as an empty revision 0.
 * @param file - absolute path of the profile JSON document.
 * @returns the document, or `unreadable` when the file exists but is not one.
 */
export async function readTailsFile(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, value: emptyTails() }
    return { ok: false, error: 'unreadable' }
  }
  return parseTails(text)
}

/**
 * Parse a tail document.
 * @param text - file contents.
 * @returns the document, or `unreadable` when the text is not one.
 */
export function parseTails(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // A hand-edited file can be truncated. Refuse it instead of saving over it.
    return { ok: false, error: 'unreadable' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'unreadable' }
  }
  if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0) {
    return { ok: false, error: 'unreadable' }
  }
  const tails = normalizeTails(parsed.tails, null)
  if (!tails.ok) return { ok: false, error: 'unreadable' }
  return { ok: true, value: { revision: parsed.revision, tails: tails.tails } }
}

/**
 * Accept a whole-document replacement at the current revision.
 * Unknown preset ids are dropped. Empty text is omitted.
 * @param current - document last read from the file.
 * @param input - request body.
 * @param knownIds - preset ids that exist right now.
 * @returns the next document, `conflict` when the revision moved, or `invalid`.
 */
export function applyTails(current, input, knownIds) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid' }
  }
  if (input.revision !== current.revision) {
    return { ok: false, error: 'conflict', revision: current.revision }
  }
  const tails = normalizeTails(input.tails, knownIds)
  if (!tails.ok) return { ok: false, error: 'invalid' }
  return { ok: true, value: { revision: current.revision + 1, tails: tails.tails } }
}

/**
 * Replace the tail file. A crash can leave a temporary file beside it.
 * @param file - absolute path of the profile JSON document.
 * @param library - the next document, already validated.
 */
export async function writeTailsFile(file, library) {
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, `${JSON.stringify(library)}\n`, 'utf8')
  try {
    await rename(temp, file)
  } catch (error) {
    const code = error && error.code
    // Windows refuses to rename onto an existing file.
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await rm(temp, { force: true })
      throw error
    }
    await rm(file, { force: true })
    try {
      await rename(temp, file)
    } catch (renameError) {
      await rm(temp, { force: true })
      throw renameError
    }
  }
}

/**
 * Whether a dumped preset plugin list makes the persona the complete prompt.
 * A block scalar is skipped, so a line inside the persona text does not count.
 * @param yaml - `readDocument` content.
 * @returns true when that preset will not show an appended tail.
 */
export function personaHidesTail(yaml) {
  if (typeof yaml !== 'string') return false
  const personaItem = /^(id:\s*persona\s*|name:\s*['"]?@deepseek-ai\/dsh-persona['"]?\s*)$/
  let personaIndent = null
  let blockFloor = null
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') continue
    const indent = line.search(/\S/)
    if (blockFloor !== null) {
      if (indent > blockFloor) continue
      blockFloor = null
    }
    const item = /^(\s*)- (.*)$/.exec(line)
    if (item) {
      const itemIndent = item[1].length
      if (personaIndent !== null && itemIndent <= personaIndent) personaIndent = null
      if (personaItem.test(item[2])) personaIndent = itemIndent
    } else if (personaIndent !== null && indent <= personaIndent) {
      personaIndent = null
    }
    if (personaIndent !== null && indent > personaIndent && /^\s*complete:\s*true\s*$/.test(line)) {
      return true
    }
    if (/:\s*[>|][+-]?\s*$/.test(line)) blockFloor = indent
  }
  return false
}

/**
 * Keep trimmed tails for known preset ids. `knownIds` null accepts every
 * well-formed id, which is how a file already on disk is read back.
 * @param value - candidate map.
 * @param knownIds - ids to keep, or null while reading a file.
 * @returns the stored map, or `invalid`.
 */
function normalizeTails(value, knownIds) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid' }
  }
  const entries = Object.entries(value)
  if (entries.length > 100) return { ok: false, error: 'invalid' }
  const tails = {}
  for (const [id, text] of entries) {
    if (!ID_PATTERN.test(id) || typeof text !== 'string') return { ok: false, error: 'invalid' }
    if (knownIds !== null && !knownIds.has(id)) continue
    const trimmed = text.trim()
    if (trimmed.length > MAX_TAIL) return { ok: false, error: 'invalid' }
    if (trimmed.length > 0) tails[id] = trimmed
  }
  const sorted = {}
  for (const id of Object.keys(tails).sort()) sorted[id] = tails[id]
  return { ok: true, tails: sorted }
}
