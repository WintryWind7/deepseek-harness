/**
 * Open/closed state for the composer overlay, shared with the left-row chip.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-bind/store
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Overlay visibility. */
export interface PickerState {
  open: boolean
}

/** Declared action shape giving the exported factory a stable return type. */
type PickerActions = {
  open: (draft: PickerState) => void
  close: (draft: PickerState) => void
  toggle: (draft: PickerState) => void
}

/**
 * Fresh handle per plugin apply so HMR does not pin one identity.
 * Pass the same handle to the chip and overlay registers.
 * @returns the store handle.
 */
export function createPickerStore(): EngineStoreHandle<PickerState, PickerActions> {
  return defineStore({
    init: (): PickerState => ({ open: false }),
    actions: {
      open(draft: PickerState) { draft.open = true },
      close(draft: PickerState) { draft.open = false },
      toggle(draft: PickerState) { draft.open = !draft.open },
    },
  })
}
