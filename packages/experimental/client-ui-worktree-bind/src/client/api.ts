/**
 * Same-origin HTTP helpers for the worktree-bind Host routes.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-bind/api
 */

import type { WorktreeBindResult, WorktreeBindState } from '@deepseek-ai/dsh-experimental-worktree-bind/src/wire.ts'

const ROUTE_STATE = '/plugin/worktree-bind/state'
const ROUTE_SELECT = '/plugin/worktree-bind/select'
const ROUTE_CREATE = '/plugin/worktree-bind/create'
const ROUTE_CLEAR = '/plugin/worktree-bind/clear'

async function readJson(response: Response): Promise<unknown> {
  return await response.json() as unknown
}

function asResult(payload: unknown, ok: boolean, fallback: string): WorktreeBindResult {
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.ok === 'boolean') return payload as WorktreeBindResult
    if (typeof record.error === 'string') return { ok, error: record.error }
  }
  return ok ? { ok: true } : { ok: false, error: fallback }
}

/**
 * Load binding and branch list for one session.
 * @param sessionId - live session id.
 * @returns the current state, with `error` set on transport failure.
 */
export async function loadState(sessionId: string): Promise<WorktreeBindState> {
  const response = await fetch(`${ROUTE_STATE}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
  const payload = await readJson(response)
  if (payload !== null && typeof payload === 'object') return payload as WorktreeBindState
  return { cwd: null, selected: null, branches: [], error: `HTTP ${String(response.status)}` }
}

/**
 * Bind an existing branch.
 * @param sessionId - live session id.
 * @param branch - local branch name.
 * @param hints - `current` / existing worktree path from the last GET /state.
 * @returns the mutation outcome.
 */
export async function selectBranch(
  sessionId: string,
  branch: string,
  hints: { current?: boolean; worktreePath?: string | null } = {},
): Promise<WorktreeBindResult> {
  try {
    const response = await fetch(ROUTE_SELECT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, branch, ...hints }),
    })
    return asResult(await readJson(response), response.ok, `HTTP ${String(response.status)}`)
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Create a new branch worktree and bind it.
 * @param sessionId - live session id.
 * @param name - new branch name.
 * @returns the mutation outcome.
 */
export async function createBranch(sessionId: string, name: string): Promise<WorktreeBindResult> {
  try {
    const response = await fetch(ROUTE_CREATE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, name }),
    })
    return asResult(await readJson(response), response.ok, `HTTP ${String(response.status)}`)
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * Drop the session binding.
 * @param sessionId - live session id.
 * @returns the mutation outcome.
 */
export async function clearBinding(sessionId: string): Promise<WorktreeBindResult> {
  try {
    const response = await fetch(ROUTE_CLEAR, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    return asResult(await readJson(response), response.ok, `HTTP ${String(response.status)}`)
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
