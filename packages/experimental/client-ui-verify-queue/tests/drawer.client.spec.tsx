// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VerifyQueueView } from '@deepseek-ai/dsh-experimental-verify-queue/client'
import { VerifyQueueDrawer } from '../src/client/Drawer.tsx'
import { en } from '../src/client/locales.ts'

const view = (over: Partial<VerifyQueueView> = {}): VerifyQueueView => ({
  workspacePath: 'D:/proj',
  ui: { open: false, pinned: false },
  rows: [],
  ...over,
})

const kit = {
  sessionId: undefined,
  useSession: () => undefined,
  t: (key: keyof typeof en) => en[key],
}

const rows: VerifyQueueView['rows'] = [
  {
    item: {
      id: 'a', title: 'nav arc', sessionId: 's1',
      commits: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      createdAt: 1, verifiedAt: null,
    },
    status: 'on-main',
  },
  {
    item: {
      id: 'b', title: 'wip', sessionId: 's1',
      commits: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
      createdAt: 2, verifiedAt: null,
    },
    status: 'recorded',
  },
  {
    item: {
      id: 'c', title: 'done', sessionId: 's1',
      commits: ['cccccccccccccccccccccccccccccccccccccccc'],
      createdAt: 3, verifiedAt: 4,
    },
    status: 'verified',
  },
]

describe('VerifyQueueDrawer', () => {
  afterEach(() => cleanup())
  it('shows empty while the first load is still pending', async () => {
    let resolveLoad: ((value: VerifyQueueView) => void) | undefined
    const load = vi.fn(() => new Promise<VerifyQueueView>((resolve) => {
      resolveLoad = resolve
    }))
    const setUi = vi.fn(() => new Promise<VerifyQueueView>(() => {}))
    render(
      <VerifyQueueDrawer
        {...kit}
        useSessions={selector => selector({
          current: 's1', ids: ['s1'],
          byId: { s1: { cwd: 'D:/proj' } },
          phase: 'ready',
        } as never)}
        useWorkspaces={selector => selector({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })}
        load={load}
        setUi={setUi}
        setVerified={vi.fn()}
        remove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en.open }))
    expect(screen.getByText(en.empty)).toBeTruthy()
    resolveLoad?.(view({ ui: { open: true, pinned: false }, rows: [] }))
  })

  it('asks for a workspace when none is selected', async () => {
    render(
      <VerifyQueueDrawer
        {...kit}
        useSessions={selector => selector({ current: undefined, ids: [], byId: {}, phase: 'ready' } as never)}
        useWorkspaces={selector => selector({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })}
        load={vi.fn()}
        setUi={vi.fn()}
        setVerified={vi.fn()}
        remove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en.open }))
    expect(screen.getByText(en.noWorkspace)).toBeTruthy()
  })

  it('opens, pins, verifies, and removes rows', async () => {
    const load = vi.fn(async () => view({
      ui: { open: true, pinned: false },
      rows,
    }))
    const setUi = vi.fn(async (_path: string, open: boolean, pinned: boolean) =>
      view({ ui: { open, pinned }, rows }))
    const setVerified = vi.fn(async () => view({ ui: { open: true, pinned: false }, rows }))
    const remove = vi.fn(async () => view({ ui: { open: true, pinned: false }, rows: rows.slice(1) }))
    render(
      <VerifyQueueDrawer
        {...kit}
        useSessions={selector => selector({
          current: 's1', ids: ['s1'],
          byId: { s1: { cwd: 'D:/proj' } },
          phase: 'ready',
        } as never)}
        useWorkspaces={selector => selector({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })}
        load={load}
        setUi={setUi}
        setVerified={setVerified}
        remove={remove}
      />,
    )
    await waitFor(() => expect(screen.getByText('nav arc')).toBeTruthy())
    expect(screen.getByText(en['status.recorded'])).toBeTruthy()
    fireEvent.click(screen.getByText(en.verify))
    await waitFor(() => expect(setVerified).toHaveBeenCalledWith('D:/proj', 'a', true))
    fireEvent.click(screen.getAllByText(en.remove)[0]!)
    await waitFor(() => expect(remove).toHaveBeenCalled())
    fireEvent.click(screen.getByText(en.unverify))
    await waitFor(() => expect(setVerified).toHaveBeenCalledWith('D:/proj', 'c', false))
    fireEvent.click(screen.getByText(en.pin))
    await waitFor(() => expect(setUi).toHaveBeenCalledWith('D:/proj', true, true))
    fireEvent.click(screen.getByText(en.unpin))
    await waitFor(() => expect(setUi).toHaveBeenCalledWith('D:/proj', true, false))
    fireEvent.click(screen.getByText(en.refresh))
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1))
    fireEvent.click(screen.getByLabelText(en.close))
    await waitFor(() => expect(setUi).toHaveBeenCalledWith('D:/proj', false, false))
  })

  it('shows a waiting badge on the handle and falls back to the workspace path', async () => {
    const load = vi.fn(async () => view({
      ui: { open: false, pinned: false },
      rows: [{
        item: {
          id: 'a', title: 'nav arc', sessionId: 's1',
          commits: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
          createdAt: 1, verifiedAt: null,
        },
        status: 'on-main',
      }],
    }))
    render(
      <VerifyQueueDrawer
        {...kit}
        useSessions={selector => selector({ current: undefined, ids: [], byId: {}, phase: 'ready' } as never)}
        useWorkspaces={selector => selector({
          items: [{
            workspaceId: 'w1', path: 'D:/proj', title: 'p', sessionIds: [],
            createdAt: '', updatedAt: '',
          }],
          archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
        } as never)}
        load={load}
        setUi={vi.fn(async () => view({ ui: { open: true, pinned: false }, rows: [] }))}
        setVerified={vi.fn()}
        remove={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: en.open }).textContent).toContain('1'))
  })

  it('surfaces a load failure', async () => {
    render(
      <VerifyQueueDrawer
        {...kit}
        useSessions={selector => selector({
          current: 's1', ids: ['s1'],
          byId: { s1: { cwd: 'D:/proj' } },
          phase: 'ready',
        } as never)}
        useWorkspaces={selector => selector({
          items: [{
            workspaceId: 'w1', path: 'D:/proj', title: 'p', sessionIds: ['s1'],
            createdAt: '', updatedAt: '',
          }],
          archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
        } as never)}
        load={vi.fn(async () => {
          throw new Error('offline')
        })}
        setUi={vi.fn()}
        setVerified={vi.fn()}
        remove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en.open }))
    await waitFor(() => expect(screen.getByText(en.error)).toBeTruthy())
  })

  it('surfaces a non-error load failure', async () => {
    render(
      <VerifyQueueDrawer
        {...kit}
        useSessions={selector => selector({
          current: 's1', ids: ['s1'],
          byId: { s1: { cwd: 'D:/proj' } },
          phase: 'ready',
        } as never)}
        useWorkspaces={selector => selector({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })}
        load={vi.fn(async () => {
          throw 'offline'
        })}
        setUi={vi.fn()}
        setVerified={vi.fn()}
        remove={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en.open }))
    await waitFor(() => expect(screen.getByText(en.error)).toBeTruthy())
  })
})
