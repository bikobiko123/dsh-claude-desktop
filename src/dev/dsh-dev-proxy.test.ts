import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DSH_DEV_ORIGIN,
  createDshBootGraphHandler,
  extractDshBootGraph,
  normalizeDshDevOrigin,
} from './dsh-dev-proxy.js'

class FakeResponse {
  statusCode = 0
  readonly headers = new Map<string, string>()
  body: string | undefined

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), String(value))
    return this
  }

  end(body?: string): this {
    this.body = body
    return this
  }
}

describe('DSH development proxy', () => {
  it('defaults and validates the configured host origin', () => {
    expect(normalizeDshDevOrigin(undefined)).toBe(DEFAULT_DSH_DEV_ORIGIN)
    expect(normalizeDshDevOrigin(' http://localhost:4000 ')).toBe('http://localhost:4000')
    expect(() => normalizeDshDevOrigin('file:///tmp/dsh')).toThrow('must use http or https')
    expect(() => normalizeDshDevOrigin('http://localhost:3080/path')).toThrow('must be an origin')
  })

  it('extracts the raw graph without evaluating host HTML', () => {
    const html = '<script>window.__DSH_BOOT__ = {"rev":"abc","entries":[{"id":"plugin","meta":{"label":"}; still text"}}]};</script>'
    expect(extractDshBootGraph(html)).toEqual({
      rev: 'abc',
      entries: [{ id: 'plugin', meta: { label: '}; still text' } }],
    })
  })

  it('serves the extracted graph as non-cacheable JSON', async () => {
    const fetch = vi.fn(async () => new Response(
      '<html><script>window.__DSH_BOOT__ = {"rev":"r1","entries":[]}</script></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ))
    const handler = createDshBootGraphHandler({ origin: 'http://127.0.0.1:3080', fetch: fetch as typeof globalThis.fetch })
    const response = new FakeResponse()

    await handler({ method: 'GET' }, response)

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3080/', expect.objectContaining({ headers: { accept: 'text/html' } }))
    expect(response.statusCode).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(JSON.parse(response.body ?? '')).toEqual({ rev: 'r1', entries: [] })
  })

  it('returns a bounded gateway error instead of host HTML', async () => {
    const handler = createDshBootGraphHandler({
      origin: 'http://127.0.0.1:3080',
      fetch: vi.fn(async () => new Response('offline', { status: 503 })) as typeof globalThis.fetch,
    })
    const response = new FakeResponse()

    await handler({ method: 'GET' }, response)

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.body ?? '')).toMatchObject({ error: 'dsh_boot_graph_unavailable' })
  })
})
