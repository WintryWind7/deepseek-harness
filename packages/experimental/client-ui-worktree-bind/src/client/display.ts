/**
 * Chip label and auto-worktree branch name.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-bind/display
 */

import type { WorktreeBindState } from '@deepseek-ai/dsh-experimental-worktree-bind/src/wire.ts'

/**
 * One-click worktree branch for this session (`agent/session-N`).
 * @param sessionId - live DSH session id.
 * @returns the branch name.
 */
export function autoBranchName(sessionId: string): string {
  return `agent/${sessionId}`
}

/**
 * Label when nothing is bound: `main`, else `master`, else `main`.
 * Does not imply a {{worktree}} binding.
 * @param state - last GET /state, or null before load.
 * @returns the chip label.
 */
export function unboundLabel(state: WorktreeBindState | null): string {
  const names = state?.branches.map(branch => branch.name) ?? []
  if (names.includes('main')) return 'main'
  if (names.includes('master')) return 'master'
  return 'main'
}
