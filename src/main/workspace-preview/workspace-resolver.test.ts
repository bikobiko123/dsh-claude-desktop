import { describe, expect, it, vi } from 'vitest'
import { createDshWorkspaceRootResolver } from './workspace-resolver.js'

describe('DSH workspace root resolver', () => {
  it('posts workspace.list directly to the authoritative upstream DSH origin', async () => {
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body))
      return Response.json({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value: { items: [{ workspaceId: 'w1', path: '/authoritative/root', title: 'Root', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], archivedSessionIds: [] } },
      })
    })
    const resolve = createDshWorkspaceRootResolver({ getUpstreamOrigin: () => 'http://127.0.0.1:3080', fetch: fetch as typeof globalThis.fetch })
    await expect(resolve('w1')).resolves.toBe('/authoritative/root')
    await expect(resolve('missing')).resolves.toBeUndefined()
    expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:3080/api/workspace.list')
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('origin')).toBe('http://127.0.0.1:3080')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ type: 'client-request', method: 'workspace.list', payload: {} })
  })

  it('fails closed without upstream origin and on mismatched RPC responses', async () => {
    const fetch = vi.fn(async () => Response.json({ type: 'server-response', rpcId: 'wrong', result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    const noOrigin = createDshWorkspaceRootResolver({ getUpstreamOrigin: () => undefined, fetch: fetch as typeof globalThis.fetch })
    await expect(noOrigin('w1')).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    const resolve = createDshWorkspaceRootResolver({ getUpstreamOrigin: () => 'http://127.0.0.1:3080', fetch: fetch as typeof globalThis.fetch })
    await expect(resolve('')).resolves.toBeUndefined()
    await expect(resolve('w1')).resolves.toBeUndefined()
  })
})
