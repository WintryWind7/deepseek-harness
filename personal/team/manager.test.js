/**
 * 管理实例的行为测试：用最小的假 ctx 在进程内驱动 `createManager`，真实走一遍
 * 归属判定、接管询问与面板写操作。纯函数测试在 `predicate.test.js`。
 *
 * 覆盖的是只有真跑才暴露的部分：`assertLead` 的登记校验、`becomeLead` 的
 * 登记/幂等/拒绝/接管的三种询问结果、`manage` 的 cwd 校验、面板四个动作，
 * 以及「失去 Lead」后成员留在原地并被下一个 Lead 接管。
 *
 * 跑法：node --test personal/team/manager.test.js
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createManager } from './index.js'
import { readRecords } from './runtime.js'

/**
 * 临时工作目录 + 假 ctx + 管理实例。会话与 agent 都在内存里，只有管理记录落在
 * 临时目录的真实文件上 —— 要验的就是那份文件的读写。
 * @param {{ask?: (request: any) => string[] | Error}} [options]
 */
async function setup(options = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'team-manager-'))
  const rows = new Map()
  const live = new Map()
  const asks = []
  const listeners = new Map()
  const ask = options.ask ?? (() => ['保持现状'])
  const ctx = {
    logger: options.logger ?? { warn() {}, info() {} },
    on: (name, fn) => {
      const list = listeners.get(name) ?? []
      list.push(fn)
      listeners.set(name, list)
      return () => {}
    },
    effect: () => {},
    get: name => {
      if (name === 'workspaceRegistry') return options.workspaceRegistry ?? { archivedSessionIds: [] }
      if (name === 'sessionController') return options.sessionController
      if (name === 'llm') return options.llm
      if (name === 'sessionTitle') return options.sessionTitle
      if (name === 'goals') return options.goals
      if (name === 'userQuestions') {
        return {
          ask: async request => {
            asks.push(request)
            const selected = ask(request)
            if (selected instanceof Error) throw selected
            return { answers: [{ id: 'team-takeover', selected }] }
          },
        }
      }
      return undefined
    },
    agents: { get: id => live.get(id), roots: () => [...live.values()] },
    sessions: { get: id => live.get(id)?.session, flush: async () => true },
    sessionPersistence: options.sessionPersistence,
    sessionProjections: options.sessionProjections,
    sessionQuery: {
      listSessions: async () => [...rows.values()],
      observeSession: async id => {
        const row = rows.get(id)
        if (row === undefined) throw new Error(`unknown session ${id}`)
        return { header: row.header, events: [], projections: { values: {} }, source: 'live', [Symbol.dispose]() {} }
      },
    },
  }
  const manager = createManager(ctx, { resultChars: 12_000, questionHistoryLimit: 64 })
  await manager.load()
  manager.start()
  /** 造一个会话 + 它的 live agent，返回 agent。 @param {string} id @param {object} [extra] */
  const add = (id, extra = {}) => {
    const header = { id, cwd, origin: 'root', ...extra }
    const agent = {
      id, status: 'idle', followup() {}, steer() {}, inbox: { nextTurn: [], nextStep: [] },
      session: { id, header, seq: 100, requestHeader: () => ({ config: {} }) },
    }
    rows.set(id, { header, live: agent })
    live.set(id, agent)
    return agent
  }
  /** 只在磁盘上、本进程没有载入的会话。 @param {string} id @param {object} [extra] */
  const addCold = (id, extra = {}) => {
    const header = { id, cwd, origin: 'root', ...extra }
    rows.set(id, { header })
    return header
  }
  return {
    cwd, manager, add, addCold, asks, listeners,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

test('未登记时 assertLead 拒绝，become_lead 登记后生效且幂等', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    assert.throws(() => h.manager.assertLead(lead), /先调用 become_lead/)
    const first = await h.manager.becomeLead(lead, {}, undefined)
    assert.equal(first.sessionId, 'lead-1')
    assert.equal(first.replaced, null)
    assert.equal(readRecords(h.cwd).leadId, 'lead-1')
    // 已经在位上：不弹问，不重复写。
    const again = await h.manager.becomeLead(lead, {}, undefined)
    assert.equal(again.replaced, null)
    assert.equal(h.asks.length, 0)
    h.manager.assertLead(lead)
  } finally { h.cleanup() }
})

test('已有 Lead 时一律拒绝并报出现任者，且不弹问', async () => {
  const h = await setup()
  try {
    const seated = h.add('lead-a', { agentPreset: 'team-dev' })
    const rival = h.add('lead-b', { agentPreset: 'team-dev' })
    const plain = h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(seated, {}, undefined)
    await assert.rejects(() => h.manager.becomeLead(rival, {}, undefined), /已有 Lead lead-a/)
    await assert.rejects(() => h.manager.becomeLead(plain, {}, undefined), /只由团队开发助手 Lead 调用/)
    assert.equal(h.asks.length, 0)
    assert.equal(readRecords(h.cwd).leadId, 'lead-a')
  } finally { h.cleanup() }
})

test('takeover 必须先问用户：拒绝或取消都不改任何东西', async () => {
  for (const [name, ask] of [
    ['拒绝', () => ['保持现状']],
    ['取消', () => new Error('用户关闭了提问窗口')],
  ]) {
    const h = await setup({ ask })
    try {
      const seated = h.add('lead-a', { agentPreset: 'team-dev' })
      const rival = h.add('lead-b', { agentPreset: 'team-dev' })
      await h.manager.becomeLead(seated, {}, undefined)
      await h.manager.manage(seated, 'work-1', 'remove', undefined).catch(() => {})
      const before = readRecords(h.cwd)
      await assert.rejects(
        () => h.manager.becomeLead(rival, { takeover: true }, undefined),
        /没有取得用户同意/,
        name,
      )
      assert.deepEqual(readRecords(h.cwd), before, name)
      assert.equal(h.asks.length, 1, name)
    } finally { h.cleanup() }
  }
})

test('takeover 同意后替换 Lead 并把成员全部转过来', async () => {
  const h = await setup({ ask: () => ['替换 Lead'] })
  try {
    const seated = h.add('lead-a', { agentPreset: 'team-dev' })
    const rival = h.add('lead-b', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(seated, {}, undefined)
    await h.manager.manage(seated, 'work-1', 'add', undefined)
    assert.equal(readRecords(h.cwd).sessions['work-1'].leadId, 'lead-a')

    const taken = await h.manager.becomeLead(rival, { takeover: true }, undefined)
    assert.equal(taken.replaced, 'lead-a')
    const file = readRecords(h.cwd)
    assert.equal(file.leadId, 'lead-b')
    assert.equal(file.sessions['work-1'].leadId, 'lead-b')
    // live 会话的投递起点是 seq-1，转移后保持。
    assert.equal(file.sessions['work-1'].afterSeq, 99)
    // 原 Lead 不再算 Lead。
    assert.throws(() => h.manager.assertLead(seated), /先调用 become_lead/)
    h.manager.assertLead(rival)
  } finally { h.cleanup() }
})

test('manage 拒绝跨工作目录的会话', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-other', { agentPreset: 'main-dev', cwd: join(h.cwd, '..', 'somewhere-else') })
    await h.manager.becomeLead(lead, {}, undefined)
    await assert.rejects(() => h.manager.manage(lead, 'work-other', 'add', undefined), /不在本工作区/)
    assert.deepEqual(readRecords(h.cwd).sessions, {})
  } finally { h.cleanup() }
})

test('面板动作：纳入、移出、成为 Lead、失去 Lead', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    // 槽位空时纳入被拒绝，提示先让某个 team-dev 会话成为 Lead。
    await assert.rejects(() => h.manager.panelAct('work-1', 'add', 'work-1', undefined), /先让某个团队开发助手会话成为 Lead/)
    // 用户在面板上点「成为 Lead」：点击即确认，服务端不弹问。
    const seated = await h.manager.panelAct('work-1', 'become-lead', 'lead-1', undefined)
    assert.equal(seated.leadId, 'lead-1')
    assert.equal(h.asks.length, 0)
    // 纳入与移出
    await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
    assert.equal(readRecords(h.cwd).sessions['work-1'].leadId, 'lead-1')
    await h.manager.panelAct('work-1', 'remove', 'work-1', undefined)
    assert.deepEqual(readRecords(h.cwd).sessions, {})
    // 失去 Lead：槽位清空，成员留在原地。
    await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
    const lost = await h.manager.panelAct('work-1', 'lose-lead', 'lead-1', undefined)
    assert.equal(lost.leadId, null)
    const after = readRecords(h.cwd)
    assert.equal(after.leadId, undefined)
    assert.equal(after.sessions['work-1'].leadId, 'lead-1')
    assert.throws(() => h.manager.assertLead(lead), /先调用 become_lead/)
    // 下一个 Lead 接管时收编留在原地的成员 —— 前任会话还在语料里也照样收。
    const next = h.add('lead-2', { agentPreset: 'team-dev' })
    await h.manager.becomeLead(next, {}, undefined)
    assert.equal(readRecords(h.cwd).sessions['work-1'].leadId, 'lead-2')
    assert.equal(readRecords(h.cwd).sessions['work-1'].afterSeq, 99)
  } finally { h.cleanup() }
})

test('状态只表达任务状态：冷会话与载入后闲置都是「空闲」', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('warm-1', { agentPreset: 'main-dev' })
    h.addCold('cold-1', { agentPreset: 'main-dev' })
    h.add('busy-1', { agentPreset: 'main-dev' }).status = 'running'
    await h.manager.becomeLead(lead, {}, undefined)
    const page = await h.manager.panel('warm-1', undefined)
    const byId = id => page.sessions.find(row => row.sessionId === id)
    assert.equal(byId('warm-1').status, 'idle')
    // 冷会话没有 live agent，也不会有在途提问等待者，对用户与「载入后没事做」是同一件事。
    assert.equal(byId('cold-1').status, 'idle')
    assert.equal(byId('cold-1').pendingQuestions, 0)
    assert.equal(byId('busy-1').status, 'running')
    const listed = await h.manager.list(lead, {}, undefined)
    assert.equal(listed.sessions.find(row => row.sessionId === 'cold-1').status, 'idle')
    // 状态词汇就这四个：offline 与 error 都不在其中。
    const vocabulary = ['running', 'waiting', 'idle', 'missing']
    for (const row of [...page.sessions, ...listed.sessions]) {
      assert.ok(vocabulary.includes(row.status), `unexpected status ${row.status}`)
    }
  } finally { h.cleanup() }
})

test('面板成为 Lead 的准入：非 team-dev、受管理工作会话、Lead 自身都拒绝', async () => {
  const h = await setup()
  try {
    h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    h.add('dev-1', { agentPreset: 'team-dev' })
    await h.manager.panelAct('work-1', 'become-lead', 'lead-1', undefined)
    await assert.rejects(() => h.manager.panelAct('work-1', 'become-lead', 'work-1', undefined), /预设是 main-dev/)
    // Lead 不能把自己纳入工作会话。
    await assert.rejects(() => h.manager.panelAct('work-1', 'add', 'lead-1', undefined), /Lead 不能把自己纳入/)
    // 受管理工作会话不能再充当 Lead。
    await h.manager.panelAct('work-1', 'add', 'dev-1', undefined)
    await assert.rejects(() => h.manager.panelAct('work-1', 'become-lead', 'dev-1', undefined), /受管理工作会话/)
    // 未知动作
    await assert.rejects(() => h.manager.panelAct('work-1', 'nope', 'work-1', undefined), /未知的面板操作/)
  } finally { h.cleanup() }
})

test('setSessionModel 只改目标会话，拒绝 Lead 自己、跨目录和未接入的控制器', async () => {
  const calls = []
  const h = await setup({
    llm: { resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }) },
    sessionController: {
      selectSessionModel: async request => {
        calls.push(request)
        return { selected: { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort } }
      },
    },
  })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    h.add('work-other', { agentPreset: 'main-dev', cwd: join(h.cwd, '..', 'somewhere-else') })
    await h.manager.becomeLead(lead, {}, undefined)
    const selection = { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'high' }
    const installed = await h.manager.setSessionModel(lead, 'work-1', selection, undefined)
    assert.deepEqual(calls, [{ sessionId: 'work-1', ...selection }])
    assert.equal(installed.model, 'deepseek-reasoner')
    await assert.rejects(() => h.manager.setSessionModel(lead, 'lead-1', selection, undefined), /不能改 Lead 自己/)
    await assert.rejects(() => h.manager.setSessionModel(lead, 'work-other', selection, undefined), /不在本工作区/)
    assert.equal(calls.length, 1)
  } finally { h.cleanup() }
  const bare = await setup()
  try {
    const lead = bare.add('lead-1', { agentPreset: 'team-dev' })
    bare.add('work-1', { agentPreset: 'main-dev' })
    await bare.manager.becomeLead(lead, {}, undefined)
    await assert.rejects(
      () => bare.manager.setSessionModel(lead, 'work-1', { provider: 'p', model: 'm', reasoningEffort: 'high' }, undefined),
      /会话模型选择不可用/,
    )
  } finally { bare.cleanup() }
})

test('setSessionModel 对没有推理强度的模型把 off 换成不带该参数，别的强度直接报错', async () => {
  const calls = []
  const h = await setup({
    llm: { resolveModelInfo: async () => ({ provider: 'p', id: 'm', name: 'M' }) },
    sessionController: {
      selectSessionModel: async request => {
        calls.push(request)
        return {
          selected: {
            provider: request.provider, model: request.model,
            ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
          },
        }
      },
    },
  })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(lead, {}, undefined)
    const installed = await h.manager.setSessionModel(lead, 'work-1', { provider: 'p', model: 'm', reasoningEffort: 'off' }, undefined)
    // off 只对这类模型是“不带这个参数”，控制器收到的请求里没有 reasoningEffort。
    assert.deepEqual(calls, [{ sessionId: 'work-1', provider: 'p', model: 'm' }])
    assert.equal(installed.reasoningEffort, undefined)
    await assert.rejects(
      () => h.manager.setSessionModel(lead, 'work-1', { provider: 'p', model: 'm', reasoningEffort: 'high' }, undefined),
      /不支持推理强度，reasoning_effort 传 off/,
    )
    assert.equal(calls.length, 1)
  } finally { h.cleanup() }
})

test('listModels 列出可用模型且不改管理记录，非 Lead 或缺少目录时报错', async () => {
  const catalog = {
    default: { provider: 'deepseek', model: 'deepseek-chat' },
    groups: [{
      id: 'deepseek', name: 'DeepSeek',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'high' }], defaultEffort: 'high' } }],
    }],
    failures: [],
  }
  const h = await setup({ sessionController: { modelCatalog: async () => catalog } })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    const plain = h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(lead, {}, undefined)
    await assert.rejects(() => h.manager.listModels(plain, {}), /只由团队开发助手 Lead 调用/)
    const shown = await h.manager.listModels(lead, {})
    assert.equal(shown.providers, 1)
    assert.equal(shown.models, 1)
    assert.equal(shown.truncated, false)
    assert.match(shown.text, /deepseek（DeepSeek）/)
    assert.match(shown.text, /- deepseek-chat（DeepSeek Chat）：推理强度：high（默认 high）/)
    assert.equal((await h.manager.listModels(lead, { provider: 'nope' })).models, 0)
    // 只读：一次查询不写入任何成员记录。
    assert.deepEqual(readRecords(h.cwd).sessions, {})
  } finally { h.cleanup() }
  const bare = await setup()
  try {
    const lead = bare.add('lead-1', { agentPreset: 'team-dev' })
    await bare.manager.becomeLead(lead, {}, undefined)
    await assert.rejects(() => bare.manager.listModels(lead, {}), /模型目录不可用/)
  } finally { bare.cleanup() }
})

test('stopSession 只停当前轮并留下排队，拒绝 Lead 自己和跨目录，不拉起冷会话', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    const work = h.add('work-1', { agentPreset: 'main-dev' })
    const other = h.add('work-other', { agentPreset: 'main-dev', cwd: join(h.cwd, '..', 'somewhere-else') })
    const cancels = []
    work.cancel = (cause, options) => { cancels.push({ cause, options }) }
    other.cancel = () => { throw new Error('不应停止别的工作区') }
    await h.manager.becomeLead(lead, {}, undefined)
    assert.deepEqual(h.manager.stopSession(lead, 'work-1'), { sessionId: 'work-1', stopped: false })
    work.status = 'running'
    assert.deepEqual(h.manager.stopSession(lead, 'work-1'), { sessionId: 'work-1', stopped: true })
    assert.deepEqual(cancels, [{ cause: { kind: 'user' }, options: { keepInbox: true } }])
    assert.throws(() => h.manager.stopSession(lead, 'lead-1'), /不能停止 Lead 自己/)
    other.status = 'running'
    assert.throws(() => h.manager.stopSession(lead, 'work-other'), /不在本工作区/)
    assert.deepEqual(h.manager.stopSession(lead, 'missing'), { sessionId: 'missing', stopped: false })
    assert.equal(cancels.length, 1)
  } finally { h.cleanup() }
})

test('archiveSession 拒绝还在跑的会话和 Lead 自己，空闲会话才写入归档', async () => {
  const archived = []
  const registry = {
    archivedSessionIds: ['old'],
    archiveSession: async id => { archived.push(id) },
  }
  const h = await setup({ workspaceRegistry: registry })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    const work = h.add('work-1', { agentPreset: 'main-dev' })
    h.add('work-other', { agentPreset: 'main-dev', cwd: join(h.cwd, '..', 'somewhere-else') })
    h.addCold('old')
    await h.manager.becomeLead(lead, {}, undefined)
    await assert.rejects(() => h.manager.archiveSession(lead, 'lead-1', undefined), /不能归档 Lead 自己/)
    work.status = 'running'
    await assert.rejects(() => h.manager.archiveSession(lead, 'work-1', undefined), /还在跑/)
    assert.deepEqual(archived, [])
    work.status = 'idle'
    assert.deepEqual(await h.manager.archiveSession(lead, 'work-1', undefined), {
      sessionId: 'work-1', archived: true, already: false,
    })
    assert.deepEqual(archived, ['work-1'])
    await assert.rejects(() => h.manager.archiveSession(lead, 'work-other', undefined), /不在本工作区/)
    assert.deepEqual(await h.manager.archiveSession(lead, 'old', undefined), {
      sessionId: 'old', archived: true, already: true,
    })
    registry.archiveSession = async () => {
      const error = new Error('active')
      error.name = 'WorkspaceActiveSessionError'
      error.activity = [{ kind: 'job' }]
      throw error
    }
    await assert.rejects(() => h.manager.archiveSession(lead, 'work-1', undefined), /job/)
    assert.deepEqual(archived, ['work-1'])
  } finally { h.cleanup() }
})

test('wait 不指定会话：没人会发消息就立刻返回，否则等第一条结果或提问', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    const work = h.add('work-1', { agentPreset: 'main-dev' })
    const other = h.add('work-2', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(lead, {}, undefined)
    await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
    await h.manager.panelAct('work-1', 'add', 'work-2', undefined)
    await new Promise(resolve => setImmediate(resolve))
    const idle = await h.manager.wait(lead, 30, undefined)
    assert.deepEqual(idle, { kind: 'none', timedOut: false, waited: false })
    assert.throws(() => h.manager.wait(lead, 0, undefined), /timeout_seconds/)

    work.status = 'running'
    other.status = 'running'
    const waiting = h.manager.wait(lead, 30, undefined)
    h.manager.noteInbound({ sessionId: 'work-2', leadId: 'lead-1', kind: 'result' })
    const done = await waiting
    assert.deepEqual(done, { sessionId: 'work-2', kind: 'result', timedOut: false, waited: true })

    work.status = 'running'
    const stopping = h.manager.wait(lead, 30, undefined)
    work.status = 'idle'
    other.status = 'idle'
    h.manager.changed()
    const stopped = await stopping
    assert.deepEqual(stopped, { kind: 'none', timedOut: false, waited: true })

    work.status = 'running'
    const questioning = h.manager.wait(lead, 30, undefined)
    h.manager.noteInbound({ sessionId: 'work-1', leadId: 'lead-1', kind: 'question' })
    const arrived = await questioning
    assert.deepEqual(arrived, { sessionId: 'work-1', kind: 'question', timedOut: false, waited: true })

    const handler = h.listeners.get('user-questions/request')?.[0]
    assert.ok(handler)
    void handler({
      agent: work,
      questions: [{ id: 'q1', question: '继续？' }],
      signal: new AbortController().signal,
    }, () => new Promise(() => {}))
    const asked = await h.manager.wait(lead, 30, undefined)
    assert.deepEqual(asked, { sessionId: 'work-1', kind: 'question', timedOut: false, waited: false })
  } finally { h.cleanup() }
})

test('轮次结果插队进入 Lead 下一步，保留团队来源和正文', async () => {
  const stored = new Map()
  const delivered = Promise.withResolvers()
  const h = await setup({
    logger: { warn: (_format, error) => delivered.reject(new Error(error)), info() {} },
    sessionPersistence: {
      open: async id => {
        const record = stored.get(id)
        if (!record) throw new Error(`unknown stored session ${id}`)
        return {
          header: record.header,
          read: async (offset, length) => ({
            events: record.events.filter(event => event.seq >= offset && (length === undefined || event.seq < offset + length)),
          }),
          close: async () => {},
        }
      },
    },
    sessionProjections: { stateOf: () => undefined },
  })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    const work = h.add('work-1', { agentPreset: 'main-dev' })
    const leadEvents = []
    const workEvents = []
    stored.set(lead.id, { header: lead.session.header, events: leadEvents })
    stored.set(work.id, { header: work.session.header, events: workEvents })
    const receive = (target, message) => {
      const inbox = target === 'next-step' ? lead.inbox.nextStep : lead.inbox.nextTurn
      const start = inbox.length
      inbox.push(message)
      leadEvents.push({
        type: 'agent/inbox/spliced', seq: lead.session.seq++,
        data: { target, start, deleteCount: 0, inserted: [message] },
      })
      delivered.resolve({ target, message })
    }
    lead.followup = message => receive('next-turn', message)
    lead.steer = message => receive('next-step', message)
    lead.status = 'running'
    await h.manager.becomeLead(lead, {}, undefined)
    await h.manager.panelAct(work.id, 'add', work.id, undefined)
    const end = { type: 'turn/end', seq: 102, data: { turn: 1, reason: { kind: 'completed' } } }
    workEvents.push(
      { type: 'turn/start', seq: 100, data: { turn: 1 } },
      { type: 'assistant/message', seq: 101, data: { turn: 1, message: { content: [{ type: 'text', text: '截图已处理。' }] } } },
      end,
    )
    work.session.seq = 103
    h.manager.onEvent(work.session, end)
    const { target, message } = await delivered.promise
    assert.equal(target, 'next-step')
    assert.equal(lead.inbox.nextTurn.length, 0)
    assert.equal(lead.inbox.nextStep.length, 1)
    assert.match(message.id, /^team-result:/)
    assert.deepEqual(message.source, {
      kind: 'team-message', form: 'notice', summary: 'work-1 第 1 轮 · completed',
    })
    assert.match(message.content[0].text, /第 1 轮已结束/)
    assert.ok(message.content[0].text.endsWith('截图已处理。'))
  } finally {
    await h.manager.dispose()
    h.cleanup()
  }
})

test('提问以团队通知插队，保留提问前正文和选项，没有标题时用会话 id', async () => {
  for (const title of ['文档助手', undefined]) {
    const h = await setup({ sessionTitle: title === undefined ? undefined : { get: () => ({ title }) } })
    try {
      const lead = h.add('lead-1', { agentPreset: 'team-dev' })
      const work = h.add('work-1', { agentPreset: 'main-dev' })
      const messages = []
      const delivered = Promise.withResolvers()
      let deliveryMethod
      lead.followup = message => { deliveryMethod = 'followup'; messages.push(message); delivered.resolve() }
      lead.steer = message => { deliveryMethod = 'steer'; messages.push(message); delivered.resolve() }
      work.session.snapshotEvents = () => [{
        type: 'assistant/message', seq: 99,
        data: { turn: 1, message: { content: [{ type: 'text', text: '方案：保持已有截图。' }] } },
      }]
      await h.manager.becomeLead(lead, {}, undefined)
      await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
      const handler = h.listeners.get('user-questions/request')?.[0]
      assert.ok(handler)
      const answered = handler({
        agent: work,
        questions: [{ id: 'q1', header: '下一步', question: '继续吗？', options: [{ label: '继续', description: '保留当前方案' }] }],
        signal: new AbortController().signal,
      }, () => new Promise(() => {}))
      await delivered.promise
      assert.equal(deliveryMethod, 'steer')
      assert.equal(messages.length, 1)
      assert.equal(messages[0].role, 'user')
      assert.deepEqual(messages[0].source, {
        kind: 'team-message', form: 'notice', summary: `${title ?? 'work-1'} 正在提问`,
      })
      assert.deepEqual(messages[0].content, [{ type: 'text', text: [
        '受管理根会话 work-1 正在提问。用户弹窗仍在，你和用户谁先回答谁算。',
        '用 reply_question 回答，不要用 continue_session。每个问题一条答案；selected 填选项原文，自由文本用 custom。',
        '', '提问前的正文：', '方案：保持已有截图。',
        '', '问题 id：q1', '标题：下一步', '继续吗？', '- 继续：保留当前方案',
      ].join('\n') }])
      const answers = [{ id: 'q1', selected: ['继续'] }]
      assert.deepEqual(h.manager.reply(lead, { session_id: work.id, answers }), { delivered: true })
      assert.deepEqual(await answered, { answers })
    } finally { h.cleanup() }
  }
})

test('reply_question 先答时只取消弹窗信号，不取消工具自己的信号', async () => {
  const h = await setup()
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    const work = h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(lead, {}, undefined)
    await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
    const handler = h.listeners.get('user-questions/request')?.[0]
    assert.ok(handler)
    const outer = new AbortController()
    const request = {
      agent: work,
      questions: [{ id: 'q1', question: '继续？' }],
      signal: outer.signal,
    }
    const answered = handler(request, () => new Promise(() => {}))
    assert.notEqual(request.signal, outer.signal)
    assert.equal(request.signal.aborted, false)
    assert.deepEqual(
      h.manager.reply(lead, { session_id: 'work-1', answers: [{ id: 'q1', selected: [], custom: '好' }] }),
      { delivered: true },
    )
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(request.signal.aborted, true)
    assert.equal(outer.signal.aborted, false)
    assert.deepEqual(await answered, { answers: [{ id: 'q1', selected: [], custom: '好' }] })
  } finally { h.cleanup() }
})

test('wait 在 goal 还会自己续时不把中间空闲当成没有消息', async () => {
  const goal = { phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 4 }
  const h = await setup({ goals: { get: () => goal } })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(lead, {}, undefined)
    await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
    let settled = false
    const waiting = h.manager.wait(lead, 30, undefined).then(value => { settled = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false)
    h.manager.noteInbound({ sessionId: 'work-1', leadId: 'lead-1', kind: 'result' })
    assert.deepEqual(await waiting, { sessionId: 'work-1', kind: 'result', timedOut: false, waited: true })
  } finally { h.cleanup() }
})

test('goal 还会自己续时只推进投递起点，停下后才走回传', async () => {
  const goal = { phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 4 }
  const h = await setup({ goals: { get: () => goal } })
  try {
    const lead = h.add('lead-1', { agentPreset: 'team-dev' })
    h.add('work-1', { agentPreset: 'main-dev' })
    await h.manager.becomeLead(lead, {}, undefined)
    await h.manager.panelAct('work-1', 'add', 'work-1', undefined)
    assert.equal(readRecords(h.cwd).sessions['work-1'].afterSeq, 99)
    h.manager.onEvent(
      { id: 'work-1' },
      { type: 'turn/end', seq: 120, data: { reason: { kind: 'completed' }, turn: 2 } },
    )
    assert.equal(readRecords(h.cwd).sessions['work-1'].afterSeq, 120)
    goal.phase = 'complete'
    h.manager.onEvent(
      { id: 'work-1' },
      { type: 'turn/end', seq: 140, data: { reason: { kind: 'completed' }, turn: 3 } },
    )
    await new Promise(resolve => setImmediate(resolve))
    // 回传路径会去读日志；假 ctx 没有持久化，所以起点停在上一轮。
    assert.equal(readRecords(h.cwd).sessions['work-1'].afterSeq, 120)
  } finally { h.cleanup() }
})
