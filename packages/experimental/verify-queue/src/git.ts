/**
 * Git helpers for worktree HEAD and whether recorded commits are on main.
 * @module @deepseek-ai/dsh-experimental-verify-queue/git
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { access } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

/** Optional git runner for tests. */
export type GitRunner = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: GitRunner = async (cwd, args) => {
  const { stdout, stderr } = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { stdout, stderr }
}

/**
 * Resolve a ref to a full SHA inside a git directory.
 * @param repo - git working tree or worktree path.
 * @param rev - ref or abbreviated SHA.
 * @param run - git runner.
 * @returns 40-character SHA.
 */
export async function resolveCommit(repo: string, rev: string, run: GitRunner = defaultRunner): Promise<string> {
  const { stdout } = await run(repo, ['rev-parse', '--verify', `${rev}^{commit}`])
  const sha = stdout.trim()
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`git rev-parse did not return a SHA for ${JSON.stringify(rev)}`)
  }
  return sha.toLowerCase()
}

/**
 * HEAD of this session's worktree when it exists, otherwise HEAD of `cwd`.
 * @param cwd - project root (the session workspace).
 * @param sessionId - durable session id used as the worktree directory name.
 * @param run - git runner.
 * @returns full HEAD SHA.
 */
export async function resolveSessionHead(
  cwd: string,
  sessionId: string,
  run: GitRunner = defaultRunner,
): Promise<string> {
  const worktree = join(cwd, '.dsh', 'worktrees', sessionId)
  const repo = await isDirectory(worktree) ? worktree : cwd
  return await resolveCommit(repo, 'HEAD', run)
}

/**
 * Whether every commit is an ancestor of the project's main branch.
 * @param cwd - project root.
 * @param commits - full SHAs.
 * @param run - git runner.
 * @returns true only when every SHA is reachable from main.
 */
export async function commitsOnMain(
  cwd: string,
  commits: readonly string[],
  run: GitRunner = defaultRunner,
): Promise<boolean> {
  if (commits.length === 0) return false
  const main = await resolveMainRef(cwd, run)
  for (const sha of commits) {
    try {
      await run(cwd, ['merge-base', '--is-ancestor', sha, main])
    } catch {
      return false
    }
  }
  return true
}

async function resolveMainRef(cwd: string, run: GitRunner): Promise<string> {
  for (const ref of ['refs/heads/main', 'refs/heads/master'] as const) {
    try {
      await run(cwd, ['rev-parse', '--verify', ref])
      return ref
    } catch {
      continue
    }
  }
  throw new Error('verify-queue: neither refs/heads/main nor refs/heads/master exists')
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
