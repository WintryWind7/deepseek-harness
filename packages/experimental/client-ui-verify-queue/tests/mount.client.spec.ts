import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { VerifyQueueDrawer, type VerifyQueueDrawerInjected } from '../src/client/Drawer.tsx'
import { apply as clientApply } from '../src/client/index.ts'
import { inject, mountVerifyQueueUi } from '../src/client/mount.ts'
import { apply as nodeApply } from '../src/index.ts'

const REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-verify-queue',
  descriptors: [],
}

const emptyView = {
  workspacePath: 'D:/p',
  ui: { open: false, pinned: false },
  rows: [],
}

async function bench(options: { registrationFailure?: boolean; failRemote?: boolean } = {}) {
  const ctx = new Context()
  const disposeMount = vi.fn(async () => {})
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $mount = vi.fn(async () => disposeMount)
  }
  const remote = new RemoteService(ctx)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  const failure = { ok: false as const, error: new RemoteError('gateway/internal', 'x', {}) }
  const success = { ok: true as const, value: emptyView }
  ctx.provide('remote.verifyQueue', {
    view: vi.fn(async () => options.failRemote === true ? failure : success),
    setUi: vi.fn(async () => options.failRemote === true ? failure : success),
    setVerified: vi.fn(async () => options.failRemote === true ? failure : success),
    removeItem: vi.fn(async () => options.failRemote === true ? failure : success),
  })
  if (options.registrationFailure === true) {
    vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => {
      throw new Error('slot registration failed')
    })
  }
  const activation = mountVerifyQueueUi(ctx, REMOTE)
  return { ctx, remote, disposeMount, activation }
}

describe('verify-queue browser plugin', () => {
  it('exports inject and a no-op host apply', () => {
    expect(inject).toEqual(['remote', 'slots', 'locale'])
    expect(nodeApply()).toBeUndefined()
  })

  it('mounts the remote contribution and overlay slot', async () => {
    const b = await bench()
    await b.activation
    expect(b.remote.$mount).toHaveBeenCalledWith(REMOTE)
    const entry = b.ctx.slots.entries('shell.overlay')
      .find(candidate => candidate.component === VerifyQueueDrawer)
    expect(entry).toMatchObject({ options: { id: 'verify-queue', order: 80 } })
    const actions = (entry!.inject as unknown as () => VerifyQueueDrawerInjected)()
    expect(await actions.load('D:/p')).toEqual(emptyView)
    expect(await actions.setUi('D:/p', true, false)).toEqual(emptyView)
    expect(await actions.setVerified('D:/p', 'id', true)).toEqual(emptyView)
    expect(await actions.remove('D:/p', 'id')).toEqual(emptyView)
    const failing = await bench({ failRemote: true })
    await failing.activation
    const failEntry = failing.ctx.slots.entries('shell.overlay')
      .find(candidate => candidate.component === VerifyQueueDrawer)
    const failActions = (failEntry!.inject as unknown as () => VerifyQueueDrawerInjected)()
    await expect(failActions.load('D:/p')).rejects.toBeTruthy()
    await expect(failActions.setUi('D:/p', true, false)).rejects.toBeTruthy()
    await expect(failActions.setVerified('D:/p', 'id', true)).rejects.toBeTruthy()
    await expect(failActions.remove('D:/p', 'id')).rejects.toBeTruthy()
    const dispose = await b.activation
    await dispose()
    expect(b.disposeMount).toHaveBeenCalled()
  })

  it('client apply mounts the generated contribution', async () => {
    const ctx = new Context()
    class RemoteService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }

      $mount = vi.fn(async () => async () => {})
    }
    new RemoteService(ctx)
    ctx.provide('locale', new LocaleRuntime(ctx))
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    ctx.provide('remote.verifyQueue', {
      view: vi.fn(),
      setUi: vi.fn(),
      setVerified: vi.fn(),
      removeItem: vi.fn(),
    })
    const dispose = await clientApply(ctx)
    expect(ctx.slots.entries('shell.overlay').some(entry => entry.component === VerifyQueueDrawer)).toBe(true)
    await dispose()
  })

  it('disposes the remote mount when UI inject fails', async () => {
    const b = await bench({ registrationFailure: true })
    await expect(b.activation).rejects.toThrow('slot registration failed')
    expect(b.disposeMount).toHaveBeenCalled()
  })
})
