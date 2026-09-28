/**
 * Browser half of dsh-personal-settings-models.
 *
 * Registers one page into the personal settings shell's `personal.settings.page`
 * slot. It edits providers that already declare models: display name, context
 * window, output cap, which reasoning levels are open, and input modalities.
 * Writes go to the same settings document the official Models page reads.
 * It does not set a model's default reasoning level.
 *
 * The page does not edit which model a new session starts on.
 * Credentials, `baseURL`, `api`, and provider removal are deliberately absent:
 * the official page owns them. A save writes only the `models` array, so a
 * concurrent edit keeps the provider's other fields.
 */
window.__ModuleLoader__.load({
  id: 'dsh-personal-settings-models',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore } = React

    const NS = 'personal-settings-models'
    /** Slot the personal settings shell declares for configuration pages. */
    const PAGE = 'personal.settings.page'
    /** Breadcrumb-row slot declared by the personal settings shell. */
    const TOOLBAR = 'personal.settings.toolbar'
    /** Levels this page offers, in escalation order. `minimal` stays out of the checkboxes. */
    const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max']
    /** Request modalities a pi-ai model entry may declare. */
    const MODALITIES = ['text', 'image']

    const zh = {
      nav: '模型',
      intro: '和官方模型页改的是同一份设置。这里只列已经声明了模型的提供方，改每个模型的显示名、上下文长度、输出上限、开放的思考档位和输入类型。密钥、接口地址和协议仍在官方模型页。',
      loading: '正在读取模型设置…',
      loadFailed: '模型设置读取失败。',
      unavailable: '当前页拿不到模型设置接口。',
      emptyModels: '还没有已声明模型的提供方。到官方模型页配置，或在 profile 的 cordis.patch.yml 里声明。',
      readOnly: '当前设置不可写。',
      saved: '已保存。',
      saveFailed: '保存失败。',
      conflict: '设置刚在别处改过。返回列表再进入这一页，然后重新保存。',
      save: '保存',
      unsaved: '{count} 个更改未保存',
      model: '模型',
      modelId: '模型 id',
      context: '上下文长度',
      maxTokens: '输出上限',
      efforts: '开放档位',
      effortsHint: '勾选该模型开放的档位。未勾选的档位在会话选择器里不会出现。',
      inputTypes: '输入类型',
      inputText: '文本',
      inputImage: '图像',
      inputHint: '勾选该模型接受的输入。都不勾选则沿用已安装目录的声明。',
      models: '{count} 个模型',
      edit: '编辑',
      expand: '展开',
      collapse: '收起',
    }
    const en = {
      nav: 'Models',
      intro: 'This edits the same settings as the official Models page. It lists only providers that already declare models, and edits each model’s display name, context window, output cap, open reasoning levels, and input types. Keys, endpoint URLs, and protocols stay on the official page.',
      loading: 'Reading model settings…',
      loadFailed: 'Could not read model settings.',
      unavailable: 'The model settings interface is unavailable here.',
      emptyModels: 'No provider declares models yet. Configure one on the official Models page, or declare it in the profile’s cordis.patch.yml.',
      readOnly: 'These settings are read-only.',
      saved: 'Saved.',
      saveFailed: 'Could not save.',
      conflict: 'These settings changed elsewhere. Go back, reopen this page, then save again.',
      save: 'Save',
      unsaved: '{count} unsaved changes',
      model: 'Model',
      modelId: 'Model id',
      context: 'Context window',
      maxTokens: 'Output cap',
      efforts: 'Open levels',
      effortsHint: 'Check the levels this model offers. An unchecked level does not appear in the session picker.',
      inputTypes: 'Input types',
      inputText: 'Text',
      inputImage: 'Image',
      inputHint: 'Check the inputs this model accepts. Leave both unchecked to keep the installed catalog’s declaration.',
      models: '{count} models',
      edit: 'Edit',
      expand: 'Expand',
      collapse: 'Collapse',
    }

    const CSS = `
      .pm-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
      .pm-intro, .pm-status { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .pm-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
      .pm-card {
        border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 16px; padding: 12px 14px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .pm-cardHead { display: flex; align-items: center; gap: 10px; }
      .pm-cardIdentity { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
      .pm-cardName { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
      .pm-cardCount { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
      .pm-cardActions { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
      .pm-ghost {
        border: none; border-radius: 8px; padding: 4px 8px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: 13px; cursor: pointer;
      }
      .pm-ghost:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .pm-ghost:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary); }
      .pm-body { display: flex; flex-direction: column; gap: 10px; }
      .pm-card h3 { margin: 0; font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
      .pm-grid { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px 12px; align-items: center; }
      .pm-label { font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .pm-input {
        width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 8px; padding: 6px 8px; background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary); font-size: 13px;
      }
      .pm-input:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
      .pm-model { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
      .pm-model:first-of-type { border-top: none; padding-top: 0; }
      .pm-id {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px; color: var(--dsw-alias-label-tertiary);
      }
      .pm-checks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
      .pm-check {
        display: flex; align-items: center; gap: 8px; min-width: 0;
        font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer;
      }
      .pm-check input { margin: 0; accent-color: var(--dsw-alias-state-business-primary); }
      .pm-check input:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary); }
      .pm-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .pm-toolbar { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
      .pm-dirty { font-size: 13px; color: var(--dsw-alias-state-error-primary); }
      .pm-save {
        margin-left: auto; flex: none; border: none; border-radius: 8px; padding: 6px 12px;
        background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted);
        font-size: 13px; font-weight: 500; cursor: pointer;
      }
      .pm-save:disabled { opacity: 0.55; cursor: not-allowed; }
      .pm-save:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
    `

    function pathGet(root, path) {
      let current = root
      for (const key of path) {
        if (current === null || typeof current !== 'object') return undefined
        current = current[key]
      }
      return current
    }

    function textOf(value) {
      return typeof value === 'string' ? value : ''
    }

    function numberText(value) {
      return typeof value === 'number' ? String(value) : ''
    }

    /** Levels a stored `reasoningEfforts` map declares, keeping their wire values. */
    function effortsOf(map) {
      const levels = {}
      if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
        for (const level of LEVELS) {
          const wire = map[level]
          if (wire === undefined) continue
          levels[level] = wire === null ? null : String(wire)
        }
      }
      return levels
    }

    /**
     * Rebuild a `reasoningEfforts` map. Offered levels follow the checkboxes;
     * a stored level outside that set is copied through so a save does not drop it.
     */
    function effortsValue(levels, source) {
      const map = {}
      const stored = source?.reasoningEfforts
      if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
        for (const [level, wire] of Object.entries(stored)) {
          if (LEVELS.includes(level)) continue
          if (wire === null || typeof wire === 'string') map[level] = wire
        }
      }
      for (const level of LEVELS) {
        const wire = levels[level]
        if (wire === undefined) continue
        map[level] = wire === null ? null : String(wire)
      }
      return map
    }

    /** Declared modalities, or null when the entry leaves the field to the catalog. */
    function draftInput(model) {
      const input = model?.input
      if (!Array.isArray(input) || input.length === 0) return null
      return MODALITIES.filter(item => input.includes(item))
    }

    function draftModel(model) {
      return {
        id: textOf(model?.id),
        name: textOf(model?.name),
        contextWindow: numberText(model?.contextWindow),
        maxTokens: numberText(model?.maxTokens),
        levels: effortsOf(model?.reasoningEfforts),
        input: draftInput(model),
        source: model,
      }
    }

    /** One stored model with the draft's fields applied. */
    function applyDraft(source, draft) {
      const next = { ...source }
      const name = draft.name.trim()
      if (name.length > 0) next.name = name
      const context = Number(draft.contextWindow)
      const maxTokens = Number(draft.maxTokens)
      if (draft.contextWindow.trim() !== '' && Number.isInteger(context) && context > 0) next.contextWindow = context
      if (draft.maxTokens.trim() !== '' && Number.isInteger(maxTokens) && maxTokens > 0) next.maxTokens = maxTokens
      const efforts = effortsValue(draft.levels, source)
      if (Object.keys(efforts).length === 0) delete next.reasoningEfforts
      else next.reasoningEfforts = efforts
      if (draft.input !== null) {
        if (draft.input.length === 0) delete next.input
        else next.input = MODALITIES.filter(item => draft.input.includes(item))
      }
      return next
    }

    /** How many edited fields on one model a save would actually write. */
    function changeCount(draft) {
      const source = draft.source ?? {}
      const next = applyDraft(source, draft)
      let count = 0
      if (textOf(next.name) !== textOf(source.name)) count += 1
      if (next.contextWindow !== source.contextWindow) count += 1
      if (next.maxTokens !== source.maxTokens) count += 1
      if (fieldSignature(next.reasoningEfforts) !== fieldSignature(source.reasoningEfforts)) count += 1
      if (fieldSignature(next.input) !== fieldSignature(source.input)) count += 1
      return count
    }

    /** Stable comparison text for an efforts map or a modality list. */
    function fieldSignature(value) {
      if (Array.isArray(value)) return MODALITIES.filter(item => value.includes(item)).join(',')
      if (value === null || typeof value !== 'object') return ''
      return Object.keys(value).sort().map(key => `${key}:${value[key] === null ? '' : String(value[key])}`).join(',')
    }

    const toolbarIdle = { dirty: 0, disabled: true, save() {} }
    const toolbarStore = {
      current: toolbarIdle,
      listeners: new Set(),
    }

    function publishToolbar(next) {
      toolbarStore.current = next
      for (const listener of toolbarStore.listeners) listener()
    }

    function subscribeToolbar(listener) {
      toolbarStore.listeners.add(listener)
      return () => { toolbarStore.listeners.delete(listener) }
    }

    function Toolbar() {
      const bar = useSyncExternalStore(subscribeToolbar, () => toolbarStore.current, () => toolbarStore.current)
      const t = Toolbar.t
      return h('div', { className: 'pm-toolbar' },
        bar.dirty > 0 ? h('span', { className: 'pm-dirty' }, t('unsaved', { count: bar.dirty })) : null,
        h('button', {
          type: 'button',
          className: 'pm-save',
          disabled: bar.disabled,
          onClick: () => { bar.save() },
        }, t('save')))
    }

    function ModelsPage() {
      const t = ModelsPage.t
      const remote = ModelsPage.remote
      const empty = { status: 'loading', error: '', notice: '', writable: false, saving: false, providers: [] }
      const [state, setState] = useState(empty)
      const [expanded, setExpanded] = useState(undefined)
      const [openModels, setOpenModels] = useState(() => new Set())

      const load = async (quiet) => {
        if (quiet !== true) setState(current => ({ ...current, status: 'loading', error: '', notice: '' }))
        const fail = (message) => {
          setState({ ...empty, status: 'error', error: message || t('loadFailed') })
        }
        try {
          if (typeof remote.settings?.describe !== 'function' || typeof remote.llm?.listConfigurableProviders !== 'function') {
            fail(t('unavailable'))
            return
          }
          const [settings, directory] = await Promise.all([
            remote.settings.describe(),
            remote.llm.listConfigurableProviders(),
          ])
          if (!settings.ok) { fail(settings.error?.message); return }
          if (!directory.ok) { fail(directory.error?.message); return }
          const namespaces = new Map((settings.value.namespaces ?? []).map(row => [row.ns, row]))
          const providers = []
          for (const entry of directory.value ?? []) {
            const namespace = namespaces.get(entry.settingsNs)
            const settingsPath = Array.isArray(entry.settingsPath) ? entry.settingsPath : []
            const profile = namespace === undefined ? undefined : pathGet(namespace.value, settingsPath)
            if (profile === null || typeof profile !== 'object' || !Array.isArray(profile.models)) continue
            if (profile.models.length === 0) continue
            providers.push({
              provider: entry.provider,
              displayName: textOf(entry.displayName) || entry.provider,
              ns: entry.settingsNs,
              path: settingsPath,
              revision: namespace.revision,
              profile,
              models: profile.models.map(draftModel),
            })
          }
          setState({
            status: 'ready', error: '', notice: quiet === true ? t('saved') : '',
            writable: settings.value.writable === true, saving: false, providers,
          })
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error))
        }
      }

      useEffect(() => { void load() }, [])

      const saveAll = async () => {
        const rows = state.providers.filter(row => row.models.some(model => changeCount(model) > 0))
        if (rows.length === 0 || state.writable !== true || state.saving === true) return
        setState(current => ({ ...current, saving: true, error: '', notice: '' }))
        try {
          for (const row of rows) {
            const response = await remote.settings.mutate(row.ns, [
              { op: 'set', path: [...row.path, 'models'], value: row.models.map(draft => applyDraft(draft.source, draft)) },
            ], row.revision)
            if (!response.ok) {
              const conflict = response.error?.code === 'settings/conflict'
              setState(current => ({
                ...current, saving: false, notice: '',
                error: conflict ? t('conflict') : (response.error?.message || t('saveFailed')),
              }))
              return
            }
          }
          await load(true)
        } catch (error) {
          setState(current => ({
            ...current, saving: false, notice: '',
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      useEffect(() => {
        if (state.status !== 'ready') {
          publishToolbar(toolbarIdle)
          return
        }
        const dirty = state.providers.reduce((sum, row) => sum + row.models.reduce((count, model) => count + changeCount(model), 0), 0)
        publishToolbar({
          dirty,
          disabled: state.writable !== true || state.saving === true || dirty === 0,
          save: () => { void saveAll() },
        })
      })

      useEffect(() => () => { publishToolbar(toolbarIdle) }, [])

      const patchModels = (provider, mapModel) => {
        setState(current => ({
          ...current,
          providers: current.providers.map(row => row.provider === provider
            ? { ...row, models: row.models.map(mapModel) }
            : row),
        }))
      }

      const toggleLevel = (provider, modelId, level) => {
        patchModels(provider, model => {
          if (model.id !== modelId) return model
          const levels = { ...model.levels }
          if (levels[level] === undefined) levels[level] = level
          else delete levels[level]
          return { ...model, levels }
        })
      }

      const toggleInput = (provider, modelId, modality) => {
        patchModels(provider, model => {
          if (model.id !== modelId) return model
          const current = model.input ?? []
          const input = MODALITIES.filter(item => item === modality ? !current.includes(item) : current.includes(item))
          return { ...model, input }
        })
      }

      const checks = (items, checked, onToggle, labelOf) => h('div', { className: 'pm-checks' },
        items.map(item => h('label', { key: item, className: 'pm-check' },
          h('input', {
            type: 'checkbox',
            checked: checked(item),
            disabled,
            onChange: () => { onToggle(item) },
          }),
          labelOf(item))))

      if (state.status === 'loading') return h('p', { className: 'pm-intro' }, t('loading'))
      if (state.status === 'error') return h('p', { className: 'pm-status', 'data-kind': 'error' }, state.error || t('loadFailed'))

      const t2 = t
      const disabled = !state.writable
      const intro = h('p', { className: 'pm-intro ps-stickyTop' }, t2('intro'))
      const notice = state.error
        ? h('p', { className: 'pm-status', 'data-kind': 'error' }, state.error)
        : state.notice
          ? h('p', { className: 'pm-status' }, state.notice)
          : disabled ? h('p', { className: 'pm-status' }, t2('readOnly')) : null

      const providerCards = state.providers.length === 0
        ? h('p', { className: 'pm-intro' }, t2('emptyModels'))
        : state.providers.map((row) => {
          const open = expanded === row.provider
          const head = h('div', { className: 'pm-cardHead' },
            h('span', { className: 'pm-cardIdentity' },
              h('span', { className: 'pm-cardName' }, row.displayName),
              h('span', { className: 'pm-cardCount' }, t2('models', { count: row.models.length }))),
            h('span', { className: 'pm-cardActions' },
              h('button', {
                type: 'button',
                className: 'pm-ghost',
                'aria-expanded': open,
                onClick: () => { setExpanded(open ? undefined : row.provider) },
              }, open ? t2('collapse') : t2('edit'))))
          if (!open) return h('section', { key: row.provider, className: 'pm-card' }, head)
          const models = row.models.map(model => {
            const setField = (key) => (event) => {
              patchModels(row.provider, item => item.id === model.id ? { ...item, [key]: event.target.value } : item)
            }
            const modelKey = `${row.provider}\0${model.id}`
            const modelOpen = openModels.has(modelKey)
            const modelHead = h('div', { className: 'pm-cardHead' },
              h('span', { className: 'pm-cardIdentity' },
                h('span', { className: 'pm-cardName' }, model.name.trim() || model.id),
                h('span', { className: 'pm-id' }, model.id)),
              h('span', { className: 'pm-cardActions' },
                h('button', {
                  type: 'button',
                  className: 'pm-ghost',
                  'aria-expanded': modelOpen,
                  onClick: () => {
                    setOpenModels(current => {
                      const next = new Set(current)
                      if (next.has(modelKey)) next.delete(modelKey)
                      else next.add(modelKey)
                      return next
                    })
                  },
                }, modelOpen ? t2('collapse') : t2('expand'))))
            const fields = [
              h('label', { className: 'pm-grid' },
                h('span', { className: 'pm-label' }, t2('model')),
                h('input', { className: 'pm-input', value: model.name, disabled, onChange: setField('name') })),
              h('label', { className: 'pm-grid' },
                h('span', { className: 'pm-label' }, t2('context')),
                h('input', {
                  className: 'pm-input', inputMode: 'numeric', value: model.contextWindow, disabled,
                  onChange: setField('contextWindow'),
                })),
              h('label', { className: 'pm-grid' },
                h('span', { className: 'pm-label' }, t2('maxTokens')),
                h('input', {
                  className: 'pm-input', inputMode: 'numeric', value: model.maxTokens, disabled,
                  onChange: setField('maxTokens'),
                })),
              h('div', { className: 'pm-grid' },
                h('span', { className: 'pm-label' }, t2('efforts')),
                checks(LEVELS, level => model.levels[level] !== undefined,
                  level => { toggleLevel(row.provider, model.id, level) },
                  level => level)),
              h('p', { className: 'pm-hint' }, t2('effortsHint')),
              h('div', { className: 'pm-grid' },
                h('span', { className: 'pm-label' }, t2('inputTypes')),
                checks(MODALITIES, modality => (model.input ?? []).includes(modality),
                  modality => { toggleInput(row.provider, model.id, modality) },
                  modality => t2(modality === 'text' ? 'inputText' : 'inputImage'))),
              h('p', { className: 'pm-hint' }, t2('inputHint')),
            ]
            return h('div', { key: model.id, className: 'pm-model' }, modelHead, modelOpen ? fields : null)
          })
          return h('section', { key: row.provider, className: 'pm-card' },
            head,
            h('div', { className: 'pm-body' }, models))
        })

      return h('div', { className: 'pm-page', 'data-dsh-plugin': 'personal-settings-models', 'data-dsh-part': 'models' },
        intro, notice, providerCards)
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ModelsPage.t = t
        ModelsPage.remote = ctx.remote
        Toolbar.t = t
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'personal-settings-models: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        }, 'personal-settings-models: styles')

        ctx.slots.inject(PAGE, () => ctx.slots.register({
          name: PAGE,
          id: 'models',
          order: 10,
          label: () => t('nav'),
          locale: NS,
        }, ModelsPage))
        ctx.slots.inject(TOOLBAR, () => ctx.slots.register({
          name: TOOLBAR,
          id: 'models',
          order: 10,
        }, Toolbar))
      },
    }
  },
})
