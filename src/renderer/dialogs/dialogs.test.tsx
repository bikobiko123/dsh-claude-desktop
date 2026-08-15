import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'
import { NewChatDialog } from './NewChatDialog'
import { SearchDialog } from './SearchDialog'
import { SettingsDialog, submitCredentialValue } from './SettingsDialog'
import { ArchiveSessionDialog, RenameSessionDialog } from './SessionDialogs'

describe('renderer dialog exports', () => {
  it('provides the independent navigation and session dialogs', () => {
    expect(typeof Dialog).toBe('function')
    expect(typeof NewChatDialog).toBe('function')
    expect(typeof SearchDialog).toBe('function')
    expect(typeof SettingsDialog).toBe('function')
    expect(typeof submitCredentialValue).toBe('function')
    expect(typeof RenameSessionDialog).toBe('function')
    expect(typeof ArchiveSessionDialog).toBe('function')
  })

  it('clears a credential value after success and failure', async () => {
    const clear = vi.fn()
    const client = { setCredential: vi.fn(async () => undefined) }
    await submitCredentialValue(client as never, 'DEMO_KEY', 'secret-value', clear)
    expect(clear).toHaveBeenCalledOnce()

    client.setCredential.mockRejectedValueOnce(new Error('rejected'))
    await expect(submitCredentialValue(client as never, 'DEMO_KEY', 'secret-value', clear)).rejects.toThrow('rejected')
    expect(clear).toHaveBeenCalledTimes(2)
  })
})
