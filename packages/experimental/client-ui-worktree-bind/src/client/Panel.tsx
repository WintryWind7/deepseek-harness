/** Composer overlay: IDEA-style branch list, create, unbind. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorktreeBindResult, WorktreeBindState } from '@deepseek-ai/dsh-experimental-worktree-bind/src/wire.ts'
import type { BranchChipInjected } from './Chip.tsx'
import { autoBranchName } from './display.ts'
import { IconCheck, IconChevron, IconPlus, IconUnbind } from './icons.tsx'
import type { WorktreeBindKey } from './locales.ts'
import type { createPickerStore } from './store.ts'
import { buildBranchTree, filterBranches, openFoldersFor, type BranchTreeNode } from './tree.ts'
import css from './Chip.module.css'

export type BranchPanelProps = {
  sessionId: string
  t: (key: WorktreeBindKey) => string
  useSession: <S>(sel: (s: { blank: boolean }) => S) => S
} & BranchChipInjected & PropsStore<ReturnType<typeof createPickerStore>>

/**
 * Floating picker above the composer card.
 * @param props - session id, locale, store, and Host verbs.
 */
export function BranchPanel({
  sessionId, t, load, select, create, clear, useSession, useStore, actions,
}: BranchPanelProps) {
  const open = useStore(s => s.open)
  const blank = useSession(s => s.blank)
  const locked = ! blank
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<WorktreeBindState | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [folders, setFolders] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await load(sessionId)
      setState(next)
      setError(next.error ?? '')
      setFolders(openFoldersFor(next.selected?.branch))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [load, sessionId])

  useEffect(() => {
    if (open) void refresh()
    else {
      setQuery('')
      setCreating(false)
      setName('')
    }
  }, [open, refresh])

  useEffect(() => {
    if (creating) createRef.current?.focus()
  }, [creating])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (panelRef.current?.contains(ev.target)) return
      if (ev.target instanceof Element && ev.target.closest('[data-worktree-bind-chip]') !== null) return
      actions.close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open, actions])

  const names = useMemo(() => {
    const listed = (state?.branches ?? []).map(branch => branch.name)
    const extra = state?.selected?.branch
    if (extra !== undefined && extra !== null && extra.length > 0 && !listed.includes(extra)) listed.push(extra)
    return listed
  }, [state])
  const visible = useMemo(() => filterBranches(names, query), [names, query])
  const tree = useMemo(() => buildBranchTree(visible), [visible])

  const run = (task: () => Promise<WorktreeBindResult>, closeOnOk = false): void => {
    if (busy || locked) return
    setBusy(true)
    setError('')
    void task().then((result) => {
      if (!result.ok) {
        setError(result.error ?? t('error'))
        return
      }
      const selected = result.selected
      if (selected !== undefined && selected !== null) {
        setState((prev) => {
          const branches = [...(prev?.branches ?? [])]
          if (selected.branch !== null && !branches.some(row => row.name === selected.branch)) {
            branches.push({ name: selected.branch, worktreePath: null, current: false })
          }
          return {
            cwd: prev?.cwd ?? null,
            selected,
            branches,
            error: null,
          }
        })
        setFolders(openFoldersFor(selected.branch))
      }
      setCreating(false)
      setName('')
      if (closeOnOk) actions.close()
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      setBusy(false)
    })
  }

  const toggleFolder = (path: string): void => {
    setFolders((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (!open) return null

  const selected = state?.selected

  const renderNodes = (nodes: BranchTreeNode[], depth: number): ReactNode => nodes.map((node) => {
    if (node.kind === 'folder') {
      const expanded = folders.has(node.path)
      return (
        <div key={`folder:${node.path}`}>
          <button
            type="button"
            className={css.group}
            style={{ paddingLeft: 8 + depth * 12 }}
            aria-expanded={expanded}
            aria-label={`${node.path}/`}
            onClick={() => { toggleFolder(node.path) }}
          >
            <span className={expanded ? `${css.chevron} ${css.chevronOpen}` : css.chevron}><IconChevron /></span>
            <span className={css.groupLabel}>{node.name}</span>
          </button>
          {expanded ? renderNodes(node.children, depth + 1) : null}
        </div>
      )
    }
    const active = selected?.branch === node.branch
    return (
      <button
        key={node.branch}
        type="button"
        className={active ? `${css.row} ${css.selected}` : css.row}
        style={{ paddingLeft: 8 + depth * 12 }}
        disabled={busy || locked}
        aria-label={node.branch}
        onClick={() => {
          const meta = state?.branches.find(row => row.name === node.branch)
          run(() => select(sessionId, node.branch, {
            current: meta?.current === true,
            worktreePath: meta?.worktreePath ?? null,
          }), true)
        }}
      >
        <span className={css.rowLabel}>{node.name}</span>
        {active ? <span className={css.check}><IconCheck /></span> : null}
      </button>
    )
  })

  return (
    <div ref={panelRef} className={css.panel} data-trigger-menu="" role="dialog">
      {locked
        ? null
        : (
          <div className={css.toolbar}>
            <button
              type="button"
              className={creating ? `${css.tool} ${css.toolOn}` : css.tool}
              aria-label={t('create')}
              disabled={busy}
              onClick={() => {
                setCreating((current) => {
                  const next = !current
                  setName(next ? autoBranchName(sessionId) : '')
                  return next
                })
              }}
            >
              <IconPlus />
            </button>
            <button
              type="button"
              className={css.tool}
              aria-label={t('unbind')}
              disabled={busy || selected === null || selected === undefined}
              onClick={() => { run(() => clear(sessionId)) }}
            >
              <IconUnbind />
            </button>
          </div>
        )}
      <div className={css.main}>
        <div className={css.heading}>{t('heading')}</div>
        {locked ? <div className={css.locked}>{t('locked')}</div> : null}
        {visible.length === 0
          ? <div className={css.empty}>{t('empty')}</div>
          : <div className={css.rows}>{renderNodes(tree, 0)}</div>}
        {error.length > 0 ? <div className={css.error}>{error}</div> : null}
        {locked
          ? null
          : creating
            ? (
              <div className={css.createWrap}>
                <input
                  ref={createRef}
                  className={css.create}
                  value={name}
                  placeholder={t('placeholder')}
                  disabled={busy}
                  onChange={(event) => { setName(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setCreating(false)
                      setName('')
                      return
                    }
                    if (event.key !== 'Enter' || name.trim() === '') return
                    event.preventDefault()
                    run(() => create(sessionId, name))
                  }}
                />
                <button
                  type="button"
                  className={css.fill}
                  disabled={busy}
                  onClick={() => { setName(autoBranchName(sessionId)) }}
                >
                  {t('auto')}
                </button>
              </div>
            )
            : (
              <div className={css.searchWrap}>
                <input
                  className={css.search}
                  value={query}
                  placeholder={t('search')}
                  onChange={(event) => { setQuery(event.target.value) }}
                />
              </div>
            )}
      </div>
    </div>
  )
}
