/**
 * Lead 直接控制的可继续工作会话。
 * 不引用 @deepseek-ai 包：这个文件从个人预设目录加载，解析不到那些依赖。
 * open_session / continue_session 只给主会话。
 * ask_lead 只给工作会话，用来把决定交回 Lead。
 */

export const name = 'lead-sessions'
export const inject = ['tools', 'subagents', 'agents']

const CHILD_DENY = ['ask_user_question', 'open_session', 'continue_session']
const LEAD_DENY = ['web_search', 'ask_lead']

const WORK_PREFACE = `你是 Lead 打开的工作会话。
调查、修改、审查和构建都由你做。先查清并只汇报结论。Lead 确认之前不要开始改。确认之后在这个会话里接着改。
要做决定时只调用 ask_lead，然后停下来等 Lead 的下一条消息。不要自己假设答案，也不要问用户。

`

/**
 * @param {string} name
 * @param {string} description
 * @param {Record<string, { type: 'string', description: string }>} fields
 * @param {(args: Record<string, string>, exec: any) => Promise<Record<string, string | boolean>>} execute
 * @param {(value: Record<string, string | boolean>, args: Record<string, string>) => string} render
 */
function tool(name, description, fields, execute, render) {
  const keys = Object.keys(fields)
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: fields,
      required: keys,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string' },
          delivered: { type: 'boolean' },
        },
        required: name === 'ask_lead' ? ['delivered'] : ['sessionId'],
      },
      /** @param {Record<string, string>} args @param {Record<string, string | boolean>} value */
      render: (args, value) => [{ type: 'text', text: render(value, args) }],
    },
    /** @param {unknown} args */
    async execute(args, exec) {
      if (typeof args !== 'object' || args === null) throw new Error(`${name} 缺少参数`)
      /** @type {Record<string, string>} */
      const text = {}
      for (const key of keys) {
        const value = /** @type {Record<string, unknown>} */ (args)[key]
        if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} 的 ${key} 必须是非空字符串`)
        text[key] = value
      }
      return execute(text, exec)
    },
  }
}

/** @param {any} agent @param {string} toolName */
function requireAgent(agent, toolName) {
  if (agent === undefined) throw new Error(`${toolName} 需要调用它的会话`)
  return agent
}

/** @param {any} agent @param {string} toolName */
function leadAgent(agent, toolName) {
  const caller = requireAgent(agent, toolName)
  if (caller.session.header.parentSession !== undefined) {
    throw new Error(`${toolName} 只由主会话 Lead 调用`)
  }
  return caller
}

/** @param {any} ctx */
function hostContext(ctx) {
  return ctx.root ?? ctx
}

/** @param {any} agent */
function hideLeadTools(agent) {
  if (agent.session.header.parentSession !== undefined) return
  for (const toolName of LEAD_DENY) {
    try {
      agent.ctx.tools.restrict({ deny: [toolName] })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('unknown global tool')) throw error
    }
  }
}

/** @param {any} ctx */
export function apply(ctx) {
  ctx.effect(() => {
    /** @type {Array<() => void>} */
    const disposers = []
    disposers.push(ctx.tools.register(tool(
      'open_session',
      '打开一个可继续的 DSH 工作会话，并送进第一句话。调查和修改都在这个会话里接着做。',
      {
        title: { type: 'string', description: '这个会话的短标题。' },
        prompt: { type: 'string', description: '交给这个会话的第一句话。写明要查清什么，或已经说定、可以开始改的内容。' },
      },
      async (args, exec) => {
        const lead = leadAgent(exec.agent, 'open_session')
        const started = await ctx.subagents.startContinuable({
          provider: 'spawn',
          label: args.title,
          signal: exec.signal,
          request: {
            parent: lead,
            prompt: [{ type: 'text', text: WORK_PREFACE + args.prompt }],
            toolFilter: { deny: CHILD_DENY },
          },
        })
        return { sessionId: started.childId }
      },
      (value) => `已打开工作会话 ${value.sessionId}`,
    )))

    disposers.push(ctx.tools.register(tool(
      'continue_session',
      '往一个已经打开的工作会话里再送一句话。用来回答它的问题，或让它按已经说定的内容继续改。',
      {
        session_id: { type: 'string', description: 'open_session 返回的会话 id。' },
        message: { type: 'string', description: '送给这个会话的下一句话。' },
      },
      async (args, exec) => {
        const lead = leadAgent(exec.agent, 'continue_session')
        await ctx.subagents.sendMessage(
          lead,
          args.session_id,
          [{ type: 'text', text: args.message }],
          { signal: exec.signal },
        )
        return { sessionId: args.session_id }
      },
      (_value, args) => `已送入工作会话 ${args.session_id}`,
    )))

    disposers.push(ctx.tools.register(tool(
      'ask_lead',
      '把一个决定交给 Lead。Lead 可以自己回答，也可以先问用户。调用后停下来，等 Lead 的下一条消息，不要自己假设答案。',
      {
        question: { type: 'string', description: '需要 Lead 决定的问题。写清可选结果，以及每个结果用户会看见什么。' },
      },
      async (args, exec) => {
        const caller = requireAgent(exec.agent, 'ask_lead')
        const parentId = caller.session.header.parentSession
        if (parentId === undefined) throw new Error('ask_lead 只由工作会话调用')
        await ctx.subagents.sendMessage(
          caller,
          parentId,
          [{
            type: 'text',
            text: `工作会话 ${caller.id} 有一个问题要你决定。你可以直接回答，用 continue_session 把答案送回这个会话；也可以先用 ask_user_question 问用户，再把用户的决定送回去。\n\n${args.question}`,
          }],
          { signal: exec.signal },
        )
        return { delivered: true }
      },
      () => '已交给 Lead。停在这里，等 Lead 的下一条消息，不要自己假设答案。',
    )))

    /** @type {WeakSet<object>} */
    const seen = new WeakSet()
    /** @param {any} agent */
    const install = (agent) => {
      if (seen.has(agent)) return
      if (ctx.get('agentPresets')?.composedPreset(agent.ctx) !== 'team-dev') return
      seen.add(agent)
      hideLeadTools(agent)
    }
    for (const agent of ctx.agents.list()) install(agent)
    disposers.push(hostContext(ctx).on('agent/created', ({ agent }) => { install(agent) }))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'lead-sessions')
}
