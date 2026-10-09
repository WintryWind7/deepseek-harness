/**
 * Host half of @wintry/prompts.
 *
 * Publishes one authenticated route for the prompt library stored in the
 * current profile directory. The browser half is discovered from package.json
 * `dsh.client` and `exports["./client"]`; this module never imports it.
 */
import { join } from 'node:path'
import { applyReplacement, readLibraryFile, writeLibraryFile } from './library.js'
import {
  applyTails,
  emptyTails,
  personaHidesTail,
  readTailsFileSync,
  writeTailsFile,
} from './tails.js'

/** Absolute route path. Connection authenticates every request it dispatches. */
const LIBRARY_PATH = '/api/prompt.library'
/** Absolute route path for per-preset system-prompt tails. */
const TAILS_PATH = '/api/prompt.tails'
/** File name inside the profile directory. The prompts are not part of the repo. */
const FILE_NAME = 'prompt-library.json'
/** Tail file inside the profile directory. Separate revision from the library. */
const TAILS_FILE = 'prompt-tails.json'
/** Section placed after the deployment persona suffix (order 10200). */
const TAIL_SECTION = 'personal:prompt-tail'

let tail = Promise.resolve()
let tailsTail = Promise.resolve()

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
 * Run tail writes one at a time inside this process.
 * @param task - the write to run after the previous one settles.
 * @returns the task's result.
 */
function lockedTails(task) {
  const run = tailsTail.then(task, task)
  tailsTail = run.then(() => undefined, () => undefined)
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
function profileFile(ctx, name) {
  const dir = ctx.profileContext?.dir
  if (typeof dir !== 'string' || dir === '') return undefined
  return join(dir, name)
}

/**
 * Resolve the prompt library file.
 * @param ctx - host context.
 * @returns the absolute file path.
 */
function libraryFile(ctx) {
  return profileFile(ctx, FILE_NAME)
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
/**
 * Current presets, plus whether a complete persona will hide an appended tail.
 * A document that cannot be read is shown and is not marked hidden.
 * @param ctx - host context with agentPresets.
 * @returns presets in registry order.
 */
async function presetCards(ctx) {
  const rows = await ctx.agentPresets.list()
  const presets = []
  for (const row of rows) {
    let hidden = false
    try {
      const doc = await ctx.agentPresets.readDocument(row.id)
      hidden = personaHidesTail(doc.content)
    } catch (error) {
      // One unreadable declaration does not hide the card or fail the list.
      hidden = false
    }
    presets.push({
      id: row.id,
      ...(row.name === undefined ? {} : { name: row.name }),
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.broken === undefined ? {} : { broken: row.broken }),
      ...(hidden ? { hidden: true } : {}),
    })
  }
  return presets
}

/**
 * @param library - the tail document.
 * @param presets - current preset cards.
 * @returns the JSON value the browser edits.
 */
function publicTails(library, presets) {
  const tails = {}
  for (const row of presets) {
    const text = library.tails[row.id]
    if (typeof text === 'string' && text.length > 0) tails[row.id] = text
  }
  return { revision: library.revision, presets, tails }
}

/**
 * Mount the tail file, the append section, and its route.
 * The section is global and returns empty text for presets without a tail,
 * so a failure here cannot reject agent creation. `text` never throws.
 * @param ctx - host context that has systemPrompt and agentPresets.
 */
function installTails(ctx) {
  const file = profileFile(ctx, TAILS_FILE)
  const loaded = file === undefined ? null : readTailsFileSync(file)
  const live = {
    unreadable: loaded !== null && loaded.ok !== true,
    library: loaded !== null && loaded.ok === true ? loaded.value : emptyTails(),
  }
  try {
    ctx.effect(() => ctx.systemPrompt.section({
      name: TAIL_SECTION,
      order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 100,
      interpolate: false,
      text: (context) => {
        try {
          const scope = context?.agent?.ctx
          if (scope === undefined) return ''
          const id = ctx.agentPresets.composedPreset(scope)
          if (typeof id !== 'string') return ''
          const text = live.library.tails[id]
          return typeof text === 'string' ? text : ''
        } catch (error) {
          // A lookup failure omits the tail. It must not fail the model step.
          return ''
        }
      },
    }), 'prompt-library.tail')
  } catch (error) {
    ctx.logger?.warn?.(`prompt tails inactive: ${String(error)}`)
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: TAILS_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: request => request.method === 'POST' ? writeTails(ctx, request, file, live) : readTails(ctx, live),
  }))
}

/**
 * @param ctx - host context.
 * @param live - the in-memory tail document.
 * @returns the JSON envelope.
 */
async function readTails(ctx, live) {
  if (profileFile(ctx, TAILS_FILE) === undefined) return json({ ok: false, error: 'unavailable' }, 503)
  if (live.unreadable) return json({ ok: false, error: 'unreadable' }, 500)
  try {
    const presets = await presetCards(ctx)
    return json({ ok: true, value: publicTails(live.library, presets) })
  } catch (error) {
    // The preset registry can be absent during shutdown.
    return json({ ok: false, error: 'unavailable' }, 503)
  }
}

/**
 * @param ctx - host context.
 * @param request - the authenticated POST.
 * @param file - the profile JSON path, if this process has a profile.
 * @param live - the in-memory tail document.
 * @returns the JSON envelope.
 */
async function writeTails(ctx, request, file, live) {
  if (file === undefined) return json({ ok: false, error: 'unavailable' }, 503)
  if (live.unreadable) return json({ ok: false, error: 'unreadable' }, 500)
  let input
  try {
    input = await request.json()
  } catch (error) {
    // The route buffer is JSON. A body that does not parse is a bad request.
    return json({ ok: false, error: 'invalid' }, 400)
  }
  return lockedTails(async () => {
    let presets
    try {
      presets = await presetCards(ctx)
    } catch (error) {
      return json({ ok: false, error: 'unavailable' }, 503)
    }
    const next = applyTails(live.library, input, new Set(presets.map(row => row.id)))
    if (!next.ok) {
      const body = { ok: false, error: next.error }
      if (next.revision !== undefined) body.revision = next.revision
      return json(body, next.error === 'conflict' ? 409 : 400)
    }
    try {
      await writeTailsFile(file, next.value)
    } catch (error) {
      // The profile directory can be read-only. Leave the previous file in place.
      return json({ ok: false, error: 'unavailable' }, 500)
    }
    live.library = next.value
    return json({ ok: true, value: publicTails(next.value, presets) })
  })
}

export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: LIBRARY_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: request => request.method === 'POST' ? write(ctx, request) : read(ctx),
  }))
  ctx.inject(['systemPrompt', 'agentPresets'], inner => {
    try {
      installTails(inner)
    } catch (error) {
      // The prompt library route above stays mounted when tails cannot.
      inner.logger?.warn?.(`prompt tails inactive: ${String(error)}`)
    }
  })
}
