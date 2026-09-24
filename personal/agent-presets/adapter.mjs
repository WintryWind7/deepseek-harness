/**
 * Register personal presets as deltas on a shipped preset declaration.
 *
 * Each file in ./presets is plain YAML: prompt, omitted row ids, shallow config
 * pins, and extra rows. The shipped plugin list is read again on every apply,
 * so a new official row appears unless its id is omitted. A missing official
 * id, an unknown file key, or an unreadable base fails the apply; a later edit
 * that fails the same way keeps the last registration that succeeded.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const here = dirname(fileURLToPath(import.meta.url))
// Same `!!js` scalar the Loader parses: an object with `__jsExpr`, evaluated only when the row activates.
const entryListSchema = yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: data => ({ __jsExpr: data }),
}))

export const name = 'personal-agent-presets'
export const inject = ['agentPresets']

const PRESETS_DIR = join(here, 'presets')
const SHARED_FILE = join(here, 'shared.yml')
const FILE_KEYS = new Set(['id', 'name', 'description', 'order', 'base', 'omit', 'persona', 'rows', 'insert'])

/** @param {string} base */
function officialPlugins(base) {
  if (!/^[a-z][a-z0-9-]*$/.test(base)) throw new Error(`invalid preset base: ${base}`)
  const file = officialPresetFile(base)
  let doc
  try {
    doc = yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`cannot parse official preset ${base} (${file}): ${detail}`)
  }
  const row = findOfficialRow(doc, base)
  if (row === undefined) throw new Error(`official preset ${base} has no preset-${base} row in ${file}`)
  const plugins = row.config?.plugins
  if (!Array.isArray(plugins)) throw new Error(`official preset ${base} has no plugins list in ${file}`)
  return structuredClone(plugins)
}

/** @param {string} base */
function officialPresetFile(base) {
  try {
    return fileURLToPath(import.meta.resolve(`@deepseek-ai/dsh-web-app/presets/${base}.patch.yml`))
  } catch (error) {
    const bundled = join(here, '..', '..', 'packages', 'bundle', 'web-app', 'presets', `${base}.patch.yml`)
    if (existsSync(bundled)) return bundled
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`cannot resolve official preset ${base}: ${detail}`)
  }
}

/** @param {unknown} doc @param {string} base */
function findOfficialRow(doc, base) {
  if (!Array.isArray(doc)) return undefined
  for (const op of doc) {
    const inserted = op && typeof op === 'object' ? op.insert : undefined
    if (!Array.isArray(inserted)) continue
    for (const row of inserted) {
      if (row?.id === `preset-${base}` && row.config?.id === base) return row
    }
  }
  return undefined
}

/** @param {unknown[]} rows @param {string} id @param {{ list: unknown[], index: number, row: any }[]} found */
function locate(rows, id, found) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row?.id === id) found.push({ list: rows, index, row })
    if (row?.group === true && Array.isArray(row.config)) locate(row.config, id, found)
  }
  return found
}

/** @param {unknown[]} rows @param {string} id @param {string} label */
function one(rows, id, label) {
  const found = locate(rows, id, [])
  if (found.length !== 1) {
    throw new Error(`${label}: expected one ${id} row, found ${found.length}`)
  }
  return found[0]
}

/** @param {string} file @param {unknown} spec */
function assertSpec(file, spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`${file}: preset file must be a map`)
  }
  for (const key of Object.keys(spec)) {
    if (!FILE_KEYS.has(key)) throw new Error(`${file}: unknown key ${key}`)
  }
  if (typeof spec.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(spec.id)) {
    throw new Error(`${file}: id must be lowercase letters, digits, and hyphens`)
  }
  if (typeof spec.name !== 'string' || spec.name.length === 0) throw new Error(`${file}: name is required`)
  if (typeof spec.description !== 'string') throw new Error(`${file}: description is required`)
  if (typeof spec.order !== 'number') throw new Error(`${file}: order must be a number`)
  if (typeof spec.base !== 'string') throw new Error(`${file}: base is required`)
  if (spec.persona === undefined || spec.persona === null || typeof spec.persona !== 'object' || Array.isArray(spec.persona)) {
    throw new Error(`${file}: persona must be a map`)
  }
  if (typeof spec.persona.prefix !== 'string') throw new Error(`${file}: persona.prefix must be a string`)
  if (spec.persona.suffix !== undefined && typeof spec.persona.suffix !== 'string') {
    throw new Error(`${file}: persona.suffix must be a string`)
  }
  for (const key of Object.keys(spec.persona)) {
    if (key !== 'prefix' && key !== 'suffix') throw new Error(`${file}: unknown persona key ${key}`)
  }
  if (spec.omit !== undefined && (!Array.isArray(spec.omit) || spec.omit.some(id => typeof id !== 'string' || id.length === 0))) {
    throw new Error(`${file}: omit must be a list of row ids`)
  }
  if (spec.rows !== undefined) assertRows(file, spec.rows)
  if (spec.insert !== undefined) {
    if (!Array.isArray(spec.insert)) throw new Error(`${file}: insert must be a list`)
    for (const [index, item] of spec.insert.entries()) {
      const label = `${file}: insert ${index + 1}`
      if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label} must be a map`)
      const hasBefore = item.before !== undefined
      const hasAfter = item.after !== undefined
      if (hasBefore === hasAfter) throw new Error(`${label} needs exactly one of before or after`)
      if (hasBefore && typeof item.before !== 'string') throw new Error(`${label}.before must be a row id`)
      if (hasAfter && typeof item.after !== 'string') throw new Error(`${label}.after must be a row id`)
      if (item.row === null || typeof item.row !== 'object' || Array.isArray(item.row)) {
        throw new Error(`${label}.row must be a plugin row`)
      }
      if (typeof item.row.name !== 'string' || item.row.name.length === 0) throw new Error(`${label}.row.name is required`)
      for (const key of Object.keys(item)) {
        if (key !== 'before' && key !== 'after' && key !== 'row') throw new Error(`${label}: unknown key ${key}`)
      }
    }
  }
}

/** @param {string} file @param {unknown} rows */
function assertRows(file, rows) {
  if (rows === null || typeof rows !== 'object' || Array.isArray(rows)) {
    throw new Error(`${file}: rows must be a map`)
  }
  for (const [id, patch] of Object.entries(rows)) {
    if (id === 'persona') throw new Error(`${file}: change persona with the persona key, not rows.persona`)
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error(`${file}: rows.${id} must be a map`)
    }
    for (const key of Object.keys(patch)) {
      if (key !== 'disabled' && key !== 'config') throw new Error(`${file}: unknown rows.${id} key ${key}`)
    }
    if (patch.disabled !== undefined && typeof patch.disabled !== 'boolean') {
      throw new Error(`${file}: rows.${id}.disabled must be a boolean`)
    }
    if (patch.config !== undefined && (patch.config === null || typeof patch.config !== 'object' || Array.isArray(patch.config))) {
      throw new Error(`${file}: rows.${id}.config must be a map`)
    }
  }
}

/** Pins applied to every personal preset before that preset's own rows. */
function sharedRows() {
  let spec
  try {
    spec = yaml.load(readFileSync(SHARED_FILE, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${SHARED_FILE}: ${detail}`)
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`${SHARED_FILE}: shared file must be a map`)
  }
  for (const key of Object.keys(spec)) {
    if (key !== 'rows') throw new Error(`${SHARED_FILE}: unknown key ${key}`)
  }
  assertRows(SHARED_FILE, spec.rows ?? {})
  return spec.rows ?? {}
}

/** @param {unknown[]} plugins @param {Record<string, any>} rows @param {string} file */
function applyRows(plugins, rows, file) {
  for (const [id, patch] of Object.entries(rows)) {
    const located = one(plugins, id, file)
    if (patch.disabled !== undefined) located.row.disabled = patch.disabled
    if (patch.config !== undefined) {
      if (located.row.group === true) throw new Error(`${file}: rows.${id} is a group; patch a child row instead`)
      located.row.config = { ...(located.row.config ?? {}), ...patch.config }
    }
  }
}

/** @param {string} file */
export function definitionFromFile(file) {
  let spec
  try {
    spec = yaml.load(readFileSync(file, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${file}: ${detail}`)
  }
  assertSpec(file, spec)
  const plugins = officialPlugins(spec.base)
  const persona = one(plugins, 'persona', file)
  const nextPersona = {}
  if (typeof spec.persona.prefix === 'string') nextPersona.prefix = spec.persona.prefix
  if (typeof spec.persona.suffix === 'string') nextPersona.suffix = spec.persona.suffix
  persona.row.config = nextPersona
  applyRows(plugins, sharedRows(), SHARED_FILE)
  applyRows(plugins, spec.rows ?? {}, file)
  for (const id of spec.omit ?? []) {
    const located = one(plugins, id, file)
    located.list.splice(located.index, 1)
  }
  const afterTail = new Map()
  for (const item of spec.insert ?? []) {
    const anchor = one(plugins, item.before ?? item.after, file)
    const row = structuredClone(item.row)
    if (item.after !== undefined) {
      const tail = afterTail.get(anchor.row) ?? anchor.index
      const index = tail + 1
      anchor.list.splice(index, 0, row)
      afterTail.set(anchor.row, index)
    } else {
      anchor.list.splice(anchor.index, 0, row)
    }
  }
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    order: spec.order,
    plugins,
  }
}

/** @param {string} directory */
export function definitionsFromDirectory(directory) {
  const files = readdirSync(directory).filter(name => name.endsWith('.yml') || name.endsWith('.yaml')).sort()
  if (files.length === 0) throw new Error(`no personal preset files in ${directory}`)
  const definitions = files.map(name => definitionFromFile(join(directory, name)))
  const seen = new Set()
  for (const definition of definitions) {
    if (seen.has(definition.id)) throw new Error(`duplicate personal preset id: ${definition.id}`)
    seen.add(definition.id)
  }
  return definitions
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export async function apply(ctx) {
  /** @type {Array<() => Promise<void>>} */
  let active = []
  let lastGood = /** @type {any[] | undefined} */ (undefined)
  let ready = false
  let closed = false
  let stamp = ''
  let queue = Promise.resolve()

  const registerAll = async (definitions) => {
    const disposers = []
    try {
      for (const definition of definitions) disposers.push(await ctx.agentPresets.register(definition))
      return disposers
    } catch (error) {
      for (const dispose of disposers) await dispose()
      throw error
    }
  }

  const reload = () => {
    const run = queue.then(async () => {
      if (closed) return
      const files = [SHARED_FILE, ...readdirSync(PRESETS_DIR).filter(name => name.endsWith('.yml') || name.endsWith('.yaml')).sort().map(name => join(PRESETS_DIR, name))]
      const text = files.map(name => readFileSync(name, 'utf8')).join('\0')
      if (text === stamp) return
      const definitions = definitionsFromDirectory(PRESETS_DIR)
      const previous = active
      active = []
      for (const dispose of previous) await dispose()
      try {
        active = await registerAll(definitions)
        lastGood = definitions
        stamp = text
        ready = true
        ctx.logger.info('personal presets registered: %s', definitions.map(definition => definition.id).join(', '))
      } catch (error) {
        for (const dispose of active) await dispose()
        active = []
        if (lastGood !== undefined) {
          try {
            active = await registerAll(lastGood)
          } catch (restore) {
            ctx.logger.warn(restore)
          }
        }
        throw error
      }
    })
    queue = run.catch(() => {})
    return run
  }

  try {
    await reload()
  } catch (error) {
    for (const dispose of active) await dispose()
    throw error
  }

  ctx.inject(['hmr'], (child) => {
    child.effect(() => {
      /** @type {Array<() => Promise<void>>} */
      const stops = []
      let disposed = false
      const starting = (async () => {
        const files = [SHARED_FILE, ...readdirSync(PRESETS_DIR).filter(name => name.endsWith('.yml') || name.endsWith('.yaml')).map(name => join(PRESETS_DIR, name))]
        for (const name of files) {
          if (disposed) return
          stops.push(await child.hmr.watchConfig(name, async () => {
            try {
              await reload()
            } catch (error) {
              if (!ready || closed) throw error
              ctx.logger.warn(error)
            }
          }))
        }
      })()
      return async () => {
        disposed = true
        await starting.catch(error => { ctx.logger.warn(error) })
        await Promise.all(stops.splice(0).map(stop => stop()))
      }
    })
  })

  return async () => {
    closed = true
    await queue
    const previous = active
    active = []
    for (const dispose of previous) await dispose()
  }
}
