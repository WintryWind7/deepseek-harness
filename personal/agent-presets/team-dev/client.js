/**
 * 团队根会话的只读侧栏。查询与通知由 Host 提供，打开会话只做导航。
 * 可见正文持有查询与 SSE；隐藏或卸载后释放，失败时保留上次成功的数据。
 */
window.__ModuleLoader__.load({
  id: '@wintry/agent-presets',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect } = React;
    const NS = 'wintry-team';
    const TAB_ID = '@wintry/agent-presets/team-dev';
    const TAB_KIND = 'wintry-team';
    const ROUTE = '/api/team.sessions';

    const zh = {
      title: '团队',
      guideDescription: '查看 Lead 管理的根会话、当前状态与最近结果',
      lead: 'Lead',
      openLead: '打开 Lead：{title}',
      openSession: '打开会话：{title}',
      refresh: '刷新',
      retry: '重试',
      loading: '正在读取团队会话',
      queryFailed: '团队会话读取失败，请重试',
      watchFailed: '实时更新已断开，可以手动刷新',
      noLead: '当前会话不属于团队',
      noMembers: 'Lead 尚未纳入工作会话',
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
      deliveryFailed: '结果未能送达 Lead',
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
      guideDescription: 'View the Lead’s root sessions, current state, and latest results',
      lead: 'Lead',
      openLead: 'Open Lead: {title}',
      openSession: 'Open session: {title}',
      refresh: 'Refresh',
      retry: 'Retry',
      loading: 'Reading team sessions',
      queryFailed: 'Could not load team sessions. Try again',
      watchFailed: 'Live updates disconnected. You can refresh manually',
      noLead: 'This session is not part of a team',
      noMembers: 'The Lead has not added any work sessions',
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
      deliveryFailed: 'The result could not reach the Lead',
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
      .wt-delivery { color:var(--dsw-alias-state-error-primary); }
      .wt-empty { display:flex; align-items:center; justify-content:center; min-height:120px; margin:0; padding:16px; color:var(--dsw-alias-label-secondary); text-align:center; }
      .wt-skeleton { height:90px; margin-bottom:8px; border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-2); animation:wt-pulse 1200ms ease-in-out infinite alternate; }
      .wt-tabicon { display:inline-flex; flex:none; vertical-align:middle; }
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
      if (!value || value.ok !== true || !Array.isArray(value.managed)
        || (value.leadId !== null && typeof value.leadId !== 'string')) throw new Error('Invalid team response');
      const statuses = ['running','waiting','idle','offline','error','missing'];
      for (const row of value.managed) {
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
          h('span', { className:'wt-state', 'data-state':row.status }, h('span', { className:'wt-dot', 'aria-hidden':true }), t(row.status))),
        h('div', { className:'wt-meta' },
          h('span', { className:'wt-preset' }, h('span', null, t('preset')), h('span', null, row.preset)),
          row.pendingQuestions > 0 && h('span', null, t('questions', { count:row.pendingQuestions }))),
        result == null ? h('p', { className:'wt-note' }, t('noResult')) :
          h('details', { className:'wt-result' },
            h('summary', null, turn != null
              ? t('latestTurn', { turn:turn.turn, reason:reasonLabel(turn.reason, t) })
              : t('latestMessage', { turn:message.turn })),
            h('div', { className:'wt-resulttext' }, result.text || t('emptyResult')),
            resultTime != null && Number.isFinite(resultTime.getTime()) && h('time', { className:'wt-resulttime', dateTime:resultTime.toISOString() }, resultTime.toLocaleString()),
            result.truncated && h('p', { className:'wt-note' }, t('truncated'))),
        row.deliveryError && h('p', { className:'wt-note wt-delivery', role:'status' }, t('deliveryFailed')));
    }

    function TeamPanel({ sessionId, useTeam, useTabInfo, retainTeam, refreshTeam, openSession, t }) {
      const query = useTeam();
      const info = useTabInfo();
      useEffect(() => info.tab.visible ? retainTeam() : undefined, [sessionId, info.tab.visible, retainTeam]);
      useEffect(() => info.tab.actions.bindCommands({ refresh:refreshTeam }), [info.tab.actions, refreshTeam]);
      const data = query.data;
      return h('section', { className:'wt-panel', 'aria-label':t('title'), 'data-dsh-plugin':'wintry-team' },
        h('style', null, CSS),
        h('header', { className:'wt-head' },
          h('h2', { className:'wt-heading' }, t('title')),
          h('button', { type:'button', className:'wt-button', disabled:query.loading, onClick:refreshTeam }, t('refresh'))),
        h('div', { className:'wt-body', 'aria-busy':query.loading },
          query.failed && h('div', { className:'wt-notice', 'data-error':true, role:'alert' },
            h('span', null, t('queryFailed')),
            h('button', { type:'button', className:'wt-button', disabled:query.loading, onClick:refreshTeam }, t('retry'))),
          query.disconnected && !query.failed && h('p', { className:'wt-notice', role:'status' }, t('watchFailed')),
          data == null && query.loading && h('div', { role:'status', 'aria-label':t('loading') },
            [0,1,2].map(key => h('div', { key, className:'wt-skeleton', 'aria-hidden':true }))),
          data != null && (data.leadId == null
            ? h('p', { className:'wt-empty' }, t('noLead'))
            : h(React.Fragment, null,
              h('div', { className:'wt-lead' },
                h('span', { className:'wt-caption' }, t('lead')),
                h('button', { type:'button', className:'wt-link', onClick:() => openSession(data.leadId), 'aria-label':t('openLead', { title:data.leadTitle || data.leadId }) }, data.leadTitle || data.leadId),
                h('span', { className:'wt-caption' }, t('members', { count:data.managed.length }))),
              data.managed.length === 0 ? h('p', { className:'wt-empty' }, t('noMembers')) :
                h('ul', { className:'wt-list' }, data.managed.map(row => h(SessionRow, { key:row.sessionId, row, openSession, t })))))));
    }

    function TeamTitle({ t }) {
      return h(React.Fragment, null, h(TeamIcon, { className:'wt-tabicon', size:16 }), t('title'));
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wintry-team: locale');
        const t = ctx.locale.bind(NS);
        const sources = new Map();
        ctx.effect(() => () => {
          for (const source of sources.values()) source.dispose();
          sources.clear();
        }, 'wintry-team: queries');
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id:TAB_ID,
          kind:TAB_KIND,
          title:() => t('title'),
          guide:[{ id:TAB_KIND, order:35, title:() => t('title'), description:() => t('guideDescription'), icon:TeamIcon }],
        }), 'wintry-team: tab type');
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name:'sidebar.right.pane.tab', key:TAB_ID, locale:NS,
          inject(sessionId) {
            let source = sources.get(sessionId);
            if (!source) { source = createTeamSource(sessionId); sources.set(sessionId, source); }
            return {
              hooks:{ team:source.source },
              retainTeam:source.retain,
              refreshTeam:source.refresh,
              openSession:id => ctx.uiWorkspace.openSession(id),
            };
          },
        }, TeamPanel));
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name:'sidebar.right.pane.tab.title', key:TAB_ID, locale:NS,
        }, TeamTitle));
      },
    };
  },
});
