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
import {
  adoptMembers, isRoot, isVisibleRoot, liveLeadId, mapLimit, modelSelection, readRecords, titleText, updateLead,
  updateRecord, writeTeam,
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
