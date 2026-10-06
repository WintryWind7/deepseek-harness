/**
 * 团队根会话的只读面板。查询与通知由 Host 提供，打开会话只做导航。
 * 可见正文持有查询与 SSE；隐藏或卸载后释放，失败时保留上次成功的数据。
 *
 * 入口有四个，内容同一份：输入框工具行的按钮加 Modal（与提示词库、Git 面板
 * 同位）、右侧边栏的“团队”标签页、个人设置页，以及标签页标题座位。
 */
window.__ModuleLoader__.load({
  id: '@wintry/team',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;
    const NS = 'wintry-team';
    const TAB_ID = '@wintry/team/team';
    const TAB_KIND = 'wintry-team';
    const ROUTE = '/api/team.sessions';

    const zh = {
      title: '团队',
      openPanel: '团队会话',
      guideDescription: '查看当前工作目录下的根会话、状态与最近结果',
      workspace: '工作目录',
      openSession: '打开会话：{title}',
      refresh: '刷新',
      retry: '重试',
      close: '关闭',
      loading: '正在读取团队会话',
      queryFailed: '团队会话读取失败，请重试',
      watchFailed: '实时更新已断开，可以手动刷新',
      noMembers: '这个工作目录下还没有根会话',
      members: '{count} 个根会话',
      preset: '预设',
      running: '运行中',
      waiting: '等待回答',
      idle: '空闲',
      offline: '未运行',
      error: '运行出错',
      missing: '会话不可用',
      questions: '{count} 个待答问题',
      latestTurn: '最近第 {turn} 轮 · {reason}',
      latestMessage: '最近回复 · 第 {turn} 轮',
      noResult: '还没有完成的轮次结果',
      emptyResult: '这一轮没有文字结果',
      truncated: '结果已截断，打开会话可查看全文',
      noSession: '当前没有选中的会话',
      completed: '已完成',
      aborted: '已取消',
      blocked: '等待继续',
      interrupted: '已中断',
      maxTokens: '达到输出上限',
      forked: '已分叉',
      otherReason: '已结束',
    };
    const en = {
      title: 'Team',
      openPanel: 'Team sessions',
      guideDescription: 'View root sessions in this working directory, their state, and latest results',
      workspace: 'Working directory',
      openSession: 'Open session: {title}',
      refresh: 'Refresh',
      retry: 'Retry',
      close: 'Close',
      loading: 'Reading team sessions',
      queryFailed: 'Could not load team sessions. Try again',
      watchFailed: 'Live updates disconnected. You can refresh manually',
      noMembers: 'No root sessions in this working directory yet',
      members: '{count} root sessions',
      preset: 'Preset',
      running: 'Running',
      waiting: 'Waiting for answers',
      idle: 'Idle',
      offline: 'Not running',
      error: 'Run failed',
      missing: 'Session unavailable',
      questions: '{count} pending questions',
      latestTurn: 'Latest turn {turn} · {reason}',
      latestMessage: 'Latest reply · Turn {turn}',
      noResult: 'No completed turn results yet',
      emptyResult: 'This turn has no text result',
      truncated: 'Result shortened. Open the session for the full text',
      noSession: 'No session is selected',
      completed: 'Completed',
      aborted: 'Cancelled',
      blocked: 'Waiting to continue',
      interrupted: 'Interrupted',
      maxTokens: 'Output limit reached',
      forked: 'Forked',
      otherReason: 'Ended',
    };

    const CSS = `
      .wt-panel { display:flex; flex-direction:column; height:100%; min-height:0; color:var(--dsw-alias-label-primary); font-size:13px; line-height:20px; }
      .wt-head { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px 8px; }
      .wt-heading { margin:0; font-size:14px; line-height:22px; font-weight:500; }
      .wt-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:28px; padding:3px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm); background:transparent; color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; }
      .wt-button:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2); }
      .wt-button:disabled { cursor:default; color:var(--dsw-alias-label-secondary); }
      .wt-button:focus-visible,.wt-link:focus-visible,.wt-result summary:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .wt-body { flex:1; min-height:0; overflow:auto; padding:4px 12px 12px; }
      .wt-lead { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 8px; padding:0 4px 12px; }
      .wt-caption { color:var(--dsw-alias-label-secondary); font-size:12px; }
      .wt-link { min-width:0; padding:0; border:0; border-radius:var(--dsw-radius-xs); background:none; color:var(--dsw-alias-label-primary); font:inherit; text-align:left; cursor:pointer; overflow-wrap:anywhere; }
      .wt-link:hover { color:var(--dsw-alias-brand-primary); text-decoration:underline; text-underline-offset:3px; }
      .wt-notice { display:flex; align-items:center; flex-wrap:wrap; gap:8px; min-height:28px; margin:0 4px 8px; color:var(--dsw-alias-label-secondary); }
      .wt-notice[data-error='true'] { color:var(--dsw-alias-state-error-primary); }
      .wt-list { display:flex; flex-direction:column; gap:8px; margin:0; padding:0; list-style:none; }
      .wt-card { min-width:0; padding:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
      .wt-cardhead { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; }
      .wt-title { flex:1 1 140px; font-weight:500; line-height:20px; }
      .wt-state { display:inline-flex; flex:none; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-secondary); }
      .wt-dot { flex:none; width:6px; height:6px; border-radius:50%; background:var(--dsw-alias-state-idle-primary); }
      .wt-state[data-state='running'] .wt-dot { background:var(--dsw-alias-brand-primary); }
      .wt-state[data-state='waiting'] .wt-dot { background:var(--dsw-alias-state-warn-primary); }
      .wt-state[data-state='error'] .wt-dot,.wt-state[data-state='missing'] .wt-dot { background:var(--dsw-alias-state-error-primary); }
      .wt-meta { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; margin:6px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary); }
      .wt-preset { display:flex; min-width:0; gap:6px; overflow-wrap:anywhere; }
      .wt-result { margin-top:10px; border-top:1px solid var(--dsw-alias-border-l1); padding-top:8px; }
      .wt-result summary { width:fit-content; max-width:100%; border-radius:var(--dsw-radius-xs); color:var(--dsw-alias-label-secondary); font-size:12px; cursor:pointer; overflow-wrap:anywhere; }
      .wt-resulttext { margin-top:8px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:21px; }
      .wt-resulttime { display:block; margin-top:6px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .wt-note { margin:8px 0 0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .wt-own { flex:none; padding:1px 6px; border-radius:var(--dsw-radius-sm); background:var(--dsw-alias-bg-layer-2); }
      .wt-delivery { color:var(--dsw-alias-state-error-primary); }
      .wt-empty { display:flex; align-items:center; justify-content:center; min-height:120px; margin:0; padding:16px; color:var(--dsw-alias-label-secondary); text-align:center; }
      .wt-skeleton { height:90px; margin-bottom:8px; border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-2); animation:wt-pulse 1200ms ease-in-out infinite alternate; }
      .wt-tabicon { display:inline-flex; flex:none; vertical-align:middle; }
      .wt-trigger { display:inline-flex; flex:none; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:0; border-radius:var(--dsw-radius-sm); background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
      .wt-trigger:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
      .wt-trigger:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .wt-overlay { position:fixed; inset:0; z-index:60; display:flex; align-items:flex-start; justify-content:center; padding:10vh 16px 16px; background:var(--dsw-alias-overlay, rgba(0,0,0,.4)); }
      .wt-dialog { width:min(560px,100%); max-height:80vh; overflow:auto; padding:16px; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); box-shadow:0 12px 40px rgba(0,0,0,.24); }
      @keyframes wt-pulse { to { opacity:.5; } }
      @media(prefers-reduced-motion:reduce) { .wt-skeleton { animation:none; } }
    `;

    /** 复用现有多人图标的轮廓，不加载 Harness Client 模块。 */
    function TeamIcon({ size = 16, className }) {
      return h('svg', { width:size, height:size, className, viewBox:'0 0 16 16', fill:'none', strokeWidth:1, 'aria-hidden':true },
        h('path', { d:'M6 8.25C7.51878 8.25 8.75 7.01878 8.75 5.5C8.75 3.98122 7.51878 2.75 6 2.75C4.48122 2.75 3.25 3.98122 3.25 5.5C3.25 7.01878 4.48122 8.25 6 8.25Z', stroke:'currentColor' }),
        h('path', { d:'M1 14.5C1 11.5 3.5 10.25 6 10.25C8.5 10.25 11 11.5 11 14.5', stroke:'currentColor' }),
        h('path', { d:'M10.5 2.9C11.65 3.35 12.45 4.35 12.45 5.5C12.45 6.65 11.65 7.65 10.5 8.1', stroke:'currentColor' }),
        h('path', { d:'M12.4 10.6C13.9 11.3 15 12.6 15 14.5', stroke:'currentColor' }));
    }

    /** 验证只读 HTTP 返回，拒绝缺失必需字段的响应。 */
    function readTeam(value) {
      if (!value || value.ok !== true || !Array.isArray(value.sessions)
        || (value.cwd !== null && typeof value.cwd !== 'string')) throw new Error('Invalid team response');
      const statuses = ['running','waiting','idle','offline','error','missing'];
      for (const row of value.sessions) {
        if (!row || typeof row.sessionId !== 'string' || typeof row.title !== 'string'
          || typeof row.preset !== 'string' || !statuses.includes(row.status)
          || !Number.isInteger(row.pendingQuestions) || row.pendingQuestions < 0) throw new Error('Invalid team session');
        const turn = row.latestTurn;
        if (turn != null && (!Number.isInteger(turn.turn) || typeof turn.reason !== 'string'
          || typeof turn.text !== 'string' || typeof turn.time !== 'number')) throw new Error('Invalid team turn');
        const message = row.latestMessage;
        if (message != null && (typeof message.text !== 'string' || !Number.isInteger(message.turn))) throw new Error('Invalid team message');
      }
      return value;
    }

    /**
     * 每个会话共享一个查询快照。订阅只发布稳定对象，网络资源由可见正文持有。
     * 新通知在请求进行时合并为一次后续读取，不让旧响应覆盖新状态。
     */
    function createTeamSource(sessionId) {
      let snapshot = { data:null, loading:false, failed:false, disconnected:false };
      const listeners = new Set();
      const holders = new Set();
      let stream;
      let request;
      let dirty = false;
      let disposed = false;
      const url = ROUTE + '?sessionId=' + encodeURIComponent(sessionId);
      const source = {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      };
      const publish = patch => {
        snapshot = { ...snapshot, ...patch };
        for (const listener of [...listeners]) {
          try { listener(); } catch (error) { console.error('Team panel subscriber failed', error); }
        }
      };
      const load = async () => {
        if (disposed || holders.size === 0) return;
        if (request) { dirty = true; return; }
        const current = new AbortController();
        request = current;
        dirty = false;
        publish({ loading:true, failed:false });
        try {
          const response = await fetch(url, { credentials:'same-origin', cache:'no-store', headers:{ accept:'application/json' }, signal:current.signal });
          if (!response.ok) throw new Error('Team query failed: ' + response.status);
          const data = readTeam(await response.json());
          if (!current.signal.aborted && !disposed) publish({ data, failed:false });
        } catch (error) {
          if (!current.signal.aborted && !disposed) publish({ failed:true });
        } finally {
          if (request === current) {
            request = undefined;
            if (!disposed) publish({ loading:false });
            if (dirty && holders.size > 0 && !disposed) void load();
          }
        }
      };
      const watch = () => {
        if (stream || disposed || holders.size === 0) return;
        stream = new EventSource(url + '&watch=1', { withCredentials:true });
        stream.addEventListener('changed', () => { void load(); });
        stream.onopen = () => { if (!disposed) publish({ disconnected:false }); };
        stream.onerror = () => { if (!disposed) publish({ disconnected:true }); };
      };
      const pause = () => {
        stream?.close();
        stream = undefined;
        dirty = false;
        const current = request;
        request = undefined;
        current?.abort();
        if (!disposed) publish({ loading:false });
      };
      return {
        source,
        retain() {
          if (disposed) return () => {};
          const token = {};
          holders.add(token);
          if (holders.size === 1) { watch(); void load(); }
          return () => { holders.delete(token); if (holders.size === 0) pause(); };
        },
        refresh() { watch(); return load(); },
        dispose() { disposed = true; holders.clear(); pause(); listeners.clear(); },
      };
    }

    function reasonLabel(reason, t) {
      const keys = { completed:'completed', aborted:'aborted', blocked:'blocked', error:'error', interrupted:'interrupted', 'max-tokens':'maxTokens', forked:'forked' };
      return t(Object.hasOwn(keys, reason) ? keys[reason] : 'otherReason');
    }

    function SessionRow({ row, openSession, t }) {
      const turn = row.latestTurn;
      const message = turn == null ? row.latestMessage : null;
      const result = turn || message;
      const resultTime = turn == null ? null : new Date(turn.time);
      return h('li', { className:'wt-card', 'data-team-session':row.sessionId },
        h('div', { className:'wt-cardhead' },
          h('button', { type:'button', className:'wt-link wt-title', onClick:() => openSession(row.sessionId), 'aria-label':t('openSession', { title:row.title }) }, row.title),
          h('span', { className:'wt-state', 'data-state':row.status }, h('span', { className:'wt-dot', 'aria-hidden':true }), t(row.status)),
          row.pendingQuestions > 0 && h('span', { className:'wt-own' }, t('questions', { count:row.pendingQuestions }))),
        h('div', { className:'wt-meta' },
          h('span', { className:'wt-preset' }, h('span', null, t('preset')), h('span', null, row.preset))),
        result == null ? h('p', { className:'wt-note' }, t('noResult')) :
          h('details', { className:'wt-result' },
            h('summary', null, turn != null
              ? t('latestTurn', { turn:turn.turn, reason:reasonLabel(turn.reason, t) })
              : t('latestMessage', { turn:message.turn })),
            h('div', { className:'wt-resulttext' }, result.text || t('emptyResult')),
            resultTime != null && Number.isFinite(resultTime.getTime()) && h('time', { className:'wt-resulttime', dateTime:resultTime.toISOString() }, resultTime.toLocaleString()),
            result.truncated && h('p', { className:'wt-note' }, t('truncated'))));
    }

    /**
     * 面板正文：当前工作目录下的根会话列表。样式与标题由调用方提供，
     * 这里只负责状态、失败提示和列表本身。
     */
    function TeamBody({ query, refreshTeam, openSession, t }) {
      const data = query.data;
      return h('div', { className:'wt-body', 'aria-busy':query.loading },
        query.failed && h('div', { className:'wt-notice', 'data-error':true, role:'alert' },
          h('span', null, t('queryFailed')),
          h('button', { type:'button', className:'wt-button', disabled:query.loading, onClick:refreshTeam }, t('retry'))),
        query.disconnected && !query.failed && h('p', { className:'wt-notice', role:'status' }, t('watchFailed')),
        data == null && query.loading && h('div', { role:'status', 'aria-label':t('loading') },
          [0,1,2].map(key => h('div', { key, className:'wt-skeleton', 'aria-hidden':true }))),
        data != null && h(React.Fragment, null,
          data.cwd === null
            ? h('p', { className:'wt-empty' }, t('noSession'))
            : h(React.Fragment, null,
              h('div', { className:'wt-lead' },
                h('span', { className:'wt-caption' }, t('workspace')),
                h('span', { className:'wt-caption' }, data.cwd),
                h('span', { className:'wt-caption' }, t('members', { count:data.sessions.length }))),
              data.sessions.length === 0 ? h('p', { className:'wt-empty' }, t('noMembers')) :
                h('ul', { className:'wt-list' }, data.sessions.map(row => h(SessionRow, { key:row.sessionId, row, openSession, t }))))));
    }

    function TeamPanel({ sessionId, useTeam, useTabInfo, retainTeam, refreshTeam, openSession, t }) {
      const query = useTeam();
      const info = useTabInfo();
      useEffect(() => info.tab.visible ? retainTeam() : undefined, [sessionId, info.tab.visible, retainTeam]);
      useEffect(() => info.tab?.actions?.bindCommands?.({ refresh:refreshTeam }), [info.tab?.actions, refreshTeam]);
      return h('section', { className:'wt-panel', 'aria-label':t('title'), 'data-dsh-plugin':'wintry-team' },
        h('style', null, CSS),
        h('header', { className:'wt-head' },
          h('h2', { className:'wt-heading' }, t('title')),
          h('button', { type:'button', className:'wt-button', disabled:query.loading, onClick:refreshTeam }, t('refresh'))),
        h(TeamBody, { query, refreshTeam, openSession, t }));
    }

    /**
     * 个人设置页的外壳：订阅当前选中会话，持有对应的查询源，再复用同一个面板。
     * 没有 tab 信息，所以可见性由挂载与卸载表达，比标签页宽。
     */
    function TeamPage({ currentSession, sourceOf, openSession, t }) {
      const binding = React.useSyncExternalStore(currentSession.subscribe, currentSession.getSnapshot);
      const sessionId = binding.key;
      const holder = sessionId === undefined ? null : sourceOf(sessionId);
      const view = holder === null ? null : holder.source;
      const query = React.useSyncExternalStore(
        view ? view.subscribe : noopSubscribe,
        view ? view.getSnapshot : emptyTeamSnapshot);
      useEffect(() => holder ? holder.retain() : undefined, [holder]);
      if (sessionId === undefined) return h('p', { className:'wt-empty' }, t('noSession'));
      return h(TeamPanel, {
        sessionId,
        useTeam: () => query,
        useTabInfo: () => ({ tab: { visible: true, actions: {} } }),
        retainTeam: () => () => {},
        refreshTeam: () => holder?.refresh(),
        openSession,
        t,
      });
    }

    /**
     * 输入框工具行的按钮，点开 Modal。与提示词库、Git 面板同一个座位、同一种形态：
     * 和它们一样无条件渲染按钮，没有会话时只在弹窗里显示空态。会话 id 缺席时
     * 提前 return null 会让入口在页面上彻底消失。
     */
    function TeamTrigger({ sessionId, sourceOf, openSession, t }) {
      // sourceOf 返回的是持有者：订阅面在 holder.source，持有/刷新在 holder 本身。
      const holder = sessionId === undefined ? null : sourceOf(sessionId);
      const view = holder === null ? null : holder.source;
      const [open, setOpen] = useState(false);
      const refresh = useCallback(() => { holder?.refresh(); }, [holder]);
      const query = React.useSyncExternalStore(
        view ? view.subscribe : noopSubscribe,
        view ? view.getSnapshot : emptyTeamSnapshot);
      useEffect(() => open && holder ? holder.retain() : undefined, [open, holder]);
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: 'wt-trigger',
          'aria-label': t('openPanel'),
          title: t('openPanel'),
          onClick: () => setOpen(true),
          'data-dsh-plugin': 'wintry-team',
          'data-dsh-part': 'trigger',
        }, h(TeamIcon, { size: 16 })),
        open && h('div', { className:'wt-overlay', role:'dialog', 'aria-modal':true, 'aria-label':t('title'), 'data-dsh-part':'dialog' },
          h('div', { className:'wt-card wt-dialog' },
            h('div', { className:'wt-head' },
              h('h2', { className:'wt-heading' }, t('title')),
              h('button', { type:'button', className:'wt-button', disabled:query.loading, onClick:refresh }, t('refresh')),
              h('button', { type:'button', className:'wt-button', 'aria-label':t('close'), onClick:() => setOpen(false) }, '×')),
            holder
              ? h(TeamBody, { query, refreshTeam:refresh, openSession, t })
              : h('p', { className:'wt-empty' }, t('noSession')))));
    }

    /**
     * 没有选中会话时的空订阅与空快照。快照必须是稳定引用：
     * useSyncExternalStore 每次拿到新对象都会当作变化，返回新字面量会一直重渲染。
     */
    const EMPTY_TEAM_SNAPSHOT = { data:null, loading:false, failed:false, disconnected:false };
    function noopSubscribe() { return () => {}; }
    function emptyTeamSnapshot() { return EMPTY_TEAM_SNAPSHOT; }

    function TeamTitle({ t }) {
      return h(React.Fragment, null, h(TeamIcon, { className:'wt-tabicon', size:16 }), t('title'));
    }

    return {
      // uiWorkspace / uiSession 都在使用点用 ctx.get 读，不写进 inject。
      // Cordis 的 inject 是硬等待：其中任何一个服务没就绪，apply 就永远停在
      // pending，四处注册一处也跑不到，页面上表现为整个插件不存在。
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wintry-team: locale');
        // 没有这一步，CSS 里的 .wt-trigger 尺寸与配色全部不生效。
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = CSS;
          document.head.append(style);
          return () => { style.remove(); };
        }, 'wintry-team: styles');
        const t = ctx.locale.bind(NS);
        /** 打开会话只是导航；服务缺席时入口照常显示，只让这一步无效。 */
        const openSession = id => ctx.get('uiWorkspace')?.openSession(id);
        const sources = new Map();
        ctx.effect(() => () => {
          for (const source of sources.values()) source.dispose();
          sources.clear();
        }, 'wintry-team: queries');
        /** 团队面板的数据：每个会话一个源，可见正文持有查询与 SSE。 */
        const teamInject = sessionId => {
          let source = sources.get(sessionId);
          if (!source) { source = createTeamSource(sessionId); sources.set(sessionId, source); }
          return {
            hooks:{ team:source.source },
            retainTeam:source.retain,
            refreshTeam:source.refresh,
            openSession,
          };
        };
        const sourceOf = sessionId => {
          let source = sources.get(sessionId);
          if (!source) { source = createTeamSource(sessionId); sources.set(sessionId, source); }
          return source;
        };
        // 输入框工具行：和提示词库（order 40）、Git 面板（order 30）并排，点开 Modal。
        // 放在最前面注册，后面标签页那部分即使出问题也不会连累主入口。
        // session 作用域的 sessionId 只有在注册里写了 inject 才会作为实参传入。
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name:'conversation.input.left',
          id:'wintry-team-trigger',
          order:50,
          locale:NS,
          inject: sessionId => ({ sessionId, sourceOf, openSession, t }),
        }, TeamTrigger));
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id:TAB_ID,
          kind:TAB_KIND,
          title:() => t('title'),
          guide:[{ id:TAB_KIND, order:35, title:() => t('title'), description:() => t('guideDescription'), icon:TeamIcon }],
        }), 'wintry-team: tab type');
        // 右侧边栏标签页：和提示词库的 composer 控件、个人设置页互不冲突，内容同一份。
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name:'sidebar.right.pane.tab', key:TAB_ID, locale:NS, inject:teamInject,
        }, TeamPanel));
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name:'sidebar.right.pane.tab.title', key:TAB_ID, locale:NS,
        }, TeamTitle));
        // 个人设置页里并列的一份，跟着当前选中会话显示。uiSession 在槽位声明时才读，
        // 那时会话服务已经可用；缺席就只渲染空态，不影响其它入口。
        ctx.slots.inject('personal.settings.page', () => {
          const current = ctx.get('uiSession')?.adapter.current;
          return ctx.slots.register({
            name:'personal.settings.page',
            id:'wintry-team',
            order:30,
            label:() => t('title'),
            locale:NS,
          }, current === undefined
            ? () => h('p', { className:'wt-empty' }, t('noSession'))
            : () => h(TeamPage, { currentSession: current, sourceOf, openSession, t }));
        });
      },
    };
  },
});
