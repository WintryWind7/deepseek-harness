/**
 * Prompt library file used by dsh-prompt-library.
 *
 * The profile directory holds one JSON document. A save replaces that document
 * only when its revision still matches the caller's, so the composer panel and
 * the settings page cannot silently overwrite each other.
 */
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'

/** Prompts kept in one library. */
export const MAX_PROMPTS = 200
/** Characters allowed in one stored title, after trimming. */
export const MAX_TITLE = 200
/** Characters allowed in one stored body. */
export const MAX_BODY = 100_000

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/

/** A library that has never been saved. */
export function emptyLibrary() {
  return { revision: 0, prompts: [] }
}

/**
 * Read the library, treating a missing file as an empty revision 0.
 * @param file - absolute path of the profile JSON document.
 * @returns the library, or `unreadable` when the file exists but is not a library.
 */
export async function readLibraryFile(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, value: emptyLibrary() }
    return { ok: false, error: 'unreadable' }
  }
  return parseLibrary(text)
}

/**
 * Parse a library document.
 * @param text - file contents.
 * @returns the library, or `unreadable` when the text is not one.
 */
export function parseLibrary(text) {
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
  const prompts = normalizePrompts(parsed.prompts)
  if (!prompts.ok) return { ok: false, error: 'unreadable' }
  return { ok: true, value: { revision: parsed.revision, prompts: prompts.prompts } }
}

/**
 * Accept a whole-library replacement at the current revision.
 * @param current - library last read from the file.
 * @param input - request body.
 * @returns the next library, `conflict` when the revision moved, or `invalid`.
 */
export function applyReplacement(current, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'invalid' }
  }
  if (input.revision !== current.revision) {
    return { ok: false, error: 'conflict', revision: current.revision }
  }
  const prompts = normalizePrompts(input.prompts)
  if (!prompts.ok) return { ok: false, error: 'invalid' }
  return { ok: true, value: { revision: current.revision + 1, prompts: prompts.prompts } }
}

/**
 * Replace the library file. A crash can leave a temporary file beside it.
 * @param file - absolute path of the profile JSON document.
 * @param library - the next library, already validated.
 */
export async function writeLibraryFile(file, library) {
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
 * Keep only id, trimmed title, and body. The whole list is rejected when any
 * item is missing, too long, or repeats an id.
 * @param value - candidate prompt array.
 * @returns the stored prompts, or `invalid`.
 */
function normalizePrompts(value) {
  if (!Array.isArray(value) || value.length > MAX_PROMPTS) return { ok: false, error: 'invalid' }
  const seen = new Set()
  const prompts = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'invalid' }
    if (typeof item.id !== 'string' || !ID_PATTERN.test(item.id) || seen.has(item.id)) {
      return { ok: false, error: 'invalid' }
    }
    if (typeof item.title !== 'string' || typeof item.body !== 'string') return { ok: false, error: 'invalid' }
    const title = item.title.trim()
    if (title.length === 0 || title.length > MAX_TITLE || item.body.length > MAX_BODY) {
      return { ok: false, error: 'invalid' }
    }
    seen.add(item.id)
    prompts.push({ id: item.id, title, body: item.body })
  }
  return { ok: true, prompts }
}
