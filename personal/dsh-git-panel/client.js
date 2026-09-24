/**
 * Browser half of dsh-git-panel.
 *
 * Registers one compact control in the composer tool row. Opening it reads the
 * Host's read-only Git route and renders the branch, its upstream tracking
 * state, the uncommitted files, and the commit history. Nothing here writes to
 * a Session.
 *
 * The panel follows the git-graph dialog of the `dsh-web` plugin family: a
 * 760px overlay card, a title with a `N commits · M lanes` subtitle, bordered
 * inset cards around each scrolled list, hoverable rows, filled ref pills, and
 * a full-width load-more control at the end of the history.
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-panel',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { Button, Modal } = primitives;
    const { IconBranchOutlineRegular, IconCloseOutlineRegular, IconRefreshOutlineRegular } = primitives;
    const h = React.createElement;
    const { useCallback, useRef, useState } = React;

    const NS = 'git-panel';
    const ROUTE = 'api/git.panel';
    /** Page size of the first history read. */
    const INITIAL_LIMIT = 200;
    /** Commits one "load more" adds. */
    const PAGE_STEP = 100;

    const zh = {
      trigger: 'Git 状态',
      title: 'Git 面板',
      close: '关闭',
      refresh: '刷新',
      loading: '正在读取 Git 状态…',
      notGit: '当前工作目录不是 Git 仓库。',
      emptyRepo: '仓库还没有任何提交。',
      noCommits: '没有可显示的提交。',
      clean: '工作区干净',
      dirty: '{count} 个未提交的更改',
      detached: '游离 HEAD',
      noUpstream: '未设置上游',
      ahead: '领先 {count}',
      behind: '落后 {count}',
      subtitle: '{commits} 个提交 · {lanes} 条泳道',
      changesTitle: '未提交的文件 · {count}',
      loadMore: '加载更多',
      historyFailed: '提交历史读取失败。',
      kindUntracked: '未跟踪',
      kindStaged: '已暂存',
      kindUnstaged: '未暂存',
      kindConflicted: '冲突',
      truncated: '仅显示前 {count} 个文件。',
      timeJustNow: '刚刚',
      timeMinutes: '{count} 分钟前',
      timeHours: '{count} 小时前',
      timeDays: '{count} 天前',
      errorUnavailable: 'Git 状态不可用。',
      errorInternal: '读取 Git 状态失败。',
      noSession: '当前会话没有工作目录。',
      panelFailed: '面板渲染失败，已保留图标。详细信息见浏览器控制台。',
      staleHost: 'Host 半仍是旧版本，提交历史不可用。重启 dsh web 后即可显示。',
    };
    const en = {
      trigger: 'Git status',
      title: 'Git panel',
      close: 'Close',
      refresh: 'Refresh',
      loading: 'Reading Git state…',
      notGit: 'The working directory is not a Git repository.',
      emptyRepo: 'The repository has no commits yet.',
      noCommits: 'No commits to show.',
      clean: 'Working tree clean',
      dirty: '{count} uncommitted changes',
      detached: 'Detached HEAD',
      noUpstream: 'No upstream',
      ahead: '{count} ahead',
      behind: '{count} behind',
      subtitle: '{commits} commits · {lanes} lanes',
      changesTitle: 'Uncommitted files · {count}',
      loadMore: 'Load more',
      historyFailed: 'Reading the commit history failed.',
      kindUntracked: 'untracked',
      kindStaged: 'staged',
      kindUnstaged: 'unstaged',
      kindConflicted: 'conflicted',
      truncated: 'Showing the first {count} files only.',
      timeJustNow: 'just now',
      timeMinutes: '{count} min ago',
      timeHours: '{count} h ago',
      timeDays: '{count} d ago',
      errorUnavailable: 'Git status is unavailable.',
      errorInternal: 'Reading Git status failed.',
      noSession: 'This session has no working directory.',
      panelFailed: 'The panel failed to render. The icon stays available; see the browser console for the error.',
      staleHost: 'The Host half is still the previous version, so the history is unavailable. Restart dsh web.',
    };

    /**
     * Scoped to this plugin's own class names, so no shipped rule is touched.
     * The doubled class on the dialog is deliberate: the Modal's own width,
     * padding, and surface rules are single-class selectors, and these must win
     * regardless of which stylesheet the browser applied first.
     */
    const CSS = `
      .gp-dialog.gp-dialog {
        width: min(760px, 100%);
        max-height: min(76vh, 720px);
        gap: 0;
        padding: 16px 16px 12px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);
      }
      .gp-card { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
      .gp-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; padding: 0 4px;
      }
      .gp-heading { min-width: 0; }
      .gp-title {
        margin: 0 0 2px; font-size: 15px; font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .gp-subtitle { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .gp-headerActions { flex: none; display: flex; align-items: center; gap: 2px; }
      .gp-iconButton {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border: none; border-radius: 8px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .gp-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .gp-iconButton:active { background: var(--dsw-alias-interactive-bg-active); }
      .gp-iconButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-iconButton:disabled { opacity: 0.55; cursor: not-allowed; }
      .gp-iconButton:disabled:hover { background: none; color: var(--dsw-alias-label-tertiary); }

      .gp-status {
        display: flex; flex-direction: column; gap: 5px;
        padding: 12px 4px 0; margin-bottom: 10px;
      }
      .gp-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .gp-branch {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px; color: var(--dsw-alias-label-primary); word-break: break-all;
      }
      .gp-muted { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .gp-dot { flex: none; width: 8px; height: 8px; border-radius: 4px; }

      /* flex: none — the section sizes to its capped list; letting it shrink
         would collapse it to nothing once the graph claims the dialog. */
      .gp-section { display: flex; flex-direction: column; flex: none; margin-bottom: 10px; }
      .gp-sectionTitle { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin: 0 4px 4px; }
      .gp-box { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 4px; }
      .gp-changesBox { max-height: 150px; overflow-y: auto; }
      .gp-changesBox::-webkit-scrollbar, .gp-graphRows::-webkit-scrollbar { width: 6px; }
      .gp-changesBox::-webkit-scrollbar-thumb, .gp-graphRows::-webkit-scrollbar-thumb {
        background: var(--dsw-alias-border-l2); border-radius: 3px;
      }
      .gp-changesBox::-webkit-scrollbar-track, .gp-graphRows::-webkit-scrollbar-track { background: transparent; }

      .gp-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; font-size: 12px; }
      .gp-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gp-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .gp-badge { flex: none; }
      .gp-old { color: var(--dsw-alias-label-tertiary); text-decoration: line-through; }
      .gp-filePath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .gp-graph { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 200px; }
      .gp-graphBox {
        display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 4px;
      }
      .gp-graphRows { flex: 1 1 auto; min-height: 0; overflow-y: auto; }

      .gp-commit { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; font-size: 12px; }
      .gp-commit:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gp-lanes {
        display: flex; flex: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px; line-height: 1.4;
        color: var(--dsw-alias-label-tertiary);
      }
      .gp-lane { display: inline-block; width: 13px; text-align: center; flex: none; }
      .gp-lane-node, .gp-lane-merge { color: var(--dsw-alias-brand-primary); font-weight: 700; }
      .gp-lane-pass { color: var(--dsw-alias-label-tertiary); }
      .gp-oid {
        flex: none; min-width: 58px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px; color: var(--dsw-alias-label-tertiary);
      }
      .gp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .gp-subject {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500;
      }
      .gp-meta {
        display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px;
        color: var(--dsw-alias-label-tertiary); font-size: 11px;
      }
      .gp-ref {
        flex: none; max-width: 120px; overflow: hidden; text-overflow: ellipsis;
        padding: 1px 6px; border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-secondary); font-size: 10px;
      }
      .gp-ref-head { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-button-contrast-fill); }
      .gp-ref-tag { font-style: italic; }

      .gp-more {
        display: block; width: 100%; margin-top: 4px; padding: 6px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
        background: none; color: var(--dsw-alias-label-secondary);
        cursor: pointer; font-size: 12px;
        transition: background-color 120ms ease;
      }
      .gp-more:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gp-more:active { background: var(--dsw-alias-interactive-bg-active); }
      .gp-more:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-more:disabled { opacity: 0.55; cursor: not-allowed; }
      .gp-more:disabled:hover { background: none; }

      .gp-empty { padding: 24px 10px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .gp-notice { padding: 6px 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .gp-error {
        margin: 4px; padding: 6px 10px; border-radius: 8px; font-size: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      @media (prefers-reduced-motion: reduce) {
        .gp-iconButton, .gp-more { transition: none; }
      }
    `;

    /** Lane glyph keys to their rendered character. */
    const GLYPH = { node: '\u25cf', merge: '\u25c6', pass: '\u2502', gap: ' ' };

    /** Glyph keys the renderer knows; anything else becomes a blank cell. */
    const GLYPH_KEYS = new Set(['node', 'merge', 'pass', 'gap']);

    /**
     * Normalize one response envelope into the value the panel renders.
     *
     * The panel crosses both a process boundary and a module generation to
     * reach this value, so a payload from a Host that has not reloaded yet is a
     * real case rather than a hypothetical one. Every field is coerced here and
     * the render code below trusts the result.
     * @param body - the parsed JSON body.
     * @returns the panel's own value, or null when the body is not one.
     */
    function normalize(body) {
      if (body === null || typeof body !== 'object' || body.ok !== true) return null;
      const value = body.value;
      if (value === null || typeof value !== 'object') return null;
      const num = raw => (Number.isFinite(raw) ? raw : 0);
      const counts = value.counts === null || typeof value.counts !== 'object' ? {} : value.counts;
      return {
        state: value.state === 'not-git' ? 'not-git' : value.state === 'empty' ? 'empty' : 'ready',
        branch: typeof value.branch === 'string' ? value.branch : null,
        upstream: typeof value.upstream === 'string' ? value.upstream : null,
        ahead: num(value.ahead),
        behind: num(value.behind),
        detached: value.detached === true,
        clean: value.clean === true,
        total: num(counts.total),
        changes: (Array.isArray(value.changes) ? value.changes : [])
          .filter(change => change !== null && typeof change === 'object' && typeof change.path === 'string')
          .map(change => ({
            path: change.path,
            oldPath: typeof change.oldPath === 'string' ? change.oldPath : null,
            index: typeof change.index === 'string' ? change.index : ' ',
            worktree: typeof change.worktree === 'string' ? change.worktree : ' ',
            kind: typeof change.kind === 'string' ? change.kind : 'unstaged',
          })),
        truncated: value.truncated === true,
        limit: Number.isFinite(value.limit) ? value.limit : INITIAL_LIMIT,
        commits: (Array.isArray(value.commits) ? value.commits : [])
          .filter(commit => commit !== null && typeof commit === 'object')
          .map(commit => ({
            oid: typeof commit.oid === 'string' ? commit.oid : '',
            subject: typeof commit.subject === 'string' ? commit.subject : '',
            author: typeof commit.author === 'string' ? commit.author : '',
            authorTime: num(commit.authorTime),
            refs: (Array.isArray(commit.refs) ? commit.refs : [])
              .filter(ref => ref !== null && typeof ref === 'object' && typeof ref.name === 'string')
              .map(ref => ({
                name: ref.name,
                kind: ref.kind === 'head' || ref.kind === 'tag' ? ref.kind : 'ref',
              })),
          })),
        lanes: (Array.isArray(value.lanes) ? value.lanes : [])
          .map(row => (Array.isArray(row) ? row : [])
            .map(glyph => (GLYPH_KEYS.has(glyph) ? glyph : 'gap'))),
        hasMore: value.hasMore === true,
        historyFailed: value.historyFailed === true,
        // A Host generation that predates this field answers without it. That is
        // a restart, not a failure, so it gets its own report.
        staleHost: !Array.isArray(value.commits),
      };
    }

    /**
     * Keeps a failed panel render inside the dialog.
     *
     * Without this the error reaches the slot renderer, which drops the whole
     * entry — taking the composer control with it.
     */
    class PanelBoundary extends React.Component {
      /** @param props - `children` is the panel and `fallback` the replacement. */
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      /** @returns the state that switches this subtree to its fallback. */
      static getDerivedStateFromError() {
        return { failed: true };
      }

      /**
       * Report the error the fallback is standing in for.
       * @param error - the render failure.
       */
      componentDidCatch(error) {
        console.error('[git-panel] panel render failed:', error);
      }

      /** @returns the panel, or the fallback once a render has failed. */
      render() {
        return this.state.failed ? this.props.fallback : this.props.children;
      }
    }

    /** Swatch color for one change bucket. */
    function kindColor(kind) {
      if (kind === 'untracked') return 'var(--dsw-alias-label-tertiary)';
      if (kind === 'staged') return 'var(--dsw-alias-state-success-primary)';
      if (kind === 'conflicted') return 'var(--dsw-alias-state-error-primary)';
      return 'var(--dsw-alias-state-warn-primary)';
    }

    /** Bucket key to its dictionary key. */
    function kindKey(kind) {
      return 'kind' + kind.charAt(0).toUpperCase() + kind.slice(1);
    }

    /** GitHub-style relative time, falling back to a plain date past 30 days. */
    function formatTime(seconds, t) {
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
      if (elapsed < 60) return t('timeJustNow');
      if (elapsed < 3600) return t('timeMinutes', { count: Math.floor(elapsed / 60) });
      if (elapsed < 86400) return t('timeHours', { count: Math.floor(elapsed / 3600) });
      if (elapsed < 2592000) return t('timeDays', { count: Math.floor(elapsed / 86400) });
      const date = new Date(seconds * 1000);
      const pad = value => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }

    /** One uncommitted file row. */
    function ChangeRow(props) {
      const change = props.change;
      const t = props.t;
      return h('div', { className: 'gp-row', 'data-git-panel-file': change.path },
        h('span', { className: 'gp-code gp-badge', style: { color: kindColor(change.kind) } },
          (change.index || ' ') + (change.worktree || ' ')),
        h('span', { className: 'gp-filePath' },
          change.oldPath === null
            ? null
            : h('span', { className: 'gp-code gp-old' }, change.oldPath + ' \u2192 '),
          h('span', { className: 'gp-code', title: change.path }, change.path)),
        h('span', { className: 'gp-muted' }, t(kindKey(change.kind))));
    }

    /** One commit row: lane gutter, short oid, subject, refs, author, time. */
    function CommitRow(props) {
      const commit = props.commit;
      const columns = props.columns;
      const current = props.current;
      const t = props.t;
      return h('div', { className: 'gp-commit', 'data-git-panel-commit': commit.oid },
        h('span', { className: 'gp-lanes', 'aria-hidden': true },
          columns.map((glyph, index) => h('span', {
            key: index,
            className: 'gp-lane gp-lane-' + glyph,
            'data-git-panel-glyph': glyph,
          }, GLYPH[glyph]))),
        h('span', { className: 'gp-oid', title: commit.oid }, commit.oid.slice(0, 7)),
        h('span', { className: 'gp-main' },
          h('span', { className: 'gp-subject', title: commit.subject }, commit.subject),
          h('span', { className: 'gp-meta' },
            commit.refs.map(ref => h('span', {
              key: ref.kind + ':' + ref.name,
              className: 'gp-ref'
                + (ref.kind === 'head' || ref.name === current ? ' gp-ref-head' : '')
                + (ref.kind === 'tag' ? ' gp-ref-tag' : ''),
              title: ref.name,
            }, ref.name)),
            h('span', null, commit.author),
            h('span', null, '\u00b7'),
            h('span', null, formatTime(commit.authorTime, t)))));
    }

    /**
     * The composer control and the panel it opens.
     * @param props.sessionId - the Session whose working directory is read.
     * @param props.t - the `git-panel` dictionary.
     */
    function GitPanelTrigger(props) {
      const sessionId = props.sessionId;
      const t = props.t;
      const [open, setOpen] = useState(false);
      const [read, setRead] = useState({ status: 'idle' });
      const [busy, setBusy] = useState(false);
      // A slow earlier read must never overwrite a newer one.
      const seq = useRef(0);

      const load = useCallback(limit => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setRead({ status: 'failed', message: t('noSession') });
          return;
        }
        seq.current += 1;
        const mine = seq.current;
        setBusy(true);
        if (limit === INITIAL_LIMIT) setRead({ status: 'loading' });
        fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId) + '&limit=' + String(limit),
          { headers: { accept: 'application/json' } })
          .then(response => response.json())
          .then(body => {
            if (mine !== seq.current) return;
            const value = normalize(body);
            if (value === null) setRead({ status: 'failed', message: t('errorInternal') });
            else setRead({ status: 'ready', value });
          })
          .catch(() => {
            if (mine !== seq.current) return;
            setRead({ status: 'failed', message: t('errorUnavailable') });
          })
          .finally(() => {
            if (mine === seq.current) setBusy(false);
          });
      }, [sessionId, t]);

      const openPanel = useCallback(() => {
        setOpen(true);
        load(INITIAL_LIMIT);
      }, [load]);
      const closePanel = useCallback(() => { setOpen(false); }, []);
      const refresh = useCallback(() => {
        load(read.status === 'ready' ? read.value.limit : INITIAL_LIMIT);
      }, [load, read]);
      const loadMore = useCallback(() => {
        if (read.status === 'ready') load(read.value.limit + PAGE_STEP);
      }, [load, read]);

      /** One header icon button. */
      const iconButton = (label, icon, onClick, disabled) => h('button', {
        type: 'button',
        className: 'gp-iconButton',
        'aria-label': label,
        title: label,
        onClick,
        disabled: disabled === true,
      }, icon);

      /** The dialog header: title, optional lane subtitle, then the actions. */
      const header = (subtitle, actions) => h('div', { className: 'gp-header' },
        h('div', { className: 'gp-heading' },
          h('h3', { className: 'gp-title' }, t('title')),
          subtitle === null ? null : h('div', { className: 'gp-subtitle' }, subtitle)),
        h('div', { className: 'gp-headerActions' },
          actions,
          iconButton(t('close'), h(IconCloseOutlineRegular, { size: 16 }), closePanel, false)));

      const ready = read.status === 'ready' && read.value.state === 'ready';
      const subtitle = ready && !read.value.staleHost
        ? t('subtitle', {
          commits: read.value.commits.length,
          lanes: read.value.lanes.reduce((widest, row) => Math.max(widest, row.length), 0),
        })
        : null;

      let body;
      if (read.status === 'loading' || read.status === 'idle') {
        body = h('div', { className: 'gp-empty' }, t('loading'));
      } else if (read.status === 'failed') {
        body = h('div', { className: 'gp-error' }, read.message);
      } else if (read.value.state === 'not-git') {
        body = h('div', { className: 'gp-empty' }, t('notGit'));
      } else {
        const value = read.value;
        const tracking = [];
        if (value.detached) tracking.push(t('detached'));
        else if (value.upstream === null) tracking.push(t('noUpstream'));
        if (value.ahead > 0) tracking.push(t('ahead', { count: value.ahead }));
        if (value.behind > 0) tracking.push(t('behind', { count: value.behind }));
        const summary = value.state === 'empty'
          ? t('emptyRepo')
          : value.clean ? t('clean') : t('dirty', { count: value.total });

        let history;
        if (value.staleHost) history = h('div', { className: 'gp-error' }, t('staleHost'));
        else if (value.historyFailed) history = h('div', { className: 'gp-error' }, t('historyFailed'));
        else if (value.commits.length === 0) history = h('div', { className: 'gp-empty' }, t('noCommits'));
        else history = h('div', { className: 'gp-graphRows' },
          value.commits.map((commit, index) => h(CommitRow, {
            key: commit.oid,
            commit,
            columns: value.lanes[index] === undefined ? [] : value.lanes[index],
            current: value.branch,
            t,
          })));

        body = h(React.Fragment, null,
          h('div', { className: 'gp-status' },
            h('div', { className: 'gp-line' },
              h(IconBranchOutlineRegular, { size: 14 }),
              h('span', { className: 'gp-branch' }, value.branch === null ? t('detached') : value.branch),
              value.upstream === null ? null : h('span', { className: 'gp-muted' }, '\u2192 ' + value.upstream),
              tracking.length === 0
                ? null
                : h('span', { className: 'gp-muted', style: { marginLeft: 'auto' } }, tracking.join(' \u00b7 '))),
            h('div', { className: 'gp-line' },
              h('span', {
                className: 'gp-dot',
                'aria-hidden': true,
                style: {
                  background: value.clean
                    ? 'var(--dsw-alias-state-success-primary)'
                    : 'var(--dsw-alias-state-warn-primary)',
                },
              }),
              h('span', {
                className: 'gp-muted',
                'data-git-panel-summary': value.clean ? 'clean' : 'dirty',
              }, summary))),
          value.changes.length === 0 ? null : h('div', { className: 'gp-section' },
            h('div', { className: 'gp-sectionTitle' }, t('changesTitle', { count: value.total })),
            h('div', { className: 'gp-box gp-changesBox' },
              value.changes.map(change => h(ChangeRow, {
                key: change.path + '\u0000' + (change.oldPath === null ? '' : change.oldPath),
                change,
                t,
              })),
              value.truncated
                ? h('div', { className: 'gp-notice' }, t('truncated', { count: value.changes.length }))
                : null)),
          h('div', { className: 'gp-graph' },
            h('div', { className: 'gp-graphBox' },
              history,
              value.hasMore && !value.staleHost && !value.historyFailed
                ? h('button', {
                  type: 'button',
                  className: 'gp-more',
                  onClick: loadMore,
                  disabled: busy,
                }, t('loadMore'))
                : null)));
      }

      const panel = h('div', {
        className: 'gp-card',
        'data-dsh-plugin': 'git-panel',
        'data-dsh-part': 'dialog',
      },
      header(subtitle, iconButton(t('refresh'), h(IconRefreshOutlineRegular, { size: 16 }), refresh, busy)),
      body);

      const fallback = h('div', {
        className: 'gp-card',
        'data-dsh-plugin': 'git-panel',
        'data-dsh-part': 'failed',
      },
      header(null, null),
      h('div', { className: 'gp-error' }, t('panelFailed')));

      return h(React.Fragment, null,
        h(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: h(IconBranchOutlineRegular, { size: 16 }),
          'aria-label': t('trigger'),
          title: t('trigger'),
          onClick: openPanel,
          'data-dsh-plugin': 'git-panel',
          'data-dsh-part': 'trigger',
        }),
        h(PanelBoundary, {
          // Remounting on each open clears an error left by the previous one.
          key: open ? 'open' : 'closed',
          fallback: h(Modal, {
            headless: true,
            open: true,
            onClose: closePanel,
            title: t('title'),
            className: 'gp-dialog',
          }, fallback),
        },
        h(Modal, {
          headless: true,
          open,
          onClose: closePanel,
          title: t('title'),
          className: 'gp-dialog',
        }, panel)));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-panel: dictionaries');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = CSS;
          document.head.append(style);
          return () => { style.remove(); };
        }, 'git-panel: panel styles');
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'git-panel-trigger',
          order: 30,
          locale: NS,
        }, GitPanelTrigger));
      },
    };
  },
});
