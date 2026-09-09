/**
 * Model-facing worktree binding text.
 * @module @deepseek-ai/dsh-experimental-worktree-bind/prompt
 */

import type { WorktreeBindSelection } from './wire.ts'

/**
 * Text substituted for `{{worktree}}`. Empty when unbound, or when the bound
 * branch is `main`/`master` (the opened project directory).
 * @param selection - recorded binding, or undefined when unbound.
 * @returns the substituted paragraph, or empty.
 */
export function worktreeVariable(selection: WorktreeBindSelection | undefined): string {
  if (selection === undefined) return ''
  if (selection.branch === 'main' || selection.branch === 'master') return ''
  return promptText(selection)
}

/**
 * Warning substituted for `{{worktree}}` when a persisted binding no longer
 * matches disk after a Host restart. Tells the model to stop editing project
 * files until the user re-binds, instead of silently falling back to cwd.
 * @param reason - why the persisted binding was rejected.
 * @returns the warning paragraph.
 */
export function lostWarningText(reason: string): string {
  return [
    `警告：本会话此前绑定的 Git Worktree 已失效（${reason}）。`,
    '当前会话没有绑定的 Worktree；在用户通过输入框芯片重新选择分支之前，不要在会话 cwd 里修改项目文件。',
  ].join('\n')
}

/**
 * Worktree paragraph for a non-default-branch binding.
 * @param selection - checkout the model should use.
 * @returns the model-facing paragraph.
 */
export function promptText(selection: WorktreeBindSelection): string {
  const branch = selection.branch ?? '(detached HEAD)'
  return [
    '当前会话的实际工作区是下面的 Git Worktree，不是会话 cwd（打开项目时的那份目录）。',
    `Worktree 路径：${selection.path}`,
    `分支：${branch}`,
    '会话 cwd 仍是打开项目时的目录，不会随 Shell 的 cd 改变。',
    '项目内 read、write、edit、glob、grep、read_image 以及 pwsh/bash 默认使用上述 Worktree 的绝对路径，或把 workdir 设为该路径。',
    '不要在会话 cwd 里改项目文件，除非用户明确要求就在cwd里改。项目外路径仍可用绝对路径读取。',
  ].join('\n')
}
