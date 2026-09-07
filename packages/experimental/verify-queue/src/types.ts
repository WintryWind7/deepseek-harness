/**
 * Shared verify-queue records stored under a project's `.dsh/verify-queue/`.
 * @module @deepseek-ai/dsh-experimental-verify-queue/types
 */

/** One worktree-dev recorded fix waiting to land on main and be checked on the running app. */
export interface VerifyQueueItem {
  /** Stable item id chosen at record time. */
  readonly id: string
  /** Short reminder of what to look at after the commits reach main. */
  readonly title: string
  /** Session that recorded the item. */
  readonly sessionId: string
  /** Full commit SHAs that must become ancestors of main. */
  readonly commits: readonly string[]
  /** Epoch milliseconds when the item was recorded. */
  readonly createdAt: number
  /** Epoch milliseconds when a human marked the item accepted, or null. */
  readonly verifiedAt: number | null
}

/** Derived merge-and-acceptance status for one item. */
export type VerifyQueueStatus = 'recorded' | 'on-main' | 'verified'

/** One item plus the git-derived merge status. */
export interface VerifyQueueRow {
  readonly item: VerifyQueueItem
  readonly status: VerifyQueueStatus
}

/** Drawer chrome persisted beside the items. */
export interface VerifyQueueUi {
  /** Whether the drawer body is expanded. */
  readonly open: boolean
  /** Whether expansion should survive reload. */
  readonly pinned: boolean
}

/** Complete queue view for one workspace path. */
export interface VerifyQueueView {
  readonly workspacePath: string
  readonly ui: VerifyQueueUi
  readonly rows: readonly VerifyQueueRow[]
}

/** Request to record or replace one queue item. */
export interface VerifyQueueRecordRequest {
  readonly title: string
  readonly sessionId: string
  readonly commits: readonly string[]
  readonly id?: string
}

/** Request to mark or clear human acceptance. */
export interface VerifyQueueVerifyRequest {
  readonly id: string
  readonly verified: boolean
}

/** Request to persist drawer chrome. */
export interface VerifyQueueUiRequest {
  readonly open: boolean
  readonly pinned: boolean
}
