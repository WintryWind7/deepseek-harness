/** Locale namespace for the worktree-bind chip. */

export const NS = 'worktree-bind' as const

/** Copy keys the worktree-bind chip and picker render. */
export type WorktreeBindKey =
  | 'chip'
  | 'heading'
  | 'create'
  | 'unbind'
  | 'search'
  | 'placeholder'
  | 'empty'
  | 'error'
  | 'locked'
  | 'auto'

/** Chinese dictionary. */
export const zh: Record<WorktreeBindKey, string> = {
  chip: '分支',
  heading: '本地分支',
  create: '新建分支',
  unbind: '解绑',
  search: '搜索分支',
  placeholder: '新分支名',
  empty: '没有匹配的分支。',
  error: '无法读取 Git 状态',
  locked: '会话已开始，不能再改分支。',
  auto: '填入会话名',
}

/** English dictionary. */
export const en: Record<WorktreeBindKey, string> = {
  chip: 'Branch',
  heading: 'Local branches',
  create: 'New branch',
  unbind: 'Unbind',
  search: 'Search branches',
  placeholder: 'New branch name',
  empty: 'No matching branches.',
  error: 'Unable to read git status',
  locked: 'This session has started; the branch can no longer change.',
  auto: 'Use session id',
}
