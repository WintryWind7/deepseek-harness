/**
 * Host half of dsh-usage-meter.
 *
 * Listens to `session/event`, which fires only when a Session appends a new
 * event. Opening an older Session loads its log without emitting that event,
 * so usage from before this plugin was running is not added. Each settled
 * model call is one JSON file under the personal data directory:
 * `<dsh-home>/personal/dsh-usage-meter/calls/<sessionId>/<seq>.json`.
 * Each file's `time` is the event time in Unix milliseconds, which is what
 * date windows filter on. `processStartedAt` is when this process began, and
 * the same instant is stored in `<plugin>/process.json`. The page's totals
 * are summed from those files when it asks, once for this process and again
 * for the rolling windows. A later
 * message for the same session, turn, and step stands in for an earlier
 * attempt in that sum; both files stay. Nothing here is written back into
 * a Session log, and nothing is written into the harness `storages` directory.
 * The browser reads the summed view through one authenticated GET route.
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const name = 'usage-meter'
export const inject = ['connection']

/** Directory name under the harness home for this user's own plugin data. */
const PERSONAL_DIR = 'personal'
/** Package directory inside {@link PERSONAL_DIR}. */
const PLUGIN_DIR = 'dsh-usage-meter'
/** Call files live in `<plugin>/calls/<sessionId>/<seq>.json`. */
const CALLS_DIR = 'calls'
/** This process's start time, beside the call files. */
const PROCESS_FILE = 'process.json'
/** Session ids and file names that are safe as a single path segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/

/** Authenticated read of the summed view. */
const LEDGER_PATH = '/api/usage.meter'

const BUCKET_KEYS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/**
 * @returns the absolute personal directory for this plugin.
 */
function pluginDirectory() {
  const fromEnv = process.env.DSH_HOME
  const home = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? resolve(fromEnv) : join(homedir(), '.dsh')
  return join(home, PERSONAL_DIR, PLUGIN_DIR)
}

/**
 * @param value - a candidate whole count.
 * @param label - the field name used when the value is rejected.
 * @returns the rounded count.
 */
function requireWhole(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`usage call field ${label} is not a non-negative integer`)
  }
  return value
}

/**
 * @param value - a candidate text field.
 * @param label - the field name used when the value is rejected.
 * @returns the text.
 */
function requireText(value, label) {
  if (typeof value !== 'string') throw new Error(`usage call field ${label} is not text`)
  return value
}

/**
 * @param value - a stored call record.
 * @returns the checked record.
 */
function parseCall(value) {
  if (value === null || typeof value !== 'object') throw new Error('usage call is missing')
  if (value.kind !== 'message' && value.kind !== 'attempt' && value.kind !== 'compaction') {
    throw new Error('usage call kind is missing')
  }
  const turn = value.turn === null ? null : requireWhole(value.turn, 'turn')
  const step = value.step === null ? null : requireWhole(value.step, 'step')
  return {
    time: requireWhole(value.time, 'time'),
    processStartedAt: value.processStartedAt == null ? null : requireWhole(value.processStartedAt, 'processStartedAt'),
    sessionId: requireText(value.sessionId, 'sessionId'),
    seq: requireWhole(value.seq, 'seq'),
    kind: value.kind,
    turn,
    step,
    provider: requireText(value.provider, 'provider'),
    model: requireText(value.model, 'model'),
    uncachedInputTokens: requireWhole(value.uncachedInputTokens, 'uncachedInputTokens'),
    outputTokens: requireWhole(value.outputTokens, 'outputTokens'),
    cacheReadTokens: requireWhole(value.cacheReadTokens, 'cacheReadTokens'),
    cacheWriteTokens: requireWhole(value.cacheWriteTokens, 'cacheWriteTokens'),
    reasoningTokens: requireWhole(value.reasoningTokens, 'reasoningTokens'),
    decodeMs: requireWhole(value.decodeMs, 'decodeMs'),
  }
}

/**
 * @param value - a candidate count.
 * @returns the value when it is a non-negative finite number.
 */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * @param value - a candidate whole count.
 * @returns the rounded value, or null when it is not a usable count.
 */
function whole(value) {
  const parsed = count(value)
  return parsed === null ? null : Math.round(parsed)
}

/**
 * @param usage - a provider usage sample.
 * @returns the four billing buckets plus reasoning, or null when input or output is unusable.
 */
function bucketsFrom(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const uncachedInputTokens = whole(usage.inputTokens)
  const outputTokens = whole(usage.outputTokens)
  if (uncachedInputTokens === null || outputTokens === null) return null
  return {
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens: whole(usage.cacheReadTokens) ?? 0,
    cacheWriteTokens: whole(usage.cacheWriteTokens) ?? 0,
    reasoningTokens: whole(usage.reasoningTokens) ?? 0,
  }
}

/**
 * @returns zero buckets.
 */
function emptyBuckets() {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

/**
 * @param stream - a compact assistant stream.
 * @returns the usage object on the last usage chunk, or null.
 */
function usageFromStream(stream) {
  if (!Array.isArray(stream)) return null
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record !== null && typeof record === 'object'
      && record.type === 'chunk'
      && record.chunk !== null && typeof record.chunk === 'object'
      && record.chunk.type === 'usage') {
      return record.chunk.usage ?? null
    }
  }
  return null
}

/**
 * @param event - one appended session event.
 * @returns the usage sample that event settles, or null.
 */
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return null
  return usageFromStream(event.data.stream)
}

/**
 * Time of the first output token in one compact stream.
 * @param stream - a compact assistant stream.
 * @returns that time, or null when the stream has no token.
 */
function firstTokenTime(stream) {
  if (!Array.isArray(stream)) return null
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type === 'chunk') {
      const chunk = record.chunk
      const time = count(record.time)
      if (chunk === null || typeof chunk !== 'object' || time === null) continue
      if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && chunk.text !== '') return time
      if (chunk.type === 'tool-call-delta' && (chunk.argumentsDelta !== '' || chunk.name !== undefined)) return time
      continue
    }
    if (record.type === 'tool-call-chunks' && record.name !== undefined) {
      const time = count(record.time0)
      if (time !== null) return time
      continue
    }
    if (record.type !== 'text-chunks' && record.type !== 'reasoning-chunks') continue
    if (!Array.isArray(record.texts) || !Array.isArray(record.dt)) continue
    let time = count(record.time0)
    if (time === null) continue
    for (let index = 0; index < record.texts.length; index += 1) {
      if (index > 0) time += count(record.dt[index - 1]) ?? 0
      if (record.texts[index] !== '') return time
    }
  }
  return null
}

/**
 * @param event - an assistant settlement.
 * @param buckets - its token buckets.
 * @returns decode duration in milliseconds, or 0 when the stream has no token clock.
 */
function decodeMs(event, buckets) {
  if (buckets.outputTokens === 0) return 0
  const first = firstTokenTime(event.data.stream)
  const settled = count(event.time)
  if (first === null || settled === null) return 0
  return whole(Math.max(0, settled - first)) ?? 0
}

/**
 * @param message - an assistant message, when the event has one.
 * @returns provider and model, or empty text when the message has none.
 */
function routeOf(message) {
  const source = message !== null && typeof message === 'object' ? message.source : null
  return {
    provider: source !== null && typeof source === 'object' && typeof source.provider === 'string' ? source.provider : '',
    model: source !== null && typeof source === 'object' && typeof source.model === 'string' ? source.model : '',
  }
}

/**
 * @param sessionId - the session that appended the event.
 * @param event - the appended event.
 * @param processStartedAt - when this process began, in Unix milliseconds.
 * @returns the record and its file key, or null when the event is not a call.
 */
function callFrom(sessionId, event, processStartedAt) {
  const data = event.data
  if (data === null || typeof data !== 'object') return null
  const seq = whole(event.seq)
  const time = whole(event.time)
  if (seq === null || time === null || sessionId === '') return null
  const key = `${sessionId}-${seq}`
  if (event.type === 'compaction/summary') {
    const buckets = bucketsFrom(data.usage) ?? emptyBuckets()
    return {
      key,
      value: {
        time,
        processStartedAt,
        sessionId,
        seq,
        kind: 'compaction',
        turn: null,
        step: null,
        provider: typeof data.provider === 'string' ? data.provider : '',
        model: typeof data.model === 'string' ? data.model : '',
        ...buckets,
        decodeMs: 0,
      },
    }
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return null
  const turn = whole(data.turn)
  const step = whole(data.step)
  if (turn === null || step === null) return null
  const buckets = bucketsFrom(usageOf(event)) ?? emptyBuckets()
  const route = routeOf(event.type === 'assistant/message' ? data.message : null)
  return {
    key,
    value: {
      time,
      processStartedAt,
      sessionId,
      seq,
      kind: event.type === 'assistant/message' ? 'message' : 'attempt',
      turn,
      step,
      provider: route.provider,
      model: route.model,
      ...buckets,
      decodeMs: decodeMs(event, buckets),
    },
  }
}

/**
 * A message replaces an attempt for the same step. A later record of the
 * same kind replaces an earlier one.
 * @param row - the candidate.
 * @param previous - the record already chosen for that step.
 * @returns whether `row` should stand for the step in the sum.
 */
function prefer(row, previous) {
  if (row.kind === 'message' && previous.kind !== 'message') return true
  if (row.kind !== 'message' && previous.kind === 'message') return false
  return row.time >= previous.time
}

/**
 * @param calls - the call table, or undefined before it is open.
 * @param cutoff - include a call when its `time` is at least this Unix millisecond, or every call when null.
 * @returns the summed fields the page shows.
 */
function viewOf(calls, cutoff) {
  /** @type {Map<string, ReturnType<typeof parseCall>>} */
  const chosen = new Map()
  const compaction = emptyBuckets()
  let compactionCount = 0
  if (calls !== undefined) {
    for (const [, row] of calls.entries()) {
      if (cutoff !== null && row.time < cutoff) continue
      if (row.kind === 'compaction') {
        compactionCount += 1
        for (const key of BUCKET_KEYS) compaction[key] += row[key]
        compaction.reasoningTokens += row.reasoningTokens
        continue
      }
      if (row.turn === null || row.step === null) continue
      const slot = `${row.sessionId}\0${row.turn}\0${row.step}`
      const previous = chosen.get(slot)
      if (previous === undefined || prefer(row, previous)) chosen.set(slot, row)
    }
  }
  const totals = emptyBuckets()
  let decodeMsSum = 0
  let decodeTokens = 0
  /** @type {Set<string>} */
  const turns = new Set()
  for (const row of chosen.values()) {
    for (const key of BUCKET_KEYS) totals[key] += row[key]
    totals.reasoningTokens += row.reasoningTokens
    if (row.decodeMs > 0) {
      decodeMsSum += row.decodeMs
      decodeTokens += row.outputTokens
    }
    turns.add(`${row.sessionId}\0${row.turn}`)
  }
  for (const key of BUCKET_KEYS) totals[key] += compaction[key]
  return {
    turns: turns.size,
    steps: chosen.size,
    decodeMs: decodeMsSum,
    decodeTokens,
    uncachedInputTokens: totals.uncachedInputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    outputTokens: totals.outputTokens,
    compaction: {
      count: compactionCount,
      uncachedInputTokens: compaction.uncachedInputTokens,
      outputTokens: compaction.outputTokens,
      cacheReadTokens: compaction.cacheReadTokens,
      cacheWriteTokens: compaction.cacheWriteTokens,
    },
  }
}

/**
 * @param body - the JSON body.
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
 * Read every call file already on disk. A missing directory is an empty set.
 * A file that does not parse is skipped.
 * @param root - the `calls` directory.
 * @returns records keyed by `sessionId-seq`.
 */
async function loadCalls(root) {
  /** @type {Map<string, ReturnType<typeof parseCall>>} */
  const calls = new Map()
  let sessions
  try {
    sessions = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return calls
    throw error
  }
  for (const session of sessions) {
    if (!session.isDirectory() || !SAFE_SEGMENT.test(session.name)) continue
    const files = await readdir(join(root, session.name), { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue
      const seqName = file.name.slice(0, -'.json'.length)
      if (!/^\d+$/.test(seqName)) continue
      try {
        const value = parseCall(JSON.parse(await readFile(join(root, session.name, file.name), 'utf8')))
        calls.set(`${value.sessionId}-${value.seq}`, value)
      } catch {
        // One damaged file does not hide the rest.
      }
    }
  }
  return calls
}

/**
 * Write one call as its own file, replacing any file for the same event.
 * @param root - the `calls` directory.
 * @param row - the record and its `sessionId-seq` key.
 */
async function writeCallFile(root, row) {
  if (!SAFE_SEGMENT.test(row.value.sessionId)) throw new Error('usage-meter: session id is not a safe path segment')
  const dir = join(root, row.value.sessionId)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${row.value.seq}.json`)
  const temporary = join(dir, `${row.value.seq}.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify(row.value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Record when this process began.
 * @param directory - the plugin's personal directory.
 * @param startedAt - Unix milliseconds.
 */
async function writeProcessFile(directory, startedAt) {
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `process.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify({ startedAt, pid: process.pid }, null, 2)}\n`, 'utf8')
  await rename(temporary, join(directory, PROCESS_FILE))
}

/**
 * @param calls - the call table.
 * @param startedAt - when this process began, in Unix milliseconds.
 * @param now - the clock used for the rolling windows.
 * @returns one summed view per range.
 */
function rangesOf(calls, startedAt, now) {
  const hour = 60 * 60 * 1000
  return {
    boot: viewOf(calls, startedAt),
    h24: viewOf(calls, now - 24 * hour),
    d7: viewOf(calls, now - 7 * 24 * hour),
    d30: viewOf(calls, now - 30 * 24 * hour),
    all: viewOf(calls, null),
  }
}

/**
 * Mount the call recorder and its read route.
 * @param ctx - host context carrying the authenticated fetch registry.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const startedAt = Date.now()
    const directory = pluginDirectory()
    const root = join(directory, CALLS_DIR)
    void writeProcessFile(directory, startedAt).catch(error => {
      ctx.logger?.error?.(`usage-meter: process start write failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    let ready = false
    /** @type {Map<string, ReturnType<typeof parseCall>>} */
    let calls = new Map()
    /** @type {Array<[string, object]>} */
    const queued = []

    /**
     * @param sessionId - the session that appended the event.
     * @param event - the appended event.
     */
    function writeCall(sessionId, event) {
      const row = callFrom(sessionId, event, startedAt)
      if (row === null || !SAFE_SEGMENT.test(sessionId)) return
      calls.set(row.key, row.value)
      void writeCallFile(root, row).catch(error => {
        calls.delete(row.key)
        ctx.logger?.error?.(`usage-meter: call write failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    const off = ctx.on('session/event', (session, event) => {
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      if (sessionId === '') return
      if (!ready) {
        queued.push([sessionId, event])
        return
      }
      writeCall(sessionId, event)
    })

    const disposeRoute = ctx.connection.fetch.register({
      path: LEDGER_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => {
        const now = Date.now()
        return Promise.resolve(json({
          startedAt,
          now,
          ranges: rangesOf(calls, startedAt, now),
        }))
      },
    })

    let disposed = false
    void loadCalls(root).then(loaded => {
      if (disposed) return
      calls = loaded
      ready = true
      for (const [sessionId, event] of queued.splice(0)) writeCall(sessionId, event)
    }).catch(error => {
      ctx.logger?.error?.(`usage-meter: call storage failed to open: ${error instanceof Error ? error.message : String(error)}`)
    })

    return () => {
      disposed = true
      ready = false
      off()
      void disposeRoute()
    }
  })
}
