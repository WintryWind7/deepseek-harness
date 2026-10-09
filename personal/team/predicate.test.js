/**
 * 团队可见性谓词的单元检查。这三个函数是 `list_sessions` 与面板共用的口径，
 * 也是这次修正的核心：本工作目录、未归档、普通根会话。
 *
 * 跑法：node --test personal/team/predicate.test.js
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isRoot, isVisibleRoot, mapLimit, titleText } from './runtime.js'

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
