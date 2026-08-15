export type HeadlessRuntimeStatus = 'idle' | 'loading-manifest' | 'booting' | 'ready' | 'failed'

/** Raw host-composed graph served by DSH as window.__DSH_BOOT__. */
export interface HeadlessBootSource {
  /** Same-origin endpoint returning the raw boot graph as JSON. */
  manifestUrl: string
}

/**
 * Renderer-facing handle around the official browser runtime composition.
 * Implementations must reuse the DSH boot manifest, ClientModuleSystem, and
 * Cordis Loader graph rather than rebuilding session projection in this app.
 */
export interface OfficialHeadlessRuntime {
  readonly status: HeadlessRuntimeStatus
  readonly error?: Error
  boot(source: HeadlessBootSource): Promise<void>
  dispose(): Promise<void> | void
}

/**
 * Dependencies are injected so the app shell does not hard-code unstable DSH
 * package imports. A version-specific adapter package will supply these seams.
 */
export interface OfficialRuntimeBootstrapDependencies {
  parseBootManifest(wire: unknown): {
    rev: string
    modules: unknown[]
    plugins: unknown[]
  }
  createClientModuleSystem(options: {
    modules: unknown[]
    staticModules: Record<string, unknown>
    loadBundle?: (url: string) => Promise<void>
  }): OfficialClientModuleSystem
  createStaticModules(): Record<string, unknown>
  bootCordisGraph(input: {
    modules: OfficialClientModuleSystem
    plugins: unknown[]
  }): Promise<OfficialCordisRuntime>
}

export interface OfficialClientModuleSystem {
  import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
  prefetch(id: string): Promise<void>
  invalidate(id: string): void
}

export interface OfficialCordisRuntime {
  dispose(): Promise<void> | void
}

export interface OfficialRuntimeBootstrapOptions {
  dependencies: OfficialRuntimeBootstrapDependencies
  fetch?: typeof globalThis.fetch
  loadBundle?: (url: string) => Promise<void>
}

/**
 * Concrete orchestration seam, deliberately independent from React. It owns
 * official DSH runtime boot/disposal but does not project or reinterpret DSH
 * events. The future adapter consumes services from the settled Cordis graph.
 */
export class OfficialRuntimeBootstrap implements OfficialHeadlessRuntime {
  status: HeadlessRuntimeStatus = 'idle'
  error?: Error
  private runtime?: OfficialCordisRuntime
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: OfficialRuntimeBootstrapOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  async boot(source: HeadlessBootSource): Promise<void> {
    await this.dispose()
    this.error = undefined
    try {
      this.status = 'loading-manifest'
      const response = await this.fetchImpl(source.manifestUrl, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`DSH boot manifest request failed with HTTP ${response.status}.`)

      const wire: unknown = await response.json()
      const manifest = this.options.dependencies.parseBootManifest(wire)

      this.status = 'booting'
      const modules = this.options.dependencies.createClientModuleSystem({
        modules: manifest.modules,
        staticModules: this.options.dependencies.createStaticModules(),
        loadBundle: this.options.loadBundle,
      })
      this.runtime = await this.options.dependencies.bootCordisGraph({ modules, plugins: manifest.plugins })
      this.status = 'ready'
    } catch (cause) {
      this.error = cause instanceof Error ? cause : new Error(String(cause))
      this.status = 'failed'
      throw this.error
    }
  }

  async dispose(): Promise<void> {
    await this.runtime?.dispose()
    this.runtime = undefined
    this.status = 'idle'
  }
}
