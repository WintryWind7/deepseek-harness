/** 个人团队插件共用的会话读取、根会话校验与持久管理记录。 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_PRESET = 'main-dev'
const RECORD_FILE = 'team-dev-sessions.json'

/** @param {unknown} value @param {string} label @returns {string} */
export function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 必须是非空字符串`)
  return value.trim()
}

/** @param {any} header @param {any} ctx */
export function assertRoot(header, ctx) {
  if (header.origin === 'subagent') throw new Error('团队管理只接受普通根会话，不接受 subagent 会话')
  const live = ctx.agents.get(header.id)
  if (live !== undefined && !ctx.agents.roots().some(agent => agent.id === header.id)) {
    throw new Error(`会话 ${header.id} 不是根会话`)
  }
}

/** @param {any} ctx @param {any} agent @returns {string | undefined} */
export function presetIdOf(ctx, agent) {
  return ctx.get('sessionProjections')?.stateOf(agent.session, 'agentPreset') ?? agent.session.header.agentPreset
}

/** @param {any} agent @returns {Record<string, unknown>} */
export function modelOptions(agent) {
  const config = agent.session.requestHeader()?.config ?? {}
  const options = agent.options ?? {}
  const provider = config.provider ?? options.provider
  const model = config.model ?? options.model
  const effort = config.reasoningEffort ?? options.reasoningEffort
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
  }
}

/** @param {string} text @param {string} [id] @returns {object} */
export function userMessage(text, id = randomUUID()) {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** @param {string} cwd @returns {string} */
export function recordPath(cwd) { return join(cwd, '.dsh', RECORD_FILE) }

/** @param {string} cwd @returns {Record<string, any>} */
export function readRecords(cwd) {
  let text
  try { text = readFileSync(recordPath(cwd), 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
  const parsed = JSON.parse(text)
  const sessions = parsed?.sessions
  if (sessions === null || typeof sessions !== 'object' || Array.isArray(sessions)) {
    throw new Error(`${recordPath(cwd)} 缺少 sessions 记录`)
  }
  for (const [id, row] of Object.entries(sessions)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)
      || typeof row.leadId !== 'string' || row.leadId === '' || typeof row.preset !== 'string') {
      throw new Error(`${recordPath(cwd)} 中会话 ${id} 的管理记录不完整`)
    }
    if (row.afterSeq !== undefined && (!Number.isSafeInteger(row.afterSeq) || row.afterSeq < -1)) {
      throw new Error(`${recordPath(cwd)} 中会话 ${id} 的 afterSeq 无效`)
    }
    if (row.leadReceiptFloor !== undefined && (!Number.isSafeInteger(row.leadReceiptFloor) || row.leadReceiptFloor < 0)) {
      throw new Error(`${recordPath(cwd)} 中会话 ${id} 的 leadReceiptFloor 无效`)
    }
    if (row.generation !== undefined && typeof row.generation !== 'string') {
      throw new Error(`${recordPath(cwd)} 中会话 ${id} 的 generation 无效`)
    }
  }
  return sessions
}

/** 同步读改写避免多个工作会话覆盖彼此；文件替换后才发布内存状态。 @param {string} cwd @param {string} id @param {any} record */
export function updateRecord(cwd, id, record) {
  const sessions = readRecords(cwd)
  if (record === undefined) delete sessions[id]
  else sessions[id] = record
  const path = recordPath(cwd)
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ sessions }, null, 2)}\n`, { flag: 'wx' })
  renameSync(temporary, path)
}

/** @param {any} ctx @param {string} id @param {AbortSignal | undefined} signal @param {(snapshot: any) => any} operation */
export async function observe(ctx, id, signal, operation) {
  const lease = await ctx.sessionQuery.observeSession(id, { projectionMode: 'all', ...(signal ? { signal } : {}) })
  try {
    return await operation({
      header: lease.header, events: lease.events, projections: lease.projections?.values ?? {}, source: lease.source,
    })
  } finally { lease[Symbol.dispose]() }
}

/** 原始持久日志不含只读恢复过程合成的结束事件。 @param {any} ctx @param {string} id @param {AbortSignal | undefined} signal @param {number} [offset] @param {number} [length] */
export async function readStored(ctx, id, signal, offset = 0, length) {
  const handle = await ctx.sessionPersistence.open(id, 'read', signal ? { signal } : undefined)
  try {
    const result = await handle.read(offset, length, signal ? { signal } : undefined)
    return { header: handle.header, events: result.events }
  } finally { await handle.close() }
}

/** @param {readonly any[]} events @returns {any | undefined} */
export function lastRequest(events) {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index].type === 'request/header') return events[index].data.header
  }
}

/** @param {any} snapshot @returns {Record<string, unknown>} */
export function restoredModel(snapshot) {
  const selection = snapshot.projections.modelSelection?.next ?? snapshot.projections.modelSelection?.lastUsed
  const header = lastRequest(snapshot.events)
  const config = selection ?? header?.config ?? {}
  return {
    ...(config.provider ? { provider: config.provider } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.reasoningEffort !== undefined && (selection || header?.adapterDefaults?.reasoningEffort !== true)
      ? { reasoningEffort: config.reasoningEffort } : {}),
  }
}

/** @param {readonly any[]} blocks @param {number} limit @returns {{text: string, truncated: boolean}} */
export function textContent(blocks, limit) {
  let text = ''
  let truncated = false
  for (const block of blocks ?? []) {
    if (block.type !== 'text' || block.text === '') continue
    const separator = text === '' ? '' : '\n'
    if (text.length + separator.length >= limit) { truncated = true; break }
    const room = limit - text.length - separator.length
    if (block.text.length > room) {
      text += separator + block.text.slice(0, room)
      truncated = true
      break
    }
    text += separator + block.text
  }
  return { text, truncated }
}

/** @param {readonly any[]} events @param {number} limit @param {number} [turn] @returns {any} */
export function latestMessage(events, limit, turn) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type !== 'assistant/message' || (turn !== undefined && event.data.turn !== turn)) continue
    const content = textContent(event.data.message.content, limit)
    if (content.text.trim() !== '') return { ...content, turn: event.data.turn, seq: event.seq }
  }
  return null
}

/** @param {readonly any[]} events @param {number} limit @param {number} [endSeq] @returns {any} */
export function turnResult(events, limit, endSeq) {
  let end
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index].type === 'turn/end' && (endSeq === undefined || events[index].seq === endSeq)) {
      end = events[index]
      break
    }
  }
  if (end === undefined) return null
  const message = latestMessage(events.filter(event => event.seq < end.seq), limit, end.data.turn)
  return {
    turn: end.data.turn, endSeq: end.seq, reason: end.data.reason.kind,
    time: end.time, text: message?.text ?? '', truncated: message?.truncated ?? false,
  }
}

/** @param {readonly any[]} events @param {string} messageId @returns {boolean} */
export function hasReceipt(events, messageId) {
  return events.some(event => (event.type === 'agent/inbox/spliced'
    && event.data.inserted.some(message => message.id === messageId))
    || (event.type === 'user/message' && event.data.id === messageId))
}
