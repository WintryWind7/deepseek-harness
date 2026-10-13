/**
 * 用已构建的 AgentLoop、goal 驱动和会话控制器，驱动团队管理实例。
 * 不访问真实模型、真实 profile 或已有会话。
 *
 * 跑法：node --test personal/team/switch.host.test.js
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createManager } from './index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const resolveFrom = createRequire(join(root, 'packages/goal/goal-round-driver/package.json'))
const load = spec => import(pathToFileURL(resolveFrom.resolve(spec)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: AgentLoop } = await load('@deepseek-ai/dsh-agent-loop')
const { mountAgentLoopTestDependencies } = await load('@deepseek-ai/dsh-agent-loop-testkit')
const { default: GoalService } = await load('@deepseek-ai/dsh-goal')
const goalDriver = await load('@deepseek-ai/dsh-goal-round-driver')
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const { default: SessionController } = await import(pathToFileURL(join(root, 'packages/api/session-controller/lib/index.js')).href)

const SELECTION = { provider: 'probe', model: 'new', reasoningEffort: 'off' }

async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`超时：${label}`)), 5000) }),
    ])
  } finally { clearTimeout(timer) }
}

class ProbeAdapter extends LlmAdapter {
  requests = []
  waiters = []
  providerInfo(provider) { return { id: provider, name: 'Probe' } }
  async listModels(provider) { return ['old', 'new'].map(id => ({ provider, id, name: id })) }
  async resolveModel(provider, model) {
    assert.ok(['old', 'new'].includes(model))
    return { provider, id: model, name: model }
  }
  requestAt(count) {
    if (this.requests.length >= count) return this.requests[count - 1]
    return bounded(new Promise(resolve => this.waiters.push({ count, resolve })), `第 ${count} 个请求`)
  }
  async *stream(options) {
    let resolveAborted
    const aborted = new Promise(resolve => { resolveAborted = resolve })
    const onAbort = () => resolveAborted()
    options.signal.addEventListener('abort', onAbort, { once: true })
    this.requests.push(options)
    for (const waiter of this.waiters.splice(0)) {
      if (this.requests.length >= waiter.count) waiter.resolve(this.requests[waiter.count - 1])
      else this.waiters.push(waiter)
    }
    try {
      if (options.signal.aborted) onAbort()
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await aborted
      options.signal.throwIfAborted()
    } finally { options.signal.removeEventListener('abort', onAbort) }
  }
}

async function harness(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'team-switch-'))
  const ctx = new Context()
  const adapter = new ProbeAdapter()
  let manager
  t.after(async () => {
    await manager?.dispose().catch(() => {})
    await bounded(ctx.fiber.dispose(), 'context teardown').catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  await ctx.plugin(goalDriver)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['probe'], adapter)
  const dispose = () => {}
  ctx.provide('typert', { lookups: { configure: () => dispose }, contexts: { configureHost: () => dispose } })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'probe', model: 'old' }),
    saveSelection: async () => { throw new Error('不应写账号默认模型') },
  })
  ctx.provide('fileUploads', { registerAgentResolver: () => dispose })
  ctx.provide('workspaceRegistry', { archivedSessionIds: [] })
  ctx.provide('sessionQuery', {
    async listSessions() { return ctx.sessions.list().map(session => ({ header: session.header })) },
    async observeSession() { throw new Error('这个测试不读取冷会话') },
  })
  void new SessionController(ctx, { nativeOpen: false })
  const lead = await ctx.agentLoop.create(`lead-${randomUUID()}`, { provider: 'probe', model: 'old' }, { cwd, agentPreset: 'team-dev' })
  const work = await ctx.agentLoop.create(`work-${randomUUID()}`, { provider: 'probe', model: 'old' }, { cwd, agentPreset: 'main-dev' })
  manager = createManager(ctx, { resultChars: 4000, questionHistoryLimit: 8, stopTimeoutSeconds: 5 })
  await manager.load()
  manager.start()
  await manager.becomeLead(lead, {}, undefined)
  return { ctx, adapter, manager, lead, work }
}

const options = { timeout: 15000 }

test('运行中的 goal 换模型时，旧请求被取消，后续请求使用新模型', options, async t => {
  const h = await harness(t)
  h.ctx.goals.create(h.work, { objective: '继续隔离任务', maxGoalRounds: 3 })
  const first = await h.adapter.requestAt(1)
  const installed = await h.manager.setSessionModel(h.lead, h.work.id, SELECTION, undefined)
  const second = await h.adapter.requestAt(2)
  assert.equal(first.model, 'old')
  assert.equal(first.signal.aborted, true)
  assert.equal(second.model, 'new')
  assert.equal(installed.resumed, true)
  assert.equal(installed.model, 'new')
  const sources = second.messages.map(message => message.source.kind)
  assert.ok(sources.includes('goal'))
  assert.ok(sources.includes('model-selection'))
  assert.equal(sources.includes('team-message'), false)
  assert.equal(h.ctx.goals.get(h.work).activation, 'armed')
})

test('空闲且没有 goal 时只换模型，不发出请求', options, async t => {
  const h = await harness(t)
  const installed = await h.manager.setSessionModel(h.lead, h.work.id, SELECTION, undefined)
  assert.equal(installed.continued, false)
  assert.equal(h.adapter.requests.length, 0)
  assert.equal(installed.model, 'new')
})

test('没有 goal 的运行轮换模型后，用新模型继续且不重复原任务', options, async t => {
  const h = await harness(t)
  h.work.followup(createUserMessage({ content: [{ type: 'text', text: '原始隔离任务' }], source: { kind: 'user' } }))
  await h.adapter.requestAt(1)
  await h.manager.setSessionModel(h.lead, h.work.id, SELECTION, undefined)
  const second = await h.adapter.requestAt(2)
  assert.equal(second.model, 'new')
  const text = second.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text)
  assert.equal(text.filter(item => item === '原始隔离任务').length, 1)
  assert.ok(text.includes('模型已切换，从当前进度继续。'))
})

test('独立停止不换模型，也不再发出请求', options, async t => {
  const h = await harness(t)
  h.ctx.goals.create(h.work, { objective: '停止后不要继续', maxGoalRounds: 3 })
  const first = await h.adapter.requestAt(1)
  const stopped = await h.manager.stopSession(h.lead, h.work.id, undefined)
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(stopped.stopped, true)
  assert.equal(first.signal.aborted, true)
  assert.equal(h.adapter.requests.length, 1)
  assert.notEqual(h.ctx.goals.get(h.work).activation, 'armed')
})
