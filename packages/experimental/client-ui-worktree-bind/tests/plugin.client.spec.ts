import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as clientApply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { BranchChip } from '../src/client/Chip.tsx'
import { BranchPanel } from '../src/client/Panel.tsx'

describe('worktree-bind browser plugin', () => {
  it('exports inject and a no-op host apply', () => {
    expect(inject).toEqual(['slots', 'locale'])
    nodeApply()
  })

  it('registers the composer chip', async () => {
    const ctx = new Context()
    ctx.provide('locale', new LocaleRuntime(ctx))
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.input.left': { kind: 'list', scope: 'session' },
        'conversation.input.overlay': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    await ctx.plugin({ name: 'worktree-bind-ui', inject, apply: clientApply })
    const entry = ctx.slots.entries('conversation.input.left')
      .find(candidate => candidate.component === BranchChip)
    expect(entry).toMatchObject({ options: { id: 'worktree-bind', order: 4 } })
    expect(ctx.slots.entries('conversation.input.overlay')
      .find(candidate => candidate.component === BranchPanel))
      .toMatchObject({ options: { id: 'worktree-bind', order: 20 } })
  })
})
