import type { AgentClient } from '../shared/agent-client'
import type { HarnessRc6Adapter } from '../shared/harness-runtime-adapter'

export const DSH_BOOT_MANIFEST_PATH = '/dsh-runtime/boot-manifest' as const

export type RendererRuntimePhase =
  | 'idle'
  | 'loading-manifest'
  | 'booting-runtime'
  | 'waiting-agent-client'
  | 'creating-agent-client'
  | 'ready'
  | 'error'
  | 'disposed'

export interface RendererRuntimeSnapshot {
  phase: RendererRuntimePhase
  agentClient?: AgentClient
  error?: Error
}

/**
 * A version-specific AgentClient implementation registers this factory when it
 * becomes available. The startup host passes it the already-settled rc.6
 * adapter, so this handoff never duplicates session/workspace mapping.
 */
export type AgentClientFactoryResult = AgentClient | {
  client: AgentClient
  dispose?: () => Promise<void> | void
}

export type AgentClientFactory = (
  adapter: HarnessRc6Adapter,
) => AgentClientFactoryResult | Promise<AgentClientFactoryResult>

export interface RendererRuntimeHostOptions {
  manifestUrl?: string
  fetch?: typeof globalThis.fetch
  createAdapter?: (bootGraph: unknown) => Promise<HarnessRc6Adapter>
  getAgentClientFactory?: () => AgentClientFactory | undefined
  loadAgentClientFactory?: () => Promise<AgentClientFactory | undefined>
  subscribeAgentClientFactory?: (listener: () => void) => () => void
}

const factoryListeners = new Set<() => void>()
let installedFactory: AgentClientFactory | undefined

/** Install the concrete renderer model factory without coupling startup to its module. */
export function installAgentClientFactory(factory: AgentClientFactory): () => void {
  installedFactory = factory
  for (const listener of [...factoryListeners]) listener()
  return () => {
    if (installedFactory !== factory) return
    installedFactory = undefined
    for (const listener of [...factoryListeners]) listener()
  }
}

export function getInstalledAgentClientFactory(): AgentClientFactory | undefined {
  return installedFactory
}

export function subscribeInstalledAgentClientFactory(listener: () => void): () => void {
  factoryListeners.add(listener)
  return () => factoryListeners.delete(listener)
}

function normalizeFactoryResult(result: AgentClientFactoryResult): {
  client: AgentClient
  dispose?: () => Promise<void> | void
} {
  if ('client' in result) return result
  return { client: result }
}

/**
 * Owns renderer startup and teardown. It fetches the JSON graph itself, boots
 * only the versioned headless adapter, and waits asynchronously for the
 * concrete AgentClient contribution when that work lands.
 */
export class RendererRuntimeHost {
  private snapshot: RendererRuntimeSnapshot = { phase: 'idle' }
  private readonly listeners = new Set<() => void>()
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly manifestUrl: string
  private readonly createAdapterImpl: (bootGraph: unknown) => Promise<HarnessRc6Adapter>
  private readonly getFactory: () => AgentClientFactory | undefined
  private readonly loadFactory: () => Promise<AgentClientFactory | undefined>
  private readonly subscribeFactory: (listener: () => void) => () => void
  private adapter?: HarnessRc6Adapter
  private clientDisposer?: () => Promise<void> | void
  private unsubscribeFactory?: () => void
  private generation = 0
  private starting?: Promise<void>

  constructor(options: RendererRuntimeHostOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.manifestUrl = options.manifestUrl ?? DSH_BOOT_MANIFEST_PATH
    this.createAdapterImpl = options.createAdapter ?? (async (bootGraph) => {
      const { createHarnessRc6Adapter } = await import('../shared/harness-runtime-adapter')
      return createHarnessRc6Adapter({ bootGraph })
    })
    this.getFactory = options.getAgentClientFactory ?? getInstalledAgentClientFactory
    this.loadFactory = options.loadAgentClientFactory ?? (async () => {
      try {
        const contribution = await import('../shared/rc6/agent-client-factory')
        return contribution.createAgentClient as AgentClientFactory
      } catch (cause) {
        const error = cause as { code?: string }
        if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
        return undefined
      }
    })
    this.subscribeFactory = options.subscribeAgentClientFactory ?? subscribeInstalledAgentClientFactory
  }

  getSnapshot = (): RendererRuntimeSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): Promise<void> {
    if (this.starting) return this.starting
    if (this.snapshot.phase === 'ready' || this.snapshot.phase === 'waiting-agent-client') {
      return Promise.resolve()
    }
    const generation = ++this.generation
    this.starting = this.startGeneration(generation).finally(() => {
      if (generation === this.generation) this.starting = undefined
    })
    return this.starting
  }

  private async startGeneration(generation: number): Promise<void> {
    try {
      this.publish({ phase: 'loading-manifest' })
      const response = await this.fetchImpl(this.manifestUrl, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`DSH boot manifest request failed with HTTP ${response.status}.`)
      const bootGraph: unknown = await response.json()
      if (generation !== this.generation) return

      this.publish({ phase: 'booting-runtime' })
      const adapter = await this.createAdapterImpl(bootGraph)
      if (generation !== this.generation) {
        await adapter.dispose()
        return
      }
      this.adapter = adapter
      this.unsubscribeFactory = this.subscribeFactory(() => {
        void this.attachFactory(generation)
      })
      await this.attachFactory(generation)
    } catch (cause) {
      if (generation !== this.generation) return
      const error = cause instanceof Error ? cause : new Error(String(cause))
      await this.disposeResources()
      this.publish({ phase: 'error', error })
    }
  }

  private async attachFactory(generation: number): Promise<void> {
    if (generation !== this.generation || !this.adapter || this.snapshot.phase === 'ready') return
    let factory = this.getFactory()
    if (!factory) factory = await this.loadFactory()
    if (generation !== this.generation) return
    if (!factory) {
      this.publish({ phase: 'waiting-agent-client' })
      return
    }

    this.publish({ phase: 'creating-agent-client' })
    try {
      const contribution = normalizeFactoryResult(await factory(this.adapter))
      if (generation !== this.generation) {
        await contribution.dispose?.()
        return
      }
      this.clientDisposer = contribution.dispose
      this.publish({ phase: 'ready', agentClient: contribution.client })
    } catch (cause) {
      if (generation !== this.generation) return
      const error = cause instanceof Error ? cause : new Error(String(cause))
      await this.disposeResources()
      this.publish({ phase: 'error', error })
    }
  }

  async dispose(): Promise<void> {
    ++this.generation
    this.starting = undefined
    await this.disposeResources()
    this.publish({ phase: 'disposed' })
  }

  private async disposeResources(): Promise<void> {
    this.unsubscribeFactory?.()
    this.unsubscribeFactory = undefined
    const disposeClient = this.clientDisposer
    this.clientDisposer = undefined
    const adapter = this.adapter
    this.adapter = undefined
    await disposeClient?.()
    await adapter?.dispose()
  }

  private publish(next: RendererRuntimeSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

export function createRendererRuntimeHost(options?: RendererRuntimeHostOptions): RendererRuntimeHost {
  return new RendererRuntimeHost(options)
}
