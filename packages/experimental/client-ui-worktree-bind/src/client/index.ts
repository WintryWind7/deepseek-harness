/** Browser entry: locale dictionaries, composer chip, and overlay picker. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { clearBinding, createBranch, loadState, selectBranch } from './api.ts'
import { BranchChip, type BranchChipInjected } from './Chip.tsx'
import { BranchPanel } from './Panel.tsx'
import { en, NS, zh, type WorktreeBindKey } from './locales.ts'
import { createPickerStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Worktree-bind chip copy. */
    'worktree-bind': WorktreeBindKey
  }
}

/** Browser services this chip reads. */
export const inject = ['slots', 'locale']

/**
 * Register dictionaries, the left-row chip, and the composer overlay panel.
 * @param ctx - browser context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-worktree-bind: dictionaries')
  const actions: BranchChipInjected = {
    load: loadState,
    select: selectBranch,
    create: createBranch,
    clear: clearBinding,
  }
  const picker = createPickerStore()
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'worktree-bind',
    order: 4,
    locale: NS,
    store: picker,
    inject: () => actions,
  }, BranchChip))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'worktree-bind',
    order: 20,
    locale: NS,
    store: picker,
    inject: () => actions,
  }, BranchPanel))
}
