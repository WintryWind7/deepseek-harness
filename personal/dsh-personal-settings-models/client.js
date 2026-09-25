/**
 * Browser half of dsh-personal-settings-models.
 *
 * Registers one page into the personal settings shell's `personal.settings.page`
 * slot: the default model selection, and the per-model fields of providers that
 * already declare models. Everything it writes goes to the same settings
 * document the official Models page reads — `agent-default-model` for the
 * selection, the provider's namespace for the model list.
 *
 * Credentials, `baseURL`, `api`, and provider removal are deliberately absent:
 * the official page owns them. Writes touch only the `models` array of one
 * provider, so a concurrent edit there keeps its own fields.
 */
window.__ModuleLoader__.load({
  id: 'dsh-personal-settings-models',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState } = React

    const NS = 'personal-settings-models'
    /** Slot the personal settings shell declares for configuration pages. */
    const PAGE = 'personal.settings.page'
    /** Settings namespace holding the default model selection. */
    const DEFAULT_NS = 'agent-default-model'

    /** Every level pi-ai accepts, in the same escalation order it validates. */
    const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

    const zh = {
      nav: '模型',
      intro: '和官方模型页改的是同一份设置。这里只列已经声明了模型的提供方，改每个模型的显示名、上下文长度、输出上限和思考档位；默认模型在同一份设置里。密钥、接口地址和协议仍在官方模型页。',
      loading: '正在读取模型设置…',
      loadFailed: '模型设置读取失败。',
      unavailable: '当前页拿不到模型设置接口。',
      emptyModels: '还没有已声明模型的提供方。到官方模型页配置，或在 profile 的 cordis.patch.yml 里声明。',
      readOnly: '当前设置不可写。',
      saved: '已保存。',
      saveFailed: '保存失败。',
      conflict: '设置刚在别处改过。返回列表再进入这一页，然后重新保存。',
      save: '保存',
      defaultTitle: '默认模型',
      provider: '提供方',
      model: '模型',
      effort: '思考深度',
      modelId: '模型 id',
      context: '上下文长度',
      maxTokens: '输出上限',
      efforts: '思考档位',
      effortsHint: '勾选该模型提供的档位。未勾选的档位在会话选择器里不会出现。',
      models: '{count} 个模型',
      edit: '编辑',
      collapse: '收起',
    }
    const en = {
      nav: 'Models',
      intro: 'This edits the same settings as the official Models page. It lists only providers that already declare models, and edits each model’s display name, context window, output cap, and reasoning efforts; the default model lives in the same document. Keys, endpoint URLs, and protocols stay on the official page.',
      loading: 'Reading model settings…',
      loadFailed: 'Could not read model settings.',
      unavailable: 'The model settings interface is unavailable here.',
      emptyModels: 'No provider declares models yet. Configure one on the official Models page, or declare it in the profile’s cordis.patch.yml.',
      readOnly: 'These settings are read-only.',
      saved: 'Saved.',
      saveFailed: 'Could not save.',
      conflict: 'These settings changed elsewhere. Go back, reopen this page, then save again.',
      save: 'Save',
      defaultTitle: 'Default model',
      provider: 'Provider',
      model: 'Model',
      effort: 'Reasoning effort',
      modelId: 'Model id',
      context: 'Context window',
      maxTokens: 'Output cap',
      efforts: 'Reasoning efforts',
      effortsHint: 'Check the levels this model offers. An unchecked level does not appear in the session picker.',
      models: '{count} models',
      edit: 'Edit',
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
      .pm-efforts { display: flex; flex-wrap: wrap; gap: 4px; }
      .pm-effort {
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 8px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
      }
      .pm-effort:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .pm-effort[data-active="true"] {
        border-color: var(--dsw-alias-state-business-primary);
        background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary);
      }
      .pm-effort:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary); }
      .pm-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .pm-save {
        justify-self: start; border: none; border-radius: 8px; padding: 6px 12px;
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

    /** Rebuild a `reasoningEfforts` map, spelling a new level as its own id. */
    function effortsValue(levels) {
      const map = {}
      for (const level of LEVELS) {
        const wire = levels[level]
        if (wire === undefined) continue
        map[level] = wire === null ? null : String(wire)
      }
      return map
    }

    function draftModel(model) {
      return {
        id: textOf(model?.id),
        name: textOf(model?.name),
        contextWindow: numberText(model?.contextWindow),
        maxTokens: numberText(model?.maxTokens),
        levels: effortsOf(model?.reasoningEfforts),
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
      const efforts = effortsValue(draft.levels)
      if (Object.keys(efforts).length === 0) delete next.reasoningEfforts
      else next.reasoningEfforts = efforts
      return next
    }

    function ModelsPage() {
      const t = ModelsPage.t
      const remote = ModelsPage.remote
      const empty = { status: 'loading', error: '', notice: '', writable: false, defaults: null, providers: [] }
      const [state, setState] = useState(empty)
      const [expanded, setExpanded] = useState(undefined)

      const load = async () => {
        setState(current => ({ ...current, status: 'loading', error: '', notice: '' }))
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
          const defaultsNs = namespaces.get(DEFAULT_NS)
          const defaults = defaultsNs?.value && typeof defaultsNs.value === 'object'
            ? {
              ns: defaultsNs.ns,
              revision: defaultsNs.revision,
              provider: textOf(defaultsNs.value.provider),
              model: textOf(defaultsNs.value.model),
              reasoningEffort: textOf(defaultsNs.value.reasoningEffort),
            }
            : null
          const providers = []
          for (const entry of directory.value ?? []) {
            const namespace = namespaces.get(entry.settingsNs)
            const profile = namespace === undefined ? undefined : pathGet(namespace.value, entry.settingsPath)
            if (profile === null || typeof profile !== 'object' || !Array.isArray(profile.models)) continue
            if (profile.models.length === 0) continue
            providers.push({
              provider: entry.provider,
              displayName: textOf(entry.displayName) || entry.provider,
              ns: entry.settingsNs,
              revision: namespace.revision,
              profile,
              models: profile.models.map(draftModel),
            })
          }
          setState({
            status: 'ready', error: '', notice: '',
            writable: settings.value.writable === true, defaults, providers,
          })
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error))
        }
      }

      useEffect(() => { void load() }, [])

      const written = async (run) => {
        try {
          const response = await run()
          if (!response.ok) {
            const conflict = response.error?.code === 'settings/conflict'
            setState(current => ({ ...current, notice: '', error: conflict ? t('conflict') : (response.error?.message || t('saveFailed')) }))
            return
          }
          await load()
          setState(current => ({ ...current, notice: t('saved') }))
        } catch (error) {
          setState(current => ({ ...current, notice: '', error: error instanceof Error ? error.message : String(error) }))
        }
      }

      const saveDefaults = () => written(async () => {
        const defaults = state.defaults
        if (defaults === null) throw new Error('no default model settings')
        return remote.settings.mutate(defaults.ns, [
          { op: 'set', path: ['provider'], value: defaults.provider },
          { op: 'set', path: ['model'], value: defaults.model },
          { op: 'set', path: ['reasoningEffort'], value: defaults.reasoningEffort },
        ], defaults.revision)
      })

      const saveModels = (row) => written(async () => remote.settings.mutate(row.ns, [
        { op: 'set', path: [...row.path, 'models'], value: row.models.map(draft => applyDraft(draft.source, draft)) },
      ], row.revision))

      const patchDefaults = (patch) => {
        setState(current => ({ ...current, defaults: current.defaults === null ? null : patch(current.defaults) }))
      }

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

      if (state.status === 'loading') return h('p', { className: 'pm-intro' }, t('loading'))
      if (state.status === 'error') return h('p', { className: 'pm-status', 'data-kind': 'error' }, state.error || t('loadFailed'))

      const t2 = t
      const defaults = state.defaults
      const disabled = !state.writable
      const intro = h('p', { className: 'pm-intro ps-stickyTop' }, t2('intro'))
      const notice = state.error
        ? h('p', { className: 'pm-status', 'data-kind': 'error' }, state.error)
        : state.notice
          ? h('p', { className: 'pm-status' }, state.notice)
          : disabled ? h('p', { className: 'pm-status' }, t2('readOnly')) : null

      const defaultCard = defaults === null ? null : h('section', { className: 'pm-card' },
        h('h3', null, t2('defaultTitle')),
        h('label', { className: 'pm-grid' },
          h('span', { className: 'pm-label' }, t2('provider')),
          h('input', {
            className: 'pm-input', value: defaults.provider, disabled,
            onChange: event => { patchDefaults(current => ({ ...current, provider: event.target.value })) },
          })),
        h('label', { className: 'pm-grid' },
          h('span', { className: 'pm-label' }, t2('model')),
          h('input', {
            className: 'pm-input', value: defaults.model, disabled,
            onChange: event => { patchDefaults(current => ({ ...current, model: event.target.value })) },
          })),
        h('label', { className: 'pm-grid' },
          h('span', { className: 'pm-label' }, t2('effort')),
          h('input', {
            className: 'pm-input', value: defaults.reasoningEffort, disabled,
            onChange: event => { patchDefaults(current => ({ ...current, reasoningEffort: event.target.value })) },
          })),
        h('button', { type: 'button', className: 'pm-save', disabled, onClick: () => { void saveDefaults() } }, t2('save')))

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
            return h('div', { key: model.id, className: 'pm-model' },
              h('span', { className: 'pm-id' }, `${t2('modelId')}: ${model.id}`),
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
                h('div', { className: 'pm-efforts' },
                  LEVELS.map(level => h('button', {
                    key: level,
                    type: 'button',
                    className: 'pm-effort',
                    'data-active': model.levels[level] === undefined ? undefined : 'true',
                    'aria-pressed': model.levels[level] !== undefined,
                    disabled,
                    onClick: () => { toggleLevel(row.provider, model.id, level) },
                  }, level)))),
              h('p', { className: 'pm-hint' }, t2('effortsHint')))
          })
          return h('section', { key: row.provider, className: 'pm-card' },
            head,
            h('div', { className: 'pm-body' }, models,
              h('button', { type: 'button', className: 'pm-save', disabled, onClick: () => { void saveModels(row) } }, t2('save'))))
        })

      return h('div', { className: 'pm-page', 'data-dsh-plugin': 'personal-settings-models', 'data-dsh-part': 'models' },
        intro, notice, defaultCard, providerCards)
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ModelsPage.t = t
        ModelsPage.remote = ctx.remote
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
      },
    }
  },
})
