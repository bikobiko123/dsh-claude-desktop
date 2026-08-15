import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { DshSidecar } from './sidecar.js'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  kills: Array<NodeJS.Signals | number | undefined> = []
  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal)
    if (signal === 'SIGTERM') queueMicrotask(() => { this.signalCode = 'SIGTERM'; this.emit('exit', null, 'SIGTERM') })
    return true
  }
}

function fixture(extra: ConstructorParameters<typeof DshSidecar>[0] = {}) {
  const child = new FakeChild()
  const spawn = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams)
  const release = vi.fn(async () => undefined)
  const sidecar = new DshSidecar({
    resolveExecutable: async () => '/bin/dsh',
    assertCompatibility: vi.fn(async () => undefined),
    reservePort: async () => ({ host: '127.0.0.1', port: 45678, release }),
    spawn: spawn as never,
    waitForReadiness: vi.fn(async () => undefined),
    now: () => 100,
    ...extra,
  })
  return { sidecar, child, spawn, release }
}

describe('DshSidecar', () => {
  it('does not reserve or spawn when compatibility validation fails', async () => {
    const reservePort = vi.fn(async () => ({ host: '127.0.0.1' as const, port: 45678, release: vi.fn(async () => undefined) }))
    const spawn = vi.fn()
    const sidecar = new DshSidecar({
      resolveExecutable: async () => '/bin/dsh',
      assertCompatibility: async () => { throw new Error('requires exactly 0.1.0-rc.6') },
      reservePort,
      spawn: spawn as never,
    })
    await expect(sidecar.start()).rejects.toThrow('requires exactly 0.1.0-rc.6')
    expect(reservePort).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns a shell-free loopback process on the reserved explicit port', async () => {
    const { sidecar, child, spawn, release } = fixture()
    const handle = await sidecar.start()
    expect(release).toHaveBeenCalledBefore(spawn)
    expect(spawn).toHaveBeenCalledWith('/bin/dsh', [
      '--profile', 'web', '--host', '127.0.0.1', '--port', '45678',
    ], expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }))
    expect(handle).toEqual({ origin: 'http://127.0.0.1:45678', port: 45678, pid: 4321 })
    expect(sidecar.getSnapshot().phase).toBe('ready')
    child.stdout.write('hello\n')
    expect(sidecar.getSnapshot().diagnostics.at(-1)?.text).toBe('hello')
    await sidecar.stop()
    expect(child.kills).toEqual(['SIGTERM'])
    expect(sidecar.getSnapshot().phase).toBe('idle')
  })

  it('bounds diagnostic entries and captured text', async () => {
    const { sidecar, child } = fixture({ maxDiagnosticEntries: 2, maxDiagnosticTextLength: 4 })
    await sidecar.start()
    child.stderr.write('abcdefgh\n')
    child.stdout.write('one\n')
    child.stdout.write('two\n')
    const diagnostics = sidecar.getSnapshot().diagnostics
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map((entry) => entry.text)).toEqual(['one', 'two'])
    await sidecar.stop()
  })

  it('kills a child and publishes failure when readiness fails', async () => {
    const child = new FakeChild()
    const sidecar = new DshSidecar({
      resolveExecutable: async () => '/bin/dsh',
      assertCompatibility: vi.fn(async () => undefined),
      reservePort: async () => ({ host: '127.0.0.1', port: 45678, release: async () => undefined }),
      spawn: vi.fn(() => child) as never,
      waitForReadiness: vi.fn(async () => { throw new Error('not ready') }),
    })
    await expect(sidecar.start()).rejects.toThrow('not ready')
    expect(child.kills).toContain('SIGTERM')
    expect(sidecar.getSnapshot()).toMatchObject({ phase: 'failed', error: 'not ready' })
  })
})
