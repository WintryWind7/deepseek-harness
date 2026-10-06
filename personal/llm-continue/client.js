/**
 * Browser half of @wintry/llm-continue.
 *
 * Adds one icon after the composer's own statistics pills; the icon opens a
 * panel for this Session. One time range filters the whole page. The main
 * card lists the routes that were continued, newest count first, each with
 * its injection count, the turns it touched, and how many of those turns
 * recovered a text answer. Two side cards show this Session's continuations
 * and the most recent records.
 * With no stored record yet, every field is zero.
 * Recovery is counted per turn, never per injection: one turn continued
 * three times and answered on the third is one recovered turn.
 */
window.__ModuleLoader__.load({
  id: '@wintry/llm-continue',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NS = 'llm-continue';

    const zh = {
      trigger: '自动继续',
      title: '自动继续',
      close: '关闭',
      boot: '本次启动',
      h24: '24小时',
      d7: '7天',
      all: '累计',
      ranges: '时间范围',
      empty: '还没有发生过自动继续。',
      summary: '{count} 次 · {turns} 轮 · 恢复 {recovered} 轮',
      failed: '未恢复',
      recovered: '恢复',
      turns: '轮次',
      injections: '注入次数',
      rate: '恢复率',
      maxAttempt: '单轮最多',
      models: '按模型',
      modelNote: '{scope}，按提供商里的模型汇总。一个模型在同一轮被注入多次，只算这一轮一次。',
      modelCount: '{count} 个模型',
      session: '这个会话',
      recent: '最近记录',
      recentEmpty: '还没有记录。',
      attemptBrief: '第 {attempt} 次',
      turnBrief: '第 {turn} 轮',
      unknown: '未记录',
      scopeBoot: '本次启动之后发生的注入',
      scopeH24: '最近24小时内发生的注入',
      scopeD7: '最近7天内发生的注入',
      scopeAll: '自开始记录以来的全部注入',
      sessionEmpty: '这个会话没有自动继续。',
      reasoning: '思考长度',
    };
    const en = {
      trigger: 'Auto continue',
      title: 'Auto continue',
      close: 'Close',
      boot: 'This start',
      h24: '24 hours',
      d7: '7 days',
      all: 'All',
      ranges: 'Time range',
      empty: 'No continuation has happened yet.',
      summary: '{count} injections · {turns} turns · {recovered} recovered',
      failed: 'Not recovered',
      recovered: 'Recovered',
      turns: 'Turns',
      injections: 'Injections',
      rate: 'Recovery rate',
      maxAttempt: 'Most in one turn',
      models: 'By model',
      modelNote: '{scope}, summed by model within each provider. A model continued several times in one turn counts that turn once.',
      modelCount: '{count} models',
      session: 'This session',
      recent: 'Recent records',
      recentEmpty: 'No record yet.',
      attemptBrief: '#{attempt}',
      turnBrief: 'turn {turn}',
      unknown: 'Not recorded',
      scopeBoot: 'Injections since this start',
      scopeH24: 'Injections in the last 24 hours',
      scopeD7: 'Injections in the last 7 days',
      scopeAll: 'Every injection since recording started',
      sessionEmpty: 'No continuation in this session.',
      reasoning: 'Reasoning',
    };

    const CSS = `
      .lc-slot { order: 1; display: inline-flex; flex: none; }
      .lc-trigger {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; padding: 0;
        border: none; border-radius: 6px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .lc-trigger:hover,
      .lc-trigger[aria-expanded='true'] {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .lc-trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .lc-backdrop {
        position: fixed; inset: 0; z-index: 1100;
        display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-2);
      }
      .lc-page {
        box-sizing: border-box;
        display: flex; flex-direction: column;
        width: min(920px, calc(100vw - 48px));
        height: min(640px, calc(100vh - 48px));
        padding: 24px 24px 20px;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 16px;
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);
        color: var(--dsw-alias-label-primary);
      }
      .lc-board {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(200px, 0.62fr);
        flex: 1 1 auto; min-height: 0;
        gap: 16px;
        align-items: stretch;
        margin-top: 20px;
      }
      .lc-card {
        display: flex; flex-direction: column;
        min-width: 0; min-height: 0;
        padding: 8px;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
      }
      .lc-cardBody {
        flex: 1 1 auto; min-height: 0;
        overflow: auto;
        --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-track-margin: 8px;
      }
      .lc-cardTitle {
        margin: 0;
        padding: 8px 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
      }
      .lc-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; padding: 0 4px;
      }
      .lc-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .lc-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .lc-iconButton {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border: none; border-radius: 8px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .lc-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .lc-iconButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .lc-main {
        min-width: 0; min-height: 0; height: 100%;
        display: flex; flex-direction: column; gap: 12px;
      }
      .lc-range {
        display: grid;
        flex: none;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        gap: 8px;
      }
      .lc-rangeButton {
        box-sizing: border-box; width: 100%; min-width: 0; min-height: 40px;
        margin: 0; padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
        background: transparent; color: var(--dsw-alias-label-primary);
        cursor: pointer; text-align: center; font-size: 13px;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      .lc-rangeButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .lc-rangeButton[aria-selected='true'] {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .lc-rangeButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .lc-summary {
        margin: 0; padding: 0 4px;
        color: var(--dsw-alias-label-secondary); font-size: 13px;
      }
      .lc-viewNote {
        margin: 0 0 8px; padding: 0 10px;
        color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5;
      }
      .lc-side { height: 100%; }
      .lc-side .lc-cardTitle { font-size: 12px; }
      .lc-row {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 16px; padding: 11px 12px; border-radius: 8px; font-size: 14px;
      }
      .lc-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .lc-name { color: var(--dsw-alias-label-secondary); }
      .lc-value {
        color: var(--dsw-alias-label-primary);
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 14px;
      }
      .lc-head {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 16px; padding: 9px 12px;
        color: var(--dsw-alias-label-tertiary); font-size: 11px;
      }
      .lc-route {
        padding: 8px 12px; border-radius: 8px;
      }
      .lc-route:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .lc-routeName {
        display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
        margin: 0 0 5px;
        font-size: 13px; color: var(--dsw-alias-label-primary);
      }
      .lc-routeProvider { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .lc-routeModel { font-weight: 500; }
      .lc-facts {
        display: flex; flex-wrap: wrap; gap: 12px;
        font-size: 12px; color: var(--dsw-alias-label-secondary);
      }
      .lc-factValue {
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: var(--dsw-alias-label-primary);
      }
      .lc-ok { color: var(--dsw-alias-state-success-primary); }
      .lc-bad { color: var(--dsw-alias-state-error-primary); }
      .lc-track {
        display: flex; height: 6px; margin-top: 7px;
        border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-border-l1);
      }
      .lc-seg { height: 100%; min-width: 0; }
      .lc-segOk { background: var(--dsw-alias-state-success-primary); }
      .lc-segBad { background: var(--dsw-alias-state-error-primary); }
      .lc-recentRow {
        display: flex; align-items: baseline; gap: 8px;
        padding: 7px 10px; border-radius: 8px; font-size: 12px;
      }
      .lc-recentRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .lc-recentTime {
        flex: none; width: 38px;
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: var(--dsw-alias-label-tertiary);
      }
      .lc-recentRoute {
        min-width: 0; flex: 1 1 auto;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--dsw-alias-label-secondary);
      }
      .lc-recentState { flex: none; }
      .lc-empty {
        margin: 0;
        padding: 28px 12px;
        text-align: center;
        color: var(--dsw-alias-label-tertiary);
        font-size: 14px;
        line-height: 1.5;
      }
      @media (max-width: 720px) {
        .lc-page { width: calc(100vw - 24px); padding: 16px; }
        .lc-board {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(0, 1.4fr) minmax(0, 0.6fr);
        }
        .lc-main, .lc-side { height: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .lc-trigger, .lc-iconButton, .lc-rangeButton { transition: none; }
      }
    `;

    /** Continue glyph: an arrow that turns back into the line it left. */
    function ContinueIcon(props) {
      const size = props.size;
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M2.6 8h7.2',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M7.6 5.4 L10.4 8 L7.6 10.6',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M13.4 4.2v7.6',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
        strokeOpacity: '0.4',
      }));
    }

    /** Close glyph, kept local so the plugin does not import host controls. */
    function CloseIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M4.2 4.2 L11.8 11.8 M11.8 4.2 L4.2 11.8',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
      }));
    }

    /**
     * @param value - a candidate count.
     * @returns the value when it is a non-negative finite number, else 0.
     */
    function count(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    }

    /** Date ranges shown on the range row, this process first. */
    const RANGE_IDS = ['boot', 'h24', 'd7', 'all'];

    /**
     * One window from the host payload.
     * @param payload - the route body, or null.
     * @param rangeId - `boot`, `h24`, `d7`, or `all`.
     * @returns that window, or a zero view.
     */
    function rangeView(payload, rangeId) {
      const view = payload?.ranges?.[rangeId];
      if (view === null || view === undefined || typeof view !== 'object') {
        return { count: 0, turns: 0, recovered: 0, failed: 0, maxAttempt: 0, routes: [] };
      }
      return view;
    }

    /**
     * Recovery share of one window, as a percentage text.
     * @param view - one window.
     * @returns percentage text, or null when the window touched no turn.
     */
    function rateOf(view) {
      const turns = count(view.turns);
      if (turns <= 0) return null;
      return String(Math.round((count(view.recovered) / turns) * 100));
    }

    /**
     * Horizontal bar for one route. Green is recovered turns, red is not.
     * @param route - one route row.
     * @returns the track element, or null when the row touched no turn.
     */
    function recoveryBar(route) {
      const turns = count(route.turns);
      if (turns <= 0) return null;
      const recovered = count(route.recovered);
      const width = (part) => `${(part / turns) * 100}%`;
      return h('div', { className: 'lc-track' },
        h('span', { className: 'lc-seg lc-segOk', style: { width: width(recovered) } }),
        h('span', { className: 'lc-seg lc-segBad', style: { width: width(turns - recovered) } }));
    }

    /**
     * One route row: route name, injection count, turns, recovery, and the bar.
     * @param props.route - one route row from the selected window.
     * @param props.t - the `llm-continue` dictionary.
     */
    function RouteRow(props) {
      const route = props.route;
      const t = props.t;
      const rate = rateOf({ turns: route.turns, recovered: route.recovered });
      const name = route.provider === '' ? t('unknown') : route.provider;
      const model = route.model === '' ? t('unknown') : route.model;
      return h('div', { className: 'lc-route' },
        h('p', { className: 'lc-routeName' },
          h('span', { className: 'lc-routeProvider' }, name),
          h('span', { className: 'lc-routeProvider' }, '/'),
          h('span', { className: 'lc-routeModel' }, model)),
        h('div', { className: 'lc-facts' },
          h('span', null, t('injections'), ' ',
            h('span', { className: 'lc-factValue' }, String(count(route.count)))),
          h('span', null, t('turns'), ' ',
            h('span', { className: 'lc-factValue' }, String(count(route.turns)))),
          h('span', null, t('recovered'), ' ',
            h('span', { className: 'lc-factValue lc-ok' }, String(count(route.recovered)))),
          h('span', null, t('failed'), ' ',
            h('span', { className: count(route.failed) > 0 ? 'lc-factValue lc-bad' : 'lc-factValue' }, String(count(route.failed)))),
          rate === null ? null : h('span', null, t('rate'), ' ',
            h('span', { className: 'lc-factValue' }, `${rate}%`)),
          count(route.maxAttempt) > 1 ? h('span', null, t('maxAttempt'), ' ',
            h('span', { className: 'lc-factValue' }, String(count(route.maxAttempt)))) : null),
        recoveryBar(route));
    }

    /**
     * The route table for the selected window, newest count first.
     * @param props.view - the selected window.
     * @param props.t - the `llm-continue` dictionary.
     */
    function RouteList(props) {
      const routes = Array.isArray(props.view.routes) ? props.view.routes : [];
      if (routes.length === 0) return h('p', { className: 'lc-empty' }, props.t('empty'));
      return h('div', null,
        h('div', { className: 'lc-head' },
          h('span', null, props.t('models')),
          h('span', { className: 'lc-factValue' }, props.t('modelCount', { count: String(routes.length) }))),
        routes.map(route => h(RouteRow, {
          key: `${route.provider}\u0000${route.model}`,
          route,
          t: props.t,
        })));
    }

    /**
     * The most recent records, newest first.
     * @param props.records - the recent rows.
     * @param props.t - the `llm-continue` dictionary.
     */
    function RecentList(props) {
      const rows = Array.isArray(props.records) ? props.records : [];
      if (rows.length === 0) return h('p', { className: 'lc-empty' }, props.t('recentEmpty'));
      return h('div', null, rows.map((row, index) => {
        const stamp = new Date(count(row.time));
        const clock = Number.isFinite(stamp.getTime())
          ? `${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
          : '--:--';
        const route = `${row.provider === '' ? props.t('unknown') : row.provider} / ${row.model === '' ? props.t('unknown') : row.model}`;
        return h('div', { key: `${row.seq ?? index}`, className: 'lc-recentRow' },
          h('span', { className: 'lc-recentTime' }, clock),
          h('span', { className: 'lc-recentRoute' },
            route, ' · ', props.t('attemptBrief', { attempt: String(count(row.attempt)) }),
            ' · ', props.t('turnBrief', { turn: String(count(row.turn)) })),
          h('span', { className: row.recovered ? 'lc-recentState lc-ok' : 'lc-recentState lc-bad' },
            row.recovered ? props.t('recovered') : props.t('failed')));
      }));
    }

    /** Route the Host uses to publish the summed view. */
    const LEDGER_PATH = '/api/llm.continue';

    /** Recent-record count the side card asks for. */
    const RECENT_LIMIT = 6;

    /**
     * Dock icon. `order: 1` places it after the built-in pills and the context
     * ring, in the same row as the other personal icons.
     * @param props.useProjection - session projection seat.
     * @param props.t - the `llm-continue` dictionary.
     */
    function ContinueMeter(props) {
      const project = props.useProjection;
      const t = props.t;
      const [open, setOpen] = useState(false);
      const [range, setRange] = useState('boot');
      const [payload, setPayload] = useState(null);
      const closeRef = useRef(null);
      void project;

      useEffect(() => {
        if (!open) return undefined;
        let stopped = false;
        const pull = () => {
          fetch(LEDGER_PATH, { headers: { accept: 'application/json' } })
            .then(response => (response.ok ? response.json() : null))
            .then(body => {
              if (!stopped && body !== null && typeof body === 'object') setPayload(body);
            })
            .catch(() => {});
        };
        pull();
        const timer = setInterval(pull, 2000);
        return () => {
          stopped = true;
          clearInterval(timer);
        };
      }, [open]);

      useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        closeRef.current?.focus();
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('keydown', onKey);
          if (previous instanceof HTMLElement) previous.focus();
        };
      }, [open]);

      if (typeof t !== 'function') return null;
      const view = rangeView(payload, range);
      const summary = t('summary', {
        count: String(count(view.count)),
        turns: String(count(view.turns)),
        recovered: String(count(view.recovered)),
      });

      const dialog = open
        ? createPortal(h('div', {
          className: 'lc-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOpen(false);
          },
        },
        h('div', {
          className: 'lc-page',
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('title'),
          'data-dsh-plugin': 'llm-continue',
          'data-dsh-part': 'page',
        },
        h('div', { className: 'lc-header' },
          h('div', { className: 'lc-heading' },
            h(ContinueIcon, { size: 18 }),
            h('h3', { className: 'lc-title' }, t('title'))),
          h('button', {
            ref: closeRef,
            type: 'button',
            className: 'lc-iconButton',
            'aria-label': t('close'),
            title: t('close'),
            onClick: () => { setOpen(false); },
          }, h(CloseIcon))),
        h('div', { className: 'lc-board' },
          h('div', { className: 'lc-main' },
            h('div', {
              className: 'lc-range',
              role: 'tablist',
              'aria-label': t('ranges'),
            }, RANGE_IDS.map(id => h('button', {
              key: id,
              type: 'button',
              className: 'lc-rangeButton',
              role: 'tab',
              'aria-selected': range === id,
              onClick: () => { setRange(id); },
            }, t(id)))),
            h('p', { className: 'lc-summary' }, summary),
            h('section', {
              className: 'lc-card',
              'data-dsh-plugin': 'llm-continue',
              'data-dsh-part': 'routes',
            },
            h('h4', { className: 'lc-cardTitle' }, t('models')),
            h('div', { className: 'lc-cardBody' },
              h('p', { className: 'lc-viewNote' }, t('modelNote', { scope: t(`scope${range === 'boot' ? 'Boot' : range === 'h24' ? 'H24' : range === 'd7' ? 'D7' : 'All'}`) })),
              h(RouteList, { view, t }))))),
          h('div', { className: 'lc-card lc-side' },
            h('h4', { className: 'lc-cardTitle' }, t('recent')),
            h('div', { className: 'lc-cardBody' },
              h(RecentList, { records: payload?.recent ?? [], t }))))),
        document.body)
        : null;

      return h('span', { className: 'lc-slot' },
        h('button', {
          type: 'button',
          className: 'lc-trigger',
          'aria-label': t('trigger'),
          title: t('trigger'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'data-dsh-plugin': 'llm-continue',
          'data-dsh-part': 'trigger',
          onClick: () => { setOpen(true); },
        }, h(ContinueIcon, { size: 16 })),
        dialog);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-continue: dictionaries');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = CSS;
          document.head.append(style);
          return () => { style.remove(); };
        }, 'llm-continue: styles');
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'llm-continue',
          order: 20,
          locale: NS,
        }, ContinueMeter));
      },
    };
  },
});
