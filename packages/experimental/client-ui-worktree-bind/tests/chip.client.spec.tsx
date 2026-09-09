// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeBindState } from '@deepseek-ai/dsh-experimental-worktree-bind/src/wire.ts'
import { BranchChip, type BranchChipProps } from '../src/client/Chip.tsx'
import { BranchPanel } from '../src/client/Panel.tsx'
import { en } from '../src/client/locales.ts'
import { createPickerStore } from '../src/client/store.ts'

const state = (over: Partial<WorktreeBindState> = {}): WorktreeBindState => ({
  cwd: 'D:/proj',
  selected: null,
  branches: [],
  error: null,
  ...over,
})

function kit(over: Partial<BranchChipProps> = {}): BranchChipProps {
  const instance = createPickerStore().create()
  return {
    sessionId: 's1',
    t: key => en[key],
    useSession: sel => sel({ blank: true }),
    useStore: sel => sel(instance.getSnapshot()),
    actions: instance.actions,
    load: vi.fn(async () => state()),
    select: vi.fn(async () => ({ ok: true as const })),
    create: vi.fn(async () => ({ ok: true as const })),
    clear: vi.fn(async () => ({ ok: true as const })),
    ...over,
  }
}

afterEach(() => { cleanup() })

describe('BranchChip', () => {
  it('shows the bound branch and toggles the overlay', async () => {
    const toggle = vi.fn()
    const load = vi.fn(async () => state({ selected: { path: 'D:/wt', branch: 'feat' } }))
    render(<BranchChip {...kit({ load, actions: { open: vi.fn(), close: vi.fn(), toggle } })} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'feat' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'feat' }))
    expect(toggle).toHaveBeenCalled()
  })

  it('clears the label when load fails', async () => {
    const load = vi.fn(async () => { throw new Error('offline') })
    render(<BranchChip {...kit({ load })} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'main' })).toBeTruthy() })
  })
})

describe('BranchPanel', () => {
  it('lists branch names only, selects, creates, and unbinds', async () => {
    const load = vi.fn(async () => state({
      selected: { path: 'D:/proj/.dsh/worktrees/feat', branch: 'feat' },
      branches: [
        { name: 'main', worktreePath: 'D:/proj', current: true },
        { name: 'feat', worktreePath: 'D:/proj/.dsh/worktrees/feat', current: false },
        { name: 'feat/one', worktreePath: null, current: false },
      ],
    }))
    const select = vi.fn(async () => ({ ok: true as const }))
    const create = vi.fn(async () => ({
      ok: true as const,
      selected: { path: 'D:/wt', branch: 'feat/two', pending: 'create' as const },
    }))
    const clear = vi.fn(async () => ({ ok: true as const }))
    const close = vi.fn()
    render(
      <BranchPanel
        {...kit({
          load, select, create, clear,
          useStore: sel => sel({ open: true }),
          actions: { open: vi.fn(), close, toggle: vi.fn() },
        })}
      />,
    )
    await waitFor(() => { expect(load).toHaveBeenCalledWith('s1') })
    expect(screen.queryByText('D:/proj')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'main' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith('s1', 'main', { current: true, worktreePath: 'D:/proj' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'feat/' }))
    expect(screen.getByRole('button', { name: 'feat/one' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'feat/' }))
    expect(screen.queryByRole('button', { name: 'feat/one' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'feat/' }))
    expect(screen.getByRole('button', { name: 'feat/one' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'feat/one' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith('s1', 'feat/one', { current: false, worktreePath: null })
    })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    expect((screen.getByPlaceholderText(en.placeholder) as HTMLInputElement).value).toBe('agent/s1')
    fireEvent.click(screen.getByRole('button', { name: en.auto }))
    expect((screen.getByPlaceholderText(en.placeholder) as HTMLInputElement).value).toBe('agent/s1')
    fireEvent.change(screen.getByPlaceholderText(en.placeholder), { target: { value: 'feat/two' } })
    fireEvent.keyDown(screen.getByPlaceholderText(en.placeholder), { key: 'Enter' })
    await waitFor(() => { expect(create).toHaveBeenCalledWith('s1', 'feat/two') })
    expect(screen.getByRole('button', { name: 'feat/two' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.unbind }))
    await waitFor(() => { expect(clear).toHaveBeenCalledWith('s1') })
  })

  it('locks mutations after the session has started', async () => {
    const select = vi.fn(async () => ({ ok: true as const }))
    render(
      <BranchPanel
        {...kit({
          select,
          useSession: sel => sel({ blank: false }),
          useStore: sel => sel({ open: true }),
          load: vi.fn(async () => state({
            selected: { path: 'D:/wt', branch: 'feat' },
            branches: [{ name: 'feat', worktreePath: 'D:/wt', current: false }],
          })),
        })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(en.locked)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'feat' }))
    expect(select).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: en.create })).toBeNull()
  })

  it('filters the list and shows empty copy', async () => {
    render(
      <BranchPanel
        {...kit({
          useStore: sel => sel({ open: true }),
          load: vi.fn(async () => state({
            branches: [
              { name: 'main', worktreePath: null, current: true },
              { name: 'feat', worktreePath: null, current: false },
            ],
          })),
        })}
      />,
    )
    await waitFor(() => { expect(screen.getByPlaceholderText(en.search)).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText(en.search), { target: { value: 'zzz' } })
    expect(screen.getByText(en.empty)).toBeTruthy()
  })

  it('surfaces errors and ignores extra create submits while busy', async () => {
    const load = vi.fn(async () => state({ error: 'git missing', branches: [] }))
    const create = vi.fn(() => new Promise<never>(() => {}))
    render(
      <BranchPanel
        {...kit({
          load, create,
          useStore: sel => sel({ open: true }),
        })}
      />,
    )
    await waitFor(() => { expect(screen.getByText('git missing')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    fireEvent.change(screen.getByPlaceholderText(en.placeholder), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByPlaceholderText(en.placeholder), { key: 'Enter' })
    fireEvent.keyDown(screen.getByPlaceholderText(en.placeholder), { key: 'Enter' })
    await waitFor(() => { expect(create).toHaveBeenCalledTimes(1) })
  })

  it('shows a failed create message', async () => {
    const load = vi.fn(async () => state())
    const create = vi.fn(async () => ({ ok: false as const }))
    render(
      <BranchPanel
        {...kit({
          load, create,
          useStore: sel => sel({ open: true }),
        })}
      />,
    )
    await waitFor(() => { expect(load).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    fireEvent.change(screen.getByPlaceholderText(en.placeholder), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByPlaceholderText(en.placeholder), { key: 'Enter' })
    await waitFor(() => { expect(screen.getByText(en.error)).toBeTruthy() })
  })

  it('renders nothing while closed and closes on outside pointerdown', async () => {
    const close = vi.fn()
    const { rerender } = render(
      <BranchPanel {...kit({ useStore: sel => sel({ open: false }) })} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(
      <BranchPanel
        {...kit({
          useStore: sel => sel({ open: true }),
          actions: { open: vi.fn(), close, toggle: vi.fn() },
          load: vi.fn(async () => state()),
        })}
      />,
    )
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
    const chip = document.createElement('button')
    chip.setAttribute('data-worktree-bind-chip', '')
    document.body.appendChild(chip)
    fireEvent.pointerDown(chip)
    expect(close).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(close).toHaveBeenCalled()
  })

  it('surfaces a thrown create and Escape cancels naming', async () => {
    const load = vi.fn(async () => state())
    const create = vi.fn(async () => { throw new Error('nope') })
    render(
      <BranchPanel
        {...kit({
          load, create,
          useStore: sel => sel({ open: true }),
        })}
      />,
    )
    await waitFor(() => { expect(load).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    fireEvent.keyDown(screen.getByPlaceholderText(en.placeholder), { key: 'Escape' })
    expect(screen.queryByPlaceholderText(en.placeholder)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    fireEvent.change(screen.getByPlaceholderText(en.placeholder), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByPlaceholderText(en.placeholder), { key: 'Enter' })
    await waitFor(() => { expect(screen.getByText('nope')).toBeTruthy() })
  })

  it('records a thrown refresh', async () => {
    const load = vi.fn(async () => { throw new Error('boom') })
    render(
      <BranchPanel
        {...kit({
          load,
          useStore: sel => sel({ open: true }),
        })}
      />,
    )
    await waitFor(() => { expect(screen.getByText('boom')).toBeTruthy() })
  })
})
