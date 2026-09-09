/**
 * HTTP paths and JSON bodies shared by the Host routes and the Web chip.
 * @module @deepseek-ai/dsh-experimental-worktree-bind/wire
 */

/** Absolute pathname prefix for every route. */
export const ROUTE_PREFIX = '/plugin/worktree-bind'

/** GET `?sessionId=` — current binding, local branches, and worktree slots. */
export const ROUTE_STATE = `${ROUTE_PREFIX}/state`

/** POST — bind this session to a branch; `git worktree add` waits until the first turn. */
export const ROUTE_SELECT = `${ROUTE_PREFIX}/select`

/** POST — name a new branch; `git worktree add -b` waits until the first turn. */
export const ROUTE_CREATE = `${ROUTE_PREFIX}/create`

/** POST — drop this session's binding; the worktree stays on disk. */
export const ROUTE_CLEAR = `${ROUTE_PREFIX}/clear`

/** One local branch as the chip lists it. */
export interface WorktreeBindBranch {
  /** `refs/heads` short name. */
  readonly name: string
  /** Linked worktree path when this branch is already checked out somewhere. */
  readonly worktreePath: string | null
  /** True when the main checkout currently has this branch. */
  readonly current: boolean
}

/** Git work still owed when the first turn starts. */
export type WorktreeBindPending = 'create' | 'ensure'

/** Session binding the prompt interpolates. */
export interface WorktreeBindSelection {
  /** Absolute checkout the model should use (predicted before git runs). */
  readonly path: string
  /** Branch name, or null when detached. */
  readonly branch: string | null
  /** When set, the first `turn/start` runs git in parallel with the prompt. */
  readonly pending?: WorktreeBindPending
}

/** GET /state payload. */
export interface WorktreeBindState {
  /** Session header cwd (the main project checkout). */
  readonly cwd: string | null
  /** Bound checkout, or null when unbound. */
  readonly selected: WorktreeBindSelection | null
  /** Local branches. */
  readonly branches: readonly WorktreeBindBranch[]
  /** Git or cwd failure, or null. */
  readonly error: string | null
}

/** Mutation result. */
export interface WorktreeBindResult {
  readonly ok: boolean
  readonly error?: string
  readonly selected?: WorktreeBindSelection | null
}
