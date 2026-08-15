import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import type { AgentClient, AgentClientSnapshot } from '../shared/agent-client'
import { UNAVAILABLE_AGENT_SNAPSHOT } from '../shared/agent-client'
import type { DesktopAppInfo, SelectedImage } from '../shared/desktop-api'
import { ArtifactsPanel } from './artifacts/ArtifactsPanel'
import { ActivityPanel } from './activity/ActivityPanel'
import { ConversationMessageView } from './ConversationMessageView'
import { useObservableModel } from './hooks/use-observable-model'
import { ApprovalCard } from './interactions/ApprovalCard'
import { QuestionCard } from './interactions/QuestionCard'
import { ModelPicker } from './models/ModelPicker'
import { attachmentMessagesForResult, canSendMessage, createImageSelectionRequest, removeAttachmentById } from './composer-state'
import { NewChatDialog } from './dialogs/NewChatDialog'
import { SearchDialog } from './dialogs/SearchDialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { ArchiveSessionDialog, RenameSessionDialog } from './dialogs/SessionDialogs'
import './styles/tokens.css'
import './styles/app.css'
import './styles/artifacts.css'

type NavItem = { label: string; shortcut?: string }

const navItems: NavItem[] = [
  { label: 'New chat', shortcut: '⌘ N' },
  { label: 'Search', shortcut: '⌘ K' },
  { label: 'Artifacts' },
]


export function moveMenuIndex(current: number, direction: 1 | -1, count: number): number {
  return count <= 0 ? 0 : (current + direction + count) % count
}

export function waitForWorkspaceNavigation(client: AgentClient, workspaceId: string, timeoutMs = 5000): Promise<void> {
  const navigated = () => {
    const snapshot = client.model.getSnapshot()
    return snapshot.selectedWorkspaceId === workspaceId && snapshot.selectedSessionId !== undefined
  }
  if (navigated()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = client.model.subscribe(() => {
      if (!navigated()) return
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      resolve()
    })
    timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('Workspace navigation was not published by the Harness runtime.'))
    }, timeoutMs)
  })
}

const unavailableModel = {
  getSnapshot: () => UNAVAILABLE_AGENT_SNAPSHOT,
  subscribe: () => () => undefined,
}

function BrandMark(): ReactElement {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
      <path d="M16 3v26M3 16h26M6.8 6.8l18.4 18.4M25.2 6.8 6.8 25.2" />
    </svg>
  )
}

function statusLabel(snapshot: AgentClientSnapshot): string {
  if (snapshot.availability === 'unavailable') return 'Harness unavailable'
  if (snapshot.availability === 'loading') return 'Connecting to Harness'
  if (snapshot.availability === 'error') return snapshot.message ?? 'Harness connection failed'
  if (snapshot.connectionStatus === 'connected') return 'Harness connected'
  if (snapshot.connectionStatus === 'connecting') return 'Harness reconnecting'
  return 'Harness disconnected'
}

export interface AppProps {
  agentClient?: AgentClient
}

export function App({ agentClient }: AppProps): ReactElement {
  const model = agentClient?.model ?? unavailableModel
  const snapshot = useObservableModel(model)
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null)
  const [attachments, setAttachments] = useState<SelectedImage[]>([])
  const [attachmentMessages, setAttachmentMessages] = useState<readonly string[]>([])
  const [draft, setDraft] = useState('')
  const [submitError, setSubmitError] = useState<string>()
  const [dialog, setDialog] = useState<'new' | 'search' | 'rename' | 'archive' | 'settings'>()
  const [menuSessionId, setMenuSessionId] = useState<string>()
  const [menuIndex, setMenuIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (window.desktop) void window.desktop.getAppInfo().then(setAppInfo)
  }, [])

  useEffect(() => {
    if (!agentClient) return
    void agentClient.refresh().catch(() => undefined)
  }, [agentClient])

  const sessions = useMemo(() => {
    if (!snapshot.selectedWorkspaceId) return snapshot.sessions
    return snapshot.sessions.filter((session) => !session.workspaceId || session.workspaceId === snapshot.selectedWorkspaceId)
  }, [snapshot.selectedWorkspaceId, snapshot.sessions])

  const openNewChat = useMemo(() => () => setDialog('new'), [])
  const openSearch = useMemo(() => () => setDialog('search'), [])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openNewChat() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch() }
      if (event.key === 'Escape') { setMenuSessionId(undefined); if (dialog) setDialog(undefined) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, openNewChat, openSearch])

  useEffect(() => {
    if (!menuSessionId) return
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuSessionId(undefined) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuSessionId])

  useEffect(() => { menuItemRefs.current[menuIndex]?.focus() }, [menuIndex, menuSessionId])

  function menuKey(event: KeyboardEvent<HTMLDivElement>, sessionId: string) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setMenuIndex((value) => moveMenuIndex(value, 1, 2)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setMenuIndex((value) => moveMenuIndex(value, -1, 2)) }
    else if (event.key === 'Escape') { event.preventDefault(); setMenuSessionId(undefined) }
    else if (event.key === 'Enter') { event.preventDefault(); setDialog(menuIndex === 0 ? 'rename' : 'archive'); setMenuSessionId(sessionId) }
  }

  function startSession(workspaceId?: string | null): void {
    if (agentClient?.startSession) { void agentClient.startSession(workspaceId) }
    else if (workspaceId) { void agentClient?.createSession(workspaceId) }
  }

  const selectedMenuSession = snapshot.sessions.find((session) => session.id === menuSessionId)

  async function chooseFiles(): Promise<void> {
    if (!window.desktop) return
    setAttachmentMessages([])
    try {
      const result = await window.desktop.selectImages(createImageSelectionRequest(snapshot, attachments))
      setAttachments((current) => [...current, ...result.images])
      setAttachmentMessages(attachmentMessagesForResult(result))
    } catch (cause) {
      setAttachmentMessages([cause instanceof Error ? cause.message : 'Images could not be attached.'])
    }
  }

  function removeAttachment(id: string): void {
    setAttachments((current) => [...removeAttachmentById(current, id)])
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const text = draft.trim()
    if (!agentClient || !snapshot.selectedSessionId || (!text && attachments.length === 0)) return
    setSubmitError(undefined)
    try {
      await agentClient.sendMessage(snapshot.selectedSessionId, {
        text,
        images: attachments.map(({ name, mediaType, bytes, width, height, base64 }) => ({ name, mediaType, bytes, width, height, base64 })),
      })
      setDraft('')
      setAttachments([])
      setAttachmentMessages([])
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Message could not be sent.')
    }
  }

  const ready = snapshot.availability === 'ready'
  const conversation = snapshot.conversation
  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === snapshot.selectedWorkspaceId)
  const title = conversation?.title || 'New conversation'
  const canSend = canSendMessage(ready, snapshot.selectedSessionId, draft, attachments.length)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <BrandMark />
          <strong>DSH Desktop</strong>
        </header>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item, index) => (
            <button
              className={index === 0 ? 'nav-button nav-button-primary' : 'nav-button'}
              disabled={!agentClient && index === 0}
              onClick={() => { if (index === 0) openNewChat(); else if (index === 1) openSearch() }}
              key={item.label}
              type="button"
            >
              <span>{item.label}</span>
              {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
            </button>
          ))}
        </nav>

        {snapshot.workspaces.length > 0 ? (
          <section className="workspace-strip" aria-label="Workspaces">
            <select aria-label="Workspace" onChange={(event) => void agentClient?.selectWorkspace(event.target.value)} value={snapshot.selectedWorkspaceId ?? ''}>
              <option disabled value="">Select workspace</option>
              {snapshot.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
            {selectedWorkspace && agentClient?.renameWorkspace ? <button onClick={() => { const title = window.prompt('Rename workspace', selectedWorkspace.name)?.trim(); if (title) void agentClient.renameWorkspace!(selectedWorkspace.id, title) }} type="button">Rename workspace</button> : null}
            {selectedWorkspace && agentClient?.deleteWorkspace ? <button onClick={() => { if (window.confirm(`Delete workspace “${selectedWorkspace.name}”? Sessions and files will not be deleted.`)) void agentClient.deleteWorkspace!(selectedWorkspace.id) }} type="button">Delete workspace</button> : null}
          </section>
        ) : null}

        <section className="sidebar-section">
          <div className="section-heading">Recent</div>
          {sessions.length ? sessions.map((session) => (
            <div className="chat-row-wrap" key={session.id}>
              <button className={session.id === snapshot.selectedSessionId ? 'chat-row chat-row-active' : 'chat-row'} onClick={() => void agentClient?.selectSession(session.id)} type="button">
                <span>{session.title || 'Untitled conversation'}</span>
                {session.running ? <span className="running-dot" title="Running" /> : null}
              </button>
              <button aria-expanded={menuSessionId === session.id} aria-haspopup="menu" aria-label={`Conversation menu for ${session.title}`} className="session-menu-trigger" onClick={() => { setMenuIndex(0); setMenuSessionId(menuSessionId === session.id ? undefined : session.id) }} type="button">•••</button>
              {menuSessionId === session.id ? <div className="session-menu" onKeyDown={(e) => menuKey(e, session.id)} ref={menuRef} role="menu" tabIndex={-1}>
                <button ref={(element) => { menuItemRefs.current[0] = element }} onClick={() => setDialog('rename')} role="menuitem" type="button">Rename</button>
                <button ref={(element) => { menuItemRefs.current[1] = element }} onClick={() => setDialog('archive')} role="menuitem" type="button">Archive</button>
              </div> : null}
            </div>
          )) : <div className="sidebar-empty">{ready ? 'No conversations yet' : 'Waiting for Harness'}</div>}
        </section>

        <footer className="sidebar-footer">
          <button className="profile-button" type="button"><span className="avatar">D</span><span><strong>{selectedWorkspace?.name ?? 'Local workspace'}</strong><small>{appInfo ? `v${appInfo.version}` : 'Loading application info'}</small></span></button>
        </footer>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div><strong>{title}</strong><span className={`status-pill status-${snapshot.availability}`}><i /> {statusLabel(snapshot)}</span></div>
          <div className="topbar-actions"><button type="button">Share</button><button aria-label="Open settings" disabled={!agentClient?.settings} onClick={() => setDialog('settings')} type="button">Settings</button></div>
        </header>

        <section className="conversation" aria-label="Conversation">
          {conversation?.messages.length || conversation?.interactions.length ? (
            <div className="message-list">
              {conversation.messages.map((message) => <ConversationMessageView agentClient={agentClient} key={message.id} message={message} sessionId={conversation.sessionId} />)}
              {conversation.interactions.map((interaction) => interaction.kind === 'approval' ? (
                <ApprovalCard interaction={interaction} key={interaction.key} onAnswer={(decision) => agentClient!.answerApproval(interaction.sessionId, interaction.key, decision)} />
              ) : (
                <QuestionCard interaction={interaction} key={interaction.key} onAnswer={(answers) => agentClient!.answerQuestions(interaction.sessionId, interaction.key, answers)} />
              ))}
            </div>
          ) : (
            <div className="hero-copy" role="status"><BrandMark /><h1>{ready ? 'How can I help you today?' : snapshot.availability === 'loading' ? 'Connecting to Harness' : 'Harness is unavailable'}</h1><p>{ready ? 'Choose a conversation or begin a new task with the connected Harness runtime.' : snapshot.message ?? 'The desktop shell is ready and will connect when a runtime adapter becomes available.'}</p></div>
          )}

          <form className="composer-wrap" onSubmit={(event) => void submit(event)}>
            <div className="composer">
              {attachments.length ? (
                <div className="attachments">
                  {attachments.map((file) => <span key={file.id}><span title={file.name}>{file.name}</span><button aria-label={`Remove ${file.name}`} onClick={() => removeAttachment(file.id)} type="button">×</button></span>)}
                </div>
              ) : null}
              {attachmentMessages.length ? <div className="attachment-errors" role="alert">{attachmentMessages.map((message, index) => <span key={`${index}:${message}`}>{message}</span>)}</div> : null}
              <textarea aria-label="Message" disabled={!ready || !snapshot.selectedSessionId} onChange={(event) => setDraft(event.target.value)} placeholder={ready ? 'Message DSH Desktop' : 'Connect Harness to start messaging'} rows={3} value={draft} />
              <div className="composer-toolbar">
                <div><button aria-label="Attach files" disabled={!ready || !snapshot.selectedSessionId} onClick={() => void chooseFiles()} type="button">Attach</button><button disabled={!ready} type="button">Tools</button></div>
                <div>
                  {snapshot.models ? <ModelPicker catalog={snapshot.models} disabled={!ready || !snapshot.selectedSessionId || !agentClient?.selectModel} onSelect={(selection) => agentClient!.selectModel!(snapshot.selectedSessionId!, selection)} /> : null}
                  {conversation?.running && agentClient && snapshot.selectedSessionId ? <button className="cancel-button" onClick={() => void agentClient.cancel(snapshot.selectedSessionId!)} type="button">Stop</button> : null}
                  <button aria-label="Send message" className="send-button" disabled={!canSend} type="submit">Send</button>
                </div>
              </div>
            </div>
            <small className={submitError ? 'disclaimer disclaimer-error' : 'disclaimer'}>{submitError ?? (ready ? (snapshot.message ?? 'Responses are supplied by the connected Harness runtime.') : 'Waiting for a compatible Harness runtime adapter.')}</small>
          </form>
        </section>
      </main>

      <ActivityPanel client={agentClient} snapshot={snapshot} onInsertSkill={(name) => setDraft(`/${name} `)} />
      <ArtifactsPanel agentClient={agentClient} workspace={selectedWorkspace} />

      {dialog === 'new' && agentClient ? <NewChatDialog workspaces={snapshot.workspaces} selectedWorkspaceId={snapshot.selectedWorkspaceId} onClose={() => setDialog(undefined)} onStart={(workspaceId) => { startSession(workspaceId); setDialog(undefined) }} onCreateWorkspace={async (path) => { if (!agentClient.createWorkspace) throw new Error('Workspace creation is unavailable.'); const workspace = await agentClient.createWorkspace(path); startSession(workspace.id); await waitForWorkspaceNavigation(agentClient, workspace.id) }}/> : null}
      {dialog === 'search' && agentClient ? <SearchDialog onClose={() => setDialog(undefined)} onSearch={(query, signal) => agentClient.searchSessions ? agentClient.searchSessions(query, signal) : Promise.resolve([])} onSelect={(id) => void agentClient.selectSession(id)}/> : null}
      {dialog === 'rename' && selectedMenuSession && agentClient?.renameSession ? <RenameSessionDialog currentTitle={selectedMenuSession.title} onClose={() => { setDialog(undefined); setMenuSessionId(undefined) }} onRename={(title) => agentClient.renameSession!(selectedMenuSession.id, title)}/> : null}
      {dialog === 'settings' && agentClient?.settings ? <SettingsDialog client={agentClient.settings} onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'archive' && selectedMenuSession && agentClient?.archiveSession ? <ArchiveSessionDialog title={selectedMenuSession.title} onClose={() => { setDialog(undefined); setMenuSessionId(undefined) }} onArchive={() => agentClient.archiveSession!(selectedMenuSession.id)}/> : null}
    </div>
  )
}
