/** Composer-left branch chip: opens the overlay picker. */

import { useCallback, useEffect, useState } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorktreeBindResult, WorktreeBindState } from '@deepseek-ai/dsh-experimental-worktree-bind/src/wire.ts'
import { unboundLabel } from './display.ts'
import type { WorktreeBindKey } from './locales.ts'
import type { createPickerStore } from './store.ts'
import css from './Chip.module.css'

/** Host verbs closed over by apply(). */
export interface BranchChipInjected {
  load: (sessionId: string) => Promise<WorktreeBindState>
  select: (
    sessionId: string,
    branch: string,
    hints?: { current?: boolean; worktreePath?: string | null },
  ) => Promise<WorktreeBindResult>
  create: (sessionId: string, name: string) => Promise<WorktreeBindResult>
  clear: (sessionId: string) => Promise<WorktreeBindResult>
}

export type BranchChipProps = {
  sessionId: string
  t: (key: WorktreeBindKey) => string
  useSession: <S>(sel: (s: { blank: boolean }) => S) => S
} & BranchChipInjected & PropsStore<ReturnType<typeof createPickerStore>>

/**
 * Compact branch label on the composer tool row.
 * @param props - session id, locale, store, and Host verbs.
 */
export function BranchChip({ sessionId, load, useStore, actions }: BranchChipProps) {
  const [state, setState] = useState<WorktreeBindState | null>(null)
  const refresh = useCallback(async () => {
    try {
      setState(await load(sessionId))
    } catch {
      setState(null)
    }
  }, [load, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selected = state?.selected
  const label = selected?.branch ?? unboundLabel(state)
  const open = useStore(s => s.open)

  return (
    <button
      type="button"
      data-worktree-bind-chip=""
      className={selected ? `${css.chip} ${css.bound}` : css.chip}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => {
        actions.toggle()
        void refresh()
      }}
    >
      <span className={css.label}>{label}</span>
    </button>
  )
}
