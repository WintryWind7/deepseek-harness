/**
 * HTTP handlers: session id in, git + binding out.
 * @module @deepseek-ai/dsh-experimental-worktree-bind/routes
 */

import { existsSync } from 'node:fs'
import {
  createWorktree, currentBranch, ensureWorktree, GitError, listLocalBranches, listWorktrees,
  sanitizeBranchName, worktreeSlot,
} from './git.ts'
import type { GitRunner } from './git.ts'
import { clearMarker, readMarker, writeMarker } from './markers.ts'
import { promptText } from './prompt.ts'
import type {
  WorktreeBindBranch, WorktreeBindResult, WorktreeBindSelection, WorktreeBindState,
} from './wire.ts'

/** Per-session checkout the prompt injects. */
export type BindingStore = Map<string, WorktreeBindSelection>

/** Look up a live session's header cwd. */
export type SessionCwd = (sessionId: string) => string | undefined

/** True after the first `turn/start` (conversation no longer blank). */
export type SessionStarted = (sessionId: string) => boolean

/**
 * Per-session restore cache: absent = never attempted, null = no marker on
 * disk, string = persisted binding was rejected with this reason ("lost").
 * Valid restorations live in the store instead.
 */
export type RestoreCache = Map<string, string | null>

/** Host dependencies for one request. */
export interface RouteDeps {
  cwdOf: SessionCwd
  started?: SessionStarted
  store: BindingStore
  restored?: RestoreCache
  run?: GitRunner
}

function fail(error: string): WorktreeBindResult {
  return { ok: false, error }
}

function gitMessage(error: unknown): string {
  if (error instanceof GitError) return error.stderr.trim() || error.message
  return error instanceof Error ? error.message : String(error)
}

function requireSession(deps: RouteDeps, sessionId: string | undefined): { sessionId: string; cwd: string } | WorktreeBindResult {
  const id = sessionId?.trim() ?? ''
  if (id.length === 0) return fail('sessionId must be non-empty')
  const cwd = deps.cwdOf(id)
  if (cwd === undefined || cwd.length === 0) return fail('session has no cwd')
  return { sessionId: id, cwd }
}

function requireWritable(deps: RouteDeps, sessionId: string | undefined): { sessionId: string; cwd: string } | WorktreeBindResult {
  const required = requireSession(deps, sessionId)
  if ('ok' in required) return required
  if (deps.started?.(required.sessionId) === true) return fail('session already started')
  return required
}

async function snapshot(deps: RouteDeps, sessionId: string, cwd: string): Promise<WorktreeBindState> {
  try {
    const [branches, trees, current] = await Promise.all([
      listLocalBranches(cwd, deps.run),
      listWorktrees(cwd, deps.run),
      currentBranch(cwd, deps.run),
    ])
    const listed: WorktreeBindBranch[] = branches.map((name) => {
      const tree = trees.find(entry => entry.branch === name)
      return {
        name,
        worktreePath: tree === undefined ? null : tree.path,
        current: current === name,
      }
    })
    return {
      cwd,
      selected: deps.store.get(sessionId) ?? null,
      branches: listed,
      error: null,
    }
  } catch (error) {
    return {
      cwd,
      selected: deps.store.get(sessionId) ?? null,
      branches: [],
      error: gitMessage(error),
    }
  }
}

/** Result of one restore attempt. */
export type RestoreOutcome = 'restored' | 'unbound' | 'lost'

/**
 * Recheck a restored binding against git; downgrade the store entry to "lost"
 * only on a definitive branch mismatch, never on an unreadable worktree (the
 * sync existence check already covers deletion).
 */
async function revalidate(deps: RouteDeps, sessionId: string, selection: WorktreeBindSelection): Promise<void> {
  if (selection.branch === null || selection.pending !== undefined) return
  let actual: string | undefined
  try {
    actual = await currentBranch(selection.path, deps.run)
  } catch {
    // Unreadable worktree: keep the restored binding; the next turn's materialize retry owns recovery.
    return
  }
  if (actual === selection.branch) return
  deps.store.delete(sessionId)
  deps.restored?.set(sessionId, `worktree ${selection.path} 当前检出的分支是 ${actual ?? '(detached HEAD)'}，与记录的分支 ${selection.branch} 不一致`)
}

/**
 * Restore a persisted binding into the store on first use after a Host
 * restart. Synchronous and idempotent; valid restorations kick an async git
 * recheck that can still downgrade the entry to "lost".
 * @param deps - host dependencies.
 * @param sessionId - calling session.
 * @param cwd - session header cwd (main checkout).
 * @returns whether the binding was restored, absent, or rejected.
 */
export function restoreBinding(deps: RouteDeps, sessionId: string, cwd: string): RestoreOutcome {
  if (deps.store.has(sessionId)) return 'restored'
  const cached = deps.restored?.get(sessionId)
  if (cached !== undefined) return cached === null ? 'unbound' : 'lost'
  const marker = readMarker(cwd, sessionId)
  if (marker.kind === 'none') {
    deps.restored?.set(sessionId, null)
    return 'unbound'
  }
  if (marker.kind === 'corrupt') {
    deps.restored?.set(sessionId, '绑定记录文件损坏，无法解析')
    return 'lost'
  }
  const selection = marker.selection
  if (selection.pending === undefined && selection.path !== cwd && !existsSync(selection.path)) {
    deps.restored?.set(
      sessionId,
      `分支 ${selection.branch ?? '(detached HEAD)'} 的 worktree 路径 ${selection.path} 已不存在`,
    )
    return 'lost'
  }
  deps.store.set(sessionId, selection)
  void revalidate(deps, sessionId, selection)
  return 'restored'
}

/**
 * Reason a restored binding was rejected, for prompt and chip surfacing.
 * @param deps - host dependencies.
 * @param sessionId - calling session.
 * @returns the rejection reason, or undefined when the session is not lost.
 */
export function lostReason(deps: RouteDeps, sessionId: string): string | undefined {
  const cached = deps.restored?.get(sessionId)
  return typeof cached === 'string' ? cached : undefined
}

/**
 * Persist a binding after the mutation commits; failure fails the mutation so
 * a Host restart never silently drops a binding the chip reported as set.
 */
async function persist(
  deps: RouteDeps,
  sessionId: string,
  cwd: string,
  selected: WorktreeBindSelection,
): Promise<WorktreeBindResult> {
  try {
    await writeMarker(cwd, sessionId, selected)
  } catch (error) {
    return fail(`无法写入绑定记录：${error instanceof Error ? error.message : String(error)}`)
  }
  deps.store.set(sessionId, selected)
  deps.restored?.delete(sessionId)
  return { ok: true, selected }
}

/**
 * GET /state
 * @param deps - host dependencies.
 * @param sessionId - calling session.
 * @returns the chip-facing state; `error` carries the lost-binding reason.
 */
export async function handleState(deps: RouteDeps, sessionId: string | undefined): Promise<WorktreeBindState> {
  const required = requireSession(deps, sessionId)
  if ('ok' in required) {
    return { cwd: null, selected: null, branches: [], error: required.error ?? 'request failed' }
  }
  const outcome = restoreBinding(deps, required.sessionId, required.cwd)
  const state = await snapshot(deps, required.sessionId, required.cwd)
  if (outcome !== 'lost') return state
  return { ...state, error: lostReason(deps, required.sessionId) ?? state.error }
}

/** Optional facts from the already-fetched branch list (so select stays git-free). */
export interface SelectHints {
  readonly current?: boolean
  readonly worktreePath?: string | null
}

/**
 * POST /select — record a binding without running git.
 * @param deps - host dependencies.
 * @param sessionId - calling session.
 * @param branch - local branch name.
 * @param hints - `current` / existing worktree path from GET /state.
 * @returns the mutation outcome.
 */
export async function handleSelect(
  deps: RouteDeps,
  sessionId: string | undefined,
  branch: string | undefined,
  hints: SelectHints = {},
): Promise<WorktreeBindResult> {
  const required = requireWritable(deps, sessionId)
  if ('ok' in required) return required
  let name: string
  try {
    name = sanitizeBranchName(branch ?? '')
  } catch (error) {
    return fail(gitMessage(error))
  }
  const selected: WorktreeBindSelection = hints.current === true
    ? { path: required.cwd, branch: name }
    : typeof hints.worktreePath === 'string' && hints.worktreePath.length > 0
      ? { path: hints.worktreePath, branch: name }
      : { path: worktreeSlot(required.cwd, name), branch: name, pending: 'ensure' }
  return await persist(deps, required.sessionId, required.cwd, selected)
}

/**
 * POST /create — record a new-branch binding; git waits for the first turn.
 * @param deps - host dependencies.
 * @param sessionId - calling session.
 * @param name - new branch name.
 * @returns the mutation outcome.
 */
export async function handleCreate(
  deps: RouteDeps,
  sessionId: string | undefined,
  name: string | undefined,
): Promise<WorktreeBindResult> {
  const required = requireWritable(deps, sessionId)
  if ('ok' in required) return required
  try {
    const branch = sanitizeBranchName(name ?? '')
    const selected: WorktreeBindSelection = {
      path: worktreeSlot(required.cwd, branch),
      branch,
      pending: 'create',
    }
    return await persist(deps, required.sessionId, required.cwd, selected)
  } catch (error) {
    return fail(gitMessage(error))
  }
}

/**
 * Run the deferred `git worktree add` for a pending binding.
 * @param cwd - main checkout.
 * @param selected - recorded binding.
 * @param run - git runner.
 * @returns the materialized binding without `pending`.
 */
export async function materializeBinding(
  cwd: string,
  selected: WorktreeBindSelection,
  run?: GitRunner,
): Promise<WorktreeBindSelection> {
  if (selected.pending === undefined) return selected
  const name = selected.branch
  if (name === null || name.length === 0) return { path: selected.path, branch: selected.branch }
  try {
    const tree = selected.pending === 'create'
      ? await createWorktree(cwd, name, run)
      : await ensureWorktree(cwd, name, run)
    return { path: tree.path, branch: tree.branch ?? name }
  } catch (error) {
    if (selected.pending === 'create') {
      const tree = await ensureWorktree(cwd, name, run)
      return { path: tree.path, branch: tree.branch ?? name }
    }
    throw error
  }
}

/**
 * POST /clear — unbind; leave the worktree on disk.
 * @param deps - host dependencies.
 * @param sessionId - calling session.
 * @returns the mutation outcome.
 */
export async function handleClear(deps: RouteDeps, sessionId: string | undefined): Promise<WorktreeBindResult> {
  const required = requireWritable(deps, sessionId)
  if ('ok' in required) return required
  try {
    await clearMarker(required.cwd, required.sessionId)
  } catch (error) {
    return fail(`无法删除绑定记录：${error instanceof Error ? error.message : String(error)}`)
  }
  deps.store.delete(required.sessionId)
  deps.restored?.set(required.sessionId, null)
  return { ok: true, selected: null }
}

export { promptText }
