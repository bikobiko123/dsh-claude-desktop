import { describe, expect, it } from 'vitest'
import { bootDshRc6HeadlessRuntime, extractDshRc6BootGraph } from './bootstrap.js'
import {
  DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT,
  DSH_RC6_CONVERSATION_PLUGIN_IDS,
  DSH_RC6_EXPECTED_PLUGIN_INJECTS,
  DSH_RC6_RUNTIME_PLUGIN_IDS,
} from './contracts.js'

const [PINNED_GRAPH_REV, ...PINNED_PLUGIN_PARTS] = DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT.split('|')
const PINNED_PLUGIN_REVISIONS = new Map(PINNED_PLUGIN_PARTS.map((part) => {
  const separator = part.lastIndexOf('=')
  return [part.slice(0, separator), part.slice(separator + 1)]
}))

function graph() {
  return {
    rev: PINNED_GRAPH_REV,
    entries: DSH_RC6_RUNTIME_PLUGIN_IDS.map((id) => ({
      id,
      url: `/plugins/${id}/client.js`,
      rev: PINNED_PLUGIN_REVISIONS.get(id)!,
      inject: [...DSH_RC6_EXPECTED_PLUGIN_INJECTS[id]],
    })),
  }
}

function fakeGlobal() {
  return {} as Window & { __DSH_BOOT__?: unknown; __ModuleLoader__?: { load(handoff: any): void } }
}

function makePlugin(id: string, apply: (ctx: any) => void) {
  const helper = () => undefined
  return {
    id,
    factory: () => ({
      apply,
      inject: [],
      emptyAssistantBlock: helper,
      toAssistantBlock: helper,
      toAssistantBlocks: () => [],
      isTokenDelta: helper,
      isAppendSurfaceEvent: helper,
      isReplacementSurfaceEvent: helper,
      contextProvenance: helper,
      contextForm: helper,
      displayFailureMessage: helper,
    }),
  }
}

function corePlugin(id: string, registrations?: { events: string[]; views: string[]; fallbacks: string[] }) {
  return makePlugin(id, (ctx) => {
    if (id === '@deepseek-ai/dsh-client-connection') ctx.provide('connection', {})
    else if (id === '@deepseek-ai/dsh-client-runtime') {
      ctx.provide('conversationEvents', {
        register: (definition: { kind: string }) => registrations?.events.push(definition.kind),
        registerFallback: (definition: { kind: string }) => registrations?.fallbacks.push(definition.kind),
      })
      ctx.provide('conversationViews', {
        register: (definition: { target: string }) => registrations?.views.push(definition.target),
      })
      ctx.provide('sessions', { list: {} })
      ctx.provide('workspaces', { list: {} })
    } else ctx.provide(`test-${id}`, {})
  })
}

describe('rc.6 headless bootstrap', () => {
  it('extracts the boot graph from host HTML without executing it', () => {
    const html = `<script>window.__DSH_BOOT__ = ${JSON.stringify(graph())}</script>`
    expect(extractDshRc6BootGraph(html)).toEqual(graph())
  })

  it('fetches the renderer JSON boot endpoint when bootGraph is not supplied', async () => {
    const globalObject = fakeGlobal()
    let requestedUrl = ''
    let requestedAccept = ''
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input)
      requestedAccept = new Headers(init?.headers).get('accept') ?? ''
      return Response.json(graph())
    }
    const runtime = await bootDshRc6HeadlessRuntime({
      manifestUrl: '/dsh-runtime/boot-manifest',
      fetch: fetch as typeof globalThis.fetch,
      global: globalObject,
      staticModules: {},
      loadBundle: async (_url, id) => globalObject.__ModuleLoader__!.load(corePlugin(id)),
    })
    expect(requestedUrl).toBe('/dsh-runtime/boot-manifest')
    expect(requestedAccept).toBe('application/json')
    await runtime.dispose()
  })

  it('loads only core bundles and registers the pinned local definitions in golden order', async () => {
    const globalObject = fakeGlobal()
    const loaded: string[] = []
    const registrations = { events: [] as string[], views: [] as string[], fallbacks: [] as string[] }
    const runtime = await bootDshRc6HeadlessRuntime({
      bootGraph: graph(),
      global: globalObject,
      staticModules: {},
      loadBundle: async (_url, id) => {
        loaded.push(id)
        globalObject.__ModuleLoader__!.load(corePlugin(id, registrations))
      },
    })

    expect(loaded).toEqual(DSH_RC6_RUNTIME_PLUGIN_IDS)
    expect(runtime.pluginIds).toEqual(DSH_RC6_RUNTIME_PLUGIN_IDS)
    expect(DSH_RC6_CONVERSATION_PLUGIN_IDS).toEqual([])
    expect(registrations.events).toEqual([
      'inbox-next-turn', 'inbox-next-step', 'input-message', 'assistant-step', 'tool-call',
      'command', 'compaction', 'model-retry', 'turn-error', 'turn-max-tokens', 'turn-tail',
    ])
    expect(registrations.fallbacks).toEqual(['unknown-surface'])
    expect(registrations.views).toEqual(['chat'])
    expect(runtime.sessions).toBeDefined()
    expect(runtime.workspaces).toBeDefined()
    expect(globalObject.__ModuleLoader__).toBeDefined()
    await runtime.dispose()
    expect(globalObject.__ModuleLoader__).toBeUndefined()
  })

  it('rejects a drifted graph revision before loading bundles or configuring helpers', async () => {
    const drifted = graph()
    drifted.rev = 'drifted-host-rev'
    let loaded = false
    await expect(bootDshRc6HeadlessRuntime({
      bootGraph: drifted,
      global: fakeGlobal(),
      loadBundle: async () => { loaded = true },
    })).rejects.toThrow('Incompatible DSH rc.6 boot graph')
    expect(loaded).toBe(false)
  })

  it('rejects a drifted core plugin revision before loading bundles or configuring helpers', async () => {
    const drifted = graph()
    drifted.entries.find((entry) => entry.id === '@deepseek-ai/dsh-client-runtime')!.rev = 'drifted-runtime-rev'
    let loaded = false
    await expect(bootDshRc6HeadlessRuntime({
      bootGraph: drifted,
      global: fakeGlobal(),
      loadBundle: async () => { loaded = true },
    })).rejects.toThrow('@deepseek-ai/dsh-client-runtime=drifted-runtime-rev')
    expect(loaded).toBe(false)
  })

  it('rejects duplicate plugin IDs while parsing the host graph', () => {
    const duplicate = graph()
    duplicate.entries.push({ ...duplicate.entries[0] })
    expect(() => extractDshRc6BootGraph(`<script>window.__DSH_BOOT__ = ${JSON.stringify(duplicate)}</script>`))
      .toThrow('duplicate plugin id')
  })

  it('rejects inject graph drift before loading bundles or configuring helpers', async () => {
    const drifted = graph()
    drifted.entries.find((entry) => entry.id === '@deepseek-ai/dsh-client-runtime')!.inject = ['@deepseek-ai/dsh-client-connection']
    let loaded = false
    await expect(bootDshRc6HeadlessRuntime({
      bootGraph: drifted,
      global: fakeGlobal(),
      loadBundle: async () => { loaded = true },
    })).rejects.toThrow('Incompatible inject graph')
    expect(loaded).toBe(false)
  })

  it('fails loudly when a core bundle is absent', async () => {
    const broken = graph()
    broken.entries.pop()
    await expect(bootDshRc6HeadlessRuntime({ bootGraph: broken, global: fakeGlobal(), loadBundle: async () => undefined }))
      .rejects.toThrow('missing runtime plugin')
  })

  it('rejects unexpected bundle registration', async () => {
    const globalObject = fakeGlobal()
    await expect(bootDshRc6HeadlessRuntime({
      bootGraph: graph(),
      global: globalObject,
      staticModules: {},
      loadBundle: async () => globalObject.__ModuleLoader__!.load(makePlugin('unexpected', () => undefined)),
    })).rejects.toThrow('Unexpected DSH bundle registration')
    expect(globalObject.__ModuleLoader__).toBeUndefined()
  })
})
