import { describe, expect, it, vi } from 'vitest'
import type { DshWebSocketLike } from './dsh-sidecar-contract.js'
import { createLoopbackDshSidecarTransport } from './dsh-sidecar-transport.js'

class FakeSocket implements DshWebSocketLike {
  readyState = 0
  closed: Array<{ code?: number; reason?: string }> = []
  private readonly listeners = new Map<string, Set<(event?: any) => void>>()

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event?: any) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event?: any) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.closed.push({ code, reason })
  }

  emit(type: 'open' | 'message' | 'close' | 'error', event?: any): void {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function responseBody(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('LoopbackDshSidecarTransport', () => {
  it('wraps unary calls and validates the echoed response', async () => {
    const fetch = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const request = JSON.parse(String(init?.body))
      return responseBody({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { items: [] } } })
    })
    const transport = createLoopbackDshSidecarTransport({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as typeof globalThis.fetch })

    const response = await transport.call('session.list', {})

    expect(response.result).toEqual({ ok: true, value: { items: [] } })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe('http://127.0.0.1:3080/api/session.list')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: 'client-request', method: 'session.list', payload: {} })
  })

  it('rejects an rpcId mismatch', async () => {
    const fetch = vi.fn(async () => responseBody({ type: 'server-response', rpcId: 'different', result: { ok: true, value: { items: [] } } }))
    const transport = createLoopbackDshSidecarTransport({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as typeof globalThis.fetch })

    await expect(transport.call('session.list', {})).rejects.toThrow('rpcId mismatch')
  })

  it('posts validated client responses and parses the carrier receipt', async () => {
    const envelopes: unknown[] = []
    const fetch = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        type: 'client-response',
        rpcId: 'question-1',
        result: { ok: true, value: { answers: [] } },
      })
      return responseBody({ accepted: true })
    })
    const transport = createLoopbackDshSidecarTransport({
      baseUrl: 'http://127.0.0.1:3080',
      fetch: fetch as typeof globalThis.fetch,
      onEnvelope: (message) => envelopes.push(message),
    })

    const receipt = await transport.respond({
      type: 'client-response',
      rpcId: 'question-1' as never,
      result: { ok: true, value: { answers: [] } },
    })

    expect(receipt).toEqual({ accepted: true })
    expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:3080/api/respond')
    expect(envelopes).toHaveLength(1)
  })

  it('opens the mux WebSocket, drops malformed frames, and yields valid frames', async () => {
    const socket = new FakeSocket()
    const malformed = vi.fn()
    let openedUrl = ''
    const transport = createLoopbackDshSidecarTransport({
      baseUrl: 'http://127.0.0.1:3080',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      webSocketFactory: (url) => { openedUrl = String(url); return socket },
      onMalformedFrame: malformed,
    })
    const iterator = transport.mux()[Symbol.asyncIterator]()
    const pending = iterator.next()
    socket.emit('open')
    socket.emit('message', { data: '{not-json' })
    socket.emit('message', { data: JSON.stringify({ type: 'server-request', rpcId: 'frame-1', method: 'events.mux', payload: { type: 'session/subscribed', sessionId: 's-1', lastSeq: 0 } }) })

    const next = await pending
    expect(openedUrl).toBe('ws://127.0.0.1:3080/api/events.mux')
    expect(next.done).toBe(false)
    expect(next.value).toMatchObject({ rpcId: 'frame-1', payload: { type: 'session/subscribed', sessionId: 's-1', lastSeq: 0 } })
    expect(malformed).toHaveBeenCalledOnce()
    await iterator.return?.()
  })

  it('closes an active host stream when aborted', async () => {
    const socket = new FakeSocket()
    const controller = new AbortController()
    const transport = createLoopbackDshSidecarTransport({
      baseUrl: 'https://127.0.0.1:3080',
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      webSocketFactory: () => socket,
    })
    const iterator = transport.host({ signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iterator.next()
    socket.emit('open')
    controller.abort()

    await expect(pending).resolves.toEqual({ value: undefined, done: true })
    expect(socket.closed).toContainEqual({ code: 1000, reason: 'aborted' })
  })
})
