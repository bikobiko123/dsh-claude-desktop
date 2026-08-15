import { describe, expect, it, vi } from 'vitest'
import { Rc6SettingsClient } from './settings-client.js'

function ok<T>(value: T) { return { result: { ok: true as const, value } } }

function apiFixture() {
  const api = {
    host: { describe: vi.fn(async () => ok({ version: 'rc.6', cwd: '/tmp', provider: undefined, model: undefined, attachedSessions: 0, canOpenPath: false })) },
    settings: { describe: vi.fn(async () => ok({ writable: true, namespaces: [{ ns: 'provider', revision: 1, value: { providers: { demo: { apiKeyEnv: 'DEMO_KEY' } } }, schema: { type: 'object', properties: {} } }], })) },
    llm: {
      providers: vi.fn(async () => ok({ providers: [{ provider: 'demo', displayName: 'Demo', active: true, declared: true, settingsNs: 'provider', settingsPath: ['providers', 'demo'] }] })),
      models: vi.fn(async () => ok({ groups: [], failures: [] })),
    },
    credentials: {
      describe: vi.fn(async () => ok({ credentials: { DEMO_KEY: { configured: false, writable: true } } })),
      set: vi.fn(async () => ok({})),
      unset: vi.fn(async () => ok({})),
    },
  }
  return api
}

describe('Rc6SettingsClient credentials', () => {
  it('exposes only value-free status and sends a secret through credentials.set', async () => {
    const api = apiFixture()
    const client = new Rc6SettingsClient(api as never)
    await client.refresh()

    const snapshot = client.model.getSnapshot()
    expect(JSON.stringify(snapshot)).not.toContain('secret-value')
    expect(snapshot.credentials).toEqual([{ ref: 'DEMO_KEY', configured: false, writable: true }])

    await client.setCredential('DEMO_KEY', 'secret-value')
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'DEMO_KEY', value: 'secret-value' })
    expect(JSON.stringify(client.model.getSnapshot())).not.toContain('secret-value')
  })

  it('keeps removal on the same official credentials seam', async () => {
    const api = apiFixture()
    api.credentials.describe.mockResolvedValue(ok({ credentials: { DEMO_KEY: { configured: true, source: 'file', writable: true } } }))
    const client = new Rc6SettingsClient(api as never)
    await client.refresh()
    await client.removeCredential('DEMO_KEY')
    expect(api.credentials.unset).toHaveBeenCalledWith({ ref: 'DEMO_KEY' })
  })

  it('rejects writes to managed or unknown references before sending', async () => {
    const api = apiFixture()
    const client = new Rc6SettingsClient(api as never)
    await client.refresh()
    await expect(client.setCredential('OTHER_KEY', 'secret-value')).rejects.toThrow('not writable')
    expect(api.credentials.set).not.toHaveBeenCalled()
  })
})
