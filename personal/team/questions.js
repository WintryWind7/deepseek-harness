/** 受管理根会话的提问保留用户弹窗，并允许所属 Lead 竞争回答。 */
import { assertRoot, latestMessage, requiredText, userMessage } from './runtime.js'

/** @param {any} answer @returns {string} */
function formatAnswer(answer) {
  return (answer?.answers ?? []).map(row => `${row.id}：${[...(row.selected ?? []), row.custom ?? ''].filter(Boolean).join('；')}`).join('\n')
}

/**
 * 提问通知。`prior` 是这一步里、工具调用之外的正文；助手消息在执行工具前已经写入。
 * @param {string} id @param {readonly any[]} questions @param {{text: string, truncated: boolean} | null} [prior] @returns {string}
 */
export function formatQuestions(id, questions, prior) {
  const lines = [
    `受管理根会话 ${id} 正在提问。用户弹窗仍在，你和用户谁先回答谁算。`,
    '用 reply_question 回答，不要用 continue_session。每个问题一条答案；selected 填选项原文，自由文本用 custom。',
  ]
  if (prior?.text) {
    lines.push('', '提问前的正文：', prior.text)
    if (prior.truncated) lines.push('（正文已截断。这一轮还没结束，read_session 读不到这段未结束的正文。）')
  }
  for (const row of questions) {
    lines.push('', `问题 id：${row.id}`, ...(row.header ? [`标题：${row.header}`] : []), row.question)
    for (const option of row.options ?? []) lines.push(`- ${option.label}${option.description ? `：${option.description}` : ''}`)
    if (!row.options?.length) lines.push('没有选项，selected 传空数组，用 custom 回答')
  }
  return lines.join('\n')
}

/** 取刚写入的助手正文。此时工具还没跑完，这段文字可能尚未刷到磁盘。 @param {any} agent @param {number} limit @returns {any} */
function priorText(agent, limit) {
  try {
    const events = agent?.session?.snapshotEvents?.()
    return Array.isArray(events) ? latestMessage(events, limit) : null
  } catch {
    return null
  }
}

/** @param {any} ctx @param {any} manager @param {number} historyLimit @param {number} resultChars @returns {any} */
export function createQuestions(ctx, manager, historyLimit, resultChars) {
  const pending = new Map()
  const answered = new Map()

  const remove = (id, waiter) => {
    const list = (pending.get(id) ?? []).filter(item => item !== waiter)
    if (list.length) pending.set(id, list)
    else pending.delete(id)
    manager.changed()
  }

  const wait = (id, questions, signal) => {
    let settle
    let reject
    const promise = new Promise((resolve, fail) => { settle = resolve; reject = fail })
    let done = false
    const finish = (answer, error) => {
      if (done) return
      done = true
      signal?.removeEventListener('abort', abort)
      remove(id, waiter)
      if (error) reject(error)
      else settle(answer)
    }
    const waiter = { questions, settle: answer => finish(answer), release: () => finish(null), fail: error => finish(null, error) }
    const abort = () => waiter.fail(new Error('提问已取消'))
    pending.set(id, [...(pending.get(id) ?? []), waiter])
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    manager.changed()
    return { waiter, promise }
  }

  const rememberUser = (id, questions, answer) => {
    const list = answered.get(id) ?? []
    list.push({ ids: questions.map(row => row.id), text: formatAnswer(answer) })
    answered.set(id, list.slice(-historyLimit))
  }

  const notify = (id, waiter, record, signal) => {
    if (waiter.forwardedGeneration === record.generation) return
    const operation = manager.ensureAgent(record.leadId, signal).then(lead => {
      if (pending.get(id)?.includes(waiter) && manager.owner(id)?.generation === record.generation
        && waiter.forwardedGeneration !== record.generation) {
        lead.followup(userMessage(formatQuestions(id, waiter.questions, waiter.prior)))
        waiter.forwardedGeneration = record.generation
        manager.noteInbound?.({ sessionId: id, leadId: record.leadId, kind: 'question' })
      }
    }).catch(error => {
      ctx.logger.warn('问题无法送给 Lead：%s', error.message)
      // 用户弹窗仍在等待；保留请求以便 Lead 重试或直接回答。
    })
    manager.track(operation)
  }

  const disposeListener = ctx.on('user-questions/request', (request, next) => {
    const agent = request.agent
    if (!agent || !request.questions?.length || agent.session.header.origin === 'subagent') return next()
    try { assertRoot(agent.session.header, ctx) } catch (error) { return next() }
    const record = manager.owner(agent.id)
    const { questions } = request
    const outer = request.signal
    // 弹窗听的是请求上的 signal。换成一条链接信号：工具自己的取消仍会关弹窗，
    // Lead 先答时只中止这条链接，不中止工作会话的工具信号。
    const dismiss = new AbortController()
    const onOuterAbort = () => { dismiss.abort(outer?.reason) }
    if (outer?.aborted) dismiss.abort(outer.reason)
    else outer?.addEventListener('abort', onOuterAbort, { once: true })
    request.signal = dismiss.signal
    const { waiter, promise } = wait(agent.id, questions, outer)
    waiter.prior = priorText(agent, resultChars)
    const leadWait = promise.then(answer => ({ from: 'lead', answer })).catch(error => ({ from: 'lead', error }))
    const userWait = Promise.resolve().then(() => next()).then(answer => {
      // 在用户回调实际完成时释放竞争者，避免恢复 Lead 的延迟改变先后顺序。
      if (pending.get(agent.id)?.includes(waiter)) rememberUser(agent.id, questions, answer)
      waiter.release()
      return { from: 'user', answer }
    }).catch(error => { waiter.release(); return { from: 'user', error } })
    if (record) notify(agent.id, waiter, record, outer)
    return Promise.race([userWait, leadWait]).then(async winner => {
      outer?.removeEventListener('abort', onOuterAbort)
      if (winner.from === 'lead' && winner.answer != null && winner.error === undefined) dismiss.abort()
      if (winner.from === 'lead' && (winner.answer === null || winner.error)) winner = await userWait
      if (winner.error) throw winner.error
      return winner.answer
    })
  }, { prepend: true })

  return {
    count: id => (pending.get(id) ?? []).length,
    view: id => (pending.get(id) ?? []).flatMap(waiter => waiter.questions),
    adopt(id, record) { for (const waiter of pending.get(id) ?? []) notify(id, waiter, record) },
    release(id) { for (const waiter of [...(pending.get(id) ?? [])]) waiter.release() },
    reply(lead, args) {
      const id = requiredText(args.session_id, 'session_id')
      const record = manager.owner(id)
      if (!record || record.leadId !== lead.id) throw new Error(`会话 ${id} 不在这个 Lead 的管理范围`)
      if (!Array.isArray(args.answers) || args.answers.length === 0) throw new Error('answers 必须是非空数组')
      const answers = args.answers.map(row => {
        if (row === null || typeof row !== 'object') throw new Error('每条答案必须是对象')
        const questionId = requiredText(row.id, '问题 id')
        if (!Array.isArray(row.selected) || row.selected.some(item => typeof item !== 'string')) throw new Error('selected 必须是字符串数组')
        if (row.custom !== undefined && typeof row.custom !== 'string') throw new Error('custom 必须是字符串')
        if (!row.selected.length && !row.custom?.trim()) throw new Error(`问题 ${questionId} 需要选项或自由文本`)
        return { id: questionId, selected: row.selected, ...(row.custom !== undefined ? { custom: row.custom } : {}) }
      })
      const ids = answers.map(row => row.id)
      if (new Set(ids).size !== ids.length) throw new Error('答案 id 不能重复')
      const matches = row => row.ids.length === ids.length && row.ids.every(id => ids.includes(id))
      const waiter = (pending.get(id) ?? []).find(row => matches({ ids: row.questions.map(question => question.id) }))
      if (!waiter) {
        const previous = (answered.get(id) ?? []).findLast(matches)
        if (previous) throw new Error(`用户已回答，回答为：${previous.text}`)
        throw new Error(`会话 ${id} 没有对应的待答提问`)
      }
      for (const answer of answers) {
        const question = waiter.questions.find(row => row.id === answer.id)
        const labels = (question.options ?? []).map(row => row.label)
        if (answer.selected.some(label => !labels.includes(label))) throw new Error(`问题 ${answer.id} 的选项必须使用原文`)
        if (!question.multiSelect && answer.selected.length > 1) throw new Error(`问题 ${answer.id} 只能选一个选项`)
      }
      waiter.settle({ answers })
      return { delivered: true }
    },
    dispose() {
      disposeListener()
      for (const list of pending.values()) for (const waiter of [...list]) waiter.fail(new Error('团队管理插件已卸载'))
      pending.clear()
      answered.clear()
    },
  }
}
