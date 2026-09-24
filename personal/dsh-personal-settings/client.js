/**
 * Browser half of dsh-personal-settings.
 *
 * The Settings shell offers one navigation level, so this bundle is that level's
 * second half: one "个人" section whose own `personal.settings.page` slot other
 * personal plugins register their configuration pages into. This file owns the
 * two-level navigation only — the vertical list, the breadcrumb, and the pinned
 * head — and ships no configuration page of its own.
 */
window.__ModuleLoader__.load({
  id: 'dsh-personal-settings',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { IconChevronRightOutlineRegular } = primitives
    const { createElement: h, useState } = React
    const { resolveSlotLabel } = require('@deepseek-ai/dsh-client-ui-slots')

    const NS = 'personal-settings'
    /** Slot other personal plugins register their configuration page into. */
    const PAGE = 'personal.settings.page'

    const zh = {
      nav: '个人',
      empty: '还没有插件把配置页注册进来。',
    }
    const en = {
      nav: 'Personal',
      empty: 'No plugin has registered a configuration page yet.',
    }

    const CSS = `
      /* The settings shell scrolls its own content column (the options node), so the
         section fills that height and scrolls inside itself: the head never
         moves, and a page's own lead paragraph pins to the top of its body. */
      .ps-section { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; }
      .ps-head { flex: none; padding-bottom: 12px; }
      .ps-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
      .ps-stickyTop {
        position: sticky; top: 0; z-index: 1;
        margin: 0; padding: 0 0 12px; background: var(--dsw-alias-bg-layer-2);
      }
      .ps-heading {
        margin: 0; font-size: 18px; font-weight: 500; line-height: 26px;
        color: var(--dsw-alias-label-primary);
      }
      .ps-list { display: flex; flex-direction: column; gap: 4px; max-width: 480px; }
      .ps-row {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
        padding: 10px 12px; background: transparent; cursor: pointer;
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: start;
      }
      .ps-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .ps-row:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary); }
      .ps-rowLabel { min-width: 0; }
      .ps-rowIcon { flex: none; color: var(--dsw-alias-label-tertiary); }
      .ps-crumb { display: flex; align-items: center; gap: 2px; }
      .ps-crumbLink {
        border: none; border-radius: 6px; padding: 2px 6px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: 13px; cursor: pointer;
      }
      .ps-crumbLink:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .ps-crumbLink:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary); }
      .ps-crumbSep { flex: none; color: var(--dsw-alias-label-tertiary); }
      .ps-crumbCurrent { padding: 2px 6px; font-size: 13px; color: var(--dsw-alias-label-primary); }
      .ps-empty { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
    `

    function PersonalSection(props) {
      const pages = props.usePages(value => value)
      const [openId, setOpenId] = useState()
      const open = pages.find(page => page.id === openId)

      if (pages.length === 0) return h('p', { className: 'ps-empty' }, props.t('empty'))

      // Level one: the plugin list fills the section.
      if (open === undefined) {
        return h('div', { className: 'ps-section' },
          h('div', { className: 'ps-head' },
            h('h2', { className: 'ps-heading' }, props.t('nav'))),
          h('div', { className: 'ps-scroll' },
            h('div', { className: 'ps-list' },
              pages.map(page => h('button', {
                key: page.id,
                type: 'button',
                className: 'ps-row',
                onClick: () => { setOpenId(page.id) },
              },
              h('span', { className: 'ps-rowLabel' }, page.label),
              h(IconChevronRightOutlineRegular, { size: 16, className: 'ps-rowIcon' }))))))
      }

      // Level two: the whole section is this page. The list is gone, and the
      // breadcrumb is the way back.
      return h('div', { className: 'ps-section' },
        h('div', { className: 'ps-head' },
          h('nav', { className: 'ps-crumb', 'aria-label': props.t('nav') },
            h('button', {
              type: 'button',
              className: 'ps-crumbLink',
              onClick: () => { setOpenId(undefined) },
            }, props.t('nav')),
            h(IconChevronRightOutlineRegular, { size: 14, className: 'ps-crumbSep' }),
            h('span', { className: 'ps-crumbCurrent' }, open.label))),
        h('div', { className: 'ps-scroll' },
          props.renderSlot(PAGE, {}, { only: open.id })))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'personal-settings: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        }, 'personal-settings: styles')

        let version = -1
        let revision = -1
        let pages = []
        // A registrant-private reactive fact: the ledgers this snapshot reads are
        // subscribed here, so components never touch the slot or locale services.
        const sectionInjected = () => ({
          hooks: {
            pages: {
              getSnapshot: () => {
                const nextVersion = ctx.slots.getVersion(PAGE)
                const nextRevision = ctx.locale.getSnapshot().revision
                if (nextVersion !== version || nextRevision !== revision) {
                  version = nextVersion
                  revision = nextRevision
                  pages = ctx.slots.entries(PAGE)
                    .map(entry => ({
                      id: entry.options.id ?? '',
                      order: entry.options.order ?? 0,
                      label: resolveSlotLabel(entry.options.label) ?? '',
                    }))
                    .sort((left, right) => left.order - right.order)
                }
                return pages
              },
              subscribe: (listener) => {
                const offLedger = ctx.slots.subscribe(PAGE, listener)
                const offLocale = ctx.locale.subscribe(listener)
                return () => { offLedger(); offLocale() }
              },
            },
          },
        })

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'personal',
          order: 40,
          label: () => t('nav'),
          locale: NS,
          inject: sectionInjected,
          children: { [PAGE]: { kind: 'list', scope: 'root' } },
        }, PersonalSection))
      },
    }
  },
})
