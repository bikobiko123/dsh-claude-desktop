import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { resolveDshExecutable } from './executable.js'
import { assertDshCompatibility } from './compat.js'
import { reserveLoopbackPort, type PortReservation } from './port.js'
import { waitForDshReadiness } from './readiness.js'
import {
  DSH_LOOPBACK_HOST,
  type DshDiagnosticEntry,
  type DshSidecarHandle,
  type DshSidecarSnapshot,
} from './types.js'

export interface DshSidecarOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string
  readonly readinessTimeoutMs?: number
  readonly stopTimeoutMs?: number
  readonly killTimeoutMs?: number
  readonly maxDiagnosticEntries?: number
  readonly maxDiagnosticTextLength?: number
  readonly resolveExecutable?: () => Promise<string>
  readonly assertCompatibility?: (executable: string) => Promise<unknown>
  readonly reservePort?: () => Promise<PortReservation>
  readonly spawn?: typeof spawn
  readonly waitForReadiness?: typeof waitForDshReadiness
  readonly now?: () => number
}

type DshChildProcess = ChildProcessByStdio<null, Readable, Readable>

type Listener = () => void

export class DshSidecar {
  private snapshot: DshSidecarSnapshot = { phase: 'idle', diagnostics: Object.freeze([]) }
  private readonly listeners = new Set<Listener>()
  private child?: DshChildProcess
  private startTask?: Promise<DshSidecarHandle>
  private stopTask?: Promise<void>
  private generation = 0
  private readonly now: () => number

  constructor(private readonly options: DshSidecarOptions = {}) {
    this.now = options.now ?? Date.now
  }

  getSnapshot = (): DshSidecarSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): Promise<DshSidecarHandle> {
    if (this.startTask) return this.startTask
    if (this.snapshot.phase === 'ready' && this.snapshot.origin && this.snapshot.port) {
      return Promise.resolve({ origin: this.snapshot.origin, port: this.snapshot.port, pid: this.snapshot.pid })
    }
    const generation = ++this.generation
    this.startTask = this.startGeneration(generation).finally(() => {
      if (generation === this.generation) this.startTask = undefined
    })
    return this.startTask
  }

  private async startGeneration(generation: number): Promise<DshSidecarHandle> {
    await this.stop()
    const executable = await (this.options.resolveExecutable ?? (() => resolveDshExecutable({ env: this.options.env })))()
    await (this.options.assertCompatibility ?? ((candidate) => assertDshCompatibility(candidate)))(executable)
    const reservation = await (this.options.reservePort ?? reserveLoopbackPort)()
    const port = reservation.port
    const origin = `http://${DSH_LOOPBACK_HOST}:${port}`
    this.publish({ phase: 'starting', executable, port, origin, startedAt: this.now(), diagnostics: this.snapshot.diagnostics })
    await reservation.release()
    if (generation !== this.generation) throw new Error('DSH sidecar start was superseded.')

    const spawnImpl = this.options.spawn ?? spawn
    const child = spawnImpl(executable, ['--profile', 'web', '--host', DSH_LOOPBACK_HOST, '--port', String(port)], {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.capture(child.stdout, 'stdout')
    this.capture(child.stderr, 'stderr')
    this.appendDiagnostic('lifecycle', `spawned pid ${child.pid ?? 'unknown'} on ${origin}`)

    const exited = new Promise<never>((_, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(`DSH sidecar exited before readiness (code ${String(code)}, signal ${String(signal)}).`)))
    })
    const controller = new AbortController()
    try {
      await Promise.race([
        (this.options.waitForReadiness ?? waitForDshReadiness)({
          origin,
          timeoutMs: this.options.readinessTimeoutMs,
          signal: controller.signal,
        }),
        exited,
      ])
      controller.abort()
      if (generation !== this.generation) throw new Error('DSH sidecar start was superseded.')
      this.publish({ ...this.snapshot, phase: 'ready', pid: child.pid, error: undefined })
      return { origin, port, pid: child.pid }
    } catch (cause) {
      controller.abort()
      await this.terminateChild(child).catch(() => undefined)
      if (this.child === child) this.child = undefined
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.appendDiagnostic('lifecycle', `start failed: ${error.message}`)
      this.publish({ ...this.snapshot, phase: 'failed', error: error.message, pid: undefined })
      throw error
    }
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask
    const child = this.child
    if (!child) {
      if (this.snapshot.phase !== 'idle') this.publish({ phase: 'idle', diagnostics: this.snapshot.diagnostics })
      return Promise.resolve()
    }
    ++this.generation
    this.stopTask = (async () => {
      this.publish({ ...this.snapshot, phase: 'stopping' })
      await this.terminateChild(child)
      if (this.child === child) this.child = undefined
      this.appendDiagnostic('lifecycle', 'sidecar stopped')
      this.publish({ phase: 'idle', diagnostics: this.snapshot.diagnostics })
    })().finally(() => { this.stopTask = undefined })
    return this.stopTask
  }

  private async terminateChild(child: DshChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    this.appendDiagnostic('lifecycle', 'sending SIGTERM')
    child.kill('SIGTERM')
    if (await this.waitForExit(child, this.options.stopTimeoutMs ?? 3_000)) return
    this.appendDiagnostic('lifecycle', 'escalating to SIGKILL')
    child.kill('SIGKILL')
    if (!await this.waitForExit(child, this.options.killTimeoutMs ?? 2_000)) {
      throw new Error('DSH sidecar did not exit after SIGKILL.')
    }
  }

  private waitForExit(child: DshChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => { child.off('exit', onExit); resolve(false) }, timeoutMs)
      const onExit = () => { clearTimeout(timer); resolve(true) }
      child.once('exit', onExit)
    })
  }

  private capture(stream: NodeJS.ReadableStream, kind: 'stdout' | 'stderr'): void {
    const decoder = new StringDecoder('utf8')
    stream.on('data', (chunk: Buffer | string) => this.appendDiagnostic(kind, decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))))
    stream.on('end', () => {
      const remaining = decoder.end()
      if (remaining) this.appendDiagnostic(kind, remaining)
    })
  }

  private appendDiagnostic(stream: DshDiagnosticEntry['stream'], text: string): void {
    const maxText = this.options.maxDiagnosticTextLength ?? 4_000
    const clean = text.replace(/\r/g, '').trim()
    if (!clean) return
    const entry: DshDiagnosticEntry = Object.freeze({ stream, time: this.now(), text: clean.slice(-maxText) })
    const maxEntries = this.options.maxDiagnosticEntries ?? 200
    const diagnostics = Object.freeze([...this.snapshot.diagnostics, entry].slice(-maxEntries))
    this.publish({ ...this.snapshot, diagnostics })
  }

  private publish(snapshot: DshSidecarSnapshot): void {
    this.snapshot = Object.freeze(snapshot)
    for (const listener of [...this.listeners]) listener()
  }
}
