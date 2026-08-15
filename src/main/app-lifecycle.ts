import type { BrowserWindow } from 'electron'
import path from 'node:path'
import { DshSidecar } from './dsh/sidecar.js'
import { startPackagedLoopbackServer, type PackagedLoopbackServer } from './packaged-loopback-server.js'

export interface DesktopRuntimeLifecycleOptions {
  readonly developmentUrl?: string
  readonly rendererDir: string
  readonly rendererSearch?: string
  /** Authoritative DSH origin used in development (Vite is renderer-only). */
  readonly developmentUpstreamOrigin?: string
  readonly sidecar?: Pick<DshSidecar, 'start' | 'stop'>
  readonly startServer?: typeof startPackagedLoopbackServer
}

/**
 * Owns the packaged-only DSH child and custom renderer reverse proxy.
 * Development remains Vite-owned and never starts a second Harness process.
 */
export class DesktopRuntimeLifecycle {
  private readonly sidecar: Pick<DshSidecar, 'start' | 'stop'>
  private readonly startServer: typeof startPackagedLoopbackServer
  private server?: PackagedLoopbackServer
  private upstreamOrigin?: string
  private startTask?: Promise<string>
  private stopTask?: Promise<void>

  constructor(private readonly options: DesktopRuntimeLifecycleOptions) {
    this.sidecar = options.sidecar ?? new DshSidecar()
    this.startServer = options.startServer ?? startPackagedLoopbackServer
  }

  /** Authoritative DSH Host origin, never the renderer/app proxy origin. */
  getUpstreamOrigin(): string | undefined {
    return this.options.developmentUrl ? this.options.developmentUpstreamOrigin : this.upstreamOrigin
  }

  /** Renderer URL and authoritative navigation origin for this application run. */
  start(): Promise<string> {
    if (this.options.developmentUrl) return Promise.resolve(this.options.developmentUrl)
    if (this.server) return Promise.resolve(this.server.url)
    if (this.startTask) return this.startTask
    this.startTask = this.startPackaged().finally(() => { this.startTask = undefined })
    return this.startTask
  }

  private async startPackaged(): Promise<string> {
    const sidecar = await this.sidecar.start()
    this.upstreamOrigin = sidecar.origin
    try {
      this.server = await this.startServer({
        rendererDir: path.resolve(this.options.rendererDir),
        upstreamOrigin: sidecar.origin,
      })
      return this.server.url
    } catch (cause) {
      this.upstreamOrigin = undefined
      await this.sidecar.stop().catch(() => undefined)
      throw cause
    }
  }

  async load(window: BrowserWindow): Promise<string> {
    const url = await this.start()
    const target = new URL(url)
    const bootstrapUrl = this.server?.url
    if (bootstrapUrl) {
      const bootstrap = new URL(bootstrapUrl)
      for (const [key, value] of bootstrap.searchParams) target.searchParams.set(key, value)
    }
    if (this.options.rendererSearch) {
      const extra = new URLSearchParams(this.options.rendererSearch)
      for (const [key, value] of extra) target.searchParams.set(key, value)
    }
    await window.loadURL(target.href)
    return target.origin
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask
    this.stopTask = (async () => {
      const server = this.server
      this.server = undefined
      if (server) await server.close()
      if (!this.options.developmentUrl) await this.sidecar.stop()
      this.upstreamOrigin = undefined
    })().finally(() => { this.stopTask = undefined })
    return this.stopTask
  }
}
