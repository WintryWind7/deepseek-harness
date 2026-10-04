/**
 * Host half of @wintry/prompts.
 *
 * Publishes one authenticated route for the prompt library stored in the
 * current profile directory. The browser half is discovered from package.json
 * `dsh.client` and `exports["./client"]`; this module never imports it.
 */
import { join } from 'node:path'
import { applyReplacement, readLibraryFile, writeLibraryFile } from './library.js'

/** Absolute route path. Connection authenticates every request it dispatches. */
const LIBRARY_PATH = '/api/prompt.library'
/** File name inside the profile directory. The prompts are not part of the repo. */
const FILE_NAME = 'prompt-library.json'

let tail = Promise.resolve()

/**
 * Run library writes one at a time inside this process.
 * @param task - the write to run after the previous one settles.
 * @returns the task's result.
 */
function locked(task) {
  const run = tail.then(task, task)
  tail = run.then(() => undefined, () => undefined)
  return run
}

/**
 * Build a JSON response.
 * @param body - the envelope to serialize.
 * @param status - the HTTP status.
 * @returns the response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Resolve the profile file, or undefined when this process has no profile directory.
 * @param ctx - host context.
 * @returns the absolute file path.
 */
function libraryFile(ctx) {
  const dir = ctx.profileContext?.dir
  if (typeof dir !== 'string' || dir === '') return undefined
  return join(dir, FILE_NAME)
}

/**
 * Answer one library read.
 * @param ctx - host context.
 * @returns the JSON envelope.
 */
async function read(ctx) {
  const file = libraryFile(ctx)
  if (file === undefined) return json({ ok: false, error: 'unavailable' }, 503)
  const loaded = await readLibraryFile(file)
  if (!loaded.ok) return json({ ok: false, error: 'unreadable' }, 500)
  return json({ ok: true, value: loaded.value })
}

/**
 * Replace the library when the caller's revision is still current.
 * @param ctx - host context.
 * @param request - the authenticated POST.
 * @returns the JSON envelope.
 */
async function write(ctx, request) {
  const file = libraryFile(ctx)
  if (file === undefined) return json({ ok: false, error: 'unavailable' }, 503)
  let input
  try {
    input = await request.json()
  } catch (error) {
    // The route buffer is JSON. A body that does not parse is a bad request.
    return json({ ok: false, error: 'invalid' }, 400)
  }
  return locked(async () => {
    const current = await readLibraryFile(file)
    if (!current.ok) return json({ ok: false, error: 'unreadable' }, 500)
    const next = applyReplacement(current.value, input)
    if (!next.ok) {
      const body = { ok: false, error: next.error }
      if (next.revision !== undefined) body.revision = next.revision
      return json(body, next.error === 'conflict' ? 409 : 400)
    }
    try {
      await writeLibraryFile(file, next.value)
    } catch (error) {
      // The profile directory can be read-only. Leave the previous file in place.
      return json({ ok: false, error: 'unavailable' }, 500)
    }
    return json({ ok: true, value: next.value })
  })
}

export const name = 'prompt-library'
export const inject = ['connection', 'profileContext']

/**
 * Mount the Host half.
 * @param ctx - host context carrying connection and the current profile.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: LIBRARY_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: request => request.method === 'POST' ? write(ctx, request) : read(ctx),
  }))
}
