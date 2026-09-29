/**
 * Browser half of dsh-usage-meter.
 *
 * Leaves the composer's own statistics pills and context ring alone. Adds one
 * icon after that row; the icon opens a usage card for the current Session.
 * `sessionStats` supplies turns, steps, and decode speed. `tokenUsage` supplies
 * the billing buckets and cache hit. `contextPressure` supplies occupancy.
 * A subagent is a different Session, so its figures appear on its own screen.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-meter',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NS = 'usage-meter';

    const zh = {
      trigger: '用量详情',
      title: '用量',
      close: '关闭',
      empty: '这个会话还没有用量。',
      turns: '轮次',
      steps: '步骤',
      speed: '输出速度',
      speedValue: '{tps} tok/s',
      total: '合计',
      totalValue: '{count} tok',
      input: '未缓存输入',
      cacheRead: '缓存读取',
      cacheWrite: '缓存写入',
      output: '输出',
      cacheHit: '缓存命中',
      cacheHitValue: '{percent}%',
      context: '上下文',
      contextValue: '{percent}%',
      tokens: '{count} tok',
    };
    const en = {
      trigger: 'Usage details',
      title: 'Usage',
      close: 'Close',
      empty: 'This session has no usage yet.',
      turns: 'Turns',
      steps: 'Steps',
      speed: 'Output speed',
      speedValue: '{tps} tok/s',
      total: 'Total',
      totalValue: '{count} tok',
      input: 'Uncached input',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      output: 'Output',
      cacheHit: 'Cache hit',
      cacheHitValue: '{percent}%',
      context: 'Context',
      contextValue: '{percent}%',
      tokens: '{count} tok',
    };

    const CSS = `
      .um-slot { order: 1; display: inline-flex; flex: none; }
      .um-trigger {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; padding: 0;
        border: none; border-radius: 6px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .um-trigger:hover,
      .um-trigger[aria-expanded='true'] {
        background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-primary);
      }
      .um-trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .um-backdrop {
        position: fixed; inset: 0; z-index: 1100;
        display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-2);
      }
      .um-card {
        width: min(380px, calc(100% - 32px));
        padding: 16px 16px 12px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);
        color: var(--dsw-alias-label-primary);
      }
      .um-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; padding: 0 4px;
      }
      .um-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .um-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .um-iconButton {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border: none; border-radius: 8px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .um-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .um-iconButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .um-box {
        margin-top: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        padding: 4px;
      }
      .um-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 7px 8px; border-radius: 8px; font-size: 12px;
      }
      .um-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .um-name { color: var(--dsw-alias-label-secondary); }
      .um-value {
        color: var(--dsw-alias-label-primary);
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .um-empty { padding: 20px 10px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      @media (prefers-reduced-motion: reduce) {
        .um-trigger, .um-iconButton { transition: none; }
      }
    `;

    /** Speedometer mark for the dock button and the card title. */
    function MeterIcon(props) {
      const size = props.size;
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M3.15 11.35a5.15 5.15 0 1 1 9.7 0',
        stroke: 'currentColor',
        strokeOpacity: '0.28',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M3.15 11.35a5.15 5.15 0 0 1 8.15-4.05',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M8 10.15 L11.15 6.55',
        stroke: 'currentColor',
        strokeWidth: '1.5',
        strokeLinecap: 'round',
      }),
      h('circle', { cx: '8', cy: '10.15', r: '1.2', fill: 'currentColor' }));
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
     * @param value - a projection field.
     * @returns the value when it is a non-negative finite number.
     */
    function count(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    }

    /**
     * Group an exact token count.
     * @param value - a non-negative finite count.
     * @returns digits grouped by three.
     */
    function formatExact(value) {
      const digits = String(Math.round(value));
      const groups = [];
      for (let end = digits.length; end > 0; end -= 3) {
        groups.unshift(digits.slice(Math.max(0, end - 3), end));
      }
      return groups.join(',');
    }

    /**
     * Whole tokens from ten up, one decimal below.
     * @param tps - tokens per second.
     * @returns the display number, without a unit.
     */
    function formatSpeed(tps) {
      const clamped = Math.max(0, tps);
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
    }

    /**
     * Cache-read share of billed prompt input. A partial hit never rounds up to 100.
     * @param read - cache-read tokens.
     * @param billed - uncached input plus cache read and cache write.
     * @returns percentage text, or null when there is no billed input.
     */
    function cacheHit(read, billed) {
      if (billed <= 0) return null;
      if (read >= billed) return '100';
      const rounded = Math.round((read / billed) * 100);
      return String(rounded >= 100 ? 99 : rounded);
    }

    /**
     * @param pressure - the `contextPressure` projection.
     * @returns occupancy percent, or null until both the numerator and the window exist.
     */
    function occupancy(pressure) {
      if (pressure === null || pressure === undefined) return null;
      const used = count(pressure.projectedTokens) ?? count(pressure.pressureTokens);
      const window = count(pressure.contextWindow);
      if (used === null || window === null || window <= 0) return null;
      return Math.min(100, Math.round((used / window) * 100));
    }

    /**
     * Rows for the open card. Missing buckets are omitted rather than shown as zero.
     * @param stats - `sessionStats`, or absent.
     * @param usage - `tokenUsage`, or absent.
     * @param pressure - `contextPressure`, or absent.
     * @param t - the `usage-meter` dictionary.
     * @returns label/value pairs, empty when this session has nothing to report.
     */
    function rowsFor(stats, usage, pressure, t) {
      const rows = [];
      if (stats !== null && stats !== undefined) {
        const turns = count(stats.turns);
        const steps = count(stats.steps);
        const decodeMs = count(stats.decodeMs);
        const decodeTokens = count(stats.decodeTokens);
        if (turns !== null) rows.push({ key: 'turns', name: t('turns'), value: formatExact(turns) });
        if (steps !== null) rows.push({ key: 'steps', name: t('steps'), value: formatExact(steps) });
        if (decodeMs !== null && decodeTokens !== null && decodeMs > 0) {
          rows.push({
            key: 'speed',
            name: t('speed'),
            value: t('speedValue', { tps: formatSpeed(decodeTokens / (decodeMs / 1000)) }),
          });
        }
      }
      if (usage !== null && usage !== undefined) {
        const uncached = count(usage.uncachedInputTokens);
        const read = count(usage.cacheReadTokens);
        const write = count(usage.cacheWriteTokens);
        const output = count(usage.outputTokens);
        if (uncached !== null && read !== null && write !== null && output !== null) {
          const billed = uncached + read + write;
          rows.push({
            key: 'total',
            name: t('total'),
            value: t('totalValue', { count: formatExact(billed + output) }),
          });
          rows.push({ key: 'input', name: t('input'), value: t('tokens', { count: formatExact(uncached) }) });
          rows.push({ key: 'cacheRead', name: t('cacheRead'), value: t('tokens', { count: formatExact(read) }) });
          if (write > 0) {
            rows.push({ key: 'cacheWrite', name: t('cacheWrite'), value: t('tokens', { count: formatExact(write) }) });
          }
          rows.push({ key: 'output', name: t('output'), value: t('tokens', { count: formatExact(output) }) });
          const hit = cacheHit(read, billed);
          if (hit !== null) rows.push({ key: 'cacheHit', name: t('cacheHit'), value: t('cacheHitValue', { percent: hit }) });
        }
      }
      const percent = occupancy(pressure);
      if (percent !== null) {
        rows.push({ key: 'context', name: t('context'), value: t('contextValue', { percent }) });
      }
      return rows;
    }

    /**
     * Dock icon. `order: 1` places it after the built-in pills and the context ring,
     * which stay at the flex default.
     * @param props.useProjection - session projection seat.
     * @param props.t - the `usage-meter` dictionary.
     */
    function UsageMeter(props) {
      const project = props.useProjection;
      const t = props.t;
      const [open, setOpen] = useState(false);
      const triggerRef = useRef(null);
      const closeRef = useRef(null);
      const stats = typeof project === 'function' ? project('sessionStats') : undefined;
      const usage = typeof project === 'function' ? project('tokenUsage') : undefined;
      const pressure = typeof project === 'function' ? project('contextPressure') : undefined;
      const rows = typeof t === 'function' ? rowsFor(stats, usage, pressure, t) : [];

      useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        closeRef.current?.focus();
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('keydown', onKey);
          if (previous instanceof HTMLElement) previous.focus();
        };
      }, [open]);

      if (typeof t !== 'function') return null;

      const dialog = open
        ? createPortal(h('div', {
          className: 'um-backdrop',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOpen(false);
          },
        },
        h('div', {
          className: 'um-card',
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('title'),
          'data-dsh-plugin': 'usage-meter',
          'data-dsh-part': 'dialog',
        },
        h('div', { className: 'um-header' },
          h('div', { className: 'um-heading' },
            h(MeterIcon, { size: 16 }),
            h('h3', { className: 'um-title' }, t('title'))),
          h('button', {
            ref: closeRef,
            type: 'button',
            className: 'um-iconButton',
            'aria-label': t('close'),
            title: t('close'),
            onClick: () => { setOpen(false); },
          }, h(CloseIcon))),
        rows.length === 0
          ? h('div', { className: 'um-empty' }, t('empty'))
          : h('div', { className: 'um-box' },
            rows.map(row => h('div', { key: row.key, className: 'um-row' },
              h('span', { className: 'um-name' }, row.name),
              h('span', { className: 'um-value' }, row.value)))))),
        document.body)
        : null;

      return h('span', { className: 'um-slot' },
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'um-trigger',
          'aria-label': t('trigger'),
          title: t('trigger'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'data-dsh-plugin': 'usage-meter',
          'data-dsh-part': 'trigger',
          onClick: () => { setOpen(true); },
        }, h(MeterIcon, { size: 16 })),
        dialog);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-meter: dictionaries');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = CSS;
          document.head.append(style);
          return () => { style.remove(); };
        }, 'usage-meter: styles');
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'usage-meter',
          order: 10,
          locale: NS,
        }, UsageMeter));
      },
    };
  },
});
