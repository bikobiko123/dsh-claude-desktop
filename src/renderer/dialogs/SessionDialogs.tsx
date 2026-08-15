import { useRef, useState, type FormEvent } from 'react'
import { Dialog } from './Dialog'

export function RenameSessionDialog({ currentTitle, onClose, onRename }: { currentTitle: string; onClose(): void; onRename(title: string): Promise<void> }) {
  const [title, setTitle] = useState(currentTitle)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  async function submit(event: FormEvent) { event.preventDefault(); const value = title.trim(); if (!value) return; try { await onRename(value); onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename conversation.') } }
  return <Dialog initialFocus={inputRef} onClose={onClose} title="Rename conversation"><form className="dialog-body" onSubmit={(e) => void submit(e)}><label>Conversation name<input maxLength={120} onChange={(e) => setTitle(e.target.value)} ref={inputRef} value={title}/></label>{error && <p className="dialog-error" role="alert">{error}</p>}<footer><button onClick={onClose} type="button">Cancel</button><button className="dialog-primary" disabled={!title.trim()} type="submit">Rename</button></footer></form></Dialog>
}

export function ArchiveSessionDialog({ title, onClose, onArchive }: { title: string; onClose(): void; onArchive(): Promise<void> }) {
  const [error, setError] = useState<string>()
  return <Dialog description={`Archive “${title}”? It will be hidden from the sidebar, but its Harness session data remains available.`} onClose={onClose} title="Archive conversation"><div className="dialog-body">{error && <p className="dialog-error" role="alert">{error}</p>}<footer><button onClick={onClose} type="button">Cancel</button><button className="dialog-danger" onClick={() => void onArchive().then(onClose).catch((e) => setError(e instanceof Error ? e.message : 'Could not archive conversation.'))} type="button">Archive</button></footer></div></Dialog>
}
