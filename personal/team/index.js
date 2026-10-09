/** 团队管理的 Host：管理关系、轮次结果投递和只读面板共用同一个实例。 */
import { randomUUID } from 'node:crypto'
import {
  assertRoot, hasReceipt, isRoot, isVisibleRoot, latestMessage, mapLimit, observe, presetIdOf,
  readRecords, readStored, requiredText, restoredModel, titleText, turnResult, updateRecord, userMessage,
} from './runtime.js'
import { createQuestions } from './questions.js'

export const name = 'personal-team-sessions'
export const inject = ['agents', 'sessions', 'sessionPersistence', 'sessionQuery', 'sessionProjections', 'connection']
const managers = new WeakMap()
const PANEL_PATH = '/api/team.sessions'
/** 面板通知的合并窗口。订阅者每收到一次通知就重读一次面板，而每次面板读取含一次全局会话列举。 */
const NOTIFY_WINDOW_MS = 300
/** 面板与列表都要为每个会话读一次日志取标题，不限并发时目录里会话一多会同时打开几百个读取。 */
const SESSION_READ_CONCURRENCY = 4

/** @param {any} raw @returns {{resultChars: number, questionHistoryLimit: number}} */
function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('团队管理配置必须是对象')
  for (const key of Object.keys(raw)) if (!['resultChars', 'questionHistoryLimit'].includes(key)) throw new Error(`未知团队管理配置：${key}`)
  const resultChars = raw.resultChars ?? 12000
  const questionHistoryLimit = raw.questionHistoryLimit ?? 64
  if (!Number.isSafeInteger(resultChars) || resultChars < 1000 || resultChars > 100000) throw new Error('resultChars 必须是 1000 至 100000 的整数')
  if (!Number.isSafeInteger(questionHistoryLimit) || questionHistoryLimit < 1 || questionHistoryLimit > 1000) throw new Error('questionHistoryLimit 必须是 1 至 1000 的整数')
  return { resultChars, questionHistoryLimit }
}

/** Cordis 接受 Standard Schema；个人包不依赖 Host 的 zod 模块路径。 */
export const Config = {
  '~standard': {
    version: 1, vendor: 'wintry-team',
    validate(raw) {
      try { return { value: resolveConfig(raw) } } catch (error) { return { issues: [{ message: error.message }] } }
    },
  },
}

/** @param {any} ctx @returns {any} */
export function getManager(ctx) {
  const manager = managers.get(ctx.root ?? ctx)
  if (!manager) throw new Error('团队管理 Host 未加载；请启用个人预设 bundle 并重启 DSH')
  return manager
}

/** @param {any} ctx @param {{resultChars: number, questionHistoryLimit: number}} config @returns {any} */
function createManager(ctx, config) {
  const records = new Map()
  const errors = new Map()
  const jobs = new Set()
  const deliveries = new Map()
  const resumes = new Map()
  const listeners = new Set()
  const shutdown = new AbortController()
  let questions
  let closed = false

  const track = promise => {
    jobs.add(promise)
    promise.then(() => jobs.delete(promise), () => jobs.delete(promise))
    return promise
  }
  // 订阅者收到一次通知就会重读一次面板，而一次面板读取含一次全局会话列举（实测约 1s）。
  // assistant/message、tool/call、tool/result 在流式输出时非常密集，所以把通知合并到一个
  // 窗口内最多一次：面板最多晚 NOTIFY_WINDOW_MS 看到变化，但不会每次事件都重读一遍。
  let notifyTimer
  const notify = () => {
    notifyTimer = undefined
    if (closed) return
    for (const listener of listeners) {
      try { listener() } catch (error) { ctx.logger.warn('团队面板通知失败：%s', error.message) }
    }
  }
  const changed = () => {
    if (closed || notifyTimer !== undefined) return
    notifyTimer = setTimeout(notify, NOTIFY_WINDOW_MS)
  }
  const signalFor = signal => signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal
  const persisted = row => ({ leadId: row.leadId, preset: row.preset, afterSeq: row.afterSeq, generation: row.generation, leadReceiptFloor: row.leadReceiptFloor })
  const save = (id, row) => { updateRecord(row.cwd, id, persisted(row)); records.set(id, row) }

  const assertLead = lead => {
    if (!lead) throw new Error('这个工具需要调用它的 Lead 会话')
    assertRoot(lead.session.header, ctx)
    if (presetIdOf(ctx, lead) !== 'team-dev') throw new Error('这个工具只由团队开发助手 Lead 调用')
    if (records.has(lead.id)) throw new Error('受管理工作会话不能再充当 Lead')
    return lead
  }

  const ensureAgent = async (id, signal) => {
    const live = ctx.agents.get(id)
    if (live) { assertRoot(live.session.header, ctx); return live }
    if (resumes.has(id)) return resumes.get(id)
    const operation = observe(ctx, id, signalFor(signal), async snapshot => {
      assertRoot(snapshot.header, ctx)
      const preset = snapshot.projections.agentPreset ?? snapshot.header.agentPreset
      const presets = ctx.get('agentPresets')
      if (!presets || !preset) throw new Error(`会话 ${id} 缺少可恢复的预设`)
      const handle = await ctx.agents.resume({
        resumeSessionId: id, agentOptions: restoredModel(snapshot), signal: signalFor(signal),
        setup: agentCtx => presets.mount(agentCtx, preset),
      })
      return handle.agent
    })
    resumes.set(id, operation)
    try { return await operation } finally { resumes.delete(id) }
  }

  const describe = async (id, signal, chars = config.resultChars, raw) => observe(ctx, id, signalFor(signal), async snapshot => {
    assertRoot(snapshot.header, ctx)
    const live = ctx.agents.get(id)
    // raw 是调用方已经读到的原始日志，避免同一份日志读两遍。
    const events = raw ?? (snapshot.source === 'prepared' ? (await readStored(ctx, id, signalFor(signal))).events : snapshot.events)
    const row = records.get(id)
    return {
      sessionId: id, title: snapshot.projections.title ?? id,
      preset: snapshot.projections.agentPreset ?? snapshot.header.agentPreset ?? '',
      cwd: snapshot.header.cwd ?? null, managed: Boolean(row), leadId: row?.leadId ?? null,
      status: (live ? questions?.count(id) ?? 0 : 0) ? 'waiting' : live ? live.status === 'running' ? 'running' : 'idle' : 'offline',
      pendingQuestions: live ? questions?.count(id) ?? 0 : 0,
      latestTurn: turnResult(events, chars),
      latestMessage: latestMessage(events, chars), deliveryError: errors.get(id) ?? null,
    }
  })

  /**
   * 团队可见的根会话：本工作目录、未归档、普通根会话。面板与 list_sessions 共用，
   * 口径只在这里定义一次。自己不在此排除，由调用方决定。
   * @param {readonly any[]} corpus @param {string} cwd @param {boolean | undefined} managedOnly @param {string | undefined} leadId
   */
  const visibleRoots = (corpus, cwd, managedOnly, leadId) => {
    const archived = new Set(ctx.get('workspaceRegistry')?.archivedSessionIds ?? [])
    return corpus.filter(record => isRoot(record.header, ctx)
      && isVisibleRoot(record.header, {
        cwd, archived, managedOnly, leadId, managedLeadId: records.get(record.header.id)?.leadId,
      }))
  }

  /**
   * 取一批会话的标题。live 行走投影（免费），冷会话逐个观察后取投影。
   * 不用 sessionQuery.readTitleSnapshots：它为每个会话做一次持久化列表预检，
   * 实测每会话约 0.9s、102 个 id 要 37.6s；一次观察冷读只要约 0.25s，且有缓存。
   * @param {readonly string[]} ids @param {AbortSignal | undefined} signal
   */
  const titlesOf = async (ids, signal) => {
    const titles = new Map()
    await mapLimit(ids, SESSION_READ_CONCURRENCY, async id => {
      const live = ctx.agents.get(id)
      const projected = live ? titleText(ctx.get('sessionProjections')?.stateOf(live.session, 'title')) : undefined
      if (projected !== undefined) { titles.set(id, projected); return }
      try {
        titles.set(id, await observe(ctx, id, signalFor(signal), snapshot => titleText(snapshot.projections.title)) ?? id)
      } catch {
        titles.set(id, id)
      }
    })
    return titles
  }

  /** 列表行：只用 header、管理记录与 live 状态，不读会话日志。 */
  const rowOf = (record, title) => {
    const id = record.header.id
    const live = ctx.agents.get(id)
    const row = records.get(id)
    const pending = live ? questions?.count(id) ?? 0 : 0
    return {
      sessionId: id, title: title ?? id,
      preset: record.header.agentPreset ?? '',
      cwd: record.header.cwd ?? null, managed: Boolean(row), leadId: row?.leadId ?? null,
      status: pending > 0 ? 'waiting' : live ? live.status === 'running' ? 'running' : 'idle' : 'offline',
      pendingQuestions: pending, deliveryError: errors.get(id) ?? null,
    }
  }

  const deliver = async (id, row, events, end) => {
    if (closed || records.get(id)?.generation !== row.generation) return
    const result = turnResult(events, config.resultChars, end.seq)
    const lead = await ensureAgent(row.leadId)
    assertLead(lead)
    if (records.get(id)?.generation !== row.generation) return
    if (!await ctx.sessions.flush(lead.session)) throw new Error('Lead 没有会话持久化监听，结果尚未确认投递')
    const receipt = await readStored(ctx, lead.id, shutdown.signal, row.leadReceiptFloor ?? 0)
    const messageId = `team-result:${row.generation}:${id}:${end.seq}`
    // 这次扫描覆盖到的最后一个 seq。它落在即将插入的收据之前，所以崩溃后重试
    // 从它读起仍能读到那条收据。
    const scannedThrough = receipt.events.at(-1)?.seq ?? row.leadReceiptFloor ?? 0
    const inserted = !hasReceipt(receipt.events, messageId)
    if (inserted) {
      const source = ctx.sessions.get(id)
      const title = source ? ctx.get('sessionTitle')?.get(source)?.title ?? id : id
      const heading = `受管理根会话 ${id}（${title}）第 ${result.turn} 轮已结束，状态：${result.reason}。\n这是该轮的最后一条正文，不代表整个任务已完成；根据结果决定是否继续安排。\n\n`
      const body = result.text || '本轮没有正文回复'
      const shortened = result.truncated || heading.length + body.length > config.resultChars
      const suffix = shortened ? `\n（正文已截断，可用 read_session 查看第 ${result.turn} 轮。）` : ''
      // 上限包含说明文字与截断提示。
      const room = Math.max(0, config.resultChars - heading.length - suffix.length)
      // 回传是机器送来的轮次结果，不是用户发言。`team-message` 是 ui-chat 已识别的
      // 来源（client/chat/turn-trigger.ts）：唤起空闲 Lead 时渲染成带「收到团队消息」
      // 标题与团队图标的通知卡，而不是用户气泡；`notice` 加 summary 给出折叠行摘要。
      lead.followup(userMessage(heading + body.slice(0, room) + suffix, messageId, {
        kind: 'team-message',
        form: 'notice',
        summary: `${title} 第 ${result.turn} 轮 · ${result.reason}`,
      }))
    }
    if (!await ctx.sessions.flush(lead.session)) throw new Error('Lead 的结果收据未持久化')
    if (records.get(id)?.generation !== row.generation) return
    // 只有确实插入了新收据才推进起点，否则会把还等着核对的旧收据跳过去，
    // 重试时就会重复投递同一条结果。不推进的话每次核对都要从纳管那一刻重扫。
    save(id, inserted
      ? { ...row, afterSeq: end.seq, leadReceiptFloor: scannedThrough }
      : { ...row, afterSeq: end.seq })
    errors.delete(id)
    changed()
  }

  const catchUp = async id => {
    const row = records.get(id)
    if (!row || closed) return
    const source = ctx.sessions.get(id)
    const cutoff = source ? source.seq - 1 : undefined
    if (source && !await ctx.sessions.flush(source)) throw new Error('工作会话没有持久化监听')
    const offset = Math.max(0, row.afterSeq + 1)
    if (cutoff !== undefined && cutoff < offset) return
    const snapshot = await readStored(ctx, id, shutdown.signal, offset, cutoff === undefined ? undefined : cutoff - offset + 1)
    assertRoot(snapshot.header, ctx)
    for (const end of snapshot.events.filter(event => event.type === 'turn/end')) {
      const current = records.get(id)
      if (!current || current.generation !== row.generation) return
      let startSeq = source ? ctx.sessionProjections.stateOf(source, 'turnOutline')?.turns.find(entry => entry.turn === end.data.turn)?.seq : undefined
      if (startSeq === undefined) {
        const complete = await readStored(ctx, id, shutdown.signal, 0, end.seq + 1)
        startSeq = complete.events.findLast(event => event.type === 'turn/start' && event.data.turn === end.data.turn)?.seq ?? 0
      }
      const range = await readStored(ctx, id, shutdown.signal, startSeq, end.seq - startSeq + 1)
      await deliver(id, current, range.events, end)
    }
  }

  const queue = id => {
    if (!records.has(id) || closed) return
    const previous = deliveries.get(id) ?? Promise.resolve()
    const operation = previous.then(() => catchUp(id)).catch(error => {
      if (closed) return
      errors.set(id, error.message)
      ctx.logger.warn('根会话 %s 的结果尚未回传：%s', id, error.message)
      changed()
    })
    deliveries.set(id, operation)
    track(operation).then(() => { if (deliveries.get(id) === operation) deliveries.delete(id) })
  }

  const manager = {
    config, track, changed, assertLead, ensureAgent,
    owner: id => records.get(id),
    async load() {
      const corpus = await ctx.sessionQuery.listSessions(shutdown.signal)
      const directories = new Set(corpus.map(row => row.header.cwd).filter(Boolean))
      for (const cwd of directories) {
        shutdown.signal.throwIfAborted()
        for (const [id, record] of Object.entries(readRecords(cwd))) {
          if (records.has(id)) throw new Error(`会话 ${id} 有重复的团队管理记录`)
          let afterSeq = record.afterSeq
          if (afterSeq === undefined) {
            // 旧记录只建立新的投递起点，不重发纳入管理前的历史轮次。
            const stored = await readStored(ctx, id, shutdown.signal)
            afterSeq = stored.events.at(-1)?.seq ?? -1
          }
          shutdown.signal.throwIfAborted()
          const row = { ...record, afterSeq, generation: record.generation ?? randomUUID(), leadReceiptFloor: record.leadReceiptFloor ?? 0, cwd }
          if (record.afterSeq === undefined || record.generation === undefined) save(id, row)
          else records.set(id, row)
        }
      }
    },
    start() {
      shutdown.signal.throwIfAborted()
      questions = createQuestions(ctx, manager, config.questionHistoryLimit)
      for (const id of records.keys()) queue(id)
    },
    async manage(lead, id, action, signal) {
      assertLead(lead)
      const previous = records.get(id)
      if (action === 'remove') {
        if (!previous || previous.leadId !== lead.id) throw new Error(`会话 ${id} 不在这个 Lead 的管理范围`)
        updateRecord(previous.cwd, id, undefined)
        records.delete(id)
        errors.delete(id)
        questions.release(id)
        changed()
        return { sessionId: id, managed: false }
      }
      if (action !== 'add') throw new Error('action 必须是 add 或 remove')
      if (id === lead.id) throw new Error('Lead 不能把自己纳入工作会话')
      if (previous && previous.leadId !== lead.id) throw new Error(`会话 ${id} 已由 Lead ${previous.leadId} 管理；需先从原 Lead 移出`)
      if ([...records.values()].some(row => row.leadId === id)) throw new Error('已经管理其他会话的 Lead 不能成为工作会话')
      if (!previous) {
        await observe(ctx, id, signalFor(signal), async snapshot => {
          assertRoot(snapshot.header, ctx)
          const stored = snapshot.source === 'live' ? null : await readStored(ctx, id, signalFor(signal))
          const live = ctx.sessions.get(id)
          const afterSeq = live ? live.seq - 1 : stored?.events.at(-1)?.seq ?? -1
          const leadReceiptFloor = lead.session.seq
          if (!await ctx.sessions.flush(lead.session)) throw new Error('Lead 的管理操作未能持久化')
          // 权属校验与写入之间没有 await，避免多个 Lead 同时抢入同一会话。
          assertLead(lead)
          const current = records.get(id)
          if (current && current.leadId !== lead.id) throw new Error(`会话 ${id} 已由 Lead ${current.leadId} 管理`)
          if ([...records.values()].some(row => row.leadId === id)) throw new Error('已经管理其他会话的 Lead 不能成为工作会话')
          if (current) return
          const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
          save(id, {
            leadId: lead.id, preset: snapshot.projections.agentPreset ?? snapshot.header.agentPreset ?? '',
            afterSeq, leadReceiptFloor, generation: randomUUID(), cwd,
          })
        })
      }
      questions.adopt(id, records.get(id))
      queue(id)
      changed()
      return { sessionId: id, managed: true }
    },
    async list(lead, args = {}, signal) {
      assertLead(lead)
      const offset = args.offset ?? 0
      const limit = args.limit ?? 20
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('offset 必须非负，limit 必须是 1 至 100 的整数')
      if (args.session_ids !== undefined
        && (!Array.isArray(args.session_ids) || args.session_ids.some(id => typeof id !== 'string' || id === ''))) {
        throw new Error('session_ids 必须是非空字符串数组')
      }
      const wanted = [...new Set(args.session_ids ?? [])]
      const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
      const corpus = await ctx.sessionQuery.listSessions(signalFor(signal))
      // 自己不作为工作会话出现在列表里；面板保留自己。
      const visible = visibleRoots(corpus, cwd, args.managed_only, lead.id)
        .filter(record => record.header.id !== lead.id)
      const page = visible.slice(offset, offset + limit)
      // 点名的会话即使不在当页也要返回，否则模型得先算分页位置。
      const named = visible.filter(record => wanted.includes(record.header.id) && !page.includes(record))
      const rows = [...page, ...named]
      const titles = await titlesOf(rows.map(record => record.header.id), signal)
      const sessions = await Promise.all(rows.map(async record => {
        const row = rowOf(record, titles.get(record.header.id))
        // 正文只在显式点名时读取；默认路径一次会话日志都不读。
        if (!wanted.includes(record.header.id)) return row
        try {
          const detail = await describe(record.header.id, signal, 240)
          return { ...row, latestTurn: detail.latestTurn, latestMessage: detail.latestMessage }
        } catch {
          return { ...row, latestTurn: null, latestMessage: null }
        }
      }))
      const found = new Set(visible.map(record => record.header.id))
      return {
        sessions, total: visible.length,
        nextOffset: offset + limit < visible.length ? offset + limit : null,
        ...wanted.length > 0 ? { missed: wanted.filter(id => !found.has(id)) } : {},
      }
    },
    async read(lead, args, signal) {
      assertLead(lead)
      const id = requiredText(args.session_id, 'session_id')
      const offset = args.offset ?? 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) throw new Error('offset 必须是 0 至 10000000 的整数')
      // 原始日志保证指定轮次结果不是冷读取合成的结束事件；只读一次，describe 复用同一份事件。
      const stored = await readStored(ctx, id, signalFor(signal))
      const state = await describe(id, signal, config.resultChars, stored.events)
      const ends = stored.events.filter(event => event.type === 'turn/end')
      const end = args.turn === undefined ? ends.at(-1) : ends.findLast(event => event.data.turn === args.turn)
      if (args.turn !== undefined && !end) throw new Error(`会话 ${id} 没有已结束的第 ${args.turn} 轮`)
      const result = end ? turnResult(stored.events, offset + config.resultChars, end.seq) : null
      if (result) {
        result.text = result.text.slice(offset)
        result.offset = offset
        result.nextOffset = result.truncated ? offset + result.text.length : null
      }
      return { ...state, latestTurn: result, questions: questions.view(id) }
    },
    reply(lead, args) { assertLead(lead); return questions.reply(lead, args) },
    async panel(sessionId, signal) {
      // 面板不做 Lead 过滤：任何会话打开都看到同一工作目录下未归档的根会话。
      const viewed = await describe(sessionId, signal, 240)
      const cwd = viewed.cwd
      if (cwd === null) return { ok: true, cwd: null, sessions: [] }
      const corpus = await ctx.sessionQuery.listSessions(signalFor(signal))
      const visible = visibleRoots(corpus, cwd, false, undefined)
      const sessions = await mapLimit(visible, SESSION_READ_CONCURRENCY, async row => {
        try {
          // managed 只表示在某个 Lead 的管理范围，不限制面板可见性。
          return { ...(await describe(row.header.id, signal)), managed: records.has(row.header.id) }
        } catch (error) {
          return {
            sessionId: row.header.id, title: row.header.id, preset: row.header.agentPreset ?? '',
            managed: records.has(row.header.id), status: 'missing', pendingQuestions: 0,
            latestTurn: null, latestMessage: null,
          }
        }
      })
      return { ok: true, cwd, sessions }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    onEvent(session, event) {
      if (event.type === 'turn/end' && records.has(session.id)) queue(session.id)
      if (['turn/start', 'turn/end', 'assistant/message', 'tool/call', 'tool/result', 'session/title', 'agent-preset/selected'].includes(event.type)) changed()
    },
    onAgent(agent) {
      if (records.has(agent.id)) queue(agent.id)
      for (const [id, row] of records) if (row.leadId === agent.id) queue(id)
      changed()
    },
    async dispose() {
      closed = true
      // 未触发的合并窗口必须清掉，否则插件卸载后还会再敲一次监听者。
      if (notifyTimer !== undefined) { clearTimeout(notifyTimer); notifyTimer = undefined }
      questions?.dispose()
      shutdown.abort(new Error('团队管理插件已卸载'))
      for (const listener of listeners) {
        try { listener(true) } catch (error) { ctx.logger.warn('团队面板连接关闭失败：%s', error.message) }
      }
      listeners.clear()
      await Promise.allSettled([...jobs, ...resumes.values()])
    },
  }
  return manager
}

/** @param {any} manager @param {Request} request @returns {Response} */
function watch(manager, request) {
  let release = () => {}
  let close = () => {}
  let dirty = false
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      close = () => {
        if (closed) return
        closed = true
        release()
        request.signal.removeEventListener('abort', close)
        controller.close()
      }
      release = manager.subscribe(ending => {
        if (ending) return close()
        if (closed) return
        if ((controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode('event: changed\ndata: {}\n\n'))
        else dirty = true
      })
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) close()
      else controller.enqueue(encoder.encode('event: changed\ndata: {}\n\n'))
    },
    pull(controller) {
      if (dirty) { dirty = false; controller.enqueue(encoder.encode('event: changed\ndata: {}\n\n')) }
    },
    cancel() { release(); request.signal.removeEventListener('abort', close) },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
}

/** @param {any} ctx @param {{resultChars: number, questionHistoryLimit: number}} config */
export async function apply(ctx, config) {
  const root = ctx.root ?? ctx
  if (managers.has(root)) throw new Error('团队管理 Host 重复加载')
  const manager = createManager(ctx, config)
  const disposers = []
  // 在第一次异步读取前建立取消与清理所有权。
  ctx.effect(() => {
    managers.set(root, manager)
    return async () => {
      managers.delete(root)
      await manager.dispose()
      for (const dispose of disposers.reverse()) await dispose()
    }
  }, 'personal-team-sessions')
  await manager.track(manager.load())
  disposers.push(
      ctx.on('session/event', (session, event) => manager.onEvent(session, event)),
      ctx.on('agent/created', ({ agent }) => manager.onAgent(agent)),
      ctx.on('agent/disposed', () => manager.changed()),
      ctx.on('agent/status', () => manager.changed()),
      ctx.connection.fetch.register({
        path: PANEL_PATH, methods: ['GET'], requestBody: 'buffered',
        async fetch(request) {
          const url = new URL(request.url)
          const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          try {
            const id = requiredText(url.searchParams.get('sessionId'), 'sessionId')
            if (url.searchParams.get('watch') === '1') return watch(manager, request)
            return new Response(JSON.stringify(await manager.panel(id, request.signal)), { headers })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 400, headers })
          }
        },
      }),
  )
  manager.start()
}
