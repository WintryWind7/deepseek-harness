/**
 * Browser half of @wintry/keepalive.
 *
 * Keeps the most recently visited Sessions retained on the Client so switching
 * back to one does not re-open its history from the Host. The Sidebar keeps a
 * reference only for the Session it currently selects, so every switch away
 * tears that generation down and re-selecting pays a fresh open. Our own
 * references share that same open, so it is already settled when the Sidebar
 * rebuilds its view.
 */
window.__ModuleLoader__.load({
  id: '@wintry/keepalive',
  factory(require) {
    /** How many recently visited Sessions stay warm. Tune here. */
    const KEEP = 8

    return {
      inject: ['sessions', 'uiSession'],
      apply(ctx) {
        /** SessionId -> SessionReference, ordered least-recently-used first. */
        const hot = new Map()

        const touch = (id) => {
          const existing = hot.get(id)
          if (existing !== undefined) {
            hot.delete(id)
            hot.set(id, existing)
            return
          }
          let reference
          try {
            reference = ctx.sessions.retain(id, { source: 'sessionKeepalive' })
          } catch (error) {
            console.warn('[session-keepalive] retain failed:', error)
            return
          }
          // Eviction and plugin disposal reject `ready`; that is a normal
          // cancellation, not a failure worth reporting.
          reference.ready.catch(() => {})
          hot.set(id, reference)
          while (hot.size > KEEP) {
            const oldest = hot.keys().next().value
            hot.get(oldest).release()
            hot.delete(oldest)
          }
        }

        ctx.effect(() => {
          const current = ctx.uiSession.adapter.current
          const sync = () => {
            const id = current.getSnapshot().key
            if (id !== undefined) touch(id)
          }
          const unsubscribe = current.subscribe(sync)
          sync()
          return () => {
            unsubscribe()
            for (const reference of hot.values()) reference.release()
            hot.clear()
          }
        }, 'session-keepalive: retained hot Sessions')
      },
    }
  },
})
