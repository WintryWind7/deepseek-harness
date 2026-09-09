/**
 * Bind a Web session to a Git worktree under `.dsh/worktrees` and expose the
 * path as `{{worktree}}`. The session cwd stays the main checkout.
 * @module @deepseek-ai/dsh-experimental-worktree-bind
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SessionSeq, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import { lostWarningText, worktreeVariable } from './prompt.ts'
import { writeMarker } from './markers.ts'
import {
  handleClear, handleCreate, handleSelect, handleState, lostReason, materializeBinding,
  restoreBinding,
  type BindingStore, type RestoreCache, type RouteDeps,
} from './routes.ts'
import {
  ROUTE_CLEAR, ROUTE_CREATE, ROUTE_SELECT, ROUTE_STATE, type WorktreeBindResult,
} from './wire.ts'

export const name = 'worktree-bind'
export const inject = ['systemPrompt']

/** Persona/section interpolation name. Empty when the session is unbound. */
export const WORKTREE_VARIABLE = 'worktree'

export { promptText, worktreeVariable, lostWarningText } from './prompt.ts'
export {
  createWorktree, ensureWorktree, listLocalBranches, listWorktrees, parseWorktrees,
  sanitizeBranchName, worktreeSlot,
} from './git.ts'
export { markerDir, markerPath, readMarker, writeMarker, clearMarker } from './markers.ts'
export {
  handleClear, handleCreate, handleSelect, handleState, lostReason, materializeBinding, restoreBinding,
} from './routes.ts'
export {
  ROUTE_CLEAR, ROUTE_CREATE, ROUTE_PREFIX, ROUTE_SELECT, ROUTE_STATE,
} from './wire.ts'
export type {
  WorktreeBindBranch, WorktreeBindPending, WorktreeBindResult, WorktreeBindSelection, WorktreeBindState,
} from './wire.ts'

const BODY_LIMIT = 64 * 1024

function sessionCwd(session: Session | undefined): string | undefined {
  const cwd = session?.header.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(json)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const data = chunk as Buffer | string
    const buf: Buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    size += buf.length
    if (size > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value : undefined
}

function conversationStarted(session: Session | undefined): boolean {
  if (session === undefined) return false
  for (let i = 0; i < session.seq; i++) {
    if (session.eventAt(SessionSeq(i))?.type === 'turn/start') return true
  }
  return false
}

function depsOf(ctx: Context, store: BindingStore, restored: RestoreCache): RouteDeps {
  return {
    store,
    restored,
    cwdOf(sessionId) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) return undefined
      return sessionCwd(sessions.get(sessionId as SessionId))
    },
    started(sessionId) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) return false
      return conversationStarted(sessions.get(sessionId as SessionId))
    },
  }
}

/**
 * Register prompt context and, when a web server is present, the chip's HTTP routes.
 * @param ctx - host Cordis context.
 */
export function apply(ctx: Context): void {
  const store: BindingStore = new Map()
  const restored: RestoreCache = new Map()

  ctx.systemPrompt.variable(WORKTREE_VARIABLE, (context) => {
    const id = context.agent?.id
    if (id === undefined) return ''
    const deps = depsOf(ctx, store, restored)
    const cwd = deps.cwdOf(id)
    if (cwd !== undefined && restoreBinding(deps, id, cwd) === 'lost') {
      return lostWarningText(lostReason(deps, id) ?? 'unknown')
    }
    return worktreeVariable(store.get(id))
  })

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/start') return
    const cwd = sessionCwd(session)
    if (cwd === undefined) return
    restoreBinding(depsOf(ctx, store, restored), session.id, cwd)
    const selected = store.get(session.id)
    if (selected?.pending === undefined) return
    void materializeBinding(cwd, selected).then((next) => {
      store.set(session.id, next)
      void writeMarker(cwd, session.id, next).catch(() => {
        // Marker update failed: the stale pending marker retriggers materialize next run, which is idempotent.
      })
    }).catch(() => {
      // Keep the predicted path in {{worktree}}; a later turn can retry.
    })
  })

  ctx.inject(['webServer'], (webCtx) => {
    const deps = (): RouteDeps => depsOf(ctx, store, restored)

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: ROUTE_STATE,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x')
        send(res, 200, await handleState(deps(), url.searchParams.get('sessionId') ?? undefined))
      },
    }), 'worktree-bind: state')

    const post = (
      path: string,
      label: string,
      handle: (d: RouteDeps, body: Record<string, unknown>) => WorktreeBindResult | Promise<WorktreeBindResult>,
    ): void => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            const body = await readJson(req)
            const result = await handle(deps(), body)
            send(res, result.ok ? 200 : 400, result)
          } catch (error) {
            send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }), `worktree-bind: ${label}`)
    }

    post(ROUTE_SELECT, 'select', (d, body) => {
      const hints: { current: boolean; worktreePath?: string | null } = { current: body.current === true }
      if (typeof body.worktreePath === 'string') hints.worktreePath = body.worktreePath
      else if (body.worktreePath === null) hints.worktreePath = null
      return handleSelect(d, stringField(body, 'sessionId'), stringField(body, 'branch'), hints)
    })
    post(ROUTE_CREATE, 'create', (d, body) => handleCreate(d, stringField(body, 'sessionId'), stringField(body, 'name')))
    post(ROUTE_CLEAR, 'clear', (d, body) => handleClear(d, stringField(body, 'sessionId')))
  })
}
