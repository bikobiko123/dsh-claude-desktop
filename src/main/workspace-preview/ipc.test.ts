import { describe, expect, it, vi } from 'vitest'
import { registerWorkspacePreviewIpc } from './ipc.js'
import { workspacePreviewChannels } from '../../shared/workspace-preview-contract.js'

class FakeIpc {
  handlers = new Map<string, (_event: unknown, value: unknown) => unknown>()
  handle(channel: string, handler: (_event: unknown, value: unknown) => unknown): void {
    this.handlers.set(channel, handler)
  }
}

describe('workspace preview IPC', () => {
  it('registers only narrow methods, validates workspaceId, and rejects unknown workspaces', async () => {
    const ipc = new FakeIpc()
    const resolve = vi.fn(async () => undefined)
    registerWorkspacePreviewIpc(ipc as never, resolve)
    expect([...ipc.handlers.keys()]).toEqual([workspacePreviewChannels.listFiles, workspacePreviewChannels.readFile])
    await expect(ipc.handlers.get(workspacePreviewChannels.listFiles)!({}, { workspaceId: 1, directory: '' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    await expect(ipc.handlers.get(workspacePreviewChannels.readFile)!({}, { workspaceId: 'unknown', path: 'x.md' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
    expect(resolve).toHaveBeenCalledWith('unknown')
  })

  it('passes only the authoritative resolved root to the filesystem service', async () => {
    const ipc = new FakeIpc()
    const resolve = vi.fn(async (id: string) => id === 'w1' ? '/definitely-missing-authoritative-root' : undefined)
    registerWorkspacePreviewIpc(ipc as never, resolve)
    const response = await ipc.handlers.get(workspacePreviewChannels.listFiles)!({}, {
      workspaceId: 'w1',
      directory: '',
      workspaceRoot: '/renderer-controlled-root',
    })
    expect(resolve).toHaveBeenCalledWith('w1')
    expect(response).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
  })
})
