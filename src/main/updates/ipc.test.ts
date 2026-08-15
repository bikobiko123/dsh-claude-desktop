import { describe, expect, it, vi } from 'vitest'
import { updateChannels } from '../../shared/update-contract.js'
import { registerUpdateIpc } from './ipc.js'

describe('update IPC', () => {
  it('registers only fixed no-argument operations and reveals only the service-owned path', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }) }
    const shell = { showItemInFolder: vi.fn() }
    const service = {
      getState: vi.fn(() => ({ status: 'idle' as const })),
      check: vi.fn(async () => ({ status: 'up-to-date' as const, currentVersion: '1.0.0' })),
      download: vi.fn(async () => ({ status: 'error' as const, operation: 'download' as const, message: 'none' })),
      getDownloadedPath: vi.fn(() => '/trusted/update.zip'),
    }
    registerUpdateIpc(ipcMain as never, shell, service as never)
    expect([...handlers.keys()]).toEqual([updateChannels.getState, updateChannels.check, updateChannels.download, updateChannels.reveal])
    expect(handlers.get(updateChannels.reveal)?.({ sender: 'untrusted' }, 'https://evil.example/file')).toBe(true)
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/trusted/update.zip')
  })
})
