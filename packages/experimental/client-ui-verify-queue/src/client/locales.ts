/** Locale namespace for the verify-queue drawer. */

export const NS = 'verify-queue' as const

export type VerifyQueueKey =
  | 'title'
  | 'open'
  | 'close'
  | 'pin'
  | 'unpin'
  | 'refresh'
  | 'empty'
  | 'noWorkspace'
  | 'status.recorded'
  | 'status.on-main'
  | 'status.verified'
  | 'verify'
  | 'unverify'
  | 'remove'
  | 'error'

export const zh: Record<VerifyQueueKey, string> = {
  title: '验收',
  open: '打开验收列表',
  close: '收起验收列表',
  pin: '钉住',
  unpin: '取消钉住',
  refresh: '刷新是否已进 main',
  empty: '还没有 worktree 记入的修复。',
  noWorkspace: '打开一个工作区会话以查看验收列表。',
  'status.recorded': '未进 main',
  'status.on-main': '待验收',
  'status.verified': '已验收',
  verify: '标为已验收',
  unverify: '取消验收',
  remove: '从列表移除',
  error: '无法读取验收列表',
}

export const en: Record<VerifyQueueKey, string> = {
  title: 'Verify',
  open: 'Open verify queue',
  close: 'Collapse verify queue',
  pin: 'Pin',
  unpin: 'Unpin',
  refresh: 'Refresh whether commits are on main',
  empty: 'No worktree fixes recorded yet.',
  noWorkspace: 'Open a workspace session to see the verify queue.',
  'status.recorded': 'Not on main',
  'status.on-main': 'Awaiting check',
  'status.verified': 'Checked',
  verify: 'Mark checked',
  unverify: 'Clear check',
  remove: 'Remove from list',
  error: 'Could not load the verify queue',
}
