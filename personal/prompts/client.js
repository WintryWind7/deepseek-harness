/**
 * Browser half of @wintry/prompts.
 *
 * Registers a composer control beside the Git panel and a page in the personal
 * settings shell. Both edit one profile library. Choosing a prompt writes its
 * body into the current input and does not send it.
 */
window.__ModuleLoader__.load({
  id: '@wintry/prompts',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { Button, Modal } = primitives
    const {
      IconCloseOutlineRegular,
      IconEditOutlineRegular,
      IconListPenOutlineRegular,
      IconTrashOutlineRegular,
    } = primitives
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'prompt-library'
    const ROUTE = 'api/prompt.library'
    const PAGE = 'personal.settings.page'
    const TOOLBAR = 'personal.settings.toolbar'
    /** Matches the Host library limits. */
    const MAX_PROMPTS = 200
    const MAX_TITLE = 200
    const MAX_BODY = 100000
    const MAX_TAIL = 20000
    const TAILS_ROUTE = 'api/prompt.tails'

    const zh = {
      trigger: '提示词库',
      title: '提示词库',
      nav: '提示词',
      intro: '和作曲栏弹层改的是同一份库。点弹层里的标题会把正文写进输入框，不会直接发送。',
      close: '关闭',
      loading: '正在读取提示词库…',
      loadFailed: '提示词库读取失败。',
      unavailable: '提示词库暂时不可用。',
      unreadable: '提示词库文件无法读取，没有覆盖它。',
      saved: '已保存。',
      saveFailed: '保存失败。',
      conflict: '库刚在别处改过。重新读取后再保存。',
      emptyTitle: '标题不能为空。',
      tooLong: '有一条正文超出长度限制。',
      titleTooLong: '标题最长 200 字。',
      titleField: '标题',
      bodyField: '正文',
      full: '最多保存 200 条。',
      invalid: '这条库无法保存。',
      save: '保存',
      unsaved: '{count} 处未保存的更改',
      tabPrompts: '提示词',
      tabTails: '系统尾注',
      tailIntro: '追加在该预设系统提示词的最后。留空则不追加。保存后，已打开的会话从下一轮请求起生效。',
      tailIntroPage: '追加在该预设系统提示词的最后。留空则不追加。保存后，已打开的会话从下一轮请求起生效。这一页不能写入输入框。',
      tailCount: '{count} 个预设',
      tailEmpty: '留空，不追加',
      tailHidden: '这个预设使用完整人设，尾注不会出现。',
      tailUnseen: '看不到',
      tailBroken: '当前挂不上。',
      tailTooLong: '一条尾注最长 20000 字。',
      noPresets: '没有预设。',
      back: '返回',
      confirm: '确认',
      confirmEmpty: '确认后整段写入输入框，不会发送。',
      confirmAppend: '确认后插在光标处，不覆盖已有内容，也不会发送。',
      create: '新建',
      edit: '编辑',
      collapse: '收起',
      remove: '删除',
      reload: '重新读取',
      retry: '重试',
      search: '搜索标题',
      untitled: '未命名',
      empty: '还没有提示词。',
      emptyBody: '这条还没有正文。',
      noMatch: '没有匹配的标题。',
      pickHint: '点标题打开正文页，确认后写入输入框。',
      subtitle: '{count} 条',
      chars: '{count} 字',
      busy: '输入框正忙，没有写入。',
      insertRejected: '输入框刚被改过，没有写入。',
      panelFailed: '面板渲染失败，已保留图标。详细信息见浏览器控制台。',
    }
    const en = {
      trigger: 'Prompt library',
      title: 'Prompt library',
      nav: 'Prompts',
      intro: 'This edits the same library as the composer panel. Choosing a title there writes the body into the input and does not send it.',
      close: 'Close',
      loading: 'Reading the prompt library…',
      loadFailed: 'Could not read the prompt library.',
      unavailable: 'The prompt library is unavailable.',
      unreadable: 'The prompt library file could not be read, so it was left in place.',
      saved: 'Saved.',
      saveFailed: 'Could not save.',
      conflict: 'The library changed elsewhere. Reload it, then save again.',
      emptyTitle: 'A title is required.',
      tooLong: 'One body is over the length limit.',
      titleTooLong: 'A title can be at most 200 characters.',
      titleField: 'Title',
      bodyField: 'Body',
      full: 'The library already has 200 prompts.',
      invalid: 'This library could not be saved.',
      save: 'Save',
      unsaved: '{count} unsaved changes',
      tabPrompts: 'Prompts',
      tabTails: 'System tail',
      tailIntro: 'Appended after that preset’s system prompt. Leave it empty to append nothing. An open session picks it up on its next request.',
      tailIntroPage: 'Appended after that preset’s system prompt. Leave it empty to append nothing. An open session picks it up on its next request. This page does not write into the input.',
      tailCount: '{count} presets',
      tailEmpty: 'Empty, so nothing is appended',
      tailHidden: 'This preset uses a complete persona, so the tail will not appear.',
      tailUnseen: 'hidden',
      tailBroken: 'This preset is not mounted.',
      tailTooLong: 'A tail can be at most 20,000 characters.',
      noPresets: 'No presets.',
      back: 'Back',
      confirm: 'Confirm',
      confirmEmpty: 'Writes the whole body into the empty input. Nothing is sent.',
      confirmAppend: 'Inserts the body at the caret without replacing anything. Nothing is sent.',
      create: 'New',
      edit: 'Edit',
      collapse: 'Collapse',
      remove: 'Delete',
      reload: 'Reload',
      retry: 'Retry',
      search: 'Search titles',
      untitled: 'Untitled',
      empty: 'No prompts yet.',
      emptyBody: 'This prompt has no body yet.',
      noMatch: 'No title matches.',
      pickHint: 'Choose a title to open its body, then confirm to write it into the input.',
      subtitle: '{count} prompts',
      chars: '{count} characters',
      busy: 'The input is busy, so nothing was written.',
      insertRejected: 'The input changed, so nothing was written.',
      panelFailed: 'The panel failed to render. The icon stays available; see the browser console for the error.',
    }

    const CSS = `
      .pl-dialog.pl-dialog {
        width: min(560px, 100%);
        max-height: min(76vh, 720px);
        gap: 0;
        padding: 16px 16px 12px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 12px;
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);
      }
      .pl-card, .pl-page, .pl-editor { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
      .pl-card, .pl-editor-panel { flex: 1 1 auto; }
      .pl-page { gap: 16px; }
      .pl-intro, .pl-hintLine { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .pl-hintLine { margin: 0 4px 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .pl-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; padding: 0 4px 12px;
      }
      .pl-heading { min-width: 0; }
      .pl-titleText {
        margin: 0; font-size: 15px; font-weight: 500; line-height: 22px;
        color: var(--dsw-alias-label-primary); overflow-wrap: anywhere;
      }
      .pl-subtitle { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .pl-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; flex: 1 1 auto; }
      .pl-listHead { display: flex; align-items: center; gap: 8px; }
      .pl-listHead .pl-input { flex: 1 1 auto; min-width: 0; }
      .pl-listHead .pl-ghost { flex: none; }
      .pl-editor-panel .pl-listBox {
        flex: 1 1 auto; min-height: 220px; max-height: min(52vh, 480px);
        overflow-y: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 4px;
      }
      .pl-editor-page .pl-listBox { display: flex; flex-direction: column; gap: 8px; }
      .pl-listBox::-webkit-scrollbar, .pl-detailText::-webkit-scrollbar { width: 6px; }
      .pl-listBox::-webkit-scrollbar-thumb, .pl-detailText::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 3px; }
      .pl-listBox::-webkit-scrollbar-track, .pl-detailText::-webkit-scrollbar-track { background: transparent; }
      .pl-detail { gap: 14px; }
      .pl-detail .pl-header { padding-bottom: 0; }
      .pl-detail .pl-footer { padding-top: 0; }
      .pl-detail .pl-heading { flex: 1 1 auto; }
      .pl-kicker { margin-bottom: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .pl-headerActions { display: flex; align-items: center; gap: 4px; flex: none; }
      .pl-detailSection { display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1 1 auto; }
      .pl-sectionHead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 4px; }
      .pl-sectionTitle, .pl-count { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .pl-detailText {
        flex: 1 1 auto; min-height: 96px; max-height: min(52vh, 460px); overflow-y: auto;
        margin: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
        color: var(--dsw-alias-label-primary);
        font-family: inherit; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .pl-detailMuted { color: var(--dsw-alias-label-tertiary); }
      .pl-footerHint { flex: 1 1 auto; min-width: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
      .pl-item { min-width: 0; border-radius: 10px; }
      .pl-editor-page .pl-item { border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 16px; padding: 4px 8px; }
      .pl-row { display: flex; align-items: center; gap: 4px; border-radius: 8px; }
      .pl-item[data-open] > .pl-row, .pl-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .pl-title {
        flex: 1 1 auto; min-width: 0; border: none; background: transparent; cursor: pointer;
        padding: 7px 8px; text-align: start; font: inherit; font-size: 13px;
        color: var(--dsw-alias-label-primary);
      }
      .pl-titleTextRow, .pl-preview {
        display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .pl-preview { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .pl-title:focus-visible, .pl-iconButton:focus-visible, .pl-ghost:focus-visible, .pl-save:focus-visible, .pl-input:focus-visible, .pl-textarea:focus-visible {
        outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary);
      }
      .pl-fields { display: flex; flex-direction: column; gap: 8px; padding: 4px 8px 10px; }
      .pl-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .pl-remove { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; }
      .pl-label { font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .pl-input, .pl-textarea {
        width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px; padding: 6px 8px; background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px;
      }
      .pl-textarea { min-height: 140px; resize: vertical; }
      .pl-empty { margin: 0; padding: 24px 10px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
      .pl-iconButton {
        display: inline-flex; align-items: center; justify-content: center; flex: none;
        width: 26px; height: 26px; border: none; border-radius: 8px;
        background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer;
      }
      .pl-iconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .pl-iconButton:disabled { opacity: 0.55; cursor: not-allowed; }
      .pl-footer, .pl-toolbar { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .pl-footer { padding-top: 12px; }
      .pl-toolbar { width: 100%; }
      .pl-dirty { font-size: 13px; color: var(--dsw-alias-state-error-primary); }
      .pl-ghost, .pl-save {
        border: none; border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 13px; cursor: pointer;
      }
      .pl-ghost { background: transparent; color: var(--dsw-alias-label-secondary); }
      .pl-ghost:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .pl-save {
        margin-left: auto; flex: none; font-weight: 500;
        background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted);
      }
      .pl-save:disabled, .pl-ghost:disabled { opacity: 0.55; cursor: not-allowed; }
      .pl-error, .pl-status {
        margin: 0 0 8px; padding: 6px 10px; border-radius: 8px; font-size: 13px;
      }
      .pl-error { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
      .pl-status { color: var(--dsw-alias-label-secondary); }
      .pl-error .pl-ghost { margin-top: 6px; }
      .pl-tabs { display: flex; gap: 4px; padding: 0 4px 12px; }
      .pl-tab {
        border: none; border-radius: 8px; padding: 4px 10px; background: transparent;
        color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer;
      }
      .pl-tab[aria-selected="true"] {
        background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 500;
      }
      .pl-tab:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .pl-editor-panel .pl-tailBox {
        flex: 1 1 auto; min-height: 220px; max-height: min(52vh, 480px); overflow-y: auto;
        display: flex; flex-direction: column; gap: 8px;
      }
      .pl-editor-page .pl-tailBox { display: flex; flex-direction: column; gap: 8px; }
      .pl-tail {
        display: flex; flex-direction: column; gap: 6px; min-width: 0;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px;
      }
      .pl-tailHead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
      .pl-tailId { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .pl-tailDesc {
        margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary);
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .pl-tailNote { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
      .pl-tail .pl-textarea { min-height: 72px; }
      .pl-countError { color: var(--dsw-alias-state-error-primary); }
    `

    const listeners = new Set()
    let loadSeq = 0
    let snapshot = {
      status: 'idle',
      error: '',
      notice: '',
      conflict: false,
      saving: false,
      revision: 0,
      saved: [],
      drafts: [],
    }

    function emit() {
      for (const listener of listeners) listener()
    }

    function publish(next) {
      snapshot = next
      emit()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    function getSnapshot() {
      return snapshot
    }

    function useLibrary() {
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    function copyPrompt(prompt) {
      return { id: prompt.id, title: prompt.title, body: prompt.body }
    }

    function countDirty(saved, drafts) {
      const savedById = new Map(saved.map(item => [item.id, item]))
      const draftIds = new Set(drafts.map(item => item.id))
      let count = 0
      for (const draft of drafts) {
        const previous = savedById.get(draft.id)
        if (previous === undefined) count += 1
        else {
          if (previous.title !== draft.title) count += 1
          if (previous.body !== draft.body) count += 1
        }
      }
      for (const previous of saved) if (!draftIds.has(previous.id)) count += 1
      return count
    }

    function libraryFrom(body) {
      if (body === null || typeof body !== 'object' || body.ok !== true) return null
      const value = body.value
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
      if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.prompts)) return null
      const prompts = []
      for (const item of value.prompts) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
        if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.body !== 'string') return null
        prompts.push(copyPrompt(item))
      }
      return { revision: value.revision, prompts }
    }

    /**
     * One candidate id: 16 lowercase hex characters, the form stored ids
     * already use and the Host id pattern accepts. `crypto.randomUUID` exists
     * only in a secure context, so an insecure origin (a LAN address over plain
     * HTTP) falls back to `crypto.getRandomValues`, which every origin exposes.
     * @returns the id.
     */
    function newId() {
      if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replaceAll('-', '').slice(0, 16)
      }
      const bytes = crypto.getRandomValues(new Uint8Array(8))
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    }

    /**
     * An id no current draft uses.
     * @param prompts - the drafts the id must not collide with.
     * @returns the id.
     */
    function freshId(prompts) {
      const used = new Set(prompts.map(item => item.id))
      let id = newId()
      while (used.has(id)) id = newId()
      return id
    }

    async function startLoad() {
      const seq = ++loadSeq
      const previous = snapshot
      publish({ ...previous, status: 'loading', error: '', notice: '', conflict: false })
      try {
        const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
        const body = await response.json()
        if (seq !== loadSeq) return
        const value = libraryFrom(body)
        if (value === null) {
          const code = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'loadFailed'
          publish({ ...previous, status: previous.drafts.length > 0 ? 'ready' : 'error', error: code, saving: false })
          return
        }
        publish({
          status: 'ready',
          error: '',
          notice: '',
          conflict: false,
          saving: false,
          revision: value.revision,
          saved: value.prompts,
          drafts: value.prompts.map(copyPrompt),
        })
      } catch (error) {
        // The route did not answer. Keep a library that is already on screen.
        if (seq !== loadSeq) return
        publish({
          ...previous,
          status: previous.drafts.length > 0 ? 'ready' : 'error',
          error: 'unavailable',
          saving: false,
        })
      }
    }

    /**
     * Re-read the library in the background when nothing here is unsaved,
     * because the settings page or another tab may have saved a newer revision.
     * A refresh that fails, or that answers with something unusable, leaves the
     * library already on screen unchanged.
     */
    async function refreshLibrary() {
      if (snapshot.saving || countDirty(snapshot.saved, snapshot.drafts) > 0) return
      const seq = ++loadSeq
      let body
      try {
        body = await (await fetch(ROUTE, { headers: { accept: 'application/json' } })).json()
      } catch (error) {
        // The refresh did not answer. The library on screen stays as it is.
        return
      }
      if (seq !== loadSeq) return
      const value = libraryFrom(body)
      if (value === null) return
      const latest = snapshot
      if (latest.saving || countDirty(latest.saved, latest.drafts) > 0) return
      publish({
        ...latest,
        status: 'ready',
        error: '',
        notice: '',
        conflict: false,
        saving: false,
        revision: value.revision,
        saved: value.prompts,
        drafts: value.prompts.map(copyPrompt),
      })
    }

    function loadLibrary() {
      if (snapshot.status === 'loading') return
      if (snapshot.status === 'ready') {
        void refreshLibrary()
        return
      }
      void startLoad()
    }

    function reloadLibrary() {
      if (snapshot.saving) return
      void startLoad()
    }

    function changePrompt(id, patch) {
      if (snapshot.saving || snapshot.status !== 'ready') return
      publish({
        ...snapshot,
        error: '',
        notice: '',
        drafts: snapshot.drafts.map(item => item.id === id ? { ...item, ...patch } : item),
      })
    }

    function addPrompt(title) {
      if (snapshot.status !== 'ready' || snapshot.saving) return undefined
      if (snapshot.drafts.length >= MAX_PROMPTS) {
        publish({ ...snapshot, error: 'full', notice: '' })
        return undefined
      }
      const prompt = { id: freshId(snapshot.drafts), title, body: '' }
      publish({
        ...snapshot,
        error: '',
        notice: '',
        drafts: [...snapshot.drafts, prompt],
      })
      return prompt.id
    }

    function removePrompt(id) {
      if (snapshot.saving || snapshot.status !== 'ready') return
      publish({
        ...snapshot,
        error: '',
        notice: '',
        drafts: snapshot.drafts.filter(item => item.id !== id),
      })
    }

    async function saveLibrary() {
      const current = snapshot
      if (current.status !== 'ready' || current.saving || countDirty(current.saved, current.drafts) === 0) return
      for (const prompt of current.drafts) {
        const title = prompt.title.trim()
        if (title === '') {
          publish({ ...current, error: 'emptyTitle', notice: '' })
          return
        }
        if (title.length > MAX_TITLE) {
          publish({ ...current, error: 'titleTooLong', notice: '' })
          return
        }
        if (prompt.body.length > MAX_BODY) {
          publish({ ...current, error: 'tooLong', notice: '' })
          return
        }
      }
      publish({ ...current, saving: true, error: '', notice: '', conflict: false })
      try {
        const response = await fetch(ROUTE, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            revision: current.revision,
            prompts: current.drafts.map(prompt => ({
              id: prompt.id,
              title: prompt.title.trim(),
              body: prompt.body,
            })),
          }),
        })
        const body = await response.json()
        if (response.status === 409 || (body && body.error === 'conflict')) {
          publish({ ...snapshot, saving: false, conflict: true, error: 'conflict', notice: '' })
          return
        }
        const value = libraryFrom(body)
        if (!response.ok || value === null) {
          const code = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'saveFailed'
          publish({ ...snapshot, saving: false, error: code === 'conflict' ? 'conflict' : code, notice: '' })
          return
        }
        publish({
          status: 'ready',
          error: '',
          notice: 'saved',
          conflict: false,
          saving: false,
          revision: value.revision,
          saved: value.prompts,
          drafts: value.prompts.map(copyPrompt),
        })
      } catch (error) {
        // The save did not reach the profile file. Keep the drafts on screen.
        publish({ ...snapshot, saving: false, error: 'unavailable', notice: '' })
      }
    }

    const tailListeners = new Set()
    let tailLoadSeq = 0
    let tailSnapshot = {
      status: 'idle',
      error: '',
      notice: '',
      conflict: false,
      saving: false,
      revision: 0,
      saved: [],
      drafts: [],
    }

    function emitTails() {
      for (const listener of tailListeners) listener()
    }

    function publishTails(next) {
      tailSnapshot = next
      emitTails()
    }

    function subscribeTails(listener) {
      tailListeners.add(listener)
      return () => { tailListeners.delete(listener) }
    }

    function useTails() {
      return useSyncExternalStore(subscribeTails, () => tailSnapshot, () => tailSnapshot)
    }

    function countTailDirty(saved, drafts) {
      const savedById = new Map(saved.map(item => [item.id, item.text]))
      let count = 0
      for (const draft of drafts) {
        if ((savedById.get(draft.id) ?? '') !== draft.text) count += 1
      }
      return count
    }

    function tailsFrom(body) {
      if (body === null || typeof body !== 'object' || body.ok !== true) return null
      const value = body.value
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
      if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.presets)) return null
      if (value.tails === null || typeof value.tails !== 'object' || Array.isArray(value.tails)) return null
      const drafts = []
      for (const item of value.presets) {
        if (item === null || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string') return null
        const stored = value.tails[item.id]
        drafts.push({
          id: item.id,
          name: typeof item.name === 'string' ? item.name : '',
          description: typeof item.description === 'string' ? item.description : '',
          broken: typeof item.broken === 'string' ? item.broken : '',
          hidden: item.hidden === true,
          text: typeof stored === 'string' ? stored : '',
        })
      }
      return { revision: value.revision, drafts }
    }

    function tailRows(drafts) {
      return drafts.map(item => ({ ...item }))
    }

    async function startTailLoad() {
      const seq = ++tailLoadSeq
      const previous = tailSnapshot
      publishTails({ ...previous, status: 'loading', error: '', notice: '', conflict: false })
      try {
        const response = await fetch(TAILS_ROUTE, { headers: { accept: 'application/json' } })
        const body = await response.json()
        if (seq !== tailLoadSeq) return
        const value = tailsFrom(body)
        if (value === null) {
          const code = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'loadFailed'
          publishTails({ ...previous, status: previous.drafts.length > 0 ? 'ready' : 'error', error: code, saving: false })
          return
        }
        const drafts = tailRows(value.drafts)
        publishTails({
          status: 'ready',
          error: '',
          notice: '',
          conflict: false,
          saving: false,
          revision: value.revision,
          saved: tailRows(drafts),
          drafts,
        })
      } catch (error) {
        if (seq !== tailLoadSeq) return
        publishTails({
          ...previous,
          status: previous.drafts.length > 0 ? 'ready' : 'error',
          error: 'unavailable',
          saving: false,
        })
      }
    }

    async function refreshTails() {
      if (tailSnapshot.saving || countTailDirty(tailSnapshot.saved, tailSnapshot.drafts) > 0) return
      const seq = ++tailLoadSeq
      let body
      try {
        body = await (await fetch(TAILS_ROUTE, { headers: { accept: 'application/json' } })).json()
      } catch (error) {
        return
      }
      if (seq !== tailLoadSeq) return
      const value = tailsFrom(body)
      if (value === null) return
      const latest = tailSnapshot
      if (latest.saving || countTailDirty(latest.saved, latest.drafts) > 0) return
      const drafts = tailRows(value.drafts)
      publishTails({
        ...latest,
        status: 'ready',
        error: '',
        notice: '',
        conflict: false,
        saving: false,
        revision: value.revision,
        saved: tailRows(drafts),
        drafts,
      })
    }

    function loadTails() {
      if (tailSnapshot.status === 'loading') return
      if (tailSnapshot.status === 'ready') {
        void refreshTails()
        return
      }
      void startTailLoad()
    }

    function reloadTails() {
      if (tailSnapshot.saving) return
      void startTailLoad()
    }

    function changeTail(id, text) {
      if (tailSnapshot.saving || tailSnapshot.status !== 'ready') return
      publishTails({
        ...tailSnapshot,
        error: '',
        notice: '',
        drafts: tailSnapshot.drafts.map(item => item.id === id ? { ...item, text } : item),
      })
    }

    async function saveTails() {
      const current = tailSnapshot
      if (current.status !== 'ready' || current.saving || countTailDirty(current.saved, current.drafts) === 0) return
      for (const row of current.drafts) {
        if (row.text.trim().length > MAX_TAIL) {
          publishTails({ ...current, error: 'tailTooLong', notice: '' })
          return
        }
      }
      const tails = {}
      for (const row of current.drafts) tails[row.id] = row.text
      publishTails({ ...current, saving: true, error: '', notice: '', conflict: false })
      try {
        const response = await fetch(TAILS_ROUTE, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ revision: current.revision, tails }),
        })
        const body = await response.json()
        if (response.status === 409 || (body && body.error === 'conflict')) {
          publishTails({ ...tailSnapshot, saving: false, conflict: true, error: 'conflict', notice: '' })
          return
        }
        const value = tailsFrom(body)
        if (!response.ok || value === null) {
          const code = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : 'saveFailed'
          publishTails({ ...tailSnapshot, saving: false, error: code === 'conflict' ? 'conflict' : code, notice: '' })
          return
        }
        const drafts = tailRows(value.drafts)
        publishTails({
          status: 'ready',
          error: '',
          notice: 'saved',
          conflict: false,
          saving: false,
          revision: value.revision,
          saved: tailRows(drafts),
          drafts,
        })
      } catch (error) {
        publishTails({ ...tailSnapshot, saving: false, error: 'unavailable', notice: '' })
      }
    }

    const toolbarIdle = { dirty: 0, disabled: true, save() {} }
    const toolbarStore = { current: toolbarIdle, listeners: new Set() }

    function publishToolbar(next) {
      toolbarStore.current = next
      for (const listener of toolbarStore.listeners) listener()
    }

    function subscribeToolbar(listener) {
      toolbarStore.listeners.add(listener)
      return () => { toolbarStore.listeners.delete(listener) }
    }

    function getToolbar() {
      return toolbarStore.current
    }

    /**
     * Keeps a failed panel render inside the dialog so the composer control stays.
     */
    class PanelBoundary extends React.Component {
      /** @param props - `children` is the panel and `fallback` the replacement. */
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      /** @returns the state that switches this subtree to its fallback. */
      static getDerivedStateFromError() {
        return { failed: true }
      }

      /**
       * Report the error the fallback is standing in for.
       * @param error - the render failure.
       */
      componentDidCatch(error) {
        console.error('[prompt-library] panel render failed:', error)
      }

      /** @returns the panel, or the fallback once a render has failed. */
      render() {
        return this.state.failed ? this.props.fallback : this.props.children
      }
    }

    function LibraryMessage(props) {
      const library = props.library
      const t = props.t
      if (library.error !== '') {
        return h('div', { className: 'pl-error' },
          t(library.error),
          library.conflict
            ? h('div', null, h('button', {
              type: 'button',
              className: 'pl-ghost',
              onClick: () => { reloadLibrary() },
            }, t('reload')))
            : null)
      }
      if (props.localNotice) return h('div', { className: 'pl-error' }, props.localNotice)
      if (library.notice !== '') return h('p', { className: 'pl-status' }, t(library.notice))
      return null
    }

    function PromptEditor(props) {
      const t = props.t
      const library = useLibrary()
      const [selectedId, setSelectedId] = useState()
      const [filter, setFilter] = useState('')
      const disabled = library.status !== 'ready' || library.saving
      const query = filter.trim().toLowerCase()
      const visible = query === ''
        ? library.drafts
        : library.drafts.filter(item => item.title.toLowerCase().includes(query))
      const dirty = countDirty(library.saved, library.drafts)

      if (library.status === 'error' && library.drafts.length === 0) {
        return h('div', { className: 'pl-empty' },
          h('p', null, t(library.error || 'loadFailed')),
          h('button', { type: 'button', className: 'pl-ghost', onClick: () => { reloadLibrary() } }, t('retry')))
      }
      if (library.status !== 'ready' && library.drafts.length === 0) {
        return h('div', { className: 'pl-empty' }, t('loading'))
      }

      const toggle = id => { setSelectedId(selectedId === id ? undefined : id) }
      const list = visible.length === 0
        ? h('div', { className: 'pl-empty' }, t(library.drafts.length === 0 ? 'empty' : 'noMatch'))
        : visible.map(item => {
          const open = item.id === selectedId
          const preview = item.body.replace(/\s+/g, ' ').trim()
          const fields = open
            ? h('div', { className: 'pl-fields' },
              h('label', { className: 'pl-field' },
                h('span', { className: 'pl-label' }, t('titleField')),
                h('input', {
                  className: 'pl-input',
                  value: item.title,
                  disabled,
                  autoFocus: true,
                  onChange: event => { changePrompt(item.id, { title: event.target.value }) },
                })),
              h('label', { className: 'pl-field' },
                h('span', { className: 'pl-label' }, t('bodyField')),
                h('textarea', {
                  className: 'pl-textarea',
                  value: item.body,
                  disabled,
                  onChange: event => { changePrompt(item.id, { body: event.target.value }) },
                })),
              h('button', {
                type: 'button',
                className: 'pl-ghost pl-remove',
                disabled,
                onClick: () => {
                  removePrompt(item.id)
                  setSelectedId(undefined)
                },
              }, h(IconTrashOutlineRegular, { size: 14 }), t('remove')))
            : null
          return h('div', {
            key: item.id,
            className: 'pl-item',
            'data-open': open ? '' : undefined,
          },
          h('div', { className: 'pl-row' },
            h('button', {
              type: 'button',
              className: 'pl-title',
              'aria-expanded': props.mode === 'page' ? open : undefined,
              onClick: () => {
                if (props.mode !== 'panel') {
                  toggle(item.id)
                  return
                }
                props.onPick(item.id)
              },
            },
            h('span', { className: 'pl-titleTextRow' }, item.title.trim() || t('untitled')),
            preview === '' ? null : h('span', { className: 'pl-preview' }, preview)),
            h('button', {
              type: 'button',
              className: 'pl-iconButton',
              'aria-expanded': open,
              'aria-label': t(open ? 'collapse' : 'edit'),
              title: t(open ? 'collapse' : 'edit'),
              onClick: () => { toggle(item.id) },
            }, h(IconEditOutlineRegular, { size: 14 }))),
          fields)
        })

      const footer = props.mode === 'panel'
        ? h('div', { className: 'pl-footer' },
          dirty > 0 ? h('span', { className: 'pl-dirty' }, t('unsaved', { count: dirty })) : null,
          h('button', {
            type: 'button',
            className: 'pl-save',
            disabled: disabled || dirty === 0,
            onClick: () => { void saveLibrary() },
          }, t('save')))
        : null

      return h('div', { className: props.mode === 'panel' ? 'pl-editor pl-editor-panel' : 'pl-editor pl-editor-page' },
        h(LibraryMessage, { library, t, localNotice: props.localNotice }),
        props.mode === 'panel' ? h('p', { className: 'pl-hintLine' }, t('pickHint')) : null,
        h('div', { className: 'pl-list' },
          h('div', { className: 'pl-listHead' },
            h('input', {
              className: 'pl-input',
              value: filter,
              placeholder: t('search'),
              'aria-label': t('search'),
              'data-modal-autofocus': props.mode === 'panel' ? '' : undefined,
              onChange: event => { setFilter(event.target.value) },
            }),
            h('button', {
              type: 'button',
              className: 'pl-ghost',
              disabled,
              onClick: () => {
                const id = addPrompt(t('untitled'))
                if (id !== undefined) setSelectedId(id)
              },
            }, t('create'))),
          h('div', { className: 'pl-listBox' }, list)),
        footer)
    }

    /**
     * Read-only page for one prompt: its title, its whole body, and the confirm
     * button that writes the body into the composer. A refused write stays on
     * this page with the reason visible.
     */
    function PromptDetail(props) {
      const t = props.t
      const prompt = props.prompt
      const body = prompt.body
      const confirm = useRef()
      // The title button this page replaces unmounts, so the page takes focus
      // back: Enter confirms without a trip through the Tab order.
      useEffect(() => { confirm.current?.focus() }, [])
      return h('div', {
        className: 'pl-card pl-detail',
        'data-dsh-plugin': 'prompt-library',
        'data-dsh-part': 'detail',
      },
      h('div', { className: 'pl-header' },
        h('div', { className: 'pl-heading' },
          h('div', { className: 'pl-kicker' }, t('title')),
          h('h3', { className: 'pl-titleText' }, prompt.title.trim() || t('untitled'))),
        h('div', { className: 'pl-headerActions' },
          h('button', {
            type: 'button',
            className: 'pl-ghost',
            onClick: props.onBack,
          }, t('back')),
          h('button', {
            type: 'button',
            className: 'pl-iconButton',
            'aria-label': t('close'),
            title: t('close'),
            onClick: props.onClose,
          }, h(IconCloseOutlineRegular, { size: 16 })))),
      h('div', { className: 'pl-detailSection' },
        h('div', { className: 'pl-sectionHead' },
          h('span', { className: 'pl-sectionTitle' }, t('bodyField')),
          h('span', { className: 'pl-count' }, t('chars', { count: body.length }))),
        h('div', {
          className: body === '' ? 'pl-detailText pl-detailMuted' : 'pl-detailText',
        }, body === '' ? t('emptyBody') : body)),
      props.notice === '' ? null : h('div', { className: 'pl-error' }, props.notice),
      h('div', { className: 'pl-footer' },
        h('span', { className: 'pl-footerHint' }, t(props.empty ? 'confirmEmpty' : 'confirmAppend')),
        h('button', {
          type: 'button',
          ref: confirm,
          className: 'pl-save',
          onClick: props.onConfirm,
        }, t('confirm'))))
    }

    function Tabs(props) {
      const t = props.t
      return h('div', { className: 'pl-tabs', role: 'tablist' },
        h('button', {
          type: 'button',
          className: 'pl-tab',
          role: 'tab',
          'aria-selected': props.tab === 'prompts' ? 'true' : 'false',
          onClick: () => { props.onTab('prompts') },
        }, t('tabPrompts')),
        h('button', {
          type: 'button',
          className: 'pl-tab',
          role: 'tab',
          'aria-selected': props.tab === 'tails' ? 'true' : 'false',
          onClick: () => { props.onTab('tails') },
        }, t('tabTails')))
    }

    function shortBroken(text) {
      const line = text.replace(/\s+/g, ' ').trim()
      if (line.length <= 160) return line
      return `${line.slice(0, 160)}…`
    }

    /**
     * One card per current preset. Empty text appends nothing. Saving this
     * page does not write into the composer.
     */
    function TailEditor(props) {
      const t = props.t
      const tails = useTails()
      const disabled = tails.status !== 'ready' || tails.saving
      const dirty = countTailDirty(tails.saved, tails.drafts)
      useEffect(() => { loadTails() }, [])

      let body
      if (tails.status === 'error' && tails.drafts.length === 0) {
        body = h('div', { className: 'pl-empty' },
          h('p', null, t(tails.error || 'loadFailed')),
          h('button', { type: 'button', className: 'pl-ghost', onClick: () => { reloadTails() } }, t('retry')))
      } else if (tails.status !== 'ready' && tails.drafts.length === 0) {
        body = h('div', { className: 'pl-empty' }, t('loading'))
      } else if (tails.drafts.length === 0) {
        body = h('div', { className: 'pl-empty' }, t('noPresets'))
      } else {
        body = h('div', { className: 'pl-tailBox' }, tails.drafts.map(row => {
          const over = row.text.trim().length > MAX_TAIL
          const idLabel = row.hidden ? `${row.id} · ${t('tailUnseen')}` : row.id
          return h('div', {
            key: row.id,
            className: 'pl-tail',
            'data-dsh-plugin': 'prompt-library',
            'data-dsh-part': 'tail',
          },
          h('div', { className: 'pl-tailHead' },
            h('h3', { className: 'pl-titleText' }, row.name || row.id),
            h('span', { className: 'pl-tailId' }, idLabel)),
          row.description === '' ? null : h('p', { className: 'pl-tailDesc' }, row.description),
          row.hidden ? h('p', { className: 'pl-tailNote' }, t('tailHidden')) : null,
          row.broken === '' ? null : h('p', { className: 'pl-tailNote' }, `${t('tailBroken')} ${shortBroken(row.broken)}`),
          h('textarea', {
            className: 'pl-textarea',
            value: row.text,
            disabled,
            'aria-label': row.name || row.id,
            onChange: event => { changeTail(row.id, event.target.value) },
          }),
          h('span', { className: over ? 'pl-count pl-countError' : 'pl-count' }, row.text.length === 0
            ? t('tailEmpty')
            : t('chars', { count: row.text.length })))
        }))
      }

      const notice = tails.drafts.length === 0 && tails.status === 'error'
        ? null
        : tails.error !== ''
        ? h('div', { className: 'pl-error' }, t(tails.error),
          tails.conflict ? h('div', null, h('button', {
            type: 'button',
            className: 'pl-ghost',
            onClick: () => { reloadTails() },
          }, t('reload'))) : null)
        : tails.notice !== '' ? h('p', { className: 'pl-status' }, t(tails.notice)) : null

      const footer = props.mode === 'panel'
        ? h('div', { className: 'pl-footer' },
          dirty > 0 ? h('span', { className: 'pl-dirty' }, t('unsaved', { count: dirty })) : null,
          h('button', {
            type: 'button',
            className: 'pl-save',
            disabled: disabled || dirty === 0,
            onClick: () => { void saveTails() },
          }, t('save')))
        : null

      return h('div', { className: props.mode === 'panel' ? 'pl-editor pl-editor-panel' : 'pl-editor pl-editor-page' },
        props.mode === 'panel' ? h('p', { className: 'pl-hintLine' }, t('tailIntro')) : null,
        notice,
        body,
        footer)
    }

    function Toolbar(props) {
      const bar = useSyncExternalStore(subscribeToolbar, getToolbar, getToolbar)
      return h('div', { className: 'pl-toolbar' },
        bar.dirty > 0 ? h('span', { className: 'pl-dirty' }, props.t('unsaved', { count: bar.dirty })) : null,
        h('button', {
          type: 'button',
          className: 'pl-save',
          disabled: bar.disabled,
          onClick: () => { bar.save() },
        }, props.t('save')))
    }

    function LibraryPage(props) {
      const library = useLibrary()
      const tails = useTails()
      const [tab, setTab] = useState('prompts')
      useEffect(() => { loadLibrary(); loadTails() }, [])
      useEffect(() => {
        if (tab === 'tails') {
          const dirty = countTailDirty(tails.saved, tails.drafts)
          publishToolbar({
            dirty,
            disabled: tails.status !== 'ready' || tails.saving || dirty === 0,
            save() { void saveTails() },
          })
          return
        }
        const dirty = countDirty(library.saved, library.drafts)
        publishToolbar({
          dirty,
          disabled: library.status !== 'ready' || library.saving || dirty === 0,
          save() { void saveLibrary() },
        })
      }, [library, tails, tab])
      useEffect(() => () => { publishToolbar(toolbarIdle) }, [])
      const intro = tab === 'tails' ? 'tailIntroPage' : 'intro'
      const editor = tab === 'tails'
        ? h(TailEditor, { mode: 'page', t: props.t })
        : h(PromptEditor, { mode: 'page', t: props.t })
      return h('div', {
        className: 'pl-page',
        'data-dsh-plugin': 'prompt-library',
        'data-dsh-part': 'page',
      },
      h('div', { className: 'ps-stickyTop' },
        h(Tabs, { tab, onTab: setTab, t: props.t }),
        h('p', { className: 'pl-intro' }, props.t(intro))),
      editor)
    }

    function PromptTrigger(props) {
      const t = props.t
      const phase = props.useInput(state => state.phase)
      const empty = props.useInput(state => state.draft.length === 0)
      const library = useLibrary()
      const tails = useTails()
      const [open, setOpen] = useState(false)
      const [localNotice, setLocalNotice] = useState('')
      const [viewing, setViewing] = useState()
      const [tab, setTab] = useState('prompts')

      const openPanel = () => {
        setLocalNotice('')
        setViewing(undefined)
        setOpen(true)
        loadLibrary()
        loadTails()
      }
      const closePanel = () => {
        setOpen(false)
        setViewing(undefined)
        setLocalNotice('')
      }
      const writePrompt = prompt => {
        const actions = props.inputActions
        if (actions === undefined || phase !== 'plain') {
          setLocalNotice(t('busy'))
          return
        }
        if (empty) actions.setDraft(prompt.body)
        else if (actions.insertText(prompt.body, actions.captureInsertion()) !== true) {
          setLocalNotice(t('insertRejected'))
          return
        }
        setLocalNotice('')
        setViewing(undefined)
        setOpen(false)
      }

      // The page follows the draft, so it keeps the id rather than the prompt.
      const viewed = viewing === undefined ? undefined : library.drafts.find(item => item.id === viewing)
      const panel = viewed === undefined
        ? h('div', {
          className: 'pl-card',
          'data-dsh-plugin': 'prompt-library',
          'data-dsh-part': 'dialog',
        },
        h('div', { className: 'pl-header' },
          h('div', { className: 'pl-heading' },
            h('h3', { className: 'pl-titleText' }, t('title')),
            h('div', { className: 'pl-subtitle' }, tab === 'tails'
              ? t('tailCount', { count: tails.drafts.length })
              : t('subtitle', { count: library.drafts.length }))),
          h('div', { className: 'pl-headerActions' },
            h('button', {
              type: 'button',
              className: 'pl-iconButton',
              'aria-label': t('close'),
              title: t('close'),
              onClick: closePanel,
            }, h(IconCloseOutlineRegular, { size: 16 })))),
        h(Tabs, { tab, onTab: setTab, t }),
        tab === 'tails'
          ? h(TailEditor, { mode: 'panel', t })
          : h(PromptEditor, { mode: 'panel', t, onPick: setViewing, localNotice }))
        : h(PromptDetail, {
          t,
          prompt: viewed,
          empty,
          notice: localNotice,
          onBack: () => { setLocalNotice(''); setViewing(undefined) },
          onClose: closePanel,
          onConfirm: () => { writePrompt(viewed) },
        })

      const fallback = h('div', {
        className: 'pl-card',
        'data-dsh-plugin': 'prompt-library',
        'data-dsh-part': 'failed',
      },
      h('div', { className: 'pl-header' },
        h('h3', { className: 'pl-titleText' }, t('title')),
        h('button', {
          type: 'button',
          className: 'pl-iconButton',
          'aria-label': t('close'),
          title: t('close'),
          onClick: closePanel,
        }, h(IconCloseOutlineRegular, { size: 16 }))),
      h('div', { className: 'pl-error' }, t('panelFailed')))

      return h(React.Fragment, null,
        h(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: h(IconListPenOutlineRegular, { size: 16 }),
          'aria-label': t('trigger'),
          title: t('trigger'),
          onClick: openPanel,
          'data-dsh-plugin': 'prompt-library',
          'data-dsh-part': 'trigger',
        }),
        h(PanelBoundary, {
          key: open ? 'open' : 'closed',
          fallback: h(Modal, {
            headless: true,
            open: true,
            onClose: closePanel,
            title: t('title'),
            className: 'pl-dialog',
          }, fallback),
        },
        h(Modal, {
          headless: true,
          open,
          onClose: closePanel,
          title: t('title'),
          className: 'pl-dialog',
        }, panel)))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'prompt-library: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        }, 'prompt-library: styles')
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'prompt-library-trigger',
          order: 40,
          locale: NS,
        }, PromptTrigger))
        ctx.slots.inject(PAGE, () => ctx.slots.register({
          name: PAGE,
          id: 'prompts',
          order: 20,
          label: () => ctx.locale.bind(NS)('nav'),
          locale: NS,
        }, LibraryPage))
        ctx.slots.inject(TOOLBAR, () => ctx.slots.register({
          name: TOOLBAR,
          id: 'prompts',
          order: 20,
          locale: NS,
        }, Toolbar))
      },
    }
  },
})
