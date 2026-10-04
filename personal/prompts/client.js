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
    const { useEffect, useState, useSyncExternalStore } = React

    const NS = 'prompt-library'
    const ROUTE = 'api/prompt.library'
    const PAGE = 'personal.settings.page'
    const TOOLBAR = 'personal.settings.toolbar'
    /** Matches the Host library limits. */
    const MAX_PROMPTS = 200
    const MAX_BODY = 100000

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
      titleField: '标题',
      bodyField: '正文',
      full: '最多保存 200 条。',
      invalid: '这条库无法保存。',
      save: '保存',
      unsaved: '{count} 个更改未保存',
      create: '新建',
      edit: '编辑',
      collapse: '收起',
      remove: '删除',
      reload: '重新读取',
      retry: '重试',
      search: '搜索标题',
      untitled: '未命名',
      empty: '还没有提示词。',
      noMatch: '没有匹配的标题。',
      pickHint: '点标题写入输入框，点编辑改这一条。',
      subtitle: '{count} 条',
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
      titleField: 'Title',
      bodyField: 'Body',
      full: 'The library already has 200 prompts.',
      invalid: 'This library could not be saved.',
      save: 'Save',
      unsaved: '{count} unsaved changes',
      create: 'New',
      edit: 'Edit',
      collapse: 'Collapse',
      remove: 'Delete',
      reload: 'Reload',
      retry: 'Retry',
      search: 'Search titles',
      untitled: 'Untitled',
      empty: 'No prompts yet.',
      noMatch: 'No title matches.',
      pickHint: 'Choose a title to write it into the input. Edit changes that prompt.',
      subtitle: '{count} prompts',
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
        color: var(--dsw-alias-label-primary);
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
      .pl-listBox::-webkit-scrollbar { width: 6px; }
      .pl-listBox::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 3px; }
      .pl-listBox::-webkit-scrollbar-track { background: transparent; }
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

    function freshId(prompts) {
      const used = new Set(prompts.map(item => item.id))
      let id = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
      while (used.has(id)) id = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
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

    function loadLibrary() {
      if (snapshot.status === 'ready' || snapshot.status === 'loading') return
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
        if (prompt.title.trim() === '') {
          publish({ ...current, error: 'emptyTitle', notice: '' })
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
                const current = snapshot.drafts.find(row => row.id === item.id)
                if (current !== undefined) props.onInsert(current)
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
      useEffect(() => { loadLibrary() }, [])
      useEffect(() => {
        const dirty = countDirty(library.saved, library.drafts)
        publishToolbar({
          dirty,
          disabled: library.status !== 'ready' || library.saving || dirty === 0,
          save() { void saveLibrary() },
        })
      }, [library])
      useEffect(() => () => { publishToolbar(toolbarIdle) }, [])
      return h('div', {
        className: 'pl-page',
        'data-dsh-plugin': 'prompt-library',
        'data-dsh-part': 'page',
      },
      h('p', { className: 'ps-stickyTop pl-intro' }, props.t('intro')),
      h(PromptEditor, { mode: 'page', t: props.t }))
    }

    function PromptTrigger(props) {
      const t = props.t
      const phase = props.useInput(state => state.phase)
      const empty = props.useInput(state => state.draft.length === 0)
      const library = useLibrary()
      const [open, setOpen] = useState(false)
      const [localNotice, setLocalNotice] = useState('')

      const openPanel = () => {
        setLocalNotice('')
        setOpen(true)
        loadLibrary()
      }
      const closePanel = () => { setOpen(false) }
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
        setOpen(false)
      }

      const panel = h('div', {
        className: 'pl-card',
        'data-dsh-plugin': 'prompt-library',
        'data-dsh-part': 'dialog',
      },
      h('div', { className: 'pl-header' },
        h('div', { className: 'pl-heading' },
          h('h3', { className: 'pl-titleText' }, t('title')),
          h('div', { className: 'pl-subtitle' }, t('subtitle', { count: library.drafts.length }))),
        h('button', {
          type: 'button',
          className: 'pl-iconButton',
          'aria-label': t('close'),
          title: t('close'),
          onClick: closePanel,
        }, h(IconCloseOutlineRegular, { size: 16 }))),
      h(PromptEditor, { mode: 'panel', t, onInsert: writePrompt, localNotice }))

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
