import { describe, expect, it, vi } from 'vitest'
import { waitForWorkspaceNavigation } from './App'
import type { AgentClientSnapshot } from '../shared/agent-client'

function model() {
  let snapshot: AgentClientSnapshot = {
    availability: 'ready', connectionStatus: 'connected', workspaces: [], sessions: [], conversation: null,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    publish(next: AgentClientSnapshot) { snapshot = next; for (const listener of listeners) listener() },
  }
}

describe('workspace creation navigation lifecycle', () => {
  it('resolves only after official navigation is observable', async () => {
    const state = model()
    const client = { model: state } as unknown as import('../shared/agent-client').AgentClient
    const pending = waitForWorkspaceNavigation(client, 'w1', 1000)
    state.publish({ ...state.getSnapshot(), selectedWorkspaceId: 'w1' })
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    state.publish({ ...state.getSnapshot(), selectedWorkspaceId: 'w1', selectedSessionId: 's1' })
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects when navigation is not published', async () => {
    vi.useFakeTimers()
    const state = model()
    const client = { model: state } as unknown as import('../shared/agent-client').AgentClient
    const pending = waitForWorkspaceNavigation(client, 'w1', 100)
    vi.advanceTimersByTime(100)
    await expect(pending).rejects.toThrow('navigation was not published')
    vi.useRealTimers()
  })
})
