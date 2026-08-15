import { describe, expect, it, vi } from 'vitest'
import { DesktopRuntimeLifecycle } from './app-lifecycle.js'

describe('DesktopRuntimeLifecycle', () => {
  it('keeps development mode Vite-owned without starting DSH', async () => {
    const sidecar = { start: vi.fn(), stop: vi.fn() }
    const startServer = vi.fn()
    const lifecycle = new DesktopRuntimeLifecycle({
      developmentUrl: 'http://127.0.0.1:5173',
      developmentUpstreamOrigin: 'http://127.0.0.1:3080',
      rendererDir: '/renderer',
      sidecar,
      startServer,
    })

    expect(await lifecycle.start()).toBe('http://127.0.0.1:5173')
    expect(lifecycle.getUpstreamOrigin()).toBe('http://127.0.0.1:3080')
    expect(sidecar.start).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    await lifecycle.stop()
    expect(sidecar.stop).not.toHaveBeenCalled()
  })

  it('starts the sidecar before the packaged renderer server and stops in reverse order', async () => {
    const calls: string[] = []
    const sidecar = {
      start: vi.fn(async () => { calls.push('sidecar:start'); return { origin: 'http://127.0.0.1:31001', port: 31001 } }),
      stop: vi.fn(async () => { calls.push('sidecar:stop') }),
    }
    const server = {
      origin: 'http://127.0.0.1:32001',
      url: 'http://127.0.0.1:32001/?__dsh_cap=test',
      address: { host: '127.0.0.1', port: 32001 },
      close: vi.fn(async () => { calls.push('server:close') }),
    }
    const startServer = vi.fn(async (options: { rendererDir: string; upstreamOrigin: string | URL }) => {
      calls.push('server:start')
      expect(options.upstreamOrigin).toBe('http://127.0.0.1:31001')
      return server
    })
    const lifecycle = new DesktopRuntimeLifecycle({ rendererDir: '/renderer', sidecar, startServer })

    expect(await lifecycle.start()).toBe(server.url)
    expect(lifecycle.getUpstreamOrigin()).toBe('http://127.0.0.1:31001')
    expect(await lifecycle.start()).toBe(server.url)
    expect(sidecar.start).toHaveBeenCalledOnce()
    expect(startServer).toHaveBeenCalledOnce()
    await lifecycle.stop()
    expect(lifecycle.getUpstreamOrigin()).toBeUndefined()
    expect(calls).toEqual(['sidecar:start', 'server:start', 'server:close', 'sidecar:stop'])
  })

  it('stops the sidecar when packaged server startup fails', async () => {
    const sidecar = {
      start: vi.fn(async () => ({ origin: 'http://127.0.0.1:31001', port: 31001 })),
      stop: vi.fn(async () => undefined),
    }
    const lifecycle = new DesktopRuntimeLifecycle({
      rendererDir: '/renderer',
      sidecar,
      startServer: vi.fn(async () => { throw new Error('bind failed') }),
    })

    await expect(lifecycle.start()).rejects.toThrow('bind failed')
    expect(sidecar.stop).toHaveBeenCalledOnce()
  })
})
