/**
 * Workspace-scoped verify queue: worktree-dev records committed fixes; the
 * Web drawer checks whether those commits are on main.
 * @module @deepseek-ai/dsh-experimental-verify-queue
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { commitsOnMain, resolveCommit, resolveSessionHead } from './git.ts'
import { readItems, readUi, writeItems, writeUi } from './store.ts'
import type {
  VerifyQueueItem,
  VerifyQueueRecordRequest,
  VerifyQueueRow,
  VerifyQueueStatus,
  VerifyQueueUi,
  VerifyQueueUiRequest,
  VerifyQueueVerifyRequest,
  VerifyQueueView,
} from './types.ts'

export type * from './types.ts'
export { VERIFY_QUEUE_DIR, queueDir } from './store.ts'
export { commitsOnMain, resolveCommit, resolveSessionHead } from './git.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    verifyQueue: VerifyQueue
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested queue item is not in this workspace. */
    'verify-queue/not-found': { readonly id: string }
    /** The workspace path cannot back a verify queue. */
    'verify-queue/invalid-path': { readonly path: string }
  }
}

/**
 * Host verify-queue service. Records live in the project tree; merge status is
 * derived from git on each read.
 */
export default class VerifyQueue extends TypertRemoteService {
  /**
   * @param ctx - owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'verifyQueue')
  }

  /**
   * Record or replace one item after worktree-dev has committed the fix.
   * @param workspacePath - project root that owns `.dsh/verify-queue/`.
   * @param request - title, session, and commit SHAs or refs.
   * @returns the written item id and updated queue view.
   */
  async record(
    workspacePath: string,
    request: VerifyQueueRecordRequest,
  ): Promise<{ id: string; view: VerifyQueueView }> {
    const path = requirePath(workspacePath)
    const title = request.title.trim()
    if (title.length === 0) {
      throw new RemoteError('verify-queue/invalid-path', 'verify-queue title must be non-empty', { path })
    }
    const sessionId = request.sessionId.trim()
    if (sessionId.length === 0) {
      throw new RemoteError('verify-queue/invalid-path', 'verify-queue sessionId must be non-empty', { path })
    }
    const rawCommits = request.commits.length > 0
      ? request.commits
      : [await resolveSessionHead(path, sessionId)]
    const commits = await Promise.all(rawCommits.map(async rev => await resolveCommit(path, rev)))
    const items = await readItems(path)
    const id = request.id?.trim() || randomUUID()
    const previous = items.find(item => item.id === id)
    const next: VerifyQueueItem = {
      id,
      title,
      sessionId,
      commits,
      createdAt: previous?.createdAt ?? Date.now(),
      verifiedAt: previous?.verifiedAt ?? null,
    }
    const updated = previous === undefined
      ? [...items, next]
      : items.map(item => item.id === id ? next : item)
    await writeItems(path, updated)
    return { id, view: await this.view(path) }
  }

  /**
   * Remove one item.
   * @param workspacePath - project root.
   * @param id - item id.
   * @returns the updated queue view.
   */
  async remove(workspacePath: string, id: string): Promise<VerifyQueueView> {
    const path = requirePath(workspacePath)
    const items = await readItems(path)
    const next = items.filter(item => item.id !== id)
    if (next.length === items.length) {
      throw new RemoteError('verify-queue/not-found', `no verify-queue item "${id}"`, { id })
    }
    await writeItems(path, next)
    return await this.view(path)
  }

  /**
   * Mark or clear human acceptance. The item must already be on main.
   * @param workspacePath - project root.
   * @param request - item id and verified flag.
   * @returns the updated queue view.
   */
  async setVerified(workspacePath: string, request: VerifyQueueVerifyRequest): Promise<VerifyQueueView> {
    const path = requirePath(workspacePath)
    const items = await readItems(path)
    const index = items.findIndex(item => item.id === request.id)
    const current = index < 0 ? undefined : items[index]
    if (current === undefined) {
      throw new RemoteError('verify-queue/not-found', `no verify-queue item "${request.id}"`, { id: request.id })
    }
    const onMain = await commitsOnMain(path, current.commits)
    if (request.verified && !onMain) {
      throw new RemoteError(
        'verify-queue/invalid-path',
        'cannot mark verified until every recorded commit is on main',
        { path },
      )
    }
    const next: VerifyQueueItem = {
      ...current,
      verifiedAt: request.verified ? Date.now() : null,
    }
    await writeItems(path, items.map((item, i) => i === index ? next : item))
    return await this.view(path)
  }

  /**
   * Persist drawer chrome.
   * @param workspacePath - project root.
   * @param request - open/pinned flags.
   * @returns the updated queue view.
   */
  async setUi(workspacePath: string, request: VerifyQueueUiRequest): Promise<VerifyQueueView> {
    const path = requirePath(workspacePath)
    const ui: VerifyQueueUi = {
      pinned: request.pinned,
      open: request.pinned ? true : request.open,
    }
    await writeUi(path, ui)
    return await this.view(path)
  }

  /**
   * Read items and derive merge status from git.
   * @param workspacePath - project root.
   * @returns detached view.
   */
  async view(workspacePath: string): Promise<VerifyQueueView> {
    const path = requirePath(workspacePath)
    const [items, ui] = await Promise.all([readItems(path), readUi(path)])
    const rows: VerifyQueueRow[] = []
    for (const item of items) {
      rows.push({ item, status: await statusOf(path, item) })
    }
    return { workspacePath: path, ui, rows }
  }

  /**
   * @param workspacePath - project root.
   * @returns queue view for the Web drawer.
   */
  @Remote('view')
  async remoteView(workspacePath: string): Promise<VerifyQueueView> {
    return await this.view(workspacePath)
  }

  /**
   * @param workspacePath - project root.
   * @param request - verified flag.
   * @returns updated view.
   */
  @Remote('setVerified')
  async remoteSetVerified(workspacePath: string, request: VerifyQueueVerifyRequest): Promise<VerifyQueueView> {
    return await this.setVerified(workspacePath, request)
  }

  /**
   * Drop one item. Wired as `removeItem` because `remove` is on the Cordis Service prototype.
   * @param workspacePath - project root.
   * @param id - item id.
   * @returns updated view.
   */
  @Remote('removeItem')
  async remoteRemove(workspacePath: string, id: string): Promise<VerifyQueueView> {
    return await this.remove(workspacePath, id)
  }

  /**
   * @param workspacePath - project root.
   * @param request - drawer chrome.
   * @returns updated view.
   */
  @Remote('setUi')
  async remoteSetUi(workspacePath: string, request: VerifyQueueUiRequest): Promise<VerifyQueueView> {
    return await this.setUi(workspacePath, request)
  }
}

async function statusOf(workspacePath: string, item: VerifyQueueItem): Promise<VerifyQueueStatus> {
  if (item.verifiedAt !== null) return 'verified'
  return await commitsOnMain(workspacePath, item.commits) ? 'on-main' : 'recorded'
}

function requirePath(workspacePath: string): string {
  const path = workspacePath.trim()
  if (path.length === 0) {
    throw new RemoteError('verify-queue/invalid-path', 'workspace path must be non-empty', { path })
  }
  return path
}
