/** Browser entry: mount the generated Remote contribution and the overlay drawer. */

import verifyQueueRemote from '@deepseek-ai/dsh-experimental-verify-queue/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountVerifyQueueUi } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Mount Remote namespace then the overlay.
 * @param ctx - browser context.
 * @returns disposer.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountVerifyQueueUi(ctx, verifyQueueRemote)
}
