/**
 * Lead 直接开根会话，并给已有的根会话发消息。
 * 不引用 @deepseek-ai 包：这个文件从个人预设目录加载，解析不到那些依赖。
 * open_session 记下的根会话若调用 ask_user_question，弹窗照常出现，问题也送给 Lead。
 * 用户和 Lead 谁先回答谁算。用户已答时，Lead 再答会看到用户的答案。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'lead-sessions'
export const inject = ['tools', 'agents']

const DEFAULT_PRESET = 'main-dev'
const LEAD_DENY = ['web_search']
const OWNED_DIR = '.dsh'
const OWNED_FILE = 'team-dev-sessions.json'

/**
 * @param {string} name
 * @param {string} description
 * @param {Record<string, unknown>} parameters
 * @param {string[]} required
 * @param {(args: Record<string, unknown>, exec: any) => Promise<Record<string, string | boolean>>} execute
 * @param {(value: Record<string, string | boolean>, args: Record<string, unknown>) => string} render
 */
function tool(name, description, parameters, required, execute, render) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: parameters,
      required,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' },
          delivered: { type: 'boolean' },
        },
        required: name === 'reply_question' ? ['delivered'] : ['sessionId'],
      },
      /** @param {Record<string, unknown>} args @param {Record<string, string | boolean>} value */
      render: (args, value) => [{ type: 'text', text: render(value, args) }],
    },
    /** @param {unknown} args */
    async execute(args, exec) {
      if (typeof args !== 'object' || args === null) throw new Error(`${name} 缺少参数`)
      return execute(/** @type {Record<string, unknown>} */ (args), exec)
    },
  }
}

/** @param {unknown} value @param {string} label */
function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 必须是非空字符串`)
  return value
}

/** @param {any} agent @param {string} toolName */
function leadAgent(agent, toolName) {
  if (agent === undefined) throw new Error(`${toolName} 需要调用它的会话`)
  if (agent.session.header.parentSession !== undefined) {
    throw new Error(`${toolName} 只由主会话 Lead 调用`)
  }
  return agent
}

/** @param {any} ctx */
function hostContext(ctx) {
  return ctx.root ?? ctx
}

/** @param {any} agent */
function modelOptions(agent) {
  const config = agent.session.requestHeader()?.config ?? {}
  const options = agent.options ?? {}
  const provider = config.provider ?? options.provider
  const model = config.model ?? options.model
  const reasoningEffort = config.reasoningEffort ?? options.reasoningEffort
  const maxTokens = options.maxTokens
  return {
    ...(typeof provider === 'string' && provider.length > 0 ? { provider } : {}),
    ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
  }
}

/** @param {string} text */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** @param {string} cwd */
function ownedPath(cwd) {
  return join(cwd, OWNED_DIR, OWNED_FILE)
}

/**
 * @param {string} cwd
 * @returns {Record<string, { leadId?: unknown, preset?: unknown }>}
 */
function readOwned(cwd) {
  let text
  try {
    text = readFileSync(ownedPath(cwd), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    throw error
  }
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${ownedPath(cwd)} 不是记录文件`)
  }
  const sessions = /** @type {{ sessions?: unknown }} */ (parsed).sessions
  if (sessions === null || typeof sessions !== 'object' || Array.isArray(sessions)) {
    throw new Error(`${ownedPath(cwd)} 缺少 sessions`)
  }
  return /** @type {Record<string, { leadId?: unknown, preset?: unknown }>} */ (sessions)
}

/**
 * @param {string} cwd
 * @param {Record<string, { leadId: string, preset: string }>} sessions
 */
function writeOwned(cwd, sessions) {
  mkdirSync(join(cwd, OWNED_DIR), { recursive: true })
  writeFileSync(ownedPath(cwd), `${JSON.stringify({ sessions }, null, 2)}\n`)
}

/** @param {any} agent */
function presetIdOf(ctx, agent) {
  const projected = ctx.get('sessionProjections')?.stateOf(agent.session, 'agentPreset')
  if (typeof projected === 'string' && projected.length > 0) return projected
  const header = agent.session.header.agentPreset
  if (typeof header === 'string' && header.length > 0) return header
  return undefined
}

/** @param {unknown} answer */
function formatAnswer(answer) {
  const answers = typeof answer === 'object' && answer !== null
    ? /** @type {{ answers?: unknown }} */ (answer).answers
    : undefined
  if (!Array.isArray(answers)) return JSON.stringify(answer)
  return answers.map((item) => {
    if (typeof item !== 'object' || item === null) return String(item)
    const row = /** @type {{ id?: unknown, selected?: unknown, custom?: unknown }} */ (item)
    const id = typeof row.id === 'string' ? row.id : '未知问题'
    const selected = Array.isArray(row.selected)
      ? row.selected.filter((label) => typeof label === 'string').join('、')
      : ''
    const custom = typeof row.custom === 'string' ? row.custom.trim() : ''
    const body = [selected, custom].filter(part => part.length > 0).join('；')
    return `${id}：${body.length > 0 ? body : '（空）'}`
  }).join('\n')
}

/**
 * @param {readonly { id: string, question: string, header?: string, options?: readonly { label: string, description?: string }[] }[]} questions
 */
function formatQuestions(sessionId, questions) {
  const lines = [
    `根会话 ${sessionId} 正在提问。界面上的弹窗也在，你和用户谁先回答谁算。`,
    '要用 reply_question 回答，不要用 continue_session 代替。用户已经答过时，这个工具会带回用户的答案。',
    '每个问题都要答一次。selected 填写选中的选项原文；自由文本放在 custom。没有选项时 selected 传空数组。',
    '',
  ]
  for (const question of questions) {
    lines.push(`问题 id：${question.id}`)
    if (question.header !== undefined && question.header.length > 0) lines.push(`标题：${question.header}`)
    lines.push(question.question)
    const options = question.options ?? []
    if (options.length === 0) {
      lines.push('（没有选项，用 custom 回答）')
    } else {
      for (const option of options) {
        const detail = option.description === undefined || option.description.length === 0
          ? ''
          : `：${option.description}`
        lines.push(`- ${option.label}${detail}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** @param {any} ctx */
export function apply(ctx) {
  ctx.effect(() => {
    /** @type {Array<() => void>} */
    const disposers = []
    /** @type {Map<string, { leadId: string, preset: string, cwd: string }>} */
    const cache = new Map()
    /**
     * @typedef {{
     *   questions: readonly { id: string }[],
     *   settle: (answer: { answers: { id: string, selected: string[], custom?: string }[] }) => void,
     *   fail: (error: Error) => void,
     *   release: () => void,
     * }} Waiter
     */
    /** @type {Map<string, Waiter[]>} */
    const waiters = new Map()
    /** @type {Map<string, { ids: string[], text: string }[]>} */
    const answered = new Map()

    /** @param {string} cwd @param {string} sessionId @param {string} leadId @param {string} preset */
    const remember = (cwd, sessionId, leadId, preset) => {
      const sessions = readOwned(cwd)
      sessions[sessionId] = { leadId, preset }
      writeOwned(cwd, /** @type {Record<string, { leadId: string, preset: string }>} */ (sessions))
      cache.set(sessionId, { leadId, preset, cwd })
    }

    /** @param {any} agent */
    const owned = (agent) => {
      const cached = cache.get(agent.id)
      if (cached !== undefined) return cached
      const cwd = agent.session.header.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) return undefined
      let sessions
      try {
        sessions = readOwned(cwd)
      } catch {
        return undefined
      }
      const record = sessions[agent.id]
      if (record === undefined || typeof record.leadId !== 'string' || record.leadId.length === 0) return undefined
      const preset = typeof record.preset === 'string' ? record.preset : DEFAULT_PRESET
      const stored = { leadId: record.leadId, preset, cwd }
      cache.set(agent.id, stored)
      return stored
    }

    /** @param {any} presets */
    const mountPreset = async (presets, agentCtx, agent) => {
      const id = presetIdOf(ctx, agent)
      if (id === undefined) throw new Error(`会话 ${agent.id} 没有预设，无法恢复`)
      await presets.mount(agentCtx, id)
    }

    /**
     * @param {string} sessionId
     * @param {any} routeFrom
     * @param {AbortSignal | undefined} signal
     */
    const ensureAgent = async (sessionId, routeFrom, signal) => {
      const live = ctx.agents.get(sessionId)
      if (live !== undefined) return live
      const presets = ctx.get('agentPresets')
      if (presets === undefined) throw new Error('没有预设服务，无法恢复会话')
      const handle = await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: modelOptions(routeFrom),
        ...(signal === undefined ? {} : { signal }),
        setup: (agentCtx, agent) => mountPreset(presets, agentCtx, agent),
      })
      return handle.agent
    }

    /**
     * @param {string} sessionId
     * @param {readonly { id: string }[]} questions
     * @param {AbortSignal | undefined} signal
     */
    const waitForAnswer = (sessionId, questions, signal) => new Promise((resolve, reject) => {
      /** @type {Waiter} */
      const waiter = {
        questions,
        settle: () => {},
        fail: () => {},
        release: () => {},
      }
      let settled = false
      const remove = () => {
        const current = waiters.get(sessionId) ?? []
        const next = current.filter(item => item !== waiter)
        if (next.length === 0) waiters.delete(sessionId)
        else waiters.set(sessionId, next)
      }
      /** @param {Error} error */
      const fail = (error) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        remove()
        reject(error)
      }
      const onAbort = () => { fail(new Error('提问已取消')) }
      waiter.fail = fail
      waiter.settle = (answer) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        remove()
        resolve(answer)
      }
      waiter.release = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        remove()
        resolve({ released: true })
      }
      const list = waiters.get(sessionId) ?? []
      list.push(waiter)
      waiters.set(sessionId, list)
      if (signal?.aborted) fail(new Error('提问已取消'))
      else signal?.addEventListener('abort', onAbort, { once: true })
    })

    disposers.push(ctx.tools.register(tool(
      'open_session',
      '新开一个根会话，并送进第一句话。它出现在左侧。省略预设时用 main-dev（开发助手）。',
      {
        title: { type: 'string', description: '这个会话的短标题。' },
        prompt: { type: 'string', description: '交给这个会话的第一句话。写明要查清什么，或已经说定、可以开始改的内容。' },
        preset: { type: 'string', description: '预设 id。省略或留空时用 main-dev。' },
      },
      ['title', 'prompt'],
      async (args, exec) => {
        const lead = leadAgent(exec.agent, 'open_session')
        const cwd = lead.session.header.cwd
        if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('主会话没有工作目录，无法打开根会话')
        const title = requiredText(args.title, 'open_session 的 title')
        const prompt = requiredText(args.prompt, 'open_session 的 prompt')
        const requested = typeof args.preset === 'string' && args.preset.trim() !== ''
          ? args.preset.trim()
          : DEFAULT_PRESET
        const presets = ctx.get('agentPresets')
        if (presets === undefined) throw new Error('没有预设服务，无法打开根会话')
        const resolved = await presets.resolve(requested)
        if (resolved.broken !== undefined) throw new Error(`预设 ${resolved.id} 不可用：${resolved.broken}`)
        const sessionId = `session-${randomUUID()}`
        const handle = await ctx.agents.create({
          sessionId,
          agentOptions: modelOptions(lead),
          meta: { cwd, agentPreset: resolved.id },
          ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          setup: async (agentCtx) => { await presets.mount(agentCtx, resolved.id) },
        })
        const opened = handle.agent
        const titles = ctx.get('sessionTitle')
        if (titles !== undefined) titles.rename(opened.session, title)
        const registry = ctx.get('workspaceRegistry')
        const workspace = typeof registry?.list === 'function'
          ? registry.list().find((item) => item.sessionIds.includes(lead.id))
          : undefined
        if (workspace !== undefined) await workspace.attachSession(opened.id)
        remember(cwd, opened.id, lead.id, resolved.id)
        opened.followup(userMessage(prompt))
        return { sessionId: opened.id }
      },
      (value) => `已打开根会话 ${value.sessionId}`,
    )))

    disposers.push(ctx.tools.register(tool(
      'continue_session',
      '给一个已有的根会话送下一句话。可以是 open_session 打开的，也可以是左侧任何一个根会话。正在等 reply_question 的提问不要用这个工具回答。',
      {
        session_id: { type: 'string', description: '根会话 id。' },
        message: { type: 'string', description: '送给这个会话的下一句话。' },
      },
      ['session_id', 'message'],
      async (args, exec) => {
        const lead = leadAgent(exec.agent, 'continue_session')
        const sessionId = requiredText(args.session_id, 'continue_session 的 session_id')
        const message = requiredText(args.message, 'continue_session 的 message')
        const target = await ensureAgent(sessionId, lead, exec.signal)
        target.followup(userMessage(message))
        return { sessionId: target.id }
      },
      (_value, args) => `已送入根会话 ${String(args.session_id)}`,
    )))

    disposers.push(ctx.tools.register(tool(
      'reply_question',
      '回答某个根会话正在提出的 ask_user_question。弹窗也在，谁先回答谁算。session_id 和每个问题 id 都要与送来的问题一致。用户已经答过时，这个工具会带回用户的答案。',
      {
        session_id: { type: 'string', description: '正在提问的根会话 id。' },
        answers: {
          type: 'array',
          description: '每个问题一条。id 用送来的问题 id。selected 是选中的选项原文。没有选项时 selected 传空数组，答案放进 custom。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', description: '问题 id。' },
              selected: {
                type: 'array',
                items: { type: 'string' },
                description: '选中的选项原文。可以多选。没有就传空数组。',
              },
              custom: { type: 'string', description: '自由文本。不需要时省略。' },
            },
            required: ['id', 'selected'],
          },
        },
      },
      ['session_id', 'answers'],
      async (args, exec) => {
        leadAgent(exec.agent, 'reply_question')
        const sessionId = requiredText(args.session_id, 'reply_question 的 session_id')
        if (!Array.isArray(args.answers) || args.answers.length === 0) {
          throw new Error('reply_question 的 answers 必须是非空数组')
        }
        /** @type {{ id: string, selected: string[], custom?: string }[]} */
        const answers = []
        for (const item of args.answers) {
          if (typeof item !== 'object' || item === null) throw new Error('reply_question 的每一条答案都必须是对象')
          const row = /** @type {Record<string, unknown>} */ (item)
          const id = requiredText(row.id, '答案 id')
          if (!Array.isArray(row.selected) || row.selected.some(label => typeof label !== 'string')) {
            throw new Error(`问题 ${id} 的 selected 必须是字符串数组`)
          }
          const custom = row.custom
          if (custom !== undefined && typeof custom !== 'string') throw new Error(`问题 ${id} 的 custom 必须是字符串`)
          const selected = /** @type {string[]} */ (row.selected)
          if (selected.length === 0 && (typeof custom !== 'string' || custom.trim() === '')) {
            throw new Error(`问题 ${id} 需要选项或自由文本`)
          }
          answers.push({
            id,
            selected,
            ...(typeof custom === 'string' ? { custom } : {}),
          })
        }
        const ids = answers.map(item => item.id)
        if (new Set(ids).size !== ids.length) throw new Error('reply_question 的答案 id 不能重复')
        const previous = (answered.get(sessionId) ?? []).find((item) => {
          return item.ids.length === ids.length && item.ids.every(id => ids.includes(id))
        })
        if (previous !== undefined) throw new Error(`用户已回答，回答为：${previous.text}`)
        const pending = waiters.get(sessionId) ?? []
        const waiter = pending.find((item) => {
          const expected = item.questions.map(question => question.id)
          return expected.length === ids.length && expected.every(id => ids.includes(id))
        })
        if (waiter === undefined) throw new Error(`会话 ${sessionId} 没有与这些 id 对应的待答提问`)
        waiter.settle({ answers })
        return { delivered: true }
      },
      () => '已回答该提问',
    )))

    /** @param {any} agent */
    const hideLeadSearch = (agent) => {
      if (agent.session.header.parentSession !== undefined) return
      if (ctx.get('agentPresets')?.composedPreset(agent.ctx) !== 'team-dev') return
      for (const toolName of LEAD_DENY) {
        try {
          agent.ctx.tools.restrict({ deny: [toolName] })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!message.includes('unknown global tool')) throw error
        }
      }
    }

    /** @type {WeakSet<object>} */
    const seen = new WeakSet()
    /** @param {any} agent */
    const install = (agent) => {
      if (seen.has(agent)) return
      seen.add(agent)
      hideLeadSearch(agent)
    }
    for (const agent of ctx.agents.list()) install(agent)
    disposers.push(hostContext(ctx).on('agent/created', ({ agent }) => { install(agent) }))

    /** @param {string} sessionId @param {readonly { id: string }[]} questions */
    const releaseWaiter = (sessionId, questions) => {
      const waiter = (waiters.get(sessionId) ?? []).find(item => item.questions === questions)
      waiter?.release()
    }

    /** @param {string} sessionId @param {readonly { id: string }[]} questions @param {unknown} answer */
    const rememberUserAnswer = (sessionId, questions, answer) => {
      const list = answered.get(sessionId) ?? []
      list.push({ ids: questions.map(question => question.id), text: formatAnswer(answer) })
      answered.set(sessionId, list)
    }

    disposers.push(hostContext(ctx).on('user-questions/request', (request, next) => {
      const agent = request.agent
      if (agent === undefined) return next()
      const record = owned(agent)
      if (record === undefined) return next()
      const questions = request.questions
      if (!Array.isArray(questions) || questions.length === 0) return next()
      if (questions.some((question) => typeof question?.id !== 'string' || typeof question?.question !== 'string')) {
        return next()
      }
      const leadWait = waitForAnswer(agent.id, questions, request.signal)
        .then((answer) => (answer?.released === true
          ? { ok: false, error: new Error('已由用户回答') }
          : { ok: true, answer }))
        .catch((error) => ({ ok: false, error }))
      const userWait = Promise.resolve()
        .then(() => next())
        .then((answer) => ({ ok: true, answer }))
        .catch((error) => ({ ok: false, error }))
      return (async () => {
        try {
          const lead = await ensureAgent(record.leadId, agent, request.signal)
          lead.followup(userMessage(formatQuestions(agent.id, questions)))
        } catch (error) {
          releaseWaiter(agent.id, questions)
          const user = await userWait
          if (!user.ok) throw user.error
          return user.answer
        }
        const winner = await Promise.race([
          userWait.then(result => ({ from: 'user', result })),
          leadWait.then(result => ({ from: 'lead', result })),
        ])
        if (winner.from === 'user') {
          if (winner.result.ok) rememberUserAnswer(agent.id, questions, winner.result.answer)
          releaseWaiter(agent.id, questions)
          if (!winner.result.ok) throw winner.result.error
          return winner.result.answer
        }
        if (!winner.result.ok) {
          const user = await userWait
          if (!user.ok) throw winner.result.error
          rememberUserAnswer(agent.id, questions, user.answer)
          return user.answer
        }
        return winner.result.answer
      })()
    }, { prepend: true }))

    return () => {
      for (const list of waiters.values()) {
        for (const waiter of list) waiter.fail(new Error('团队会话插件已卸载'))
      }
      waiters.clear()
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'lead-sessions')
}
