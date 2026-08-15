import type {
  AgentClient,
  AgentClientSnapshot,
  ApprovalDecision,
  QuestionAnswerItem,
  ResolvedConversationImage,
  SendMessageInput,
  SessionSearchResult,
  SessionSummary,
  WorkspaceDirectoryListing,
  WorkspaceSummary,
} from '../shared/agent-client'
import { createObservableModel } from '../shared/observable-model'

interface FixtureSnapshot extends AgentClientSnapshot {
  baselineVersion?: number
}

interface FixtureEvent {
  type: 'reconnecting' | 'baseline-invalidated'
}

function freezeSnapshot(snapshot: FixtureSnapshot): AgentClientSnapshot {
  return Object.freeze({
    ...snapshot,
    workspaces: Object.freeze(snapshot.workspaces),
    sessions: Object.freeze(snapshot.sessions),
    conversation: snapshot.conversation === null ? null : Object.freeze({
      ...snapshot.conversation,
      messages: Object.freeze(snapshot.conversation.messages),
      interactions: Object.freeze(snapshot.conversation.interactions),
    }),
  })
}

/** Deterministic renderer seam used only by the packaged Electron smoke suite. */
export class E2eFixtureAgentClient implements AgentClient {
  readonly model = createObservableModel<AgentClientSnapshot>(Object.freeze({
    availability: 'loading',
    connectionStatus: 'connecting',
    workspaces: Object.freeze([]),
    sessions: Object.freeze([]),
    conversation: null,
    message: 'Loading deterministic fixture baseline.',
  }))
  private socket?: WebSocket
  private disposed = false

  async start(): Promise<void> {
    await this.refresh()
    this.socket = new WebSocket(new URL('/api/test.events', location.origin))
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as FixtureEvent
      if (message.type === 'reconnecting') {
        this.model.setSnapshot(Object.freeze({
          ...this.model.getSnapshot(),
          availability: 'loading',
          connectionStatus: 'connecting',
          message: 'Reconnecting to Harness fixture.',
        }))
      } else if (message.type === 'baseline-invalidated') {
        void this.refresh()
      }
    })
  }

  async refresh(): Promise<void> {
    const response = await fetch('/api/test.snapshot', { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Fixture baseline failed with HTTP ${response.status}`)
    const snapshot = await response.json() as FixtureSnapshot
    if (!this.disposed) this.model.setSnapshot(freezeSnapshot(snapshot))
  }

  selectWorkspace(workspaceId: string): void {
    this.model.setSnapshot(Object.freeze({ ...this.model.getSnapshot(), selectedWorkspaceId: workspaceId }))
  }

  selectSession(sessionId: string): void {
    this.model.setSnapshot(Object.freeze({ ...this.model.getSnapshot(), selectedSessionId: sessionId }))
  }

  async createSession(workspaceId: string): Promise<SessionSummary> {
    const response = await fetch('/api/test.session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })
    if (!response.ok) throw new Error(`Fixture session creation failed with HTTP ${response.status}`)
    await this.refresh()
    return await response.json() as SessionSummary
  }

  startSession(workspaceId?: string): void {
    if (workspaceId) void this.createSession(workspaceId)
  }

  async createWorkspace(path: string): Promise<WorkspaceSummary> {
    return Object.freeze({ id: path, name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, path })
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const snapshot = this.model.getSnapshot()
    this.model.setSnapshot(Object.freeze({ ...snapshot, sessions: snapshot.sessions.map((row) => row.id === sessionId ? { ...row, title } : row) }))
  }

  async archiveSession(sessionId: string): Promise<void> {
    const snapshot = this.model.getSnapshot()
    this.model.setSnapshot(Object.freeze({ ...snapshot, sessions: snapshot.sessions.filter((row) => row.id !== sessionId) }))
  }

  async searchSessions(query: string, _signal: AbortSignal): Promise<readonly SessionSearchResult[]> {
    const needle = query.toLowerCase()
    return this.model.getSnapshot().sessions.filter((row) => row.title.toLowerCase().includes(needle)).map((row) => ({ sessionId: row.id, title: row.title, snippet: row.title, updatedAt: row.updatedAt, workspaceId: row.workspaceId }))
  }

  async listDirectory(path = '', _signal?: AbortSignal): Promise<WorkspaceDirectoryListing> {
    return Object.freeze({ path, home: path, crumbs: Object.freeze([]), entries: Object.freeze([]), truncated: false })
  }

  async openPath(_path: string): Promise<void> {}

  async sendMessage(sessionId: string, input: SendMessageInput): Promise<void> {
    const response = await fetch('/api/test.prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input.text }),
    })
    if (!response.ok) throw new Error(`Fixture prompt failed with HTTP ${response.status}`)
    await this.refresh()
  }

  async readImage(): Promise<ResolvedConversationImage> {
    throw new Error('Fixture image reading is unavailable.')
  }

  async selectModel(): Promise<void> {}

  async cancel(): Promise<void> {}
  async answerApproval(_sessionId: string, _interactionKey: string, _decision: ApprovalDecision): Promise<void> {}
  async answerQuestions(_sessionId: string, _interactionKey: string, _answers: readonly QuestionAnswerItem[]): Promise<void> {}

  dispose(): void {
    this.disposed = true
    this.socket?.close()
    this.socket = undefined
  }
}

export async function createE2eFixtureAgentClient(): Promise<E2eFixtureAgentClient> {
  const client = new E2eFixtureAgentClient()
  await client.start()
  return client
}
