import { describe, expect, it, vi } from 'vitest'
import type { AgentClient } from '../shared/agent-client'
import type { HarnessRc6Adapter } from '../shared/harness-runtime-adapter'
import {
  RendererRuntimeHost,
  installAgentClientFactory,
  type AgentClientFactory,
} from './agent-client-host'

function fakeClient(): AgentClient {
  return {
    model: {
      getSnapshot: () => ({
        availability: 'ready',
        connectionStatus: 'connected',
        workspaces: [],
        sessions: [],
        conversation: null,
      }),
      subscribe: () => () => undefined,
    },
    refresh: async () => undefined,
    selectWorkspace: () => undefined,
    selectSession: () => undefined,
    createSession: async () => ({ id: 's', title: '', updatedAt: '', running: false }),
    startSession: () => undefined,
    createWorkspace: async (path) => ({ id: path, name: path, path }),
    renameSession: async () => undefined,
    archiveSession: async () => undefined,
    searchSessions: async () => [],
    listDirectory: async (path = '') => ({ path, home: path, crumbs: [], entries: [], truncated: false }),
    openPath: async () => undefined,
    sendMessage: async () => undefined,
    readImage: async () => ({ mediaType: 'image/png', data: new Uint8Array() }),
    selectModel: async () => undefined,
    cancel: async () => undefined,
    answerApproval: async () => undefined,
    answerQuestions: async () => undefined,
  }
}

function fakeAdapter(dispose = vi.fn(async () => undefined)): HarnessRc6Adapter {
  return {
    version: '0.1.0-rc.6',
    runtime: {} as HarnessRc6Adapter['runtime'],
    sessions: {} as HarnessRc6Adapter['sessions'],
    workspaces: {} as HarnessRc6Adapter['workspaces'],
    connection: {} as HarnessRc6Adapter['connection'],
    dispose,
  }
}

function okGraphResponse(graph: unknown): Response {
  return new Response(JSON.stringify(graph), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('RendererRuntimeHost', () => {
  it('fetches the JSON graph, boots the adapter, and installs a concrete client', async () => {
    const graph = { rev: 'graph', entries: [] }
    const client = fakeClient()
    const adapter = fakeAdapter()
    const fetch = vi.fn(async () => okGraphResponse(graph))
    const createAdapter = vi.fn(async () => adapter)
    const factory: AgentClientFactory = vi.fn(async (received) => {
      expect(received).toBe(adapter)
      return client
    })
    const host = new RendererRuntimeHost({
      fetch: fetch as typeof globalThis.fetch,
      createAdapter,
      getAgentClientFactory: () => factory,
      loadAgentClientFactory: async () => undefined,
      subscribeAgentClientFactory: () => () => undefined,
    })

    await host.start()

    expect(fetch).toHaveBeenCalledWith('/dsh-runtime/boot-manifest', expect.objectContaining({ credentials: 'same-origin' }))
    expect(createAdapter).toHaveBeenCalledWith(graph)
    expect(host.getSnapshot()).toEqual({ phase: 'ready', agentClient: client })
  })

  it('waits without inventing a mapping and accepts a later factory contribution', async () => {
    const adapter = fakeAdapter()
    let factory: AgentClientFactory | undefined
    let notify: () => void = () => undefined
    const host = new RendererRuntimeHost({
      fetch: vi.fn(async () => okGraphResponse({ rev: 'graph', entries: [] })) as typeof globalThis.fetch,
      createAdapter: async () => adapter,
      getAgentClientFactory: () => factory,
      loadAgentClientFactory: async () => undefined,
      subscribeAgentClientFactory: (listener) => {
        notify = listener
        return function unsubscribeFactory(): void {}
      },
    })

    await host.start()
    expect(host.getSnapshot().phase).toBe('waiting-agent-client')

    const client = fakeClient()
    factory = () => client
    notify()
    await vi.waitFor(() => expect(host.getSnapshot()).toEqual({ phase: 'ready', agentClient: client }))
  })

  it('publishes startup failures and can retry', async () => {
    const client = fakeClient()
    let calls = 0
    const fetch = vi.fn(async () => {
      calls += 1
      return calls === 1 ? new Response('unavailable', { status: 502 }) : okGraphResponse({ rev: 'ok', entries: [] })
    })
    const host = new RendererRuntimeHost({
      fetch: fetch as typeof globalThis.fetch,
      createAdapter: async () => fakeAdapter(),
      getAgentClientFactory: () => () => client,
      subscribeAgentClientFactory: () => () => undefined,
    })

    await host.start()
    expect(host.getSnapshot().phase).toBe('error')
    expect(host.getSnapshot().error?.message).toContain('HTTP 502')

    await host.start()
    expect(host.getSnapshot()).toEqual({ phase: 'ready', agentClient: client })
  })

  it('disposes the client contribution and adapter exactly once', async () => {
    const disposeClient = vi.fn(async () => undefined)
    const disposeAdapter = vi.fn(async () => undefined)
    const host = new RendererRuntimeHost({
      fetch: vi.fn(async () => okGraphResponse({ rev: 'graph', entries: [] })) as typeof globalThis.fetch,
      createAdapter: async () => fakeAdapter(disposeAdapter),
      getAgentClientFactory: () => () => ({ client: fakeClient(), dispose: disposeClient }),
      subscribeAgentClientFactory: () => () => undefined,
    })

    await host.start()
    await host.dispose()
    await host.dispose()

    expect(disposeClient).toHaveBeenCalledOnce()
    expect(disposeAdapter).toHaveBeenCalledOnce()
    expect(host.getSnapshot().phase).toBe('disposed')
  })

  it('supports the shared late-registration host', async () => {
    const adapter = fakeAdapter()
    const host = new RendererRuntimeHost({
      fetch: vi.fn(async () => okGraphResponse({ rev: 'graph', entries: [] })) as typeof globalThis.fetch,
      createAdapter: async () => adapter,
      loadAgentClientFactory: async () => undefined,
    })
    await host.start()
    expect(host.getSnapshot().phase).toBe('waiting-agent-client')

    const client = fakeClient()
    const uninstall = installAgentClientFactory(() => client)
    await vi.waitFor(() => expect(host.getSnapshot().phase).toBe('ready'))
    uninstall()
    await host.dispose()
  })
})
