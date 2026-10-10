/** 团队管理的 Host：管理关系、轮次结果投递和面板共用同一个实例。 */
import { randomUUID } from 'node:crypto'
import {
  adoptMembers, assertRoot, goalWillContinue, hasReceipt, isRoot, isVisibleRoot, latestMessage, liveLeadId, mapLimit,
  mountPreset, observe, presetIdOf, readRecords, readStored, requiredText, restoredModel, titleText, turnResult,
  updateLead, updateRecord, userMessage, writeTeam,
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

/**
 * 测试把 {@link createManager} 的实例挂到 ctx 上，让 Lead 工具能找到它。
 * @param {any} ctx @param {any} manager @returns {() => void}
 */
export function bindManager(ctx, manager) {
  const root = ctx.root ?? ctx
  managers.set(root, manager)
  return () => { if (managers.get(root) === manager) managers.delete(root) }
}

/**
 * 建一个管理实例。导出是为了让测试能用最小的假 ctx 在进程内驱动它：接管询问、
 * 归属转移、面板写操作这些路径都要真实走一遍，而不是只测纯函数。
 * @param {any} ctx @param {{resultChars: number, questionHistoryLimit: number}} config @returns {any}
 */
export function createManager(ctx, config) {
  const records = new Map()
  /** 本工作区登记在册的 Lead：cwd → 会话 id。一个工作区只保留一个。 */
  const leads = new Map()
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
  /** 等待工具要马上看到状态变化；面板通知仍走下面的合并窗口。 */
  const activityListeners = new Set()
  /** 一条结果或提问真正 followup 进 Lead 之后才通知。调用前已经送出的不重放。 */
  const inboundWaiters = new Set()
  const noteInbound = (notice) => {
    for (const waiter of inboundWaiters) {
      try { waiter(notice) } catch (error) { ctx.logger.warn('团队等待通知失败：%s', error.message) }
    }
  }
  const changed = () => {
    for (const listener of activityListeners) {
      try { listener() } catch (error) { ctx.logger.warn('团队等待通知失败：%s', error.message) }
    }
    if (closed || notifyTimer !== undefined) return
    notifyTimer = setTimeout(notify, NOTIFY_WINDOW_MS)
  }
  const signalFor = signal => signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal
  const persisted = row => ({ leadId: row.leadId, preset: row.preset, afterSeq: row.afterSeq, generation: row.generation, leadReceiptFloor: row.leadReceiptFloor })
  const save = (id, row) => { updateRecord(row.cwd, id, persisted(row)); records.set(id, row) }

  /** 归档的会话不再算数：登记的 Lead 一旦归档，这个工作区的槽位就空出来给人接管。 */
  const isArchived = id => (ctx.get('workspaceRegistry')?.archivedSessionIds ?? []).includes(id)
  const membersOf = leadId => [...records.values()].filter(row => row.leadId === leadId).length

  /** 能不能当 Lead：根会话、预设、不是受管理工作会话。与"是否已登记"无关。 */
  const assertCandidate = lead => {
    if (!lead) throw new Error('这个工具需要调用它的 Lead 会话')
    assertRoot(lead.session.header, ctx)
    if (presetIdOf(ctx, lead) !== 'team-dev') throw new Error('这个工具只由团队开发助手 Lead 调用')
    if (records.has(lead.id)) throw new Error('受管理工作会话不能再充当 Lead')
    return lead
  }

  /** 要求调用者就是本工作区登记在册的 Lead；未登记时六个工具全部报错并指向 become_lead。 */
  const assertLead = lead => {
    assertCandidate(lead)
    const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
    if (isArchived(lead.id) || leads.get(cwd) !== lead.id) {
      throw new Error(`这个会话不是本工作区（${cwd}）的 Lead；请先调用 become_lead 成为 Lead`)
    }
    return lead
  }

  /**
   * 当前仍可用的会话语料与 id 集合（排除已归档）。一次列举同时供槽位判定与面板使用，
   * 避免一次面板加载做两遍全局列举。
   * @param {AbortSignal | undefined} signal
   */
  const usableSessions = async signal => {
    const corpus = await ctx.sessionQuery.listSessions(signalFor(signal))
    const archived = new Set(ctx.get('workspaceRegistry')?.archivedSessionIds ?? [])
    return { corpus, ids: corpus.filter(row => !archived.has(row.header.id)).map(row => row.header.id) }
  }

  /**
   * 落盘核心：把槽位与成员一次交给 leadId。`expected` 是决定接管之前观察到的槽位；
   * 复查发现它变了就整体失败 —— 用户同意的是"替换那一个"，不是"替换任何一个"。
   * 这里到写盘之间没有任何 await，两个并发接管只有一个能落盘。
   * @param {string} cwd @param {string} leadId @param {readonly string[]} ids @param {string | undefined} expected
   * @returns {{replaced: string | null}}
   */
  const seatLead = (cwd, leadId, ids, expected) => {
    const snapshot = readRecords(cwd)
    const incumbent = liveLeadId(snapshot.leadId, ids)
    if (incumbent !== expected) {
      throw new Error(`本工作区的 Lead 槽位已经变了（现在是 ${incumbent ?? '空'}）；本次接管未生效，请重新决定`)
    }
    const sessions = adoptMembers(snapshot.sessions, leadId)
    for (const [id, row] of Object.entries(sessions)) {
      const known = records.get(id)
      if (known !== undefined && row.leadId === leadId) records.set(id, { ...known, ...row })
    }
    writeTeam(cwd, { leadId, sessions })
    leads.set(cwd, leadId)
    changed()
    return { replaced: incumbent ?? null }
  }

  /**
   * 工具入口：模型驱动，所以接管必须先问用户。用户取消或拒绝都不改任何东西。
   * @param {any} lead @param {{takeover?: boolean}} args @param {AbortSignal | undefined} signal
   */
  const becomeLead = async (lead, args = {}, signal) => {
    assertCandidate(lead)
    const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
    const ids = (await usableSessions(signal)).ids
    const incumbent = liveLeadId(readRecords(cwd).leadId, ids)
    if (incumbent === lead.id) return { sessionId: lead.id, members: membersOf(lead.id), replaced: null }
    if (incumbent !== undefined && args.takeover !== true) {
      const title = (await titlesOf([incumbent], signal)).get(incumbent) ?? incumbent
      throw new Error(`本工作区已有 Lead ${incumbent}（${title}）；要替换它请再次调用并带 takeover: true，届时会先询问用户`)
    }
    if (incumbent !== undefined) {
      const interaction = ctx.get('userQuestions')
      if (interaction === undefined) throw new Error('没有可用的用户问答通道，无法确认替换 Lead')
      const APPROVE = '替换 Lead'
      try {
        const answer = await interaction.ask({
          agent: lead, signal: signalFor(signal),
          questions: [{
            id: 'team-takeover',
            header: '替换 Lead',
            question: '当前团队已有 Lead。继续会让这个会话成为新的 Lead，是否替换？',
            detail: `现任 Lead：${incumbent}\n替换后，它名下 ${membersOf(incumbent)} 个成员会全部转到这个会话名下。`,
            options: [
              { label: APPROVE, description: '这个会话成为本工作区新的 Lead，并接管现有成员。' },
              { label: '保持现状', description: '什么都不改，现任 Lead 继续。' },
            ],
          }],
        })
        const row = (answer?.answers ?? []).find(entry => entry.id === 'team-takeover')
        if (!(row?.selected ?? []).includes(APPROVE)) throw new Error('用户选择保持现状')
      } catch (error) {
        throw new Error(`没有取得用户同意，本工作区保持原状：${error?.message ?? error}`)
      }
    }
    const { replaced } = seatLead(cwd, lead.id, ids, incumbent)
    return { sessionId: lead.id, members: membersOf(lead.id), replaced }
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
        setup: mountPreset(presets, preset),
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
    const pending = live ? questions?.count(id) ?? 0 : 0
    return {
      sessionId: id, title: snapshot.projections.title ?? id,
      preset: snapshot.projections.agentPreset ?? snapshot.header.agentPreset ?? '',
      cwd: snapshot.header.cwd ?? null, managed: Boolean(row), leadId: row?.leadId ?? null,
      // 状态只表达任务状态：没载入本进程的会话，与载入后当下没事做的会话，对用户是同一件事。
      status: pending > 0 ? 'waiting' : live?.status === 'running' ? 'running' : 'idle',
      pendingQuestions: pending,
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
      status: pending > 0 ? 'waiting' : live?.status === 'running' ? 'running' : 'idle',
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
      noteInbound({ sessionId: id, leadId: row.leadId, kind: 'result' })
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

  /** 本轮结束后驱动还会自己续。读不到 goal 时不当成会续，免得把最后一轮吞掉。 */
  const goalContinues = (session, reasonKind) => {
    const agent = ctx.agents.get(session.id)
    const goals = ctx.get('goals')
    if (!agent || typeof goals?.get !== 'function') return false
    try { return goalWillContinue(goals.get(agent), reasonKind) }
    catch { return false }
  }
  /** 跳过这一轮的回传，只推进投递起点。 */
  const skipTurn = (id, endSeq) => {
    const row = records.get(id)
    if (!row || !Number.isSafeInteger(endSeq) || row.afterSeq >= endSeq) return
    save(id, { ...row, afterSeq: endSeq })
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
    track(operation).then(() => {
      if (deliveries.get(id) === operation) deliveries.delete(id)
      // 没发出新消息时，等待中的 Lead 要看到“已经没有在途回传”。
      changed()
    })
  }

  /** 读槽位：登记在册且仍然存在的 Lead。 */
  const leadIdOf = (cwd, ids) => liveLeadId(readRecords(cwd).leadId, ids)

  /** 移出一个成员。expectedLead 给出时要求归属匹配；面板移出孤儿成员时传 undefined。 */
  const removeMember = (cwd, id, expectedLead) => {
    const previous = records.get(id)
    if (!previous) throw new Error(`会话 ${id} 不在管理范围`)
    if (expectedLead !== undefined && previous.leadId !== expectedLead) {
      throw new Error(`会话 ${id} 不在这个 Lead 的管理范围`)
    }
    updateRecord(previous.cwd, id, undefined)
    records.delete(id)
    errors.delete(id)
    questions.release(id)
    changed()
    return { sessionId: id, managed: false }
  }

  /**
   * 把一个根会话纳入 leadId 名下。lead 给出时（工具路径）额外做 Lead 身份复查；
   * 面板路径的操作者是人，只校验 cwd 与槽位没变。
   * @param {string} leadId @param {string} cwd @param {string} id @param {AbortSignal | undefined} signal @param {any} [lead]
   */
  const seatMember = async (leadId, cwd, id, signal, lead) => {
    const previous = records.get(id)
    if (previous) {
      if (previous.leadId !== leadId) throw new Error(`会话 ${id} 已经在团队里（归属 ${previous.leadId}）；先移出再纳入`)
      return { sessionId: id, managed: true }
    }
    if ([...records.values()].some(row => row.leadId === id)) throw new Error('已经管理其他会话的 Lead 不能成为工作会话')
    await observe(ctx, id, signalFor(signal), async snapshot => {
      assertRoot(snapshot.header, ctx)
      // 一个工作区一个 Lead：跨工作目录纳入的成员既不在列表里也不在面板里，只能靠 id 移出。
      if (snapshot.header.cwd !== cwd) {
        throw new Error(`会话 ${id} 的工作目录是 ${snapshot.header.cwd ?? '（无）'}，不在本工作区 ${cwd}；不能纳入`)
      }
      const stored = snapshot.source === 'live' ? null : await readStored(ctx, id, signalFor(signal))
      const live = ctx.sessions.get(id)
      const afterSeq = live ? live.seq - 1 : stored?.events.at(-1)?.seq ?? -1
      const owner = lead ?? ctx.agents.get(leadId)
      if (owner && !await ctx.sessions.flush(owner.session)) throw new Error('Lead 的管理操作未能持久化')
      // 权属校验与写入之间没有 await，避免多个 Lead 同时抢入同一会话。
      if (lead) assertLead(lead)
      const current = records.get(id)
      if (current) {
        if (current.leadId !== leadId) throw new Error(`会话 ${id} 已由 Lead ${current.leadId} 管理`)
        return
      }
      if (leads.get(cwd) !== leadId) throw new Error(`本工作区（${cwd}）的 Lead 已经变了；请重新决定`)
      if ([...records.values()].some(row => row.leadId === id)) throw new Error('已经管理其他会话的 Lead 不能成为工作会话')
      save(id, {
        leadId, preset: snapshot.projections.agentPreset ?? snapshot.header.agentPreset ?? '',
        afterSeq, leadReceiptFloor: owner?.session.seq ?? 0, generation: randomUUID(), cwd,
      })
    })
    questions.adopt(id, records.get(id))
    queue(id)
    changed()
    return { sessionId: id, managed: true }
  }

  const manager = {
    config, track, changed, noteInbound, assertLead, becomeLead, ensureAgent,
    owner: id => records.get(id),
    async load() {
      const corpus = await ctx.sessionQuery.listSessions(shutdown.signal)
      const archived = new Set(ctx.get('workspaceRegistry')?.archivedSessionIds ?? [])
      // 已归档的不再算数：登记的 Lead 一旦归档，这个工作区的槽位就空出来给人接管。
      const usable = corpus.filter(row => !archived.has(row.header.id)).map(row => row.header.id)
      const directories = new Set(corpus.map(row => row.header.cwd).filter(Boolean))
      for (const cwd of directories) {
        shutdown.signal.throwIfAborted()
        const stored = readRecords(cwd)
        const lead = liveLeadId(stored.leadId, usable)
        if (lead !== undefined) leads.set(cwd, lead)
        for (const [id, record] of Object.entries(stored.sessions)) {
          if (records.has(id)) throw new Error(`会话 ${id} 有重复的团队管理记录`)
          let afterSeq = record.afterSeq
          if (afterSeq === undefined) {
            // 旧记录只建立新的投递起点，不重发纳入管理前的历史轮次。
            const log = await readStored(ctx, id, shutdown.signal)
            afterSeq = log.events.at(-1)?.seq ?? -1
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
      const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
      if (action === 'remove') return removeMember(cwd, id, lead.id)
      if (action !== 'add') throw new Error('action 必须是 add 或 remove')
      if (id === lead.id) throw new Error('Lead 不能把自己纳入工作会话')
      return seatMember(lead.id, cwd, id, signal, lead)
    },
    /**
     * 面板写操作。操作者是人不是 Lead，所以不走 assertLead；cwd、根会话、一个工作区
     * 一个 Lead、成员互斥这些不变式照旧强制。接管由用户在界面上确认，不再走服务端弹问
     * —— 打开面板的会话可能是冷的，而 userQuestions.ask 要求精确的 live 根 agent。
     * @param {string} viewedId @param {string} action @param {string | undefined} targetId @param {AbortSignal | undefined} signal
     */
    async panelAct(viewedId, action, targetId, signal) {
      const viewed = await observe(ctx, viewedId, signalFor(signal), snapshot => snapshot)
      const cwd = requiredText(viewed.header.cwd, '面板会话工作目录')
      const ids = (await usableSessions(signal)).ids
      const seated = leadIdOf(cwd, ids)
      if (action === 'lose-lead') {
        if (seated === undefined) throw new Error('本工作区还没有 Lead')
        if (targetId !== seated) throw new Error(`会话 ${targetId} 不是本工作区的 Lead（现任 ${seated}）`)
        const members = membersOf(seated)
        updateLead(cwd, undefined)
        leads.delete(cwd)
        changed()
        return { action, leadId: null, members }
      }
      const target = await observe(ctx, targetId, signalFor(signal), snapshot => snapshot)
      assertRoot(target.header, ctx)
      if (target.header.cwd !== cwd) throw new Error('只能操作本工作目录下的根会话')
      if (action === 'become-lead') {
        if (target.header.agentPreset !== 'team-dev') {
          throw new Error(`会话 ${targetId} 的预设是 ${target.header.agentPreset ?? '（无）'}，只有团队开发助手会话能当 Lead`)
        }
        if (records.has(targetId)) throw new Error(`会话 ${targetId} 是受管理工作会话，不能再充当 Lead`)
        const { replaced } = seatLead(cwd, targetId, ids, seated)
        return { action, leadId: targetId, replaced, members: membersOf(targetId) }
      }
      if (action === 'add') {
        if (seated === undefined) throw new Error('本工作区还没有 Lead；先让某个团队开发助手会话成为 Lead')
        if (targetId === seated) throw new Error('Lead 不能把自己纳入工作会话')
        return { action, ...(await seatMember(seated, cwd, targetId, signal)) }
      }
      if (action === 'remove') return { action, ...removeMember(cwd, targetId, undefined) }
      throw new Error(`未知的面板操作：${action}`)
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
    /**
     * 改一个本工作目录根会话的下一次模型请求。不改账号默认，也不打断正在跑的轮次。
     * @param {any} lead @param {string} id @param {{provider: string, model: string, reasoningEffort: string}} selection
     * @param {AbortSignal | undefined} signal
     */
    async setSessionModel(lead, id, selection, signal) {
      assertLead(lead)
      if (id === lead.id) throw new Error('不能改 Lead 自己的模型；用会话自己的模型选择')
      const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
      // 先核对目录再恢复，避免把别的工作区的冷会话拉起来。
      const live = ctx.agents.get(id)
      const header = live?.session.header ?? await observe(ctx, id, signalFor(signal), snapshot => snapshot.header)
      assertRoot(header, ctx)
      if (header.cwd !== cwd) throw new Error(`会话 ${id} 不在本工作区 ${cwd}`)
      const agent = live ?? await ensureAgent(id, signal)
      const controller = ctx.get('sessionController')
      if (!controller?.selectSessionModel) throw new Error('会话模型选择不可用')
      const installed = await controller.selectSessionModel({
        sessionId: id,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
      })
      return { sessionId: id, ...installed.selected }
    },
    /**
     * 停止一个本工作目录根会话的当前轮，并留下排队消息。和界面上的停止按钮相同。
     * 没在本进程运行的会话不会被拉起来。
     * @param {any} lead @param {string} id
     * @returns {{sessionId: string, stopped: boolean}}
     */
    stopSession(lead, id) {
      assertLead(lead)
      if (id === lead.id) throw new Error('不能停止 Lead 自己')
      const cwd = requiredText(lead.session.header.cwd, 'Lead 工作目录')
      const live = ctx.agents.get(id)
      if (!live) return { sessionId: id, stopped: false }
      assertRoot(live.session.header, ctx)
      if (live.session.header.cwd !== cwd) throw new Error(`会话 ${id} 不在本工作区 ${cwd}`)
      if (live.status !== 'running') return { sessionId: id, stopped: false }
      live.cancel({ kind: 'user' }, { keepInbox: true })
      return { sessionId: id, stopped: true }
    },
    /**
     * 等到这个 Lead 名下第一个新消息，或超时。消息是真正送进 Lead 的一轮结果或一次提问。
     * 已经有待答提问，或眼下没有会再发来消息的会话时立刻返回。超时不抛错。
     * @param {any} lead @param {number} timeout @param {AbortSignal | undefined} signal
     */
    wait(lead, timeout, signal) {
      assertLead(lead)
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error('timeout_seconds 必须是 1 至 3600 的整数')
      const managedIds = () => [...records.entries()].filter(([, row]) => row.leadId === lead.id).map(([id]) => id)
      const firstPending = () => managedIds().find(id => (questions?.count(id) ?? 0) > 0)
      const queued = agent => (agent?.inbox?.nextTurn?.length ?? 0) + (agent?.inbox?.nextStep?.length ?? 0)
      // goal 还会自己续时，中间空闲不是停止，也不能当成没有消息。
      const willContinue = id => {
        const agent = ctx.agents.get(id)
        const goals = ctx.get('goals')
        if (!agent || typeof goals?.get !== 'function') return false
        try { return goalWillContinue(goals.get(agent), undefined) } catch { return false }
      }
      const needsWait = () => managedIds().some(id => {
        const live = ctx.agents.get(id)
        return live?.status === 'running' || queued(live) > 0 || deliveries.has(id) || willContinue(id)
      })
      const pendingNow = firstPending()
      if (pendingNow !== undefined) return { sessionId: pendingNow, kind: 'question', timedOut: false, waited: false }
      if (!needsWait()) return { kind: 'none', timedOut: false, waited: false }
      const linked = signalFor(signal)
      return new Promise((resolve, reject) => {
        let settled = false
        const finish = (value, error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          inboundWaiters.delete(onInbound)
          activityListeners.delete(tick)
          linked.removeEventListener('abort', onAbort)
          if (error) reject(error)
          else resolve(value)
        }
        const onInbound = (notice) => {
          if (notice.leadId !== lead.id || records.get(notice.sessionId)?.leadId !== lead.id) return
          finish({ sessionId: notice.sessionId, kind: notice.kind, timedOut: false, waited: true })
        }
        const tick = () => {
          const pending = firstPending()
          if (!needsWait()) {
            finish(pending === undefined
              ? { kind: 'none', timedOut: false, waited: true }
              : { sessionId: pending, kind: 'question', timedOut: false, waited: true })
          }
        }
        const onAbort = () => finish(null, linked.reason instanceof Error ? linked.reason : new Error('等待已取消'))
        const timer = setTimeout(() => {
          const pending = firstPending()
          if (pending !== undefined) finish({ sessionId: pending, kind: 'question', timedOut: false, waited: true })
          else finish({ kind: 'none', timedOut: needsWait(), waited: true })
        }, timeout * 1000)
        inboundWaiters.add(onInbound)
        activityListeners.add(tick)
        if (linked.aborted) onAbort()
        else linked.addEventListener('abort', onAbort, { once: true })
        tick()
      })
    },
    async panel(sessionId, signal) {
      // 面板不做 Lead 过滤：任何会话打开都看到同一工作目录下未归档的根会话。
      const viewed = await describe(sessionId, signal, 240)
      const cwd = viewed.cwd
      if (cwd === null) return { ok: true, cwd: null, lead: null, members: 0, canManage: false, sessions: [] }
      const { corpus, ids } = await usableSessions(signal)
      const lead = leadIdOf(cwd, ids)
      const leadTitle = lead === undefined ? null : (await titlesOf([lead], signal)).get(lead) ?? lead
      const visible = visibleRoots(corpus, cwd, false, undefined)
      // 只有团队开发助手会话能当 Lead；受管理工作会话不行。
      const flags = row => ({
        managed: records.has(row.header.id),
        isLead: row.header.id === lead,
        canBeLead: row.header.id !== lead && !records.has(row.header.id) && row.header.agentPreset === 'team-dev',
      })
      const sessions = await mapLimit(visible, SESSION_READ_CONCURRENCY, async row => {
        try {
          // managed 只表示在某个 Lead 的管理范围，不限制面板可见性。
          return { ...(await describe(row.header.id, signal)), ...flags(row) }
        } catch (error) {
          return {
            sessionId: row.header.id, title: row.header.id, preset: row.header.agentPreset ?? '',
            status: 'missing', pendingQuestions: 0, latestTurn: null, latestMessage: null,
            ...flags(row),
          }
        }
      })
      return {
        ok: true, cwd,
        lead: lead === undefined ? null : { sessionId: lead, title: leadTitle },
        // 成员数按本工作目录的记录数算：归属已消失 Lead 的孤儿成员也算在团队里。
        members: [...records.values()].filter(row => row.cwd === cwd).length,
        canManage: lead !== undefined,
        sessions,
      }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    onEvent(session, event) {
      if (event.type === 'turn/end' && records.has(session.id)) {
        // goal 会先回到空闲再立刻开下一轮。这种一轮不回传，但要把投递起点推过去，
        // 否则等它真正停下时，catchUp 会把中间轮次补发给 Lead。
        if (goalContinues(session, event.data?.reason?.kind)) skipTurn(session.id, event.seq)
        else queue(session.id)
      }
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
        path: PANEL_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
        async fetch(request) {
          const url = new URL(request.url)
          const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
          try {
            if (request.method === 'POST') {
              let body
              try {
                const text = await request.text()
                if (text.length > 4000) throw new Error('请求体过大')
                body = JSON.parse(text)
              } catch (error) {
                throw new Error(`面板写请求不是合法 JSON：${error?.message ?? error}`)
              }
              const sessionId = requiredText(body?.sessionId, 'sessionId')
              const action = requiredText(body?.action, 'action')
              const target = body?.target === undefined ? undefined : requiredText(body.target, 'target')
              return new Response(
                JSON.stringify({ ok: true, ...(await manager.panelAct(sessionId, action, target, request.signal)) }),
                { headers },
              )
            }
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
