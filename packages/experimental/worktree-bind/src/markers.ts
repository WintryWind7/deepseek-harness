/**
 * Per-project marker files that let a session binding survive a Host restart.
 * @module @deepseek-ai/dsh-experimental-worktree-bind/markers
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorktreeBindSelection } from './wire.ts'

/**
 * Directory holding one marker per session id, inside the project's `.dsh`.
 * @param cwd - project root (main checkout).
 * @returns absolute marker directory.
 */
export function markerDir(cwd: string): string {
  return join(cwd, '.dsh', 'worktree-bind')
}

function fileSafe(sessionId: string): string {
  return sessionId.replaceAll(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * Marker file for one session.
 * @param cwd - project root (main checkout).
 * @param sessionId - live DSH session id.
 * @returns absolute marker file path.
 */
export function markerPath(cwd: string, sessionId: string): string {
  return join(markerDir(cwd), `${fileSafe(sessionId)}.json`)
}

/** Outcome of reading one marker from disk. */
export type MarkerRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'selection'; readonly selection: WorktreeBindSelection }

function isSelection(value: unknown): value is WorktreeBindSelection {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.path !== 'string' || record.path.length === 0) return false
  if (record.branch !== null && typeof record.branch !== 'string') return false
  return record.pending === undefined || record.pending === 'create' || record.pending === 'ensure'
}

/**
 * Synchronously read one session's marker; the prompt variable provider cannot
 * await, so restore paths use this and cache the outcome.
 * @param cwd - project root (main checkout).
 * @param sessionId - session whose binding may have been persisted.
 * @returns the parsed marker, or why none is usable.
 */
export function readMarker(cwd: string, sessionId: string): MarkerRead {
  const path = markerPath(cwd, sessionId)
  if (!existsSync(path)) return { kind: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Unreadable or non-JSON marker: the session was bound once, but the record is unusable.
    return { kind: 'corrupt' }
  }
  return isSelection(parsed) ? { kind: 'selection', selection: parsed } : { kind: 'corrupt' }
}

/**
 * Persist one binding, replacing any previous marker.
 * @param cwd - project root (main checkout).
 * @param sessionId - bound session.
 * @param selection - binding to persist, including an unfulfilled `pending`.
 */
export async function writeMarker(cwd: string, sessionId: string, selection: WorktreeBindSelection): Promise<void> {
  await mkdir(markerDir(cwd), { recursive: true })
  await writeFile(markerPath(cwd, sessionId), JSON.stringify(selection), 'utf8')
}

/**
 * Drop one session's marker; a missing file is not an error.
 * @param cwd - project root (main checkout).
 * @param sessionId - session to unbind.
 */
export async function clearMarker(cwd: string, sessionId: string): Promise<void> {
  await rm(markerPath(cwd, sessionId), { force: true })
}
