/** Lead 专用工具。工作会话、管理面板和轮次回传由同一个 Host 管理实例驱动。 */
import { randomUUID } from 'node:crypto'
import { getManager } from './index.js'
import { DEFAULT_PRESET, modelOptions, modelSelection, mountPreset, requiredText, userMessage } from './runtime.js'

export const name = 'lead-sessions'
export const inject = ['tools', 'agents']

/** @param {string} name @param {string} description @param {object} properties @param {string[]} required @param {(args: any, exec: any) => Promise<any> | any} execute @param {(value: any) => string} render @returns {object} */
function tool(name, description, properties, required, execute, render = value => JSON.stringify(value, null, 2)) {
  return {
    name, description,
    parameters: { type: 'object', additionalProperties: false, properties, required },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: render(value) }],
    },
    execute(args, exec) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error(`${name} 缺少对象参数`)
      return execute(args, exec)
    },
  }
}

/** @param {any} ctx */
export function apply(ctx) {
  const manager = () => getManager(ctx)
  const lead = exec => manager().assertLead(exec.agent)
  const definitions = [
    tool('become_lead', '成为本工作区的 Lead。每个工作区只有一个 Lead，这是使用其它团队工具的前提。已有 Lead 时先拒绝；带 takeover: true 会先弹窗询问用户是否替换，用户同意才生效并把现任名下的成员全部接管过来。', {
      takeover: { type: 'boolean', description: '已有 Lead 时是否请求替换。省略或 false 时只报告现任 Lead 并拒绝。' },
    }, [], (args, exec) => manager().becomeLead(exec.agent, args, exec.signal),
    value => value.replaced === null
      ? `你已经是本工作区的 Lead，当前名下 ${value.members} 个成员。`
      : `你已经是本工作区的 Lead，接管了原 Lead ${value.replaced} 名下的 ${value.members} 个成员。`),
    tool('open_session', '新建独立根会话并纳入你的管理，发送第一条任务。返回会话 id；每轮结束结果会自动送回本会话。provider、model、reasoning_effort 一起给出时，这个会话使用该模型；三项都省略则沿用你当前的模型。', {
      title: { type: 'string', description: '工作会话标题。' },
      prompt: { type: 'string', description: '自包含的任务、范围与约束；不会复制 Lead 的聊天上下文。' },
      preset: { type: 'string', description: `预设 id，省略时使用开发助手（${DEFAULT_PRESET}）。` },
      provider: { type: 'string', description: '模型提供方 id。与 model、reasoning_effort 同时给出，或三项都省略。' },
      model: { type: 'string', description: '模型 id。' },
      reasoning_effort: { type: 'string', description: '该模型的推理强度 id。' },
    }, ['title', 'prompt'], async (args, exec) => {
      const caller = lead(exec)
      const title = requiredText(args.title, 'title')
      const prompt = requiredText(args.prompt, 'prompt')
      const preset = args.preset === undefined ? DEFAULT_PRESET : requiredText(args.preset, 'preset')
      const chosen = modelSelection(args, false)
      const presets = ctx.get('agentPresets')
      if (!presets) throw new Error('agentPresets 服务未启用')
      await presets.resolve(preset)
      const handle = await ctx.agents.create({
        sessionId: `session-${randomUUID()}`,
        meta: { cwd: requiredText(caller.session.header.cwd, '工作目录'), agentPreset: preset },
        agentOptions: chosen ?? modelOptions(caller), signal: exec.signal,
        setup: mountPreset(presets, preset),
      })
      const agent = handle.agent
      try {
        ctx.get('sessionTitle')?.rename(agent.session, title)
        const workspaces = ctx.get('workspaceRegistry')
        const workspace = workspaces?.list().find(item => item.sessionIds.includes(caller.id))
        if (workspace) await workspace.attachSession(agent.id)
        await manager().manage(caller, agent.id, 'add', exec.signal)
        if (chosen) await manager().setSessionModel(caller, agent.id, chosen, exec.signal)
        agent.followup(userMessage(prompt))
      } catch (error) {
        throw new Error(`已创建根会话 ${agent.id}，但初始化或任务发送失败：${error.message}`)
      }
      return {
        sessionId: agent.id, preset, managed: true,
        ...(chosen ? { provider: chosen.provider, model: chosen.model, reasoningEffort: chosen.reasoningEffort } : {}),
      }
    }, value => `已打开并纳入管理的根会话：${value.sessionId}（预设：${value.preset}${value.model ? `，模型：${value.provider}/${value.model}，强度：${value.reasoningEffort}` : ''}）。任务已送入；本轮工具不等待工作结果。`),
    tool('set_session_model', '改本工作目录下一个根会话的下一次模型请求。不打断正在跑的轮次，也不改账号默认模型。不能改 Lead 自己。', {
      session_id: { type: 'string', description: '目标根会话 id。' },
      provider: { type: 'string', description: '模型提供方 id。' },
      model: { type: 'string', description: '模型 id。' },
      reasoning_effort: { type: 'string', description: '该模型的推理强度 id。' },
    }, ['session_id', 'provider', 'model', 'reasoning_effort'], async (args, exec) => {
      const caller = lead(exec)
      return manager().setSessionModel(caller, requiredText(args.session_id, 'session_id'), modelSelection(args, true), exec.signal)
    }, value => `已改 ${value.sessionId} 的下一次请求：${value.provider}/${value.model}，强度 ${value.reasoningEffort}。正在跑的轮次不受影响。`),
    tool('wait_session', '仅当用户明确要求使用本工具时调用。不要因为任务很长、开了 goal，或要等某个会话做完，就自行调用。不指定会话：在你管理的会话里，谁先把一轮结果或一个提问送进来，就返回谁。已经有待答提问，或眼下没有会发来消息的会话，会立刻返回。goal 还会自己续的中间轮次不算消息。超时不报错。正文仍由原来的回传送入，不在这个结果里重复。', {
      timeout_seconds: { type: 'integer', minimum: 1, maximum: 3600, description: '等待上限，1 至 3600 的整数秒。' },
    }, ['timeout_seconds'], (args, exec) => manager().wait(lead(exec), args.timeout_seconds, exec.signal),
    value => {
      if (value.timedOut) return '等待超时，这段时间没有受管理会话把新消息送进来。'
      if (value.kind === 'question') {
        return value.waited
          ? `会话 ${value.sessionId} 发来提问。用 reply_question 回答。正文已送入本会话。`
          : `会话 ${value.sessionId} 已有待答问题。用 reply_question 回答，不要继续干等。`
      }
      if (value.kind === 'result') return `会话 ${value.sessionId} 发来一轮结果。正文已送入本会话。这不代表整个任务完成。`
      return value.waited ? '受管理会话都已停下，没有新消息。' : '现在没有在跑、待答或即将回传的受管理会话。'
    }),
    tool('continue_session', '给已有根会话送下一句话，必要时恢复它。对方正在跑时，这句话插进当前轮的下一步，不等这轮结束；正在执行的工具不会被打断。对方空闲时照常开始下一轮。只有纳入管理的会话才会自动回传结果；回答待答问题用 reply_question。', {
      session_id: { type: 'string', description: '目标根会话 id。' },
      message: { type: 'string', description: '下一条任务或补充指令。正在跑时会插进当前轮。' },
    }, ['session_id', 'message'], async (args, exec) => {
      lead(exec)
      const id = requiredText(args.session_id, 'session_id')
      const message = requiredText(args.message, 'message')
      const agent = await manager().ensureAgent(id, exec.signal)
      agent.steer(userMessage(message))
      return { sessionId: id, managed: manager().owner(id)?.leadId === exec.agent.id }
    }, value => `消息已插入根会话：${value.sessionId}。对方正在跑时，当前这一步结束后就能看到，不等这轮结束。${value.managed ? '每轮结束结果会回传给你。' : '该会话不在你的管理范围，结果不会自动回传给你。'}`),
    tool('manage_session', '将已有根会话纳入或移出你的管理。纳入后回传后续每轮结果并转发提问；移出不停止、不删除会话。', {
      session_id: { type: 'string', description: '目标根会话 id，可先用 list_sessions 查找。' },
      action: { type: 'string', enum: ['add', 'remove'], description: 'add 纳入，remove 移出。' },
    }, ['session_id', 'action'], async (args, exec) => manager().manage(lead(exec), requiredText(args.session_id, 'session_id'), args.action, exec.signal),
    value => `${value.managed ? '已纳入管理' : '已移出管理'}：${value.sessionId}`),
    tool('list_sessions', '列出本工作目录下未归档的根会话：标题、管理归属与当前状态，按创建时间倒序。默认不含正文；用 session_ids 点名后，这些行才附带最近一轮正文预览。要看某一轮的完整正文用 read_session。', {
      session_ids: {
        type: 'array', items: { type: 'string' },
        description: '要查看正文的会话 id，可给多个。命中的行附带最近一轮正文预览；不在本工作目录、已归档或不是根会话的 id 会出现在 missed 里。默认不传。',
      },
      managed_only: { type: 'boolean', description: 'true 只列出你管理的会话；省略或 false 时列出本工作目录下所有未归档根会话。' },
      offset: { type: 'integer', minimum: 0, description: '分页起点，默认 0。' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20。' },
    }, [], (args, exec) => manager().list(lead(exec), args, exec.signal)),
    tool('read_session', '读取根会话的当前状态、最近已提交回复和轮次结果，不给该会话发送任务。可分页读取截断结果；不会读取未提交的流式思考。', {
      session_id: { type: 'string', description: '目标根会话 id。' },
      turn: { type: 'integer', minimum: 1, description: '指定已结束的轮次；省略时读取最近的真实结束轮次。' },
      offset: { type: 'integer', minimum: 0, maximum: 10000000, description: '结果正文的字符起点，默认 0；使用返回的 nextOffset 继续读取。' },
    }, ['session_id'], (args, exec) => manager().read(lead(exec), args, exec.signal)),
    tool('reply_question', '回答你管理的根会话正在提出的问题。用户弹窗保持可用，先回答者生效。你先答时用户弹窗会关掉；用户已答时返回用户答案。', {
      session_id: { type: 'string', description: '正在提问的根会话 id。' },
      answers: {
        type: 'array', minItems: 1, items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', description: '问题 id。' },
            selected: { type: 'array', items: { type: 'string' }, description: '选择的选项原文；自由回答时传空数组。' },
            custom: { type: 'string', description: '自由文本答案。' },
          }, required: ['id', 'selected'],
        },
      },
    }, ['session_id', 'answers'], (args, exec) => manager().reply(lead(exec), args), () => '答案已送入工作会话'),
  ]
  ctx.effect(() => {
    const disposers = definitions.map(definition => ctx.tools.register(definition))
    // 只有确实继承了联网搜索才禁用；restrict 遇到未注册的名称会失败。
    const webDenied = ['web_search', 'web_fetch'].filter(name => ctx.tools.get(name) !== undefined)
    if (webDenied.length > 0) disposers.push(ctx.tools.restrict({ deny: webDenied }))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'lead-sessions')
}
