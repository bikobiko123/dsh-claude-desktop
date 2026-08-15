import { useEffect, useState, type ReactElement } from 'react'
import type { UpdateState } from '../../shared/update-contract'

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) + ' MB'
}

export function UpdateSection(): ReactElement {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    let active = true
    void window.desktop.updates.getState().then((next) => { if (active) setState(next) })
    const unsubscribe = window.desktop.updates.onStateChanged((next) => { if (active) setState(next) })
    return () => { active = false; unsubscribe() }
  }, [])

  function invoke(operation: 'check' | 'download' | 'reveal', action: () => Promise<unknown>): void {
    void action().catch((cause: unknown) => setState({ status: 'error', operation, message: cause instanceof Error ? cause.message : 'The desktop update operation failed.' }))
  }

  const busy = state.status === 'checking' || state.status === 'downloading'
  return <section className="settings-section update-section">
    <div className="settings-section-title">
      <div><h3>Desktop updates</h3><p>Secure manual downloads from the public bikobiko123/dsh-claude-desktop GitHub Releases page.</p></div>
      <button disabled={busy} onClick={() => invoke('check', () => window.desktop.updates.check())} type="button">{state.status === 'checking' ? 'Checking…' : 'Check for updates'}</button>
    </div>
    <div className="update-status" aria-live="polite">
      {state.status === 'idle' ? <p>No update check has been run.</p> : null}
      {state.status === 'checking' ? <p role="status">Checking the latest stable release…</p> : null}
      {state.status === 'up-to-date' ? <p>You are up to date (v{state.currentVersion}).</p> : null}
      {state.status === 'available' ? <>
        <p><strong>Version {state.version} is available.</strong> Exact artifact: {state.fileName} ({formatBytes(state.size)}).</p>
        <button onClick={() => invoke('download', () => window.desktop.updates.download())} type="button">Download and verify</button>
      </> : null}
      {state.status === 'downloading' ? <>
        <p role="status">Downloading and verifying {state.fileName}: {state.percent}%</p>
        <progress aria-label="Update download progress" max={100} value={state.percent}>{state.percent}%</progress>
        <small>{formatBytes(state.received)} of {formatBytes(state.total)}</small>
      </> : null}
      {state.status === 'downloaded' ? <>
        <p><strong>Version {state.version} was downloaded and SHA-256 verified.</strong> The application will not install or replace itself.</p>
        <button onClick={() => invoke('reveal', () => window.desktop.updates.reveal())} type="button">Reveal downloaded artifact</button>
      </> : null}
      {state.status === 'error' ? <p className="dialog-error" role="alert">Update {state.operation} failed: {state.message}</p> : null}
    </div>
    <p className="settings-muted">Unsigned personal-use builds require manual replacement. macOS may display Gatekeeper warnings; review the security notes before opening the archive.</p>
  </section>
}
