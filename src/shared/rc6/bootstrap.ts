import { Context, type Plugin } from '@deepseek-ai/cordis'
import * as Cordis from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT,
  DSH_RC6_EXPECTED_PLUGIN_INJECTS,
  DSH_RC6_RUNTIME_PLUGIN_IDS,
  DSH_RC6_VERSION,
  type DshRc6BootEntry,
  type DshRc6BootGraph,
  type DshRc6RuntimePluginId,
  type DshRc6PluginHandoff,
  type DshRc6SettledRuntime,
  type DshRc6Window,
} from './contracts.js'
import { registerConversationDefinitions } from '../../vendor/dsh-rc6-conversation-definitions/register.js'
import { configureConversationRuntimeHelpers } from '../../vendor/dsh-rc6-conversation-definitions/runtime-helpers.js'

function createPlatformModules(): Readonly<Record<string, unknown>> {
  return { '@deepseek-ai/cordis': Cordis }
}

export interface DshRc6BootstrapOptions {
  /** JSON endpoint returning the host-composed boot graph, e.g. /dsh-runtime/boot-manifest. */
  manifestUrl?: string
  /** Already-fetched graph; skips the manifest request. */
  bootGraph?: unknown
  fetch?: typeof globalThis.fetch
  /** Test seam; production appends a classic script to document.head. */
  loadBundle?: (url: string, id: DshRc6RuntimePluginId) => Promise<void>
  global?: DshRc6Window
  staticModules?: Readonly<Record<string, unknown>>
}

interface LoadedPlugin {
  id: DshRc6RuntimePluginId
  exports: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseDshRc6BootGraph(value: unknown): DshRc6BootGraph {
  if (!isRecord(value) || typeof value.rev !== 'string' || !Array.isArray(value.entries)) {
    throw new TypeError('Invalid DSH rc.6 boot graph.')
  }
  const entries = value.entries.map((row, index): DshRc6BootEntry => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.rev !== 'string') {
      throw new TypeError(`Invalid DSH rc.6 boot entry at index ${index}.`)
    }
    if (row.inject !== undefined && (!Array.isArray(row.inject) || row.inject.some((item) => typeof item !== 'string'))) {
      throw new TypeError(`Invalid inject list for DSH rc.6 boot entry ${row.id}.`)
    }
    return {
      id: row.id,
      url: row.url,
      rev: row.rev,
      ...(row.inject === undefined ? {} : { inject: row.inject as string[] }),
      ...(row.immediately === undefined ? {} : { immediately: row.immediately === true }),
    }
  })
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`DSH rc.6 boot graph contains duplicate plugin id ${entry.id}.`)
    seen.add(entry.id)
  }
  return { rev: value.rev, entries }
}

/** Extract the JSON object assigned to window.__DSH_BOOT__ without executing host HTML. */
export function extractDshRc6BootGraph(html: string): DshRc6BootGraph {
  const marker = 'window.__DSH_BOOT__'
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) throw new Error('DSH host HTML does not contain window.__DSH_BOOT__.')
  const equalsIndex = html.indexOf('=', markerIndex + marker.length)
  const start = html.indexOf('{', equalsIndex + 1)
  if (equalsIndex < 0 || start < 0) throw new Error('DSH boot manifest assignment is malformed.')

  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const char = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return parseDshRc6BootGraph(JSON.parse(html.slice(start, index + 1)))
    }
  }
  throw new Error('DSH boot manifest JSON is unterminated.')
}

function selectRuntimeEntries(graph: DshRc6BootGraph): Map<DshRc6RuntimePluginId, DshRc6BootEntry> {
  const selected = new Map<DshRc6RuntimePluginId, DshRc6BootEntry>()
  for (const id of DSH_RC6_RUNTIME_PLUGIN_IDS) {
    const row = graph.entries.find((entry) => entry.id === id)
    if (!row) throw new Error(`DSH rc.6 boot graph is missing runtime plugin ${id}.`)
    selected.set(id, row)
  }
  return selected
}

export function fingerprintDshRc6RuntimeGraph(
  graph: DshRc6BootGraph,
  entries = selectRuntimeEntries(graph),
): string {
  return [
    graph.rev,
    ...DSH_RC6_RUNTIME_PLUGIN_IDS.map((id) => `${id}=${entries.get(id)!.rev}`),
  ].join('|')
}

export function assertDshRc6RegistrarCompatibility(
  graph: DshRc6BootGraph,
  entries = selectRuntimeEntries(graph),
): void {
  const actual = fingerprintDshRc6RuntimeGraph(graph, entries)
  if (actual !== DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT) {
    throw new Error(
      `Incompatible DSH rc.6 boot graph for vendored conversation registrar. Expected ${DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT}, found ${actual}.`,
    )
  }
  for (const id of DSH_RC6_RUNTIME_PLUGIN_IDS) {
    const actualInjects = entries.get(id)!.inject ?? []
    const expectedInjects = DSH_RC6_EXPECTED_PLUGIN_INJECTS[id]
    if (actualInjects.length !== expectedInjects.length || actualInjects.some((value, index) => value !== expectedInjects[index])) {
      throw new Error(
        `Incompatible inject graph for DSH rc.6 runtime plugin ${id}. Expected ${JSON.stringify(expectedInjects)}, found ${JSON.stringify(actualInjects)}.`,
      )
    }
  }
}

function defaultLoadBundle(url: string): Promise<void> {
  if (typeof document === 'undefined') throw new Error('DSH browser bundles require a document or an injected loadBundle seam.')
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = url
    script.addEventListener('load', () => { script.remove(); resolve() }, { once: true })
    script.addEventListener('error', () => { script.remove(); reject(new Error(`Failed to load DSH client bundle ${url}.`)) }, { once: true })
    document.head.append(script)
  })
}

function asPlugin(id: string, exports: Record<string, unknown>): Plugin {
  if (typeof exports.apply !== 'function') throw new TypeError(`DSH core bundle ${id} has no apply() plugin export.`)
  return exports as unknown as Plugin
}

function assertService<T>(ctx: Context, name: string): T {
  const value = ctx.get(name)
  if (value === undefined) throw new Error(`DSH rc.6 core graph settled without ctx.${name}.`)
  return value as T
}

/**
 * Unstable rc.6 integration island. It materializes the transport/object-layer
 * core, then registers the locally vendored rc.6 conversation definitions.
 * No official UI bundle, slot occupant, locale, settings, theme, layout, React,
 * or DOM presentation effect is loaded or activated.
 */
export async function bootDshRc6HeadlessRuntime(options: DshRc6BootstrapOptions = {}): Promise<DshRc6SettledRuntime> {
  const globalObject = options.global ?? (globalThis as unknown as DshRc6Window)
  const fetchImpl = options.fetch ?? globalThis.fetch
  let graph: DshRc6BootGraph
  if (options.bootGraph !== undefined) graph = parseDshRc6BootGraph(options.bootGraph)
  else if (globalObject.__DSH_BOOT__ !== undefined) graph = parseDshRc6BootGraph(globalObject.__DSH_BOOT__)
  else {
    if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available for the DSH boot manifest.')
    const response = await fetchImpl(options.manifestUrl ?? '/dsh-runtime/boot-manifest', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`DSH host manifest request failed with HTTP ${response.status}.`)
    graph = parseDshRc6BootGraph(await response.json())
  }

  const entries = selectRuntimeEntries(graph)
  assertDshRc6RegistrarCompatibility(graph, entries)
  if (globalObject.__ModuleLoader__ !== undefined) throw new Error('window.__ModuleLoader__ is already installed; refusing a second DSH client boot.')

  const factories = new Map<string, DshRc6PluginHandoff['factory']>()
  const materialized = new Map<string, Record<string, unknown>>()
  const staticModules = options.staticModules ?? createPlatformModules()
  globalObject.__ModuleLoader__ = {
    load(handoff) {
      if (!entries.has(handoff.id as DshRc6RuntimePluginId)) throw new Error(`Unexpected DSH bundle registration: ${handoff.id}.`)
      if (factories.has(handoff.id)) throw new Error(`Duplicate DSH bundle registration: ${handoff.id}.`)
      factories.set(handoff.id, handoff.factory)
    },
  }

  const loadBundle = options.loadBundle ?? defaultLoadBundle
  const ctx = new Context()
  const fibers: Array<{ dispose(): Promise<void> }> = []
  let disposed = false

  const requireModule = (specifier: string): unknown => {
    const normalized = specifier.endsWith('/client') ? specifier.slice(0, -7) : specifier
    if (normalized in staticModules) return staticModules[normalized]
    if (specifier in staticModules) return staticModules[specifier]
    const existing = materialized.get(normalized)
    if (existing) return existing
    const factory = factories.get(normalized)
    if (!factory) throw new Error(`DSH rc.6 bundle required unavailable module ${specifier}.`)
    const exports = factory(requireModule)
    materialized.set(normalized, exports)
    return exports
  }

  try {
    for (const id of DSH_RC6_RUNTIME_PLUGIN_IDS) {
      const entry = entries.get(id)!
      await loadBundle(entry.url, id)
      if (!factories.has(id)) throw new Error(`DSH bundle ${entry.url} loaded without registering ${id}.`)
    }

    const loaded: LoadedPlugin[] = DSH_RC6_RUNTIME_PLUGIN_IDS
      .map((id) => ({ id, exports: requireModule(id) as Record<string, unknown> }))
    for (const item of loaded) {
      const fiber = ctx.plugin(asPlugin(item.id, item.exports))
      await fiber
      fibers.push(fiber)
    }
    configureConversationRuntimeHelpers(materialized.get('@deepseek-ai/dsh-client-runtime') ?? requireModule('@deepseek-ai/dsh-client-runtime') as Record<string, unknown>)
    registerConversationDefinitions(ctx)

    const sessions = assertService<ISessions>(ctx, 'sessions')
    const workspaces = assertService<IWorkspaces>(ctx, 'workspaces')
    const connection = assertService<ConnectionHandle>(ctx, 'connection')
    return {
      version: DSH_RC6_VERSION,
      ctx,
      sessions,
      workspaces,
      connection,
      pluginIds: DSH_RC6_RUNTIME_PLUGIN_IDS,
      async dispose() {
        if (disposed) return
        disposed = true
        for (const fiber of fibers.reverse()) await fiber.dispose()
        if (globalObject.__ModuleLoader__ !== undefined) delete globalObject.__ModuleLoader__
      },
    }
  } catch (error) {
    for (const fiber of fibers.reverse()) await fiber.dispose().catch(() => undefined)
    if (globalObject.__ModuleLoader__ !== undefined) delete globalObject.__ModuleLoader__
    throw error
  }
}
