import { useRef, useState, type FormEvent } from 'react'
import type { WorkspaceSummary } from '../../shared/agent-client'
import { Dialog } from './Dialog'

export function NewChatDialog({ workspaces, selectedWorkspaceId, onClose, onStart, onCreateWorkspace }: {
  workspaces: readonly WorkspaceSummary[]
  selectedWorkspaceId?: string
  onClose(): void
  onStart(workspaceId: string | null): void
  onCreateWorkspace(path: string): Promise<void>
}) {
  const [workspaceId, setWorkspaceId] = useState(selectedWorkspaceId ?? workspaces[0]?.id ?? '')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      onStart(workspaceId || null)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start a chat.') }
    finally { setBusy(false) }
  }
  async function create() {
    const folder = path.trim()
    if (!folder) return
    setBusy(true)
    setError(undefined)
    try {
      await onCreateWorkspace(folder)
      setPath('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create workspace.')
    } finally {
      setBusy(false)
    }
  }
  return <Dialog description="Choose a workspace for the new conversation or register a local folder." initialFocus={selectRef} onClose={onClose} title="New chat">
    <form className="dialog-body" onSubmit={(e) => void submit(e)}>
      <label>Workspace<select onChange={(e) => setWorkspaceId(e.target.value)} ref={selectRef} value={workspaceId}><option value="">No workspace</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <div className="dialog-divider"><span>or add a workspace</span></div>
      <label>Folder path<div className="dialog-inline"><input onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/project" value={path}/><button disabled={!path.trim() || busy} onClick={() => void create()} type="button">Add</button></div></label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <footer><button onClick={onClose} type="button">Cancel</button><button className="dialog-primary" disabled={busy} type="submit">Start chat</button></footer>
    </form>
  </Dialog>
}
