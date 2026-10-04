/**
 * Browser half of dsh-usage-meter.
 *
 * Leaves the composer's own statistics pills and context ring alone. Adds one
 * icon after that row; the icon opens a usage page for the current Session.
 * The main card shows the detail for the selected total. Summary buttons under
 * that card stay put, share one size, and each shows a few figures; choosing
 * one only changes the detail. The page keeps one width and height either way.
 * With no stored total yet, every field is zero.
 * Compaction token usage is included in the running total and also kept as its
 * own total. This Session's report sits in the narrow card and still comes
 * from its own projections.
 * `sessionStats` supplies turns, steps, and decode speed. `tokenUsage` supplies
 * the billing buckets and cache hit. A subagent is a different Session, so its
 * figures appear on its own screen.
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
      session: '这个会话',
      empty: '这个会话还没有用量。',
      ledger: '累计',
      ledgerNote: '自开始记录以来的全部调用。合计含压缩，轮次、步骤和输出速度不含压缩。',
      turns: '轮次',
      steps: '步骤',
      compaction: '压缩',
      compactionNote: '只累计压缩。这些用量也已加进累计，轮次、步骤和输出速度不含压缩。',
      views: '用量视图',
      ledgerBrief: '{turns} 轮 · {steps} 步',
      countBrief: '{count} 次',
      count: '次数',
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
      tokens: '{count} tok',
    };
    const en = {
      trigger: 'Usage details',
      title: 'Usage',
      close: 'Close',
      session: 'This session',
      empty: 'This session has no usage yet.',
      ledger: 'Running total',
      ledgerNote: 'Every call since recording started. The total includes compaction; turns, steps, and output speed do not.',
      turns: 'Turns',
      steps: 'Steps',
      compaction: 'Compaction',
      compactionNote: 'Compaction only. These tokens are also in the running total. Turns, steps, and output speed do not include compaction.',
      views: 'Usage views',
      ledgerBrief: '{turns} turns · {steps} steps',
      countBrief: '{count} times',
      count: 'Count',
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
      .um-page {
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
      .um-board {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(200px, 0.62fr);
        flex: 1 1 auto; min-height: 0;
        gap: 16px;
        align-items: stretch;
        margin-top: 20px;
      }
      .um-card {
        display: flex; flex-direction: column;
        min-width: 0; min-height: 0;
        padding: 8px;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
      }
      .um-cardBody {
        flex: 1 1 auto; min-height: 0;
        overflow: auto;
        --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
        --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
        --dsh-scrollbar-track-margin: 8px;
      }
      .um-cardTitle {
        margin: 0;
        padding: 8px 10px 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
      }
      .um-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; padding: 0 4px;
      }
      .um-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .um-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .um-iconButton {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border: none; border-radius: 8px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .um-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .um-iconButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .um-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 11px 12px; border-radius: 8px; font-size: 14px;
      }
      .um-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .um-name { color: var(--dsw-alias-label-secondary); }
      .um-value {
        color: var(--dsw-alias-label-primary);
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 14px;
      }
      .um-empty {
        margin: 0;
        padding: 28px 12px;
        text-align: center;
        color: var(--dsw-alias-label-tertiary);
        font-size: 14px;
        line-height: 1.5;
      }
      .um-session .um-cardTitle { font-size: 12px; }
      .um-session .um-row { padding: 7px 10px; font-size: 12px; }
      .um-session .um-value { font-size: 12px; }
      .um-session .um-empty { padding: 16px 10px; font-size: 12px; }
      .um-ledger .um-row { padding: 12px 14px; font-size: 15px; }
      .um-ledger .um-value { font-size: 15px; }
      .um-main {
        min-width: 0; min-height: 0; height: 100%;
        display: flex; flex-direction: column; gap: 12px;
      }
      .um-ledger { flex: 1 1 auto; }
      .um-session { height: 100%; }
      .um-switch {
        display: grid;
        flex: none;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        gap: 8px;
      }
      .um-switchButton {
        display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
        gap: 2px; box-sizing: border-box; width: 100%; min-width: 0; min-height: 78px;
        margin: 0; padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
        background: transparent; color: var(--dsw-alias-label-primary);
        cursor: pointer; text-align: left;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      .um-switchButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .um-switchButton[aria-selected='true'] {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .um-switchButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .um-switchName {
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary);
      }
      .um-switchTotal {
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: 15px; font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: var(--dsw-alias-label-primary);
      }
      .um-switchMeta {
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: 12px; color: var(--dsw-alias-label-tertiary);
      }
      .um-viewNote {
        box-sizing: border-box;
        height: 66px; margin: 0; padding: 4px 12px 0; overflow: hidden;
        color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5;
      }
      @media (max-width: 720px) {
        .um-page { width: calc(100vw - 24px); padding: 16px; }
        .um-board {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(0, 1.4fr) minmax(0, 0.6fr);
        }
        .um-main, .um-session { height: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .um-trigger, .um-iconButton, .um-switchButton { transition: none; }
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
     * Rows for the session card. Missing buckets are omitted rather than shown as zero.
     * @param stats - `sessionStats`, or absent.
     * @param usage - `tokenUsage`, or absent.
     * @param t - the `usage-meter` dictionary.
     * @returns label/value pairs, empty when this session has nothing to report.
     */
    function rowsFor(stats, usage, t) {
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
      return rows;
    }

    /** Route the Host uses to publish the running total. */
    const LEDGER_PATH = '/api/usage.meter';

    /**
     * Ledger rows. A missing record is all zeros, and cache write stays visible
     * at zero so the card shows every field the Host keeps.
     * @param record - the stored view, or null before the first successful read.
     * @param t - the `usage-meter` dictionary.
     * @returns the running total.
     */
    function ledgerRows(record, t) {
      const turns = count(record?.turns) ?? 0;
      const steps = count(record?.steps) ?? 0;
      const decodeMs = count(record?.decodeMs) ?? 0;
      const decodeTokens = count(record?.decodeTokens) ?? 0;
      const uncached = count(record?.uncachedInputTokens) ?? 0;
      const read = count(record?.cacheReadTokens) ?? 0;
      const write = count(record?.cacheWriteTokens) ?? 0;
      const output = count(record?.outputTokens) ?? 0;
      const billed = uncached + read + write;
      const speed = decodeMs > 0 ? formatSpeed(decodeTokens / (decodeMs / 1000)) : '0';
      const tokens = (value) => t('tokens', { count: formatExact(value) });
      return [
        { key: 'turns', name: t('turns'), value: formatExact(turns) },
        { key: 'steps', name: t('steps'), value: formatExact(steps) },
        { key: 'speed', name: t('speed'), value: t('speedValue', { tps: speed }) },
        { key: 'total', name: t('total'), value: t('totalValue', { count: formatExact(billed + output) }) },
        { key: 'input', name: t('input'), value: tokens(uncached) },
        { key: 'cacheRead', name: t('cacheRead'), value: tokens(read) },
        { key: 'cacheWrite', name: t('cacheWrite'), value: tokens(write) },
        { key: 'output', name: t('output'), value: tokens(output) },
        { key: 'cacheHit', name: t('cacheHit'), value: t('cacheHitValue', { percent: cacheHit(read, billed) ?? '0' }) },
      ];
    }

    /**
     * @param rows - label/value pairs.
     * @returns one row element per pair.
     */
    function rowList(rows) {
      return rows.map(row => h('div', { key: row.key, className: 'um-row' },
        h('span', { className: 'um-name' }, row.name),
        h('span', { className: 'um-value' }, row.value)));
    }

    /**
     * Compaction rows. A missing total is all zeros.
     * @param record - the stored view, or null before the first successful read.
     * @param t - the `usage-meter` dictionary.
     * @returns the compaction total.
     */
    function compactionRows(record, t) {
      const compaction = record?.compaction;
      const times = count(compaction?.count) ?? 0;
      const uncached = count(compaction?.uncachedInputTokens) ?? 0;
      const read = count(compaction?.cacheReadTokens) ?? 0;
      const write = count(compaction?.cacheWriteTokens) ?? 0;
      const output = count(compaction?.outputTokens) ?? 0;
      const billed = uncached + read + write;
      const tokens = (value) => t('tokens', { count: formatExact(value) });
      return [
        { key: 'count', name: t('count'), value: formatExact(times) },
        { key: 'total', name: t('total'), value: t('totalValue', { count: formatExact(billed + output) }) },
        { key: 'input', name: t('input'), value: tokens(uncached) },
        { key: 'cacheRead', name: t('cacheRead'), value: tokens(read) },
        { key: 'cacheWrite', name: t('cacheWrite'), value: tokens(write) },
        { key: 'output', name: t('output'), value: tokens(output) },
        { key: 'cacheHit', name: t('cacheHit'), value: t('cacheHitValue', { percent: cacheHit(read, billed) ?? '0' }) },
      ];
    }

    /**
     * Billed tokens plus output. Missing buckets count as zero.
     * @param source - a ledger or compaction total, or absent.
     * @returns the combined token count.
     */
    function tokenTotal(source) {
      const uncached = count(source?.uncachedInputTokens) ?? 0;
      const read = count(source?.cacheReadTokens) ?? 0;
      const write = count(source?.cacheWriteTokens) ?? 0;
      const output = count(source?.outputTokens) ?? 0;
      return uncached + read + write + output;
    }

    /**
     * Summary buttons for the main card. Each button keeps the same size and
     * stays in place; selecting one only changes which detail the card shows.
     * @param record - the stored view, or null before the first successful read.
     * @param t - the `usage-meter` dictionary.
     * @param view - `ledger` or `compaction`.
     * @param onSelect - chooses the detail.
     * @returns the button row.
     */
    function viewSwitch(record, t, view, onSelect) {
      const turns = count(record?.turns) ?? 0;
      const steps = count(record?.steps) ?? 0;
      const compaction = record?.compaction;
      const items = [
        {
          id: 'ledger',
          name: t('ledger'),
          total: t('totalValue', { count: formatExact(tokenTotal(record)) }),
          meta: t('ledgerBrief', { turns: formatExact(turns), steps: formatExact(steps) }),
        },
        {
          id: 'compaction',
          name: t('compaction'),
          total: t('totalValue', { count: formatExact(tokenTotal(compaction)) }),
          meta: t('countBrief', { count: formatExact(count(compaction?.count) ?? 0) }),
        },
      ];
      return h('div', {
        className: 'um-switch',
        role: 'tablist',
        'aria-label': t('views'),
      }, items.map(item => h('button', {
        key: item.id,
        type: 'button',
        className: 'um-switchButton',
        role: 'tab',
        'aria-selected': view === item.id,
        onClick: () => { onSelect(item.id); },
      },
      h('span', { className: 'um-switchName' }, item.name),
      h('span', { className: 'um-switchTotal' }, item.total),
      h('span', { className: 'um-switchMeta' }, item.meta))));
    }

    /**
     * One labeled report card. The body is the row list, or the empty line.
     * @param props.title - card heading.
     * @param props.part - `data-dsh-part` value.
     * @param props.className - extra card class.
     * @param props.children - card body.
     */
    function ReportCard(props) {
      return h('section', {
        className: props.className,
        'data-dsh-plugin': 'usage-meter',
        'data-dsh-part': props.part,
      },
      h('h4', { className: 'um-cardTitle' }, props.title),
      h('div', { className: 'um-cardBody' }, props.children));
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
      const [view, setView] = useState('ledger');
      const [ledger, setLedger] = useState(null);
      const dismiss = () => {
        setOpen(false);
        setView('ledger');
      };
      const triggerRef = useRef(null);
      const closeRef = useRef(null);
      const stats = typeof project === 'function' ? project('sessionStats') : undefined;
      const usage = typeof project === 'function' ? project('tokenUsage') : undefined;
      const rows = typeof t === 'function' ? rowsFor(stats, usage, t) : [];

      useEffect(() => {
        if (!open) return undefined;
        let stopped = false;
        const pull = () => {
          fetch(LEDGER_PATH, { headers: { accept: 'application/json' } })
            .then(response => (response.ok ? response.json() : null))
            .then(body => {
              if (!stopped && body !== null && typeof body === 'object') setLedger(body);
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
          if (event.key === 'Escape') dismiss();
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
            if (event.target === event.currentTarget) dismiss();
          },
        },
        h('div', {
          className: 'um-page',
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('title'),
          'data-dsh-plugin': 'usage-meter',
          'data-dsh-part': 'page',
        },
        h('div', { className: 'um-header' },
          h('div', { className: 'um-heading' },
            h(MeterIcon, { size: 18 }),
            h('h3', { className: 'um-title' }, t('title'))),
          h('button', {
            ref: closeRef,
            type: 'button',
            className: 'um-iconButton',
            'aria-label': t('close'),
            title: t('close'),
            onClick: () => { dismiss(); },
          }, h(CloseIcon))),
        h('div', { className: 'um-board' },
          h('div', { className: 'um-main' },
            h(ReportCard, {
              title: view === 'compaction' ? t('compaction') : t('ledger'),
              part: view === 'compaction' ? 'compactions' : 'ledger',
              className: 'um-card um-ledger',
            }, h('div', null,
              h('p', { className: 'um-viewNote' }, t(view === 'compaction' ? 'compactionNote' : 'ledgerNote')),
              rowList(view === 'compaction' ? compactionRows(ledger, t) : ledgerRows(ledger, t)))),
            viewSwitch(ledger, t, view, setView)),
          h(ReportCard, {
            title: t('session'),
            part: 'session-card',
            className: 'um-card um-session',
          }, rows.length === 0
            ? h('p', { className: 'um-empty' }, t('empty'))
            : rowList(rows))))),
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
