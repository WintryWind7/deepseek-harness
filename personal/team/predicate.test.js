/**
 * 团队可见性谓词的单元检查。这三个函数是 `list_sessions` 与面板共用的口径，
 * 也是这次修正的核心：本工作目录、未归档、普通根会话。
 *
 * 跑法：node --test personal/team/predicate.test.js
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { formatQuestions } from './questions.js'
import {
  adoptMembers, goalWillContinue, isRoot, isVisibleRoot, liveLeadId, mapLimit, modelCatalogText, modelSelection, mountPreset,
  normalizeEffort, readRecords, selectionLabel, titleText, updateLead, updateRecord, writeTeam,
} from './runtime.js'

const CWD = 'D:\\why\\deepseek-harness'

/** @param {string} id @param {object} [extra] */
const header = (id, extra = {}) => ({ id, cwd: CWD, ...extra })
/** 没有 live agent 的上下文：冷会话一律算根。 */
const cold = { agents: { get: () => undefined, roots: () => [] } }
/** live 上下文：只有出现在 roots() 里的才算根。 */
const live = roots => ({ agents: { get: id => ({ id }), roots: () => roots } })
/** @param {object} [extra] */
const view = (extra = {}) => ({ cwd: CWD, archived: new Set(), ...extra })

test('isRoot 拒绝 subagent，接受冷会话与 live 根会话', () => {
  assert.equal(isRoot(header('a', { origin: 'subagent' }), cold), false)
  assert.equal(isRoot(header('a'), cold), true)
  assert.equal(isRoot(header('a'), live([{ id: 'a' }])), true)
  assert.equal(isRoot(header('a'), live([])), false)
})

test('isVisibleRoot 只让本工作目录、未归档的会话通过', () => {
  assert.equal(isVisibleRoot(header('a'), view()), true)
  assert.equal(isVisibleRoot(header('a', { cwd: 'D:\\other' }), view()), false)
  assert.equal(isVisibleRoot(header('a', { cwd: undefined }), view()), false)
  assert.equal(isVisibleRoot(header('a'), view({ archived: new Set(['a']) })), false)
})

test('isVisibleRoot 的 managedOnly 按 Lead 归属过滤', () => {
  assert.equal(isVisibleRoot(header('a'), view({ managedOnly: true, leadId: 'L', managedLeadId: 'L' })), true)
  assert.equal(isVisibleRoot(header('a'), view({ managedOnly: true, leadId: 'L', managedLeadId: 'other' })), false)
  assert.equal(isVisibleRoot(header('a'), view({ managedOnly: true, leadId: 'L', managedLeadId: null })), false)
  // 省略或 false 时不过滤归属：未纳入管理的会话仍要能看到。
  assert.equal(isVisibleRoot(header('a'), view({ leadId: 'L', managedLeadId: 'other' })), true)
  assert.equal(isVisibleRoot(header('a'), view({ managedOnly: false, leadId: 'L', managedLeadId: 'other' })), true)
})

test('titleText 吃掉标题取值的两种形状', () => {
  assert.equal(titleText('标题'), '标题')
  assert.equal(titleText({ title: '标题', eventSeq: 1 }), '标题')
  assert.equal(titleText(undefined), undefined)
  assert.equal(titleText(null), undefined)
  assert.equal(titleText({}), undefined)
  assert.equal(titleText(7), undefined)
})

test('mapLimit 保持输入顺序，且并发不超过上限', async () => {
  const items = [50, 5, 30, 1, 20, 2, 10, 3]
  let running = 0
  let peak = 0
  const out = await mapLimit(items, 3, async value => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, value))
    running -= 1
    return value * 2
  })
  // 完成顺序与输入顺序不同，结果仍按输入排列。
  assert.deepEqual(out, items.map(value => value * 2))
  // 三个工作位在第一个 await 之前就都已经起来了。
  assert.equal(peak, 3)
})

test('mapLimit 在空输入与上限大于条目数时都不出错', async () => {
  assert.deepEqual(await mapLimit([], 4, async () => 1), [])
  assert.deepEqual(await mapLimit([1, 2], 10, async value => value + 1), [2, 3])
})

/** 建一个临时工作目录跑记录文件，结束必删。 @param {(cwd: string) => void} body */
function withCwd(body) {
  const cwd = mkdtempSync(join(tmpdir(), 'team-records-'))
  try { body(cwd) } finally { rmSync(cwd, { recursive: true, force: true }) }
}

test('记录文件的 leadId 与成员表互不覆盖', () => {
  withCwd(cwd => {
    updateRecord(cwd, 'session-a', { leadId: 'session-lead', preset: 'main-dev', afterSeq: 3, generation: 'g1', leadReceiptFloor: 2 })
    updateLead(cwd, 'session-lead')
    assert.equal(readRecords(cwd).leadId, 'session-lead')
    // 再写一个成员：updateRecord 不能把顶层 leadId 抹掉。
    updateRecord(cwd, 'session-b', { leadId: 'session-lead', preset: 'main-dev', afterSeq: 1, generation: 'g2', leadReceiptFloor: 0 })
    assert.equal(readRecords(cwd).leadId, 'session-lead')
    assert.deepEqual(Object.keys(readRecords(cwd).sessions).sort(), ['session-a', 'session-b'])
    // 清空槽位：指针消失，成员表不动。
    updateLead(cwd, undefined)
    assert.equal(readRecords(cwd).leadId, undefined)
    assert.equal(Object.keys(readRecords(cwd).sessions).length, 2)
  })
})

test('liveLeadId 让消失的 Lead 变成空槽', () => {
  assert.equal(liveLeadId(undefined, ['a']), undefined)
  assert.equal(liveLeadId('a', ['a', 'b']), 'a')
  assert.equal(liveLeadId('a', ['b']), undefined)
})

test('adoptMembers 收编本工作区里所有不属于新 Lead 的成员记录', () => {
  const sessions = {
    a: { leadId: 'old', preset: 'main-dev', afterSeq: 1, generation: 'g1', leadReceiptFloor: 5 },
    b: { leadId: 'gone', preset: 'main-dev', afterSeq: 2, generation: 'g2', leadReceiptFloor: 6 },
    d: { leadId: 'new', preset: 'main-dev', afterSeq: 4, generation: 'g4', leadReceiptFloor: 8 },
  }
  const next = adoptMembers(sessions, 'new')
  // 前任名下的成员转过来，投递位置保留、代次换新。
  assert.equal(next.a.leadId, 'new')
  assert.notEqual(next.a.generation, 'g1')
  assert.equal(next.a.afterSeq, 1)
  assert.equal(next.a.leadReceiptFloor, 5)
  // 指向已经消失的 Lead 的孤儿成员一并收编。
  assert.equal(next.b.leadId, 'new')
  assert.notEqual(next.b.generation, 'g2')
  // 前任会话是否还在语料里无关紧要：失去 Lead 后留在原地的成员同样收编。
  // 已经归新 Lead 的行原样保留。
  assert.equal(next.d, sessions.d)
  assert.equal(sessions.a.leadId, 'old')
})

test('readRecords 拒绝损坏的 leadId 与不完整的成员记录', () => {
  withCwd(cwd => {
    mkdirSync(join(cwd, '.dsh'), { recursive: true })
    const path = join(cwd, '.dsh', 'team-dev-sessions.json')
    writeFileSync(path, '{"leadId":7,"sessions":{}}', 'utf8')
    assert.throws(() => readRecords(cwd), /leadId 无效/)
    writeFileSync(path, '{"sessions":{"x":{"leadId":"l"}}}', 'utf8')
    assert.throws(() => readRecords(cwd), /管理记录不完整/)
    writeFileSync(path, '{}', 'utf8')
    assert.throws(() => readRecords(cwd), /缺少 sessions 记录/)
  })
})

test('readRecords 在没有记录文件时给出空槽', () => {
  withCwd(cwd => {
    assert.deepEqual(readRecords(cwd), { leadId: undefined, sessions: {} })
  })
})

test('登记 Lead 的整条落盘：写槽位 + 收编成员 + 保留投递位置', () => {
  withCwd(cwd => {
    updateRecord(cwd, 'm1', { leadId: 'old', preset: 'main-dev', afterSeq: 7, generation: 'g1', leadReceiptFloor: 3 })
    updateRecord(cwd, 'm2', { leadId: 'gone', preset: 'main-dev', afterSeq: 9, generation: 'g2', leadReceiptFloor: 4 })
    // 下面两步就是 seatLead 的落盘动作。
    const sessions = adoptMembers(readRecords(cwd).sessions, 'lead-1')
    writeTeam(cwd, { leadId: 'lead-1', sessions })
    const after = readRecords(cwd)
    assert.equal(after.leadId, 'lead-1')
    assert.deepEqual(Object.keys(after.sessions).sort(), ['m1', 'm2'])
    assert.equal(after.sessions.m1.leadId, 'lead-1')
    assert.equal(after.sessions.m1.afterSeq, 7)
    assert.equal(after.sessions.m1.leadReceiptFloor, 3)
    assert.notEqual(after.sessions.m1.generation, 'g1')
    assert.equal(after.sessions.m2.leadId, 'lead-1')
    assert.notEqual(after.sessions.m2.generation, 'g2')
    // 重复登记不能让已归新 Lead 的行换代次，否则会重复投递。
    writeTeam(cwd, { leadId: 'lead-1', sessions: adoptMembers(after.sessions, 'lead-1') })
    assert.deepEqual(readRecords(cwd).sessions, after.sessions)
  })
})

test('modelSelection 要么三项一起给，要么在可选时全部省略', () => {
  assert.equal(modelSelection({}, false), undefined)
  assert.deepEqual(modelSelection({ provider: ' p ', model: 'm', reasoning_effort: 'high' }, true), {
    provider: 'p', model: 'm', reasoningEffort: 'high',
  })
  assert.throws(() => modelSelection({ model: 'm' }, false), /必须一起给出/)
  assert.throws(() => modelSelection({}, true), /必须一起给出/)
  assert.throws(() => modelSelection({ provider: ' ', model: 'm', reasoning_effort: 'high' }, true), /provider/)
})

test('goalWillContinue 只在还会自动续轮时为真', () => {
  const armed = { phase: 'active', activation: 'armed', roundsStarted: 2, maxGoalRounds: 4 }
  assert.equal(goalWillContinue(armed, 'completed'), true)
  assert.equal(goalWillContinue({ ...armed, roundsStarted: 4 }, 'completed'), false)
  assert.equal(goalWillContinue({ ...armed, phase: 'complete' }, 'completed'), false)
  assert.equal(goalWillContinue({ ...armed, activation: 'disarmed' }, 'completed'), false)
  assert.equal(goalWillContinue(armed, 'max-tokens'), false)
  assert.equal(goalWillContinue(armed, 'aborted'), false)
  assert.equal(goalWillContinue(undefined, 'completed'), false)
})

test('modelCatalogText 列出提供方、模型、推理强度和读取失败', () => {
  const catalog = {
    default: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    groups: [{
      id: 'deepseek', name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'high' } },
        { id: 'plain', name: 'Plain' },
      ],
    }],
    failures: [{ id: 'chattt', name: 'ChatTT', message: '连接超时' }],
  }
  const shown = modelCatalogText(catalog, {
    current: { provider: 'chattt', model: 'grok-4.7', reasoningEffort: 'xhigh' },
  })
  assert.equal(shown.providers, 1)
  assert.equal(shown.models, 2)
  assert.equal(shown.truncated, false)
  assert.equal(shown.text, [
    '你当前的模型：chattt/grok-4.7（强度 xhigh）',
    '账号默认模型：deepseek/deepseek-chat（强度 high）',
    '当前可用 1 个提供方、2 个模型。',
    '读取失败：chattt（ChatTT）：连接超时',
    '',
    'deepseek（DeepSeek）',
    '- deepseek-chat（DeepSeek Chat）：推理强度：off、high（默认 high）',
    '- plain（Plain）：不支持推理强度；指定它时 reasoning_effort 传 off',
  ].join('\n'))
})

test('modelCatalogText 按 provider 只看一个提供方，没有时说明可以省略', () => {
  const catalog = {
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }],
    failures: [{ id: 'chattt', name: 'ChatTT', message: '连接超时' }],
  }
  const one = modelCatalogText(catalog, { provider: 'deepseek' })
  assert.equal(one.providers, 1)
  assert.equal(one.models, 1)
  assert.equal(one.text.includes('读取失败'), false)
  assert.match(one.text, /提供方 deepseek 可用 1 个模型。/)
  const none = modelCatalogText(catalog, { provider: 'nope' })
  assert.equal(none.providers, 0)
  assert.equal(none.models, 0)
  assert.match(none.text, /没有提供方 nope。省略 provider 可以列出全部。/)
})

test('modelCatalogText 超出上限时截断，仍然报出总数', () => {
  const models = Array.from({ length: 200 }, (_, index) => ({ id: `model-${index}`, name: `模型 ${index}` }))
  const shown = modelCatalogText({ groups: [{ id: 'p', name: 'P', models }], failures: [] }, { limit: 1000 })
  assert.equal(shown.truncated, true)
  assert.equal(shown.models, 200)
  assert.ok(shown.text.length <= 1000)
  assert.ok(shown.text.endsWith('（已截断。要看得更全，用 provider 指定一个提供方。）'))
})

test('normalizeEffort 只把没有推理强度的模型的 off 换成不带该参数', () => {
  const selection = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  const reasoning = { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' }
  assert.equal(normalizeEffort({ reasoning }, selection), 'high')
  assert.equal(normalizeEffort({ reasoning }, { ...selection, reasoningEffort: 'off' }), 'off')
  assert.equal(normalizeEffort({}, { ...selection, reasoningEffort: 'off' }), undefined)
  assert.throws(() => normalizeEffort({}, selection), /p\/m 不支持推理强度，reasoning_effort 传 off/)
})

test('selectionLabel 在没有推理强度时说明，不印出 undefined', () => {
  assert.equal(selectionLabel({ provider: 'p', model: 'm', reasoningEffort: 'high' }), 'p/m，强度 high')
  assert.equal(selectionLabel({ provider: 'p', model: 'm' }), 'p/m（该模型没有推理强度）')
})

test('提问通知带上工具前的正文，没有正文时不另起一段', () => {
  const question = [{ id: 'q1', question: '用哪一种？', options: [{ label: '甲', description: '现有接口' }] }]
  const withBody = formatQuestions('session-1', question, { text: '方案：改导出。', truncated: true })
  assert.match(withBody, /提问前的正文：\n方案：改导出。/)
  assert.match(withBody, /正文已截断/)
  assert.match(withBody, /问题 id：q1/)
  const bare = formatQuestions('session-1', question, null)
  assert.equal(bare.includes('提问前的正文'), false)
})

test('mountPreset 等绑定完成，不把预设身份交给工厂的 commit', async () => {
  let seen
  const presets = {
    mount: async (agentCtx, id) => {
      seen = { agentCtx, id }
      return { id }
    },
  }
  const commit = await mountPreset(presets, 'main-dev')({ scope: 'child' })
  assert.deepEqual(seen, { agentCtx: { scope: 'child' }, id: 'main-dev' })
  assert.equal(commit, undefined)
  assert.doesNotThrow(() => { commit?.commit() })
})
