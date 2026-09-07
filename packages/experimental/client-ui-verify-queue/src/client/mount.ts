/** Register locale, Remote namespace, and the overlay drawer. */

import type { VerifyQueueView } from '@deepseek-ai/dsh-experimental-verify-queue/client'
import type {} from '@deepseek-ai/dsh-experimental-verify-queue/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { VerifyQueueDrawer, type VerifyQueueDrawerInjected } from './Drawer.tsx'
import { en, NS, zh, type VerifyQueueKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Verify-queue drawer copy. */
    'verify-queue': VerifyQueueKey
  }
}

/** Browser services needed after the Remote namespace is mounted. */
export const inject = ['remote', 'slots', 'locale']

function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-verify-queue: dictionaries')
  const actions: VerifyQueueDrawerInjected = {
    async load(workspacePath): Promise<VerifyQueueView> {
      const result = await ctx.remote.verifyQueue.view(workspacePath)
      if (!result.ok) throw result.error
      return result.value
    },
    async setUi(workspacePath, open, pinned): Promise<VerifyQueueView> {
      const result = await ctx.remote.verifyQueue.setUi(workspacePath, { open, pinned })
      if (!result.ok) throw result.error
      return result.value
    },
    async setVerified(workspacePath, id, verified): Promise<VerifyQueueView> {
      const result = await ctx.remote.verifyQueue.setVerified(workspacePath, { id, verified })
      if (!result.ok) throw result.error
      return result.value
    },
    async remove(workspacePath, id): Promise<VerifyQueueView> {
      const result = await ctx.remote.verifyQueue.removeItem(workspacePath, id)
      if (!result.ok) throw result.error
      return result.value
    },
  }

  ctx.slots.inject(
    'shell.overlay',
    () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'verify-queue',
      order: 80,
      locale: NS,
      inject: () => actions,
    }, VerifyQueueDrawer),
  )
}

/**
 * Mount the generated Remote contribution, then the overlay.
 * @param ctx - browser context.
 * @param contribution - generated verify-queue descriptors.
 * @returns disposer.
 */
export async function mountVerifyQueueUi(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.verifyQueue', 'slots', 'locale'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
