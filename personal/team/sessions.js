/** Lead 专用工具。工作会话、管理面板和轮次回传由同一个 Host 管理实例驱动。 */
import { randomUUID } from 'node:crypto'
import { getManager } from './index.js'
import { DEFAULT_PRESET, modelOptions, requiredText, userMessage } from './runtime.js'

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
    tool('open_session', '新建独立根会话并纳入你的管理，发送第一条任务。返回会话 id；每轮结束结果会自动送回本会话。', {
      title: { type: 'string', description: '工作会话标题。' },
      prompt: { type: 'string', description: '自包含的任务、范围与约束；不会复制 Lead 的聊天上下文。' },
      preset: { type: 'string', description: `预设 id，省略时使用开发助手（${DEFAULT_PRESET}）。` },
    }, ['title', 'prompt'], async (args, exec) => {
      const caller = lead(exec)
      const title = requiredText(args.title, 'title')
      const prompt = requiredText(args.prompt, 'prompt')
      const preset = args.preset === undefined ? DEFAULT_PRESET : requiredText(args.preset, 'preset')
      const presets = ctx.get('agentPresets')
      if (!presets) throw new Error('agentPresets 服务未启用')
      await presets.resolve(preset)
      const handle = await ctx.agents.create({
        sessionId: `session-${randomUUID()}`,
        meta: { cwd: requiredText(caller.session.header.cwd, '工作目录'), agentPreset: preset },
        agentOptions: modelOptions(caller), signal: exec.signal,
        setup: agentCtx => presets.mount(agentCtx, preset),
      })
      const agent = handle.agent
      try {
        ctx.get('sessionTitle')?.rename(agent.session, title)
        const workspaces = ctx.get('workspaceRegistry')
        const workspace = workspaces?.list().find(item => item.sessionIds.includes(caller.id))
        if (workspace) await workspace.attachSession(agent.id)
        await manager().manage(caller, agent.id, 'add', exec.signal)
        agent.followup(userMessage(prompt))
      } catch (error) {
        throw new Error(`已创建根会话 ${agent.id}，但初始化或任务发送失败：${error.message}`)
      }
      return { sessionId: agent.id, preset, managed: true }
    }, value => `已打开并纳入管理的根会话：${value.sessionId}（预设：${value.preset}）。任务已送入；本轮工具不等待工作结果。`),
    tool('continue_session', '给已有根会话发送下一条消息，必要时恢复它。只有纳入管理的会话才会自动回传结果；回答待答问题用 reply_question。', {
      session_id: { type: 'string', description: '目标根会话 id。' },
      message: { type: 'string', description: '下一条任务或补充指令。' },
    }, ['session_id', 'message'], async (args, exec) => {
      lead(exec)
      const id = requiredText(args.session_id, 'session_id')
      const message = requiredText(args.message, 'message')
      const agent = await manager().ensureAgent(id, exec.signal)
      agent.followup(userMessage(message))
      return { sessionId: id, managed: manager().owner(id)?.leadId === exec.agent.id }
    }, value => `消息已送入根会话：${value.sessionId}。${value.managed ? '每轮结束结果会回传给你。' : '该会话不在你的管理范围，结果不会自动回传给你。'}`),
    tool('manage_session', '将已有根会话纳入或移出你的管理。纳入后回传后续每轮结果并转发提问；移出不停止、不删除会话。', {
      session_id: { type: 'string', description: '目标根会话 id，可先用 list_sessions 查找。' },
      action: { type: 'string', enum: ['add', 'remove'], description: 'add 纳入，remove 移出。' },
    }, ['session_id', 'action'], async (args, exec) => manager().manage(lead(exec), requiredText(args.session_id, 'session_id'), args.action, exec.signal),
    value => `${value.managed ? '已纳入管理' : '已移出管理'}：${value.sessionId}`),
    tool('list_sessions', '列出可操作的根会话、管理归属、当前状态和最近回复预览，供选择或查看团队进展。', {
      managed_only: { type: 'boolean', description: 'true 只列出你管理的会话；省略或 false 时列出所有普通根会话。' },
      offset: { type: 'integer', minimum: 0, description: '分页起点，默认 0。' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20。' },
    }, [], (args, exec) => manager().list(lead(exec), args, exec.signal)),
    tool('read_session', '读取根会话的当前状态、最近已提交回复和轮次结果，不给该会话发送任务。可分页读取截断结果；不会读取未提交的流式思考。', {
      session_id: { type: 'string', description: '目标根会话 id。' },
      turn: { type: 'integer', minimum: 1, description: '指定已结束的轮次；省略时读取最近的真实结束轮次。' },
      offset: { type: 'integer', minimum: 0, maximum: 10000000, description: '结果正文的字符起点，默认 0；使用返回的 nextOffset 继续读取。' },
    }, ['session_id'], (args, exec) => manager().read(lead(exec), args, exec.signal)),
    tool('reply_question', '回答你管理的根会话正在提出的问题。用户弹窗保持可用，先回答者生效；用户已答时返回用户答案。', {
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
