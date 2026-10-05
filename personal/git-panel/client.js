/**
 * Browser half of @wintry/git-panel.
 *
 * Registers one compact control in the composer tool row. Opening it reads the
 * Host Git route and renders the branch, its upstream tracking state, the
 * uncommitted files, the commit history, and the remotes. Remote edits and the
 * fast-forward push go to that same route. Nothing here writes to a Session.
 *
 * The panel follows the git-graph dialog of the `dsh-web` plugin family: a
 * 760px overlay card, a title with a `N commits · M lanes` subtitle, bordered
 * inset cards around each scrolled list, hoverable rows, filled ref pills, and
 * a full-width load-more control at the end of the history.
 */
window.__ModuleLoader__.load({
  id: '@wintry/git-panel',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { Button, Modal } = primitives;
    const {
      IconBranchOutlineRegular,
      IconCheckOutlineRegular,
      IconCloseOutlineRegular,
      IconEditOutlineRegular,
      IconPaperPlaneOutlineRegular,
      IconRefreshOutlineRegular,
      IconTrashOutlineRegular,
    } = primitives;
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

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
      remotesTitle: '远端',
      pushAll: '推送',
      pushBusy: '正在检查并推送…',
      pushHint: '将把已提交的 {branch} 推送到 {remotes}。任一远端不能快进则全部不推，也不会新建分支。',
      pushNone: '勾选要一键推送的远端。不能快进时不会推送。',
      pushNoBranch: '游离或还没有提交时不能从这里推送。',
      pushBlocked: '{reasons}，这次没有推送。',
      reasonDiverged: '{remotes} 已分叉',
      reasonMissing: '{remotes} 没有这个分支',
      reasonUnreachable: '{remotes} 读不到',
      reasonSep: '，',
      pushPartial: '已推送到 {done}。{failed} 没有推成，其余未再推送。',
      pushOk: '已推送到 {remotes}。',
      pushCurrent: '{remotes} 已经包含当前提交。',
      pushOkMixed: '已推送到 {pushed}。{current} 已经是最新。',
      remoteAdded: '已添加 {name}。',
      remoteUpdated: '已更新 {name}。',
      remoteRemoved: '已删除 {name}。',
      pushSetOk: '已更新一键推送的远端。',
      remoteInvalid: '名称或地址无效。',
      remoteExists: '这个远端已经存在。',
      remoteAbsent: '没有这个远端。',
      remoteFailed: '远端操作失败。',
      pushFailed: '推送失败。',
      remoteBusy: '上一项 Git 操作还在进行。',
      remoteUnsafe: '这个远端的地址不能从这里推送。',
      noRemotes: '还没有远端。',
      addRemote: '添加',
      remoteName: '名称',
      remoteUrl: '地址',
      save: '保存',
      cancel: '取消',
      edit: '修改地址',
      remove: '删除',
      confirmRemove: '确认删除',
      includePush: '一键推送 {name}',
      remotesFailed: '远端列表读取失败。',
      remotesStale: '远端配置需要重启 dsh web 后才会出现。',
      commitCopy: '复制',
      commitCopied: '已复制',
      commitParents: '父提交',
      commitAuthor: '作者  {person}',
      commitCommitter: '提交  {person}',
      commitFiles: '{count} 个文件',
      commitMoreFiles: '还有 {count} 个文件',
      commitNoFiles: '没有文件改动。',
      commitFilesFailed: '文件列表读取失败。',
      commitFailed: '这条提交读不出来。',
      commitStale: '提交详情需要重启 dsh web。',
      commitLoading: '正在读取这条提交…',
      commitOpen: '展开 {subject}',
      nameSep: '、',
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
      remotesTitle: 'Remotes',
      pushAll: 'Push',
      pushBusy: 'Checking and pushing…',
      pushHint: 'Pushes committed {branch} to {remotes}. If any remote is not a fast-forward, nothing is pushed and no branch is created.',
      pushNone: 'Choose the remotes for the shortcut. A remote that is not a fast-forward blocks the push.',
      pushNoBranch: 'A detached or unborn HEAD cannot be pushed from here.',
      pushBlocked: '{reasons}. Nothing was pushed.',
      reasonDiverged: '{remotes} diverged',
      reasonMissing: '{remotes} has no such branch',
      reasonUnreachable: '{remotes} could not be read',
      reasonSep: '; ',
      pushPartial: 'Pushed to {done}. {failed} failed, so the rest were not pushed.',
      pushOk: 'Pushed to {remotes}.',
      pushCurrent: '{remotes} already has this commit.',
      pushOkMixed: 'Pushed to {pushed}. {current} was already up to date.',
      remoteAdded: 'Added {name}.',
      remoteUpdated: 'Updated {name}.',
      remoteRemoved: 'Removed {name}.',
      pushSetOk: 'Updated the remotes included in the shortcut.',
      remoteInvalid: 'The name or URL is not valid.',
      remoteExists: 'That remote already exists.',
      remoteAbsent: 'That remote does not exist.',
      remoteFailed: 'The remote operation failed.',
      pushFailed: 'The push failed.',
      remoteBusy: 'Another Git operation is still running.',
      remoteUnsafe: 'This remote URL cannot be pushed from here.',
      noRemotes: 'No remotes yet.',
      addRemote: 'Add',
      remoteName: 'Name',
      remoteUrl: 'URL',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit URL',
      remove: 'Remove',
      confirmRemove: 'Confirm remove',
      includePush: 'Include {name} in the shortcut',
      remotesFailed: 'Reading the remotes failed.',
      remotesStale: 'Remote settings appear after restarting dsh web.',
      commitCopy: 'Copy',
      commitCopied: 'Copied',
      commitParents: 'Parents',
      commitAuthor: 'Author  {person}',
      commitCommitter: 'Committer  {person}',
      commitFiles: '{count} files',
      commitMoreFiles: '{count} more files',
      commitNoFiles: 'No file changes.',
      commitFilesFailed: 'Reading the file list failed.',
      commitFailed: 'This commit could not be read.',
      commitStale: 'Commit details appear after restarting dsh web.',
      commitLoading: 'Reading this commit…',
      commitOpen: 'Expand {subject}',
      nameSep: ', ',
    };

    /**
     * Scoped to this plugin's own class names, so no shipped rule is touched.
     * The doubled class on the dialog is deliberate: the Modal's own width,
     * padding, and surface rules are single-class selectors, and these must win
     * regardless of which stylesheet the browser applied first.
     */
    const CSS = `
      .gp-dialog.gp-dialog {
        display: flex;
        flex-direction: column;
        width: min(760px, 100%);
        max-height: min(76vh, 720px);
        overflow: hidden;
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
      .gp-changesBox::-webkit-scrollbar, .gp-graphRows::-webkit-scrollbar, .gp-remotesBox::-webkit-scrollbar { width: 6px; }
      .gp-changesBox::-webkit-scrollbar-thumb, .gp-graphRows::-webkit-scrollbar-thumb, .gp-remotesBox::-webkit-scrollbar-thumb {
        background: var(--dsw-alias-border-l2); border-radius: 3px;
      }
      .gp-changesBox::-webkit-scrollbar-track, .gp-graphRows::-webkit-scrollbar-track, .gp-remotesBox::-webkit-scrollbar-track { background: transparent; }

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

      .gp-commit {
        display: flex; align-items: center; gap: 10px; width: 100%;
        padding: 7px 8px; border: none; border-radius: 8px; font-size: 12px;
        background: none; color: inherit; font-family: inherit; text-align: left; cursor: pointer;
      }
      .gp-commit:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gp-commit:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-detail {
        margin: 0 8px 8px 48px; padding: 12px; border-radius: 8px;
        background: var(--dsw-alias-bg-overlay);
        border: 1px solid var(--dsw-alias-border-l1);
      }
      .gp-detailTop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .gp-detailOid {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px; color: var(--dsw-alias-label-tertiary); word-break: break-all;
      }
      .gp-detailLine { margin-top: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .gp-detailParents { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
      .gp-parentRow { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      .gp-parentLink {
        flex: none; border: none; background: none; padding: 0; cursor: pointer;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px; color: var(--dsw-alias-link);
      }
      .gp-parentLink:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-parentSubject {
        flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: 11px; color: var(--dsw-alias-label-secondary);
      }
      .gp-detailMessage {
        display: flex; flex-direction: column; gap: 8px;
        max-height: 180px; overflow-y: auto; margin: 12px 0;
      }
      .gp-detailSubject {
        margin: 0; font-size: 15px; font-weight: 500; white-space: pre-wrap; word-break: break-word;
        color: var(--dsw-alias-label-primary);
      }
      .gp-detailBody {
        margin: 0; font-size: 13px; white-space: pre-wrap; word-break: break-word;
        color: var(--dsw-alias-label-primary);
      }
      .gp-detailStat { display: flex; align-items: center; gap: 8px; font-size: 11px; }
      .gp-detailFile {
        display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12px;
      }
      .gp-detailPath {
        flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .gp-detailPlus { flex: none; font-size: 11px; color: var(--dsw-alias-state-success-primary); }
      .gp-detailMinus { flex: none; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
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

      .gp-sectionHead {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin: 0 4px 4px;
      }
      .gp-sectionHead .gp-sectionTitle { margin: 0; }
      .gp-push {
        display: inline-flex; align-items: center; gap: 4px; flex: none;
        border: none; border-radius: 8px; padding: 4px 10px;
        background: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-button-contrast-fill);
        cursor: pointer; font-size: 12px;
      }
      .gp-push:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-push:disabled { opacity: 0.55; cursor: not-allowed; }
      .gp-hint { margin: 0 4px 6px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .gp-remote {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 8px; font-size: 12px;
      }
      .gp-remote:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gp-check { flex: none; width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
      .gp-remoteName {
        flex: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: var(--dsw-alias-label-primary);
      }
      .gp-remoteUrl {
        flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--dsw-alias-label-tertiary); font-size: 11px;
      }
      .gp-remoteActions { flex: none; display: flex; align-items: center; gap: 2px; }
      .gp-field {
        flex: 1; min-width: 0; height: 26px; border-radius: 8px; padding: 0 8px;
        border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-overlay);
        color: var(--dsw-alias-label-primary); font-size: 12px;
      }
      .gp-field-name { flex: 0 1 120px; }
      .gp-field:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-add { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
      .gp-textButton {
        flex: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
        background: none; color: var(--dsw-alias-label-secondary);
        padding: 4px 8px; cursor: pointer; font-size: 12px;
      }
      .gp-textButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .gp-textButton:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .gp-textButton:disabled { opacity: 0.55; cursor: not-allowed; }
      .gp-textButton:disabled:hover { background: none; }
      .gp-remotesBox { max-height: 168px; overflow-y: auto; }
      .gp-ok {
        margin: 0 4px 6px; padding: 6px 10px; border-radius: 8px; font-size: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);
        color: var(--dsw-alias-state-success-primary);
      }

      .gp-empty { padding: 24px 10px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .gp-notice { padding: 6px 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .gp-error {
        margin: 4px; padding: 6px 10px; border-radius: 8px; font-size: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      @media (prefers-reduced-motion: reduce) {
        .gp-iconButton, .gp-more, .gp-textButton { transition: none; }
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
        remotesKnown: Array.isArray(value.remotes),
        remotesFailed: value.remotesFailed === true,
        remotes: (Array.isArray(value.remotes) ? value.remotes : [])
          .filter(remote => remote !== null && typeof remote === 'object'
            && typeof remote.name === 'string' && typeof remote.url === 'string')
          .map(remote => ({
            name: remote.name,
            url: remote.url,
            push: remote.push === true,
            unsafe: remote.unsafe === true,
          })),
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

    /**
     * Normalize one commit-detail response.
     * @param body - the parsed JSON body.
     * @returns the detail, `{ stale: true }` when the Host ignored the commit, or null.
     */
    function normalizeCommit(body) {
      if (body === null || typeof body !== 'object' || body.ok !== true) return null;
      const value = body.value;
      if (value === null || typeof value !== 'object') return null;
      if (value.kind !== 'commit') return value.state === undefined ? null : { stale: true };
      const num = raw => (Number.isFinite(raw) ? raw : 0);
      const text = raw => (typeof raw === 'string' ? raw : '');
      return {
        stale: false,
        oid: text(value.oid),
        subject: text(value.subject),
        body: text(value.body),
        author: text(value.author),
        authorEmail: text(value.authorEmail),
        authorTime: num(value.authorTime),
        committer: text(value.committer),
        committerEmail: text(value.committerEmail),
        parents: (Array.isArray(value.parents) ? value.parents : [])
          .filter(parent => parent !== null && typeof parent === 'object' && typeof parent.oid === 'string')
          .map(parent => ({ oid: parent.oid, subject: text(parent.subject) })),
        files: (Array.isArray(value.files) ? value.files : [])
          .filter(file => file !== null && typeof file === 'object' && typeof file.path === 'string')
          .map(file => ({
            status: typeof file.status === 'string' && file.status !== '' ? file.status : 'M',
            path: file.path,
            oldPath: typeof file.oldPath === 'string' ? file.oldPath : null,
            additions: Number.isFinite(file.additions) ? file.additions : null,
            deletions: Number.isFinite(file.deletions) ? file.deletions : null,
          })),
        fileCount: num(value.fileCount),
        additions: num(value.additions),
        deletions: num(value.deletions),
        filesTruncated: value.filesTruncated === true,
        filesFailed: value.filesFailed === true,
      };
    }

    /** Absolute local time for an opened commit. */
    function formatAbsolute(seconds) {
      const date = new Date(seconds * 1000);
      const pad = value => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    /** `Name <email>`, or just the name when git recorded no email. */
    function personLine(name, email) {
      return email === '' ? name : name + ' <' + email + '>';
    }

    /** Color for one diff status letter. */
    function statusColor(status) {
      if (status === 'A') return 'var(--dsw-alias-state-success-primary)';
      if (status === 'D') return 'var(--dsw-alias-state-error-primary)';
      if (status === 'M' || status === 'T') return 'var(--dsw-alias-state-warn-primary)';
      return 'var(--dsw-alias-link)';
    }

    /**
     * The opened commit: full message, identity, parents, and file summary.
     * @param props.detail - loading, failed, or ready detail for this row.
     * @param props.known - commit ids currently rendered in the list.
     * @param props.onOpen - open another rendered commit.
     * @param props.t - the `git-panel` dictionary.
     */
    function CommitDetail(props) {
      const detail = props.detail;
      const t = props.t;
      const [copied, setCopied] = useState(false);
      if (detail === null || detail.status === 'loading') {
        return h('div', { className: 'gp-detail' }, h('div', { className: 'gp-notice' }, t('commitLoading')));
      }
      if (detail.status !== 'ready') {
        return h('div', { className: 'gp-detail' }, h('div', { className: 'gp-error' }, detail.message));
      }
      const value = detail.value;
      const samePerson = value.author === value.committer && value.authorEmail === value.committerEmail;
      const copy = event => {
        event.stopPropagation();
        const done = () => {
          setCopied(true);
          setTimeout(() => { setCopied(false); }, 1500);
        };
        if (navigator.clipboard === undefined) return;
        navigator.clipboard.writeText(value.oid).then(done).catch(() => {});
      };
      return h('div', { className: 'gp-detail', 'data-git-panel-detail': value.oid },
        h('div', { className: 'gp-detailTop' },
          h('span', { className: 'gp-detailOid' }, value.oid),
          h('button', {
            type: 'button',
            className: 'gp-textButton',
            onClick: copy,
          }, copied ? t('commitCopied') : t('commitCopy'))),
        h('div', { className: 'gp-detailLine' }, formatAbsolute(value.authorTime)),
        h('div', { className: 'gp-detailLine' }, t('commitAuthor', { person: personLine(value.author, value.authorEmail) })),
        samePerson ? null : h('div', { className: 'gp-detailLine' }, t('commitCommitter', {
          person: personLine(value.committer, value.committerEmail),
        })),
        value.parents.length === 0 ? null : h('div', { className: 'gp-detailParents' },
          h('span', { className: 'gp-muted' }, t('commitParents')),
          value.parents.map(parent => h('div', { key: parent.oid, className: 'gp-parentRow' },
            props.known.get(parent.oid.toLowerCase()) === undefined
              ? h('span', { className: 'gp-detailOid' }, parent.oid.slice(0, 7))
              : h('button', {
                type: 'button',
                className: 'gp-parentLink',
                onClick: () => { props.onOpen(props.known.get(parent.oid.toLowerCase())); },
              }, parent.oid.slice(0, 7)),
            h('span', { className: 'gp-parentSubject', title: parent.subject }, parent.subject)))),
        h('div', { className: 'gp-detailMessage' },
          h('p', { className: 'gp-detailSubject' }, value.subject),
          value.body === '' ? null : h('p', { className: 'gp-detailBody' }, value.body)),
        value.filesFailed
          ? h('div', { className: 'gp-error' }, t('commitFilesFailed'))
          : value.fileCount === 0
            ? h('div', { className: 'gp-notice' }, t('commitNoFiles'))
            : h('div', null,
              h('div', { className: 'gp-detailStat' },
                h('span', { className: 'gp-muted' }, t('commitFiles', { count: value.fileCount })),
                h('span', { className: 'gp-detailPlus' }, '+' + String(value.additions)),
                h('span', { className: 'gp-detailMinus' }, '−' + String(value.deletions))),
              value.files.map(file => {
                const label = file.oldPath === null ? file.path : file.oldPath + ' → ' + file.path;
                return h('div', { key: file.status + ':' + label, className: 'gp-detailFile' },
                  h('span', { className: 'gp-code', style: { color: statusColor(file.status) } }, file.status),
                  h('span', { className: 'gp-detailPath', title: label }, label),
                  file.additions === null ? null : h('span', { className: 'gp-detailPlus' }, '+' + String(file.additions)),
                  file.deletions === null ? null : h('span', { className: 'gp-detailMinus' }, '−' + String(file.deletions)));
              }),
              value.filesTruncated
                ? h('div', { className: 'gp-notice' }, t('commitMoreFiles', { count: value.fileCount - value.files.length }))
                : null));
    }

    /** One commit row: lane gutter, short oid, subject, refs, author, time. */
    function CommitRow(props) {
      const commit = props.commit;
      const columns = props.columns;
      const current = props.current;
      const t = props.t;
      const open = props.open === true;
      return h('div', { 'data-git-panel-commit': commit.oid },
        h('button', {
          type: 'button',
          className: 'gp-commit',
          'aria-expanded': open,
          'aria-label': t('commitOpen', { subject: commit.subject }),
          onClick: props.onToggle,
        },
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
                + (ref.kind === 'head' || ref.kind === current ? ' gp-ref-head' : '')
                + (ref.kind === 'tag' ? ' gp-ref-tag' : ''),
              title: ref.name,
            }, ref.name)),
            h('span', null, commit.author),
            h('span', null, '\u00b7'),
            h('span', null, formatTime(commit.authorTime, t))))),
        open ? h(CommitDetail, {
          detail: props.detail,
          known: props.known,
          onOpen: props.onOpen,
          t,
        }) : null);
    }

    /**
     * Join remote names with the dictionary's separator.
     * @param names - raw names from a response.
     * @param t - the `git-panel` dictionary.
     * @returns the display list.
     */
    function joinNames(names, t) {
      return names.filter(name => typeof name === 'string' && name !== '').join(t('nameSep'));
    }

    /**
     * Map one mutation response onto the notice shown in the panel.
     * @param action - the action this panel sent.
     * @param body - the parsed JSON body, or anything `response.json` produced.
     * @param t - the `git-panel` dictionary.
     * @returns the notice text.
     */
    function outcomeText(action, body, t) {
      if (body === null || typeof body !== 'object') return t('errorInternal');
      if (body.ok === true) {
        const value = body.value !== null && typeof body.value === 'object' ? body.value : {};
        if (action === 'push') {
          const pushed = Array.isArray(value.pushed) ? value.pushed : [];
          const current = Array.isArray(value.current) ? value.current : [];
          if (pushed.length > 0 && current.length > 0) {
            return t('pushOkMixed', { pushed: joinNames(pushed, t), current: joinNames(current, t) });
          }
          if (pushed.length > 0) return t('pushOk', { remotes: joinNames(pushed, t) });
          return t('pushCurrent', { remotes: joinNames(current, t) });
        }
        const name = typeof value.name === 'string' ? value.name : '';
        if (action === 'remote-add') return t('remoteAdded', { name });
        if (action === 'remote-set-url') return t('remoteUpdated', { name });
        if (action === 'remote-remove') return t('remoteRemoved', { name });
        if (action === 'push-set') return t('pushSetOk');
        return t('errorInternal');
      }
      const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 160) : '';
      const withDetail = text => (detail === '' ? text : text + ' ' + detail);
      if (body.code === 'blocked') {
        const reasons = [];
        const reasonsMap = body.reasons !== null && typeof body.reasons === 'object' ? body.reasons : {};
        const gather = (key, remotes, template) => {
          const entry = reasonsMap[key] !== null && typeof reasonsMap[key] === 'object' ? reasonsMap[key] : null;
          const list = Array.isArray(entry?.remotes)
            ? entry.remotes
            : Array.isArray(remotes) ? remotes : [];
          if (list.length === 0) return;
          const text = t(template, { remotes: joinNames(list, t) });
          const detail = typeof entry?.detail === 'string' ? entry.detail.trim().slice(0, 160) : '';
          reasons.push(detail === '' ? text : text + ' ' + detail);
        };
        gather('diverged', Array.isArray(body.diverged) ? body.diverged : [], 'reasonDiverged');
        gather('missing', Array.isArray(body.missing) ? body.missing : [], 'reasonMissing');
        gather('unreachable', Array.isArray(body.unreachable) ? body.unreachable : [], 'reasonUnreachable');
        if (reasons.length === 0) return t('remoteFailed');
        return t('pushBlocked', { reasons: reasons.join(t('reasonSep')) });
      }
      if (body.code === 'diverged') return t('pushBlocked', { reasons: t('reasonDiverged', { remotes: joinNames(Array.isArray(body.remotes) ? body.remotes : [], t) }) });
      if (body.code === 'partial') {
        return withDetail(t('pushPartial', {
          done: joinNames(Array.isArray(body.pushed) ? body.pushed : [], t),
          failed: typeof body.failed === 'string' ? body.failed : '',
        }));
      }
      if (body.code === 'no-branch') return t('pushNoBranch');
      if (body.code === 'no-targets') return t('pushNone');
      if (body.code === 'exists') return t('remoteExists');
      if (body.code === 'absent') return t('remoteAbsent');
      if (body.code === 'busy') return t('remoteBusy');
      if (body.code === 'invalid') return t('remoteInvalid');
      if (body.code === 'not-git') return t('notGit');
      if (body.code === 'no-session') return t('noSession');
      if (action === 'push') return withDetail(t('pushFailed'));
      return withDetail(t('remoteFailed'));
    }

    /**
     * Remote list, its shortcut selection, and the fast-forward push.
     * @param props.t - the `git-panel` dictionary.
     * @param props.value - the normalized panel value.
     * @param props.notice - the latest mutation notice, if any.
     * @param props.acting - the mutation in flight, or null.
     * @param props.busy - whether a panel read is in flight.
     * @param props.draft - the remote whose URL is being edited, or null.
     * @param props.addName - the add-remote name field.
     * @param props.addUrl - the add-remote URL field.
     * @param props.confirmRemove - the remote waiting for a second click, or null.
     * @param props.onPush - push the selected remotes.
     * @param props.onToggle - replace the saved selection.
     * @param props.onAdd - add the typed remote.
     * @param props.onSave - save the edited URL.
     * @param props.onRemove - remove one remote.
     * @param props.onDraft - start or cancel URL editing.
     * @param props.onAddName - update the name field.
     * @param props.onAddUrl - update the URL field.
     * @param props.onConfirmRemove - arm or cancel removal.
     */
    function RemoteSection(props) {
      const t = props.t;
      const value = props.value;
      const disabled = props.acting !== null || props.busy;
      if (!value.remotesKnown) {
        if (value.staleHost) return null;
        return h('div', { className: 'gp-notice' }, t('remotesStale'));
      }
      const targets = value.remotes.filter(remote => remote.push && !remote.unsafe).map(remote => remote.name);
      const canPush = value.state === 'ready' && !value.detached && targets.length > 0;
      let hint = t('pushNone');
      if (value.state !== 'ready' || value.detached) hint = t('pushNoBranch');
      else if (targets.length > 0) hint = t('pushHint', { branch: value.branch ?? '', remotes: targets.join(t('nameSep')) });
      const notice = props.notice === null
        ? null
        : h('div', { className: props.notice.tone === 'ok' ? 'gp-ok' : 'gp-error' }, props.notice.text);

      const rows = value.remotes.map(remote => {
        const editing = props.draft !== null && props.draft.name === remote.name;
        const confirming = props.confirmRemove === remote.name;
        return h('div', { key: remote.name, className: 'gp-remote', 'data-git-panel-remote': remote.name },
          h('input', {
            type: 'checkbox',
            className: 'gp-check',
            checked: remote.push === true,
            disabled: disabled || (remote.unsafe && remote.push !== true),
            'aria-label': t('includePush', { name: remote.name }),
            title: remote.unsafe ? t('remoteUnsafe') : t('includePush', { name: remote.name }),
            onChange: () => {
              const names = value.remotes
                .filter(item => (item.name === remote.name ? !item.push : item.push) && !item.unsafe)
                .map(item => item.name);
              props.onToggle(names);
            },
          }),
          h('span', { className: 'gp-remoteName' }, remote.name),
          editing
            ? h('input', {
              className: 'gp-field',
              'aria-label': t('remoteUrl'),
              value: props.draft.url,
              disabled: disabled,
              onChange: event => { props.onDraft({ name: remote.name, url: event.target.value }); },
            })
            : h('span', { className: 'gp-remoteUrl', title: remote.url }, remote.url),
          h('span', { className: 'gp-remoteActions' },
            editing
              ? h('button', {
                type: 'button',
                className: 'gp-iconButton',
                'aria-label': t('save'),
                title: t('save'),
                disabled: disabled || props.draft.url.trim() === '',
                onClick: () => { props.onSave(remote.name, props.draft.url); },
              }, h(IconCheckOutlineRegular, { size: 16 }))
              : null,
            editing
              ? h('button', {
                type: 'button',
                className: 'gp-iconButton',
                'aria-label': t('cancel'),
                title: t('cancel'),
                disabled: disabled,
                onClick: () => { props.onDraft(null); },
              }, h(IconCloseOutlineRegular, { size: 16 }))
              : h('button', {
                type: 'button',
                className: 'gp-iconButton',
                'aria-label': t('edit'),
                title: t('edit'),
                disabled: disabled,
                onClick: () => {
                  props.onConfirmRemove(null);
                  props.onDraft({ name: remote.name, url: remote.url });
                },
              }, h(IconEditOutlineRegular, { size: 16 })),
            confirming
              ? h('button', {
                type: 'button',
                className: 'gp-textButton',
                disabled: disabled,
                onClick: () => { props.onRemove(remote.name); },
              }, t('confirmRemove'))
              : h('button', {
                type: 'button',
                className: 'gp-iconButton',
                'aria-label': t('remove'),
                title: t('remove'),
                disabled: disabled || editing,
                onClick: () => { props.onConfirmRemove(remote.name); },
              }, h(IconTrashOutlineRegular, { size: 16 }))));
      });

      return h('div', { className: 'gp-section', 'data-git-panel-remotes': 'true' },
        h('div', { className: 'gp-sectionHead' },
          h('div', { className: 'gp-sectionTitle' }, t('remotesTitle')),
          h('button', {
            type: 'button',
            className: 'gp-push',
            'data-git-panel-push': canPush ? 'ready' : 'blocked',
            disabled: disabled || !canPush,
            title: hint,
            onClick: props.onPush,
          },
          h(IconPaperPlaneOutlineRegular, { size: 14 }),
          props.acting === 'push' ? t('pushBusy') : t('pushAll'))),
        h('div', { className: 'gp-hint' }, hint),
        notice,
        value.remotesFailed ? h('div', { className: 'gp-error' }, t('remotesFailed')) : null,
        h('div', { className: 'gp-box gp-remotesBox' },
          rows,
          value.remotes.length === 0 ? h('div', { className: 'gp-notice' }, t('noRemotes')) : null,
          h('form', {
            className: 'gp-add',
            onSubmit: event => {
              event.preventDefault();
              if (!disabled && props.addName.trim() !== '' && props.addUrl.trim() !== '') props.onAdd();
            },
          },
          h('input', {
            className: 'gp-field gp-field-name',
            'aria-label': t('remoteName'),
            placeholder: t('remoteName'),
            value: props.addName,
            disabled,
            onChange: event => { props.onAddName(event.target.value); },
          }),
          h('input', {
            className: 'gp-field',
            'aria-label': t('remoteUrl'),
            placeholder: t('remoteUrl'),
            value: props.addUrl,
            disabled,
            onChange: event => { props.onAddUrl(event.target.value); },
          }),
          h('button', {
            type: 'submit',
            className: 'gp-textButton',
            disabled: disabled || props.addName.trim() === '' || props.addUrl.trim() === '',
          }, t('addRemote')))));
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
      const [acting, setActing] = useState(null);
      const [notice, setNotice] = useState(null);
      const [draft, setDraft] = useState(null);
      const [addName, setAddName] = useState('');
      const [addUrl, setAddUrl] = useState('');
      const [confirmRemove, setConfirmRemove] = useState(null);
      const [openOid, setOpenOid] = useState(null);
      const [detail, setDetail] = useState(null);
      const details = useRef(new Map());
      // A slow earlier read must never overwrite a newer one.
      const seq = useRef(0);

      const load = useCallback((limit, quiet) => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setRead({ status: 'failed', message: t('noSession') });
          return;
        }
        seq.current += 1;
        const mine = seq.current;
        setBusy(true);
        if (quiet !== true && limit === INITIAL_LIMIT) setRead({ status: 'loading' });
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
        setNotice(null);
        load(INITIAL_LIMIT);
      }, [load]);
      const closePanel = useCallback(() => {
        setOpen(false);
        setOpenOid(null);
      }, []);
      const refresh = useCallback(() => {
        load(read.status === 'ready' ? read.value.limit : INITIAL_LIMIT);
      }, [load, read]);
      const loadMore = useCallback(() => {
        if (read.status === 'ready') load(read.value.limit + PAGE_STEP);
      }, [load, read]);

      const mutate = useCallback((action, extra) => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setNotice({ tone: 'error', text: t('noSession') });
          return;
        }
        setActing(action);
        setNotice(null);
        const limit = read.status === 'ready' ? read.value.limit : INITIAL_LIMIT;
        fetch(ROUTE, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, action, ...extra }),
        })
          .then(response => response.json())
          .then(body => {
            const ok = body !== null && typeof body === 'object' && body.ok === true;
            setNotice({ tone: ok ? 'ok' : 'error', text: outcomeText(action, body, t) });
            if (!ok) return;
            setDraft(null);
            setConfirmRemove(null);
            if (action === 'remote-add') {
              setAddName('');
              setAddUrl('');
            }
            load(limit, true);
          })
          .catch(() => {
            setNotice({ tone: 'error', text: t('errorUnavailable') });
          })
          .finally(() => { setActing(null); });
      }, [sessionId, t, load, read]);

      useEffect(() => {
        if (!open || openOid === null || typeof sessionId !== 'string' || sessionId === '') return undefined;
        const cached = details.current.get(openOid);
        if (cached !== undefined) {
          setDetail({ status: 'ready', oid: openOid, value: cached });
          return undefined;
        }
        let cancelled = false;
        setDetail({ status: 'loading', oid: openOid });
        fetch(ROUTE + '?sessionId=' + encodeURIComponent(sessionId) + '&commit=' + encodeURIComponent(openOid),
          { headers: { accept: 'application/json' } })
          .then(response => response.json())
          .then(body => {
            if (cancelled) return;
            const value = normalizeCommit(body);
            if (value === null || value.stale === true) {
              setDetail({
                status: 'failed',
                oid: openOid,
                message: value !== null && value.stale === true ? t('commitStale') : t('commitFailed'),
              });
              return;
            }
            details.current.set(openOid, value);
            setDetail({ status: 'ready', oid: openOid, value });
          })
          .catch(() => {
            if (!cancelled) setDetail({ status: 'failed', oid: openOid, message: t('errorUnavailable') });
          });
        return () => { cancelled = true; };
      }, [open, openOid, sessionId, t]);

      useEffect(() => {
        if (openOid === null) return;
        const node = document.querySelector('[data-git-panel-commit="' + CSS.escape(openOid) + '"]');
        if (node !== null) node.scrollIntoView({ block: 'nearest' });
      }, [openOid]);

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
        else {
          const known = new Map(value.commits.map(commit => [commit.oid.toLowerCase(), commit.oid]));
          history = h('div', { className: 'gp-graphRows' },
            value.commits.map((commit, index) => h(CommitRow, {
              key: commit.oid,
              commit,
              columns: value.lanes[index] === undefined ? [] : value.lanes[index],
              current: value.branch,
              t,
              open: openOid === commit.oid,
              detail: openOid !== commit.oid
                ? null
                : detail !== null && detail.oid === commit.oid
                  ? detail
                  : { status: 'loading' },
              known,
              onToggle: () => { setOpenOid(current => current === commit.oid ? null : commit.oid); },
              onOpen: setOpenOid,
            })));
        }

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
          h(RemoteSection, {
            t,
            value,
            notice,
            acting,
            busy,
            draft,
            addName,
            addUrl,
            confirmRemove,
            onPush: () => { mutate('push'); },
            onToggle: names => { mutate('push-set', { remotes: names }); },
            onAdd: () => { mutate('remote-add', { name: addName.trim(), url: addUrl.trim() }); },
            onSave: (name, url) => { mutate('remote-set-url', { name, url: url.trim() }); },
            onRemove: name => { mutate('remote-remove', { name }); },
            onDraft: setDraft,
            onAddName: setAddName,
            onAddUrl: setAddUrl,
            onConfirmRemove: setConfirmRemove,
          }),
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
                  disabled: busy || acting !== null,
                }, t('loadMore'))
                : null)));
      }

      const panel = h('div', {
        className: 'gp-card',
        'data-dsh-plugin': 'git-panel',
        'data-dsh-part': 'dialog',
      },
      header(subtitle, iconButton(t('refresh'), h(IconRefreshOutlineRegular, { size: 16 }), refresh, busy || acting !== null)),
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
          onKeyDownCapture: event => {
            if (event.key === 'Escape' && openOid !== null) {
              event.preventDefault();
              setOpenOid(null);
            }
          },
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
