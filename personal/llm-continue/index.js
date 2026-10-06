/**
 * Host half of @wintry/llm-continue.
 *
 * Listens to `agent/turn-stopping`, which the loop dispatches once a turn is
 * about to close while the model owes nothing further. When the turn's last
 * assistant message carries reasoning but no text and no tool call, the model
 * spent its turn thinking and produced nothing a user or the loop can act on,
 * so one continuation is steered: the loop re-reads its inbox, finds fresh
 * next-step work, and runs one more step instead of closing the turn.
 *
 * Steering is the documented contract of the event — a listener that objects
 * steers and the machine re-reads its inbox. The decision is made entirely
 * from data, so listener order cannot change the outcome.
 *
 * Cancellation is immune by data rather than by timing: a turn the user
 * stopped records its assistant messages with `interrupted: true`, and those
 * are never eligible. The abort path in the loop also jumps straight from the
 * step's catch to the finally that writes `turn/end`, skipping the dispatch
 * entirely.
 *
 * Every steering is one JSON file under the personal data directory:
 * `<dsh-home>/personal/llm-continue/continues/<sessionId>-<seq>.json`.
 * A later assistant message in the same turn that carries text marks that
 * turn's records as recovered. The browser reads the summed view through one
 * authenticated GET route.
 */

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Cordis plugin identity; must match the row id in cordis.patch.yml. */
export const name = 'llm-continue'

/** Injected services: the agent registry is not needed; events come from ctx.on. */
export const inject = ['connection']

/** Defaults; a cordis row overrides individual fields. */
const DEFAULTS = {
  enabled: true,
  /** Maximum continuations steered into a single turn. */
  maxAttempts: 5,
  /** Steered text for attempt 1. */
  prompt: '上一轮只输出了推理过程，没有给出最终答复。请直接给出结论；如需更多信息，请调用工具获取。',
  /** Steered text for attempts 2..maxAttempts. */
  promptFirm: '你又一次只输出了推理过程而没有给出答复。请立即输出最终答复，不要继续推理。',
}

/**
 * Normalize one row's config over {@link DEFAULTS}.
 * @param raw - the row's config object.
 * @returns the complete config.
 */
function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('llm-continue config must be an object')
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`unknown llm-continue config: ${key}`)
  }
  const enabled = raw.enabled ?? DEFAULTS.enabled
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
  const maxAttempts = raw.maxAttempts ?? DEFAULTS.maxAttempts
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error('maxAttempts must be an integer from 1 to 20')
  }
  const prompt = raw.prompt ?? DEFAULTS.prompt
  if (typeof prompt !== 'string' || prompt.length === 0) throw new Error('prompt must be a non-empty string')
  const promptFirm = raw.promptFirm ?? DEFAULTS.promptFirm
  if (typeof promptFirm !== 'string' || promptFirm.length === 0) throw new Error('promptFirm must be a non-empty string')
  return { enabled, maxAttempts, prompt, promptFirm }
}

/**
 * Cordis reads every plugin's config through Standard Schema: a declared
 * `Config` without `~standard` throws before `apply` runs, and the value
 * `validate` returns is what `apply` receives.
 */
export const Config = {
  '~standard': {
    version: 1, vendor: 'wintry-llm-continue',
    validate(raw) {
      try { return { value: resolveConfig(raw) } } catch (error) { return { issues: [{ message: error.message }] } }
    },
  },
}

/** Directory name under the harness home for this user's own plugin data. */
const PERSONAL_DIR = 'personal'
/** Package directory inside {@link PERSONAL_DIR}. */
const PLUGIN_DIR = 'llm-continue'
/** Record files live in `<plugin>/continues/<sessionId>/<seq>.json`. */
const CONTINUES_DIR = 'continues'
/** This process's start time, beside the record files. */
const PROCESS_FILE = 'process.json'

/** Authenticated read of the summed view. */
const LEDGER_PATH = '/api/llm.continue'

/** Session ids and file names that are safe as a single path segment. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000

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
    throw new Error(`llm-continue record field ${label} is not a non-negative integer`)
  }
  return value
}

/**
 * @param value - a candidate text field.
 * @param label - the field name used when the value is rejected.
 * @returns the text.
 */
function requireText(value, label) {
  if (typeof value !== 'string') throw new Error(`llm-continue record field ${label} is not text`)
  return value
}

/**
 * @param value - a candidate boolean field.
 * @param label - the field name used when the value is rejected.
 * @returns the boolean.
 */
function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`llm-continue record field ${label} is not a boolean`)
  return value
}

/**
 * @param value - a stored record.
 * @returns the checked record.
 */
function parseRecord(value) {
  if (value === null || typeof value !== 'object') throw new Error('llm-continue record is missing')
  const sessionId = requireText(value.sessionId, 'sessionId')
  return {
    time: requireWhole(value.time, 'time'),
    processStartedAt: typeof value.processStartedAt === 'number' ? requireWhole(value.processStartedAt, 'processStartedAt') : 0,
    sessionId,
    seq: requireWhole(value.seq, 'seq'),
    turn: requireWhole(value.turn, 'turn'),
    step: requireWhole(value.step, 'step'),
    attempt: requireWhole(value.attempt, 'attempt'),
    provider: requireText(value.provider, 'provider'),
    model: requireText(value.model, 'model'),
    reasoningChars: requireWhole(value.reasoningChars, 'reasoningChars'),
    recovered: requireBoolean(value.recovered, 'recovered'),
  }
}

/**
 * Turn-scoped steering counts, reset when the turn's closing event arrives.
 * @typedef {object} TurnState
 * @property {number} count - steerings already made in this turn.
 * @property {boolean} recovered - whether a recovery was observed for this turn.
 */

/** Turn identity a plugin instance tracks, keyed by `${sessionId}\0${turn}`. */
/** @type {Map<string, TurnState>} */
const turnStates = new Map()

/** Records loaded from disk, keyed by `${sessionId}-${seq}`. */
/** Records loaded from disk, keyed by `${sessionId}-${seq}`. */
/** @type {Map<string, ReturnType<typeof parseRecord>>} */
let records = new Map()

/** This process's start time, shared by every record it writes. */
let startedAt = 0

/**
 * Turn identity for one session.
 * @param sessionId - the session's id.
 * @param turn - the turn number.
 * @returns the map key.
 */
function turnKey(sessionId, turn) {
  return `${sessionId}\0${turn}`
}

/**
 * True when this assistant message carries only reasoning: no text block and
 * no tool-call block. An interrupted message is never eligible, which is what
 * makes a user-cancelled turn immune regardless of signal timing.
 * @param message - the recorded assistant message.
 * @returns whether the turn owes a continuation.
 */
function owesContinuation(message) {
  if (message === null || typeof message !== 'object') return false
  const content = Array.isArray(message.content) ? message.content : []
  if (content.length === 0) return true
  return content.every(block => block !== null && typeof block === 'object' && block.type === 'reasoning')
}

/**
 * Model route recorded on one assistant message.
 * @param message - the recorded assistant message.
 * @returns provider and model, empty text when the message records neither.
 */
function routeOf(message) {
  const source = message?.source
  return {
    provider: typeof source?.provider === 'string' ? source.provider : '',
    model: typeof source?.model === 'string' ? source.model : '',
  }
}

/**
 * Reasoning characters recorded on one assistant message.
 * @param message - the recorded assistant message.
 * @returns the summed reasoning text length, 0 when there is none.
 */
function reasoningCharsOf(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  let total = 0
  for (const block of content) {
    if (block?.type === 'reasoning' && typeof block.text === 'string') total += block.text.length
  }
  return total
}

/**
 * The last assistant message of one session at or before a sequence number.
 * @param session - the agent's session.
 * @param turn - the turn whose closing step is being judged.
 * @param beforeSeq - highest sequence to consider; the turn's own events only.
 * @returns the message, or null when the turn settled no assistant message.
 */
function lastAssistantMessage(session, turn, beforeSeq) {
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return null
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.seq > beforeSeq) continue
    if (event.type !== 'assistant/message') continue
    const data = event.data
    if (data?.turn !== turn) continue
    if (data.interrupted === true) continue
    return data.message ?? null
  }
  return null
}

/**
 * The highest sequence number of one session's own events.
 * @param session - the agent's session.
 * @returns the last sequence, or 0 when the log is empty.
 */
function lastSeq(session) {
  try {
    const events = session.snapshotEvents()
    return events.length === 0 ? 0 : events[events.length - 1].seq
  } catch {
    return 0
  }
}

/**
 * Mark one turn's records as recovered and rewrite their files.
 * @param root - the `continues` root directory.
 * @param sessionId - the session whose turn recovered.
 * @param turn - the turn that recovered.
 * @returns a promise that settles after the files are rewritten.
 */
async function markRecovered(root, sessionId, turn) {
  const stale = []
  for (const row of records.values()) {
    if (row.sessionId !== sessionId || row.turn !== turn || row.recovered) continue
    stale.push(row)
  }
  for (const row of stale) {
    row.recovered = true
    records.set(`${row.sessionId}-${row.seq}`, row)
    await writeRecord(root, { key: `${row.sessionId}-${row.seq}`, record: row })
  }
}

/**
 * Write one record, replacing any file for the same event.
 * @param root - the `continues` root directory.
 * @param row - the record and its `sessionId-seq` key.
 */
async function writeRecord(root, row) {
  const dir = join(root, row.record.sessionId)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${row.record.seq}.json`)
  const temporary = join(dir, `${row.record.seq}.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify(row.record, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Read every record already on disk. A missing directory is an empty set, and
 * a file that does not parse is skipped.
 * @param root - the `continues` directory.
 * @returns records keyed by `sessionId-seq`.
 */
async function loadRecords(root) {
  /** @type {Map<string, ReturnType<typeof parseRecord>>} */
  const loaded = new Map()
  let sessions
  try {
    sessions = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return loaded
    throw error
  }
  for (const session of sessions) {
    if (!session.isDirectory() || !SAFE_SEGMENT.test(session.name)) continue
    let files
    try {
      files = await readdir(join(root, session.name))
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.json') || !/^\d+\.json$/.test(file)) continue
      const seqName = file.slice(0, -'.json'.length)
      if (!/^\d+$/.test(seqName)) continue
      try {
        const value = parseRecord(JSON.parse(await readFile(join(root, session.name, file), 'utf8')))
        loaded.set(`${value.sessionId}-${value.seq}`, value)
      } catch {
        // One damaged file does not hide the rest.
      }
    }
  }
  return loaded
}

/**
 * Sum one window of records, grouped by route, with recovery counted per turn.
 * @param rows - every loaded record.
 * @param startedAt - this process's start time, for the `boot` window.
 * @param now - the clock used for the rolling windows.
 * @param cutoff - include a record when its `time` is at least this, or all when null.
 * @returns that window's summed view.
 */
function viewOf(rows, startedAt, now, cutoff) {
  /** @type {Map<string, { provider: string, model: string, count: number, turns: Set<string>, recoveredTurns: Set<string>, maxAttempt: number }>} */
  const byRoute = new Map()
  const turnTotals = new Map()
  let count = 0

  for (const row of rows.values()) {
    if (cutoff !== null && row.time < cutoff) continue
    count += 1
    const routeKey = `${row.provider}\0${row.model}`
    let slot = byRoute.get(routeKey)
    if (slot === undefined) {
      slot = {
        provider: row.provider,
        model: row.model,
        count: 0,
        turns: new Set(),
        recoveredTurns: new Set(),
        maxAttempt: 0,
      }
      byRoute.set(routeKey, slot)
    }
    slot.count += 1
    const turnIdentity = turnKey(row.sessionId, row.turn)
    slot.turns.add(turnIdentity)
    if (row.recovered) slot.recoveredTurns.add(turnIdentity)
    if (row.attempt > slot.maxAttempt) slot.maxAttempt = row.attempt
    turnTotals.set(turnIdentity, (turnTotals.get(turnIdentity) ?? 0) + 1)
  }

  let maxAttempt = 0
  for (const value of turnTotals.values()) if (value > maxAttempt) maxAttempt = value

  let recoveredTurns = 0
  for (const identity of turnTotals.keys()) {
    for (const slot of byRoute.values()) {
      if (slot.recoveredTurns.has(identity)) {
        recoveredTurns += 1
        break
      }
    }
  }

  return {
    count,
    turns: turnTotals.size,
    recovered: recoveredTurns,
    failed: turnTotals.size - recoveredTurns,
    maxAttempt,
    routes: [...byRoute.values()]
      .map(slot => ({
        provider: slot.provider,
        model: slot.model,
        count: slot.count,
        turns: slot.turns.size,
        recovered: slot.recoveredTurns.size,
        failed: slot.turns.size - slot.recoveredTurns.size,
        maxAttempt: slot.maxAttempt,
      }))
      .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
  }
}

/**
 * The summed view for every window the panel offers.
 * @param rows - every loaded record.
 * @param startedAt - this process's start time.
 * @param now - the current clock.
 * @returns one view per window.
 */
function viewsOf(rows, startedAt, now) {
  return {
    boot: viewOf(rows, startedAt, now, startedAt),
    h24: viewOf(rows, startedAt, now, now - DAY_MS),
    d7: viewOf(rows, startedAt, now, now - 7 * DAY_MS),
    all: viewOf(rows, startedAt, now, null),
  }
}

/**
 * The most recent records for the panel's side card.
 * @param rows - every loaded record.
 * @param limit - how many to return.
 * @returns newest records first.
 */
function recentOf(rows, limit) {
  return [...rows.values()]
    .sort((a, b) => b.time - a.time || b.seq - a.seq)
    .slice(0, limit)
    .map(row => ({
      time: row.time,
      provider: row.provider,
      model: row.model,
      attempt: row.attempt,
      turn: row.turn,
      recovered: row.recovered,
    }))
}

/** Recent-record count the panel's side card asks for. */
const RECENT_LIMIT = 6

/**
 * Mount the steering listener and its read route.
 * @param ctx - host context carrying the authenticated fetch registry.
 * @param config - the row's config, already normalized by {@link Config}.
 */
export function apply(ctx, config = resolveConfig({})) {
  ctx.effect(() => {
    const directory = pluginDirectory()
    const root = join(directory, CONTINUES_DIR)
    startedAt = Date.now()
    let ready = false
    /** @type {Array<[string, object]>} */
    const queued = []
    records = new Map()

    const persistProcess = async () => {
      await mkdir(directory, { recursive: true })
      const temporary = join(directory, `process.${process.pid}.tmp`)
      await writeFile(temporary, `${JSON.stringify({ startedAt, pid: process.pid }, null, 2)}\n`, 'utf8')
      await rename(temporary, join(directory, PROCESS_FILE))
    }
    void persistProcess().catch(error => {
      ctx.logger?.error?.(`llm-continue: process start write failed: ${error instanceof Error ? error.message : String(error)}`)
    })

    /**
     * Record one steering under the analysed step's sequence.
     * @param sessionId - the session whose turn is stopping.
     * @param turn - the turn number.
     * @param attempt - 1-based index of this steering within the turn.
     * @param provider - the route that produced the empty turn.
     * @param model - the model id that produced the empty turn.
     * @param reasoningChars - reasoning length of the analysed message.
     * @param seq - sequence of the analysed step, used as the record key.
     */
    function record(sessionId, turn, attempt, provider, model, reasoningChars, seq) {
      const entry = {
        time: Date.now(),
        processStartedAt: startedAt,
        sessionId,
        seq,
        turn,
        step: 0,
        attempt,
        provider,
        model,
        reasoningChars,
        recovered: false,
      }
      records.set(`${sessionId}-${seq}`, entry)
      if (!ready) {
        queued.push([sessionId, entry])
        return
      }
      void writeRecord(root, { key: `${sessionId}-${seq}`, record: entry }).catch(error => {
        records.delete(`${sessionId}-${seq}`)
        ctx.logger?.error?.(`llm-continue: record write failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    // The agent subject arrives in the payload; scope filtering keeps the
    // listener on the agents this context owns.
    const offTurnStopping = ctx.on('agent/turn-stopping', async (session, event) => {
      if (config.enabled !== true) return
      const { agent, turn, signal } = event ?? {}
      if (agent?.session === undefined || typeof turn !== 'number') return
      // Second guard: never steer a turn that is already abandoned.
      if (signal?.aborted === true) return

      const sessionId = typeof agent.session.id === 'string' ? agent.session.id : ''
      if (!SAFE_SEGMENT.test(sessionId)) return

      const before = lastSeq(agent.session)
      const message = lastAssistantMessage(agent.session, turn, before)
      if (message === null) return
      if (!owesContinuation(message)) return

      const state = turnStates.get(turnKey(sessionId, turn)) ?? { count: 0, recovered: false }
      if (state.count >= config.maxAttempts) return
      state.count += 1
      turnStates.set(turnKey(sessionId, turn), state)

      const route = routeOf(message)
      try {
        agent.steer({
          role: 'user',
          content: state.count <= 1 ? config.prompt : config.promptFirm,
          source: { kind: 'steer', origin: 'llm-continue', attempt: state.count },
        })
      } catch (error) {
        ctx.logger?.warn?.(`llm-continue: steer rejected: ${error instanceof Error ? error.message : String(error)}`)
        return
      }

      record(sessionId, turn, state.count, route.provider, route.model, reasoningCharsOf(message), before)
    })

    // Recovery and turn teardown both read from the session log.
    const offSessionEvent = ctx.on('session/event', async (session, event) => {
      const sessionId = typeof session?.id === 'string' ? session.id : ''
      if (sessionId === '') return
      if (event?.type === 'assistant/message') {
        const data = event.data
        const turn = data?.turn
        if (typeof turn !== 'number') return
        const blocks = Array.isArray(data?.message?.content) ? data.message.content : []
        const hasText = blocks.some(block => block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
        if (!hasText) return
        const key = turnKey(sessionId, turn)
        const state = turnStates.get(key)
        if (state === undefined || state.recovered) return
        state.recovered = true
        // Marks memory even before the load settled; the queued records are
        // written with whatever flag they carry at flush time.
        await markRecovered(root, sessionId, turn).catch(error => {
          ctx.logger?.error?.(`llm-continue: recovery write failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        return
      }
      if (event?.type === 'turn/end') {
        const key = turnKey(sessionId, event.data?.turn)
        if (turnStates.has(key)) turnStates.delete(key)
      }
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
          ranges: viewsOf(records, startedAt, now),
          recent: recentOf(records, RECENT_LIMIT),
        }))
      },
    })

    // Merge rather than replace: records written while the load was in flight
    // are this process's own and must survive the snapshot that lands after.
    loadRecords(root).then(loaded => {
      const merged = new Map(loaded)
      for (const [key, entry] of records) if (!merged.has(key)) merged.set(key, entry)
      records = merged
      ready = true
      for (const [sessionId, entry] of queued.splice(0)) {
        if (!SAFE_SEGMENT.test(sessionId)) continue
        const key = `${sessionId}-${entry.seq}`
        void writeRecord(root, { key, record: entry }).catch(error => {
          records.delete(key)
          ctx.logger?.error?.(`llm-continue: queued record write failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }).catch(error => {
      ctx.logger?.error?.(`llm-continue: record storage failed to open: ${error instanceof Error ? error.message : String(error)}`)
    })

    return () => {
      turnStates.clear()
      offTurnStopping()
      offSessionEvent()
      void disposeRoute()
    }
  }, 'llm-continue')
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
