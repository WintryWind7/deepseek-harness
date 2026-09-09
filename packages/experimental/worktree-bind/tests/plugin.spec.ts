import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { apply, name, ROUTE_CLEAR, ROUTE_CREATE, ROUTE_SELECT, ROUTE_STATE } from '../src/index.ts'
import { listWorktrees, worktreeSlot } from '../src/git.ts'
import { writeMarker } from '../src/markers.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

const exec = promisify(execFile)

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worktree-bind-plugin-'))
  await exec('git', ['init'], { cwd: root, windowsHide: true })
  await exec('git', ['config', 'user.email', 'bind@example.com'], { cwd: root, windowsHide: true })
  await exec('git', ['config', 'user.name', 'Worktree Bind'], { cwd: root, windowsHide: true })
  await writeFile(join(root, 'README.md'), 'one\n', 'utf8')
  await exec('git', ['add', 'README.md'], { cwd: root, windowsHide: true })
  await exec('git', ['commit', '-m', 'first'], { cwd: root, windowsHide: true })
  return root
}

class FakeWebServer {
  readonly routes: WebRoute[] = []
  register(route: WebRoute): () => void {
    this.routes.push(route)
    return () => {}
  }
}

function request(url: string, body?: string): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  return Object.assign(stream, { url }) as IncomingMessage
}

function response(): { res: ServerResponse; status: () => number; body: () => string } {
  let statusCode = 0
  let payload = ''
  const res = {
    set statusCode(value: number) { statusCode = value },
    get statusCode() { return statusCode },
    setHeader() {},
    end(chunk?: string) { payload = chunk ?? '' },
  }
  return {
    res: res as unknown as ServerResponse,
    status: () => statusCode,
    body: () => payload,
  }
}

function parseBody(body: string): { error?: string; cwd?: string } {
  return JSON.parse(body) as { error?: string; cwd?: string }
}

describe('worktree-bind plugin', () => {
  it('injects prompt text only while the session is bound and serves chip routes', async () => {
    const ctx = new Context()
    const web = new FakeWebServer()
    ctx.provide('webServer', web as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin({ name, inject: ['systemPrompt'], apply })
    ctx.systemPrompt.section({ name: 'probe', order: 0, text: 'X{{worktree}}Y' })
    expect(web.routes.map(route => route.path)).toEqual([
      ROUTE_STATE, ROUTE_SELECT, ROUTE_CREATE, ROUTE_CLEAR,
    ])

    const empty = await ctx.systemPrompt.assemble({ agent: { id: 's1' } })
    expect(renderPrompt(empty)).toContain('XY')
    expect(renderPrompt(empty)).not.toContain('Worktree')

    const root = await initRepo()
    ctx.provide('sessions', {
      get: (id: string) => {
        if (id === 's1') return { header: { cwd: root }, seq: 0, eventAt: () => undefined }
        if (id === 'started') {
          return {
            header: { cwd: root },
            seq: 1,
            eventAt: () => ({ type: 'turn/start' }),
          }
        }
        return { header: {} }
      },
    } as never)

    const state = web.routes.find(route => route.path === ROUTE_STATE)
    const before = response()
    await state?.handler(request(`${ROUTE_STATE}?sessionId=missing`), before.res)
    expect(parseBody(before.body()).error).toMatch(/cwd/)

    const listed = response()
    await state?.handler(request(`${ROUTE_STATE}?sessionId=s1`), listed.res)
    expect(listed.status()).toBe(200)
    expect(parseBody(listed.body()).cwd).toBe(root)

    const create = web.routes.find(route => route.path === ROUTE_CREATE)
    const bad = response()
    await create?.handler(request(ROUTE_CREATE, '{"sessionId":"s1","name":"-x"}'), bad.res)
    expect(bad.status()).toBe(400)

    const invalid = response()
    await create?.handler(request(ROUTE_CREATE, '[]'), invalid.res)
    expect(invalid.status()).toBe(400)

    const missingUrl = response()
    await state?.handler(request(undefined as unknown as string), missingUrl.res)
    expect(parseBody(missingUrl.body()).error).toMatch(/sessionId/)

    const huge = response()
    await create?.handler(request(ROUTE_CREATE, `"${'x'.repeat(70 * 1024)}"`), huge.res)
    expect(huge.status()).toBe(400)

    const created = response()
    await create?.handler(request(ROUTE_CREATE, JSON.stringify({ sessionId: 's1', name: 'feat/plugin' })), created.res)
    expect(created.status()).toBe(200)
    const bound = await ctx.systemPrompt.assemble({ agent: { id: 's1' } })
    expect(renderPrompt(bound)).toContain('feat/plugin')
    ctx.emit('session/event', { id: 's1', header: { cwd: root } } as never, { type: 'turn/end' } as never)
    ctx.emit('session/event', { id: 's1', header: { cwd: root } } as never, { type: 'turn/start' } as never)
    await expect.poll(async () => (await listWorktrees(root)).some(tree => tree.branch === 'feat/plugin')).toBe(true)

    const cleared = response()
    const clear = web.routes.find(route => route.path === ROUTE_CLEAR)
    await clear?.handler(request(ROUTE_CLEAR, JSON.stringify({ sessionId: 's1' })), cleared.res)
    expect(cleared.status()).toBe(200)
    const unbound = renderPrompt(await ctx.systemPrompt.assemble({ agent: { id: 's1' } }))
    expect(unbound).toContain('XY')
    expect(unbound).not.toContain('feat/plugin')

    const emptyBody = response()
    await create?.handler(request(ROUTE_CREATE), emptyBody.res)
    expect(emptyBody.status()).toBe(400)

    const select = web.routes.find(route => route.path === ROUTE_SELECT)
    const selected = response()
    await select?.handler(request(ROUTE_SELECT, JSON.stringify({ sessionId: 's1', branch: 'feat/plugin' })), selected.res)
    expect(selected.status()).toBe(200)

    const locked = response()
    await create?.handler(request(ROUTE_CREATE, JSON.stringify({ sessionId: 'started', name: 'late' })), locked.res)
    expect(locked.status()).toBe(400)
    expect(parseBody(locked.body()).error).toMatch(/already started/)
  })

  it('restores a persisted binding after a simulated Host restart and warns when it is lost', async () => {
    const root = await initRepo()
    const mount = async (): Promise<Context> => {
      const ctx = new Context()
      ctx.provide('webServer', new FakeWebServer() as never)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin({ name, inject: ['systemPrompt'], apply })
      ctx.systemPrompt.section({ name: 'probe', order: 0, text: 'X{{worktree}}Y' })
      ctx.provide('sessions', {
        get: (id: string) => id === 's1'
          ? { header: { cwd: root }, seq: 0, eventAt: () => undefined }
          : { header: {} },
      } as never)
      return ctx
    }

    const pending = await mount()
    await writeMarker(root, 's1', { path: worktreeSlot(root, 'feat/back'), branch: 'feat/back', pending: 'ensure' })
    const restored = renderPrompt(await pending.systemPrompt.assemble({ agent: { id: 's1' } }))
    expect(restored).toContain('feat/back')
    expect(restored).not.toContain('失效')

    const lost = await mount()
    await writeMarker(root, 's1', { path: worktreeSlot(root, 'feat/gone'), branch: 'feat/gone' })
    const warned = renderPrompt(await lost.systemPrompt.assemble({ agent: { id: 's1' } }))
    expect(warned).toContain('失效')
    expect(warned).toContain('feat/gone')
  })
})
