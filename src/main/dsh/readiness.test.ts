import { describe, expect, it, vi } from 'vitest'
import { waitForDshReadiness } from './readiness.js'

describe('waitForDshReadiness', () => {
  it('retries until the boot graph page is available', async () => {
    let time = 0
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(new Response('<html>window.__DSH_BOOT__ = {}</html>', { status: 200 }))
    await waitForDshReadiness({
      origin: 'http://127.0.0.1:1234',
      timeoutMs: 1_000,
      intervalMs: 10,
      fetch,
      now: () => time,
      sleep: async (ms) => { time += ms },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('times out with the last readiness error', async () => {
    let time = 0
    await expect(waitForDshReadiness({
      origin: 'http://127.0.0.1:1234',
      timeoutMs: 20,
      intervalMs: 10,
      fetch: vi.fn(async () => new Response('not ready', { status: 503 })),
      now: () => time,
      sleep: async (ms) => { time += ms },
    })).rejects.toThrow('HTTP 503')
  })
})
