/**
 * Git helpers for listing branches and creating linked worktrees under `.dsh/worktrees`.
 * @module @deepseek-ai/dsh-experimental-worktree-bind/git
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** Optional git runner for tests. */
export type GitRunner = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

/** Failure of one git invocation. */
export class GitError extends Error {
  /**
   * @param args - git argv after `git`.
   * @param stderr - captured stderr.
   */
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim()}`)
    this.name = 'GitError'
  }
}

const defaultRunner: GitRunner = async (cwd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    })
    return { stdout, stderr }
  } catch (error) {
    const captured = error instanceof Error && 'stderr' in error
      ? (error as { stderr?: unknown }).stderr
      : undefined
    const stderr = typeof captured === 'string' ? captured : ''
    throw new GitError(args, stderr || (error instanceof Error ? error.message : String(error)))
  }
}

async function git(cwd: string, args: readonly string[], run: GitRunner): Promise<string> {
  const { stdout } = await run(cwd, args)
  return stdout
}

/** One `git worktree list --porcelain` entry. */
export interface WorktreeEntry {
  /** Absolute worktree path. */
  readonly path: string
  /** Checked-out local branch, absent when detached. */
  readonly branch: string | undefined
  /** First porcelain entry is the main checkout. */
  readonly main: boolean
}

/**
 * Directory for a branch's plugin-managed worktree.
 * @param cwd - project root (main checkout).
 * @param branch - local branch name; `/` becomes `-` in the folder name.
 * @returns absolute slot directory.
 */
export function worktreeSlot(cwd: string, branch: string): string {
  return join(cwd, '.dsh', 'worktrees', branch.replaceAll('/', '-'))
}

/**
 * Reject names git would treat as flags or illegal refs.
 * @param name - user-typed branch name.
 * @returns trimmed name.
 */
export function sanitizeBranchName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('branch name must be non-empty')
  if (trimmed.startsWith('-')) throw new Error('branch name must not start with "-"')
  if (/[\s~^:?*\\[\]]/.test(trimmed)) throw new Error('branch name contains an illegal character')
  if (trimmed.includes('..') || trimmed.includes('@{') || trimmed.includes('//')) {
    throw new Error('branch name contains an illegal sequence')
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) throw new Error('branch name must not start or end with "/"')
  if (trimmed.endsWith('.') || trimmed.endsWith('.lock')) throw new Error('branch name has an illegal suffix')
  if (trimmed === '@') throw new Error('branch name must not be "@"')
  return trimmed
}

/**
 * Parse `git worktree list --porcelain`.
 * @param out - porcelain stdout.
 * @returns parsed entries; the main checkout comes first.
 */
export function parseWorktrees(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let path: string | undefined
  let branch: string | undefined
  let detached = false
  const flush = (): void => {
    if (path === undefined) return
    entries.push({
      path,
      branch: detached || branch === undefined ? undefined : branch.replace(/^refs\/heads\//, ''),
      main: entries.length === 0,
    })
    path = undefined
    branch = undefined
    detached = false
  }
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).trim()
    } else if (line === 'detached') {
      detached = true
    }
  }
  flush()
  return entries
}

/**
 * Linked worktrees plus the main checkout.
 * @param cwd - directory inside the repository.
 * @param run - git runner.
 * @returns parsed worktree entries.
 */
export async function listWorktrees(cwd: string, run: GitRunner = defaultRunner): Promise<WorktreeEntry[]> {
  return parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain'], run))
}

/**
 * Local branch short names.
 * @param cwd - directory inside the repository.
 * @param run - git runner.
 * @returns local branch names.
 */
export async function listLocalBranches(cwd: string, run: GitRunner = defaultRunner): Promise<string[]> {
  const out = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], run)
  return out.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
}

/**
 * Current branch of this checkout, or undefined when detached.
 * @param cwd - worktree path.
 * @param run - git runner.
 * @returns the checked-out branch name.
 */
export async function currentBranch(cwd: string, run: GitRunner = defaultRunner): Promise<string | undefined> {
  const name = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], run)).trim()
  return name === 'HEAD' || name.length === 0 ? undefined : name
}

/**
 * Create or reuse a worktree for an existing local branch without moving the main checkout.
 * When the branch is already checked out on main, returns the main path.
 * @param cwd - main checkout.
 * @param branch - existing local branch.
 * @param run - git runner.
 * @returns the existing or newly added worktree entry.
 */
export async function ensureWorktree(
  cwd: string,
  branch: string,
  run: GitRunner = defaultRunner,
): Promise<WorktreeEntry> {
  const trees = await listWorktrees(cwd, run)
  const existing = trees.find(tree => tree.branch === branch)
  if (existing !== undefined) return existing
  const slot = worktreeSlot(cwd, branch)
  await git(cwd, ['worktree', 'add', slot, branch], run)
  return { path: slot, branch, main: false }
}

/**
 * Cut a new branch from HEAD and check it out in `.dsh/worktrees/<name>`.
 * @param cwd - main checkout.
 * @param name - new branch name.
 * @param run - git runner.
 * @returns the new worktree entry.
 */
export async function createWorktree(
  cwd: string,
  name: string,
  run: GitRunner = defaultRunner,
): Promise<WorktreeEntry> {
  const branch = sanitizeBranchName(name)
  const slot = worktreeSlot(cwd, branch)
  await git(cwd, ['worktree', 'add', '-b', branch, slot], run)
  return { path: slot, branch, main: false }
}
