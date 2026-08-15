import { useEffect, useState, type ReactElement } from 'react'
import type { SettingsClient } from '../../shared/agent-client'
import { useObservableModel } from '../hooks/use-observable-model'
import { Dialog } from './Dialog'
import { UpdateSection } from './UpdateSection'

/** One-shot secret handoff: the value is not returned and clearing runs on every outcome. */
export async function submitCredentialValue(client: SettingsClient, ref: string, value: string, clear: () => void): Promise<void> {
  try { await client.setCredential(ref, value) }
  finally { clear() }
}

export function SettingsDialog({ client, onClose }: { client: SettingsClient; onClose(): void }): ReactElement {
  const snapshot = useObservableModel(client.model)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({})

  useEffect(() => { void client.refresh() }, [client])

  async function run(key: string, action: () => Promise<void>): Promise<void> {
    setBusy(key)
    setError(undefined)
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be updated.') }
    finally { setBusy(undefined) }
  }

  async function submitCredential(ref: string): Promise<void> {
    const value = credentialValues[ref] ?? ''
    if (!value) return
    await run(ref, () => submitCredentialValue(client, ref, value, () => {
      // Drop the only renderer-owned copy whether the host accepts or rejects it.
      setCredentialValues((current) => {
        if (!(ref in current)) return current
        const next = { ...current }
        delete next[ref]
        return next
      })
    }))
  }

  const runtime = snapshot.runtime
  return <Dialog description="Runtime, providers, credentials, and permission defaults from the connected Harness host." onClose={onClose} title="Settings">
    <div className="settings-body">
      {snapshot.state === 'loading' && !runtime ? <p className="settings-loading" role="status">Loading Harness settings…</p> : null}
      {snapshot.error || error ? <p className="dialog-error" role="alert">{error ?? snapshot.error}</p> : null}

      <section className="settings-section">
        <div className="settings-section-title"><div><h3>General</h3><p>Official rc.6 runtime information.</p></div><button disabled={snapshot.state === 'loading'} onClick={() => void client.refresh()} type="button">Refresh</button></div>
        {runtime ? <dl className="settings-facts">
          <div><dt>Harness</dt><dd>v{runtime.version}</dd></div>
          <div><dt>Working directory</dt><dd title={runtime.cwd}>{runtime.cwd}</dd></div>
          <div><dt>Default route</dt><dd>{runtime.provider && runtime.model ? `${runtime.provider} / ${runtime.model}` : 'Harness default'}</dd></div>
          <div><dt>Attached sessions</dt><dd>{runtime.attachedSessions}</dd></div>
        </dl> : null}
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><div><h3>Permission default</h3><p>Applied to newly created sessions{snapshot.permission.applies === 'restart' ? ' after restart' : ''}.</p></div></div>
        {snapshot.permission.available ? <label className="settings-field">Preset
          <select aria-label="Permission preset" disabled={!snapshot.permission.writable || Boolean(busy)} onChange={(event) => void run('permission', () => client.selectPermissionPreset(event.target.value))} value={snapshot.permission.current}>
            {snapshot.permission.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label> : <p className="settings-muted">Permission presets are not registered by this host.</p>}
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><div><h3>Providers</h3><p>Availability and host model discovery. Configuration values stay inside Harness.</p></div></div>
        <div className="settings-list">{snapshot.providers.map((provider) => <article className="settings-row" key={provider.id}>
          <span className={`settings-status ${provider.active ? 'is-active' : ''}`} aria-label={provider.active ? 'Active' : 'Inactive'} />
          <div><strong>{provider.name}</strong><small>{provider.id} · {provider.modelCount} model{provider.modelCount === 1 ? '' : 's'}</small></div>
          <span className="settings-badge">{provider.active ? 'Active' : provider.declared ? 'Configured route' : 'Unavailable'}</span>
        </article>)}</div>
        {snapshot.modelFailureCount ? <p className="settings-muted">{snapshot.modelFailureCount} provider catalog request{snapshot.modelFailureCount === 1 ? '' : 's'} failed.</p> : null}
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><div><h3>Credentials</h3><p>Masked status only. Secret values are never returned to this window.</p></div></div>
        {snapshot.credentials.length ? <div className="settings-list">{snapshot.credentials.map((credential) => <article className="settings-row" key={credential.ref}>
          <span className={`settings-status ${credential.configured ? 'is-active' : ''}`} />
          <div><strong>{credential.ref}</strong><small>{credential.configured ? `Configured${credential.source ? ` via ${credential.source}` : ''}` : 'Not configured'}</small></div>
          {credential.writable ? <div className="settings-credential-actions">
            {!credential.configured ? <form onSubmit={(event) => { event.preventDefault(); void submitCredential(credential.ref) }}>
              <input aria-label={`Value for ${credential.ref}`} autoComplete="off" onChange={(event) => setCredentialValues((current) => ({ ...current, [credential.ref]: event.target.value }))} type="password" value={credentialValues[credential.ref] ?? ''} />
              <button disabled={Boolean(busy) || !(credentialValues[credential.ref] ?? '')} type="submit">Save</button>
            </form> : null}
            {credential.configured ? <button disabled={Boolean(busy)} onClick={() => void run(credential.ref, () => client.removeCredential(credential.ref))} type="button">Remove</button> : null}
          </div> : <span className="settings-badge">Managed</span>}
        </article>)}</div> : <p className="settings-muted">No credential references are advertised by configured providers.</p>}
      </section>

      <UpdateSection />
    </div>
  </Dialog>
}
