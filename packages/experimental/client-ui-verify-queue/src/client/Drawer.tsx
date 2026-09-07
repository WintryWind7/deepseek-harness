/** Right-edge verify-queue drawer. */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { VerifyQueueRow, VerifyQueueView } from '@deepseek-ai/dsh-experimental-verify-queue/client'
import type { VerifyQueueKey } from './locales.ts'
import css from './Drawer.module.css'

/** Injected Remote verbs. */
export interface VerifyQueueDrawerInjected {
  /** Load the queue for one workspace path. */
  load: (workspacePath: string) => Promise<VerifyQueueView>
  /** Persist drawer chrome. */
  setUi: (workspacePath: string, open: boolean, pinned: boolean) => Promise<VerifyQueueView>
  /** Mark or clear human acceptance. */
  setVerified: (workspacePath: string, id: string, verified: boolean) => Promise<VerifyQueueView>
  /** Drop one item. */
  remove: (workspacePath: string, id: string) => Promise<VerifyQueueView>
}

export type VerifyQueueDrawerProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'verify-queue'>
  & VerifyQueueDrawerInjected

/**
 * Render the right-edge handle and optional pinned/open panel.
 * @param props - slot runtime, locale, and Remote verbs.
 */
export function VerifyQueueDrawer({
  useSessions, useWorkspaces, t, load, setUi, setVerified, remove,
}: VerifyQueueDrawerProps) {
  const current = useSessions(state => state.current)
  const sessionCwd = useSessions(state =>
    current === undefined ? undefined : state.byId[current]?.cwd)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePath = sessionCwd
    ?? workspaces.find(workspace =>
      current !== undefined && workspace.sessionIds.includes(current),
    )?.path
    ?? workspaces[0]?.path
  const [view, setView] = useState<VerifyQueueView | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openLocal, setOpenLocal] = useState(false)

  const refresh = useCallback(async () => {
    if (workspacePath === undefined) {
      setView(undefined)
      return
    }
    try {
      const next = await load(workspacePath)
      setView(next)
      setError(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('error'))
    }
  }, [load, t, workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = view?.ui.pinned === true || view?.ui.open === true || openLocal
  const waiting = view?.rows.filter(row => row.status === 'on-main').length ?? 0

  const persistOpen = async (nextOpen: boolean, pinned: boolean) => {
    setOpenLocal(nextOpen)
    if (workspacePath === undefined) return
    setView(await setUi(workspacePath, nextOpen, pinned))
  }

  return (
    <div className={css.root} data-verify-queue>
      {open
        ? (
          <section className={css.panel} aria-label={t('title')}>
            <header className={css.header}>
              <span className={css.title}>{t('title')}</span>
              <Button size="sm" onClick={() => void refresh()}>{t('refresh')}</Button>
              <Button
                size="sm"
                onClick={() => void persistOpen(true, !(view?.ui.pinned === true))}
              >
                {view?.ui.pinned === true ? t('unpin') : t('pin')}
              </Button>
              <Button size="sm" aria-label={t('close')} onClick={() => void persistOpen(false, false)}>
                ×
              </Button>
            </header>
            <div className={css.body}>
              {workspacePath === undefined
                ? <p className={css.empty}>{t('noWorkspace')}</p>
                : error !== undefined
                  ? <p className={css.error}>{t('error')}</p>
                  : view === undefined || view.rows.length === 0
                    ? <p className={css.empty}>{t('empty')}</p>
                    : view.rows.map(row => (
                      <QueueItem
                        key={row.item.id}
                        row={row}
                        t={t}
                        onVerify={() => void setVerified(workspacePath, row.item.id, row.status !== 'verified')
                          .then(setView)}
                        onRemove={() => void remove(workspacePath, row.item.id).then(setView)}
                      />
                    ))}
            </div>
          </section>
        )
        : (
          <button
            type="button"
            className={css.handle}
            data-attention={waiting > 0 || undefined}
            aria-label={t('open')}
            onClick={() => void persistOpen(true, view?.ui.pinned === true)}
          >
            {t('title')}{waiting > 0 ? ` ${waiting}` : ''}
          </button>
        )}
    </div>
  )
}

function QueueItem({
  row, t, onVerify, onRemove,
}: {
  row: VerifyQueueRow
  t: VerifyQueueDrawerProps['t']
  onVerify: () => void
  onRemove: () => void
}) {
  const statusKey: VerifyQueueKey = `status.${row.status}`
  return (
    <article className={css.item}>
      <div>{row.item.title}</div>
      <div className={css.status} data-kind={row.status}>{t(statusKey)}</div>
      <div className={css.actions}>
        {row.status !== 'recorded' && (
          <Button size="sm" onClick={onVerify}>
            {row.status === 'verified' ? t('unverify') : t('verify')}
          </Button>
        )}
        <Button size="sm" onClick={onRemove}>{t('remove')}</Button>
      </div>
    </article>
  )
}
