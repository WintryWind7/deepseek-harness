/**
 * JSON files under `{workspace}/.dsh/verify-queue/`.
 * @module @deepseek-ai/dsh-experimental-verify-queue/store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VerifyQueueItem, VerifyQueueUi } from './types.ts'

/** Directory name under the project `.dsh` folder. */
export const VERIFY_QUEUE_DIR = 'verify-queue'

const ITEMS_FILE = 'items.json'
const UI_FILE = 'ui.json'

const DEFAULT_UI: VerifyQueueUi = { open: false, pinned: false }

interface ItemsFile {
  readonly items: VerifyQueueItem[]
}

/**
 * Resolve the on-disk directory for one workspace.
 * @param workspacePath - canonical project root.
 * @returns `{workspace}/.dsh/verify-queue`.
 */
export function queueDir(workspacePath: string): string {
  return join(workspacePath, '.dsh', VERIFY_QUEUE_DIR)
}

/**
 * Read stored items, or an empty list when the file is missing.
 * @param workspacePath - canonical project root.
 * @returns detached items.
 */
export async function readItems(workspacePath: string): Promise<VerifyQueueItem[]> {
  const raw = await readOptionalJson(join(queueDir(workspacePath), ITEMS_FILE))
  if (raw === undefined) return []
  const file = raw as ItemsFile
  if (!Array.isArray(file.items)) return []
  return file.items.map(cloneItem)
}

/**
 * Replace the stored item list.
 * @param workspacePath - canonical project root.
 * @param items - complete list to persist.
 */
export async function writeItems(workspacePath: string, items: readonly VerifyQueueItem[]): Promise<void> {
  const dir = queueDir(workspacePath)
  await mkdir(dir, { recursive: true })
  const body: ItemsFile = { items: items.map(cloneItem) }
  await writeFile(join(dir, ITEMS_FILE), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

/**
 * Read drawer chrome, or the closed unpinned default.
 * @param workspacePath - canonical project root.
 * @returns detached UI state.
 */
export async function readUi(workspacePath: string): Promise<VerifyQueueUi> {
  const raw = await readOptionalJson(join(queueDir(workspacePath), UI_FILE))
  if (raw === undefined || typeof raw !== 'object' || raw === null) return { ...DEFAULT_UI }
  const open = (raw as { open?: unknown }).open === true
  const pinned = (raw as { pinned?: unknown }).pinned === true
  return { open: open || pinned, pinned }
}

/**
 * Persist drawer chrome.
 * @param workspacePath - canonical project root.
 * @param ui - open/pinned flags.
 */
export async function writeUi(workspacePath: string, ui: VerifyQueueUi): Promise<void> {
  const dir = queueDir(workspacePath)
  await mkdir(dir, { recursive: true })
  const body: VerifyQueueUi = { open: ui.pinned ? true : ui.open, pinned: ui.pinned }
  await writeFile(join(dir, UI_FILE), `${JSON.stringify(body, null, 2)}\n`, 'utf8')
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error: unknown) {
    if (isEnoent(error)) return undefined
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

function cloneItem(item: VerifyQueueItem): VerifyQueueItem {
  return {
    id: item.id,
    title: item.title,
    sessionId: item.sessionId,
    commits: [...item.commits],
    createdAt: item.createdAt,
    verifiedAt: item.verifiedAt,
  }
}
