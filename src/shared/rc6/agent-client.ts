import type { ConnectionHandle, IApiClient, PromptContentPart, SessionModels } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions, IWorkspaces, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentClient,
  AgentClientSnapshot,
  ActivityView,
  ApprovalDecision,
  GoalView,
  ModelCatalogView,
  ModelSelectionView,
  ObservableModel,
  QuestionAnswerItem,
  ResolvedConversationImage,
  SendMessageInput,
  SessionSearchResult,
  SessionSummary,
  WorkspaceDirectoryListing,
  WorkspaceSummary,
} from '../agent-client.js'
import { mapAgentSnapshot } from './mappers.js'
import { Rc6SettingsClient } from './settings-client.js'

export interface Rc6AgentClientServices {
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly connection?: ConnectionHandle
  readonly api: IApiClient
}

function emptyModelCatalog(state: ModelCatalogView['state'] = 'idle'): ModelCatalogView {
  return Object.freeze({ state, routable: false, options: Object.freeze([]), failures: Object.freeze([]) })
}

function mapModels(models: SessionModels): ModelCatalogView {
  return Object.freeze({
    state: 'ready',
    current: Object.freeze({ ...models.current }),
    routable: models.routable,
    options: Object.freeze(models.groups.flatMap((group) => group.models.map((model) => Object.freeze({
      provider: group.id,
      providerName: group.name,
      id: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      reasoningEfforts: Object.freeze((model.reasoning?.efforts ?? []).map((effort) => Object.freeze({ ...effort }))),
      ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultReasoningEffort: model.reasoning.defaultEffort }),
    })))),
    failures: Object.freeze(models.failures.map((failure) => Object.freeze({ provider: failure.id, name: failure.name, message: failure.message }))),
  })
}

function errorMessage(result: { ok: boolean; error?: { message?: string; code?: string } }, operation: string): void {
  if (result.ok) return
  const error = result.error
  throw new Error(error?.message ?? error?.code ?? `${operation} failed`)
}

function receiptError(receipt: { accepted: boolean; reason?: string }, operation: string): void {
  if (receipt.accepted) return
  throw new Error(`${operation} failed: ${receipt.reason ?? 'response not accepted'}`)
}

/**
 * Concrete view facade over a settled rc.6 sessions/workspaces object layer.
 * It observes only official immutable snapshots and delegates every mutation to
 * the runtime faces; it never consumes or folds raw SessionEvents.
 */
export class Rc6AgentClient implements AgentClient {
  readonly model: ObservableModel<AgentClientSnapshot>
  readonly settings: Rc6SettingsClient
  private readonly listeners = new Set<() => void>()
  private readonly disposeSessions: () => void
  private readonly disposeWorkspaces: () => void
  private disposeSession?: () => void
  private disposeGoal?: () => void
  private currentSession?: SessionFace
  private currentSessionId?: string
  private modelCatalog: ModelCatalogView = emptyModelCatalog()
  private activity: ActivityView = Object.freeze({ skills: Object.freeze([]), skillsState: 'idle', subagents: Object.freeze([]), jobs: Object.freeze([]) })
  private activityGeneration = 0
  private modelGeneration = 0
  private snapshot: AgentClientSnapshot
  private disposed = false

  constructor(private readonly services: Rc6AgentClientServices) {
    this.settings = new Rc6SettingsClient(services.api)
    this.currentSession = this.resolveCurrentSession()
    this.currentSessionId = this.selectedSessionId()
    this.snapshot = this.readSnapshot()
    this.model = Object.freeze({
      getSnapshot: () => this.snapshot,
      subscribe: (listener: () => void) => {
        if (this.disposed) return () => undefined
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    })
    this.disposeSession = this.currentSession?.subscribe(() => this.publish())
    this.disposeGoal = this.currentSession?.projections.faceOf('goal').subscribe(() => this.publish())
    this.disposeSessions = services.sessions.list.subscribe(() => {
      this.rebindCurrentSession()
      this.syncActivityFromSessionState()
      this.publish()
    })
    this.disposeWorkspaces = services.workspaces.list.subscribe(() => this.publish())
    void this.loadModels(this.selectedSessionId())
    void this.loadActivity()
  }

  async refresh(): Promise<void> {
    this.publish()
    const sessionId = this.selectedSessionId()
    await Promise.all([this.loadModels(sessionId), this.loadActivity()])
  }

  async selectWorkspace(workspaceId: string): Promise<void> {
    const id = await this.services.workspaces.connectWorkspace(workspaceId as Parameters<IWorkspaces['connectWorkspace']>[0])
    this.services.sessions.open(id)
  }

  selectSession(sessionId: string): void {
    this.services.sessions.open(sessionId as Parameters<ISessions['open']>[0])
  }

  async createSession(workspaceId: string): Promise<SessionSummary> {
    const id = await this.services.workspaces.connectWorkspace(workspaceId as Parameters<IWorkspaces['connectWorkspace']>[0])
    this.services.sessions.open(id)
    const state = this.services.sessions.list.getSnapshot()
    const row = state.byId[id]
    if (row === undefined) throw new Error(`Harness runtime did not publish connected session ${String(id)}`)
    return Object.freeze({
      id: String(row.id),
      title: row.displayTitle,
      updatedAt: new Date(row.updatedAt).toISOString(),
      running: row.running,
      workspaceId,
    })
  }

  startSession(workspaceId?: string | null): void {
    if (workspaceId === null) { this.services.sessions.clear(); return }
    this.services.workspaces.startSession(workspaceId as Parameters<IWorkspaces['startSession']>[0])
  }

  async createWorkspace(path: string): Promise<WorkspaceSummary> {
    const workspace = await this.services.workspaces.create({ path })
    return Object.freeze({
      id: String(workspace.workspaceId),
      name: workspace.title,
      path: workspace.path,
    })
  }

  async renameWorkspace(workspaceId: string, title: string): Promise<void> {
    await this.services.workspaces.rename(workspaceId as Parameters<IWorkspaces['rename']>[0], title)
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.services.workspaces.delete(workspaceId as Parameters<IWorkspaces['delete']>[0])
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const result = await this.requireSession(sessionId).rename(title)
    errorMessage(result, 'Rename session')
  }

  archiveSession(sessionId: string): Promise<void> {
    return this.services.workspaces.archiveSession(sessionId as Parameters<IWorkspaces['archiveSession']>[0])
  }

  async searchSessions(query: string, signal: AbortSignal): Promise<readonly SessionSearchResult[]> {
    const result = await this.services.sessions.search(query, signal)
    errorMessage(result, 'Search sessions')
    if (!result.ok) throw new Error('Search sessions failed')
    const sessionState = this.services.sessions.list.getSnapshot()
    const workspaceState = this.services.workspaces.list.getSnapshot()
    const workspaceIds = new Map<string, string>()
    for (const workspace of workspaceState.items) {
      for (const sessionId of workspace.sessionIds) workspaceIds.set(String(sessionId), String(workspace.workspaceId))
    }
    return Object.freeze(result.value.items.map((item) => {
      const row = sessionState.byId[item.sessionId]
      return Object.freeze({
        sessionId: String(item.sessionId),
        title: row?.displayTitle ?? String(item.sessionId),
        snippet: item.snippet,
        ...(row === undefined ? {} : { updatedAt: new Date(row.updatedAt).toISOString() }),
        ...(workspaceIds.get(String(item.sessionId)) ? { workspaceId: workspaceIds.get(String(item.sessionId)) } : {}),
      })
    }))
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing> {
    const listing = await this.services.workspaces.listDirectory(path, signal)
    const mapEntry = (entry: (typeof listing.entries)[number]) => Object.freeze({
      name: entry.name,
      path: entry.path,
      hidden: entry.hidden,
    })
    return Object.freeze({
      path: listing.path,
      home: listing.home,
      crumbs: Object.freeze(listing.crumbs.map(mapEntry)),
      entries: Object.freeze(listing.entries.map(mapEntry)),
      truncated: listing.truncated,
    })
  }

  openPath(path: string): Promise<void> {
    return this.services.workspaces.openPath(path)
  }

  async sendMessage(sessionId: string, input: SendMessageInput): Promise<void> {
    const session = this.requireSession(sessionId)
    const content: PromptContentPart[] = []
    if (input.text.trim()) content.push({ type: 'text', text: input.text.trim() })
    for (const image of input.images) content.push({ type: 'image', mediaType: image.mediaType, data: image.base64, name: image.name })
    if (content.length === 0) throw new Error('A message must include text or at least one image.')
    const result = await session.prompt(content, 'queue')
    errorMessage(result, 'Send message')
  }

  async readImage(sessionId: string, attachmentId: string): Promise<ResolvedConversationImage> {
    const result = await this.requireSession(sessionId).readAttachment(attachmentId as never)
    errorMessage(result, 'Read image attachment')
    if (!result.ok) throw new Error('Read image attachment failed')
    return Object.freeze({ mediaType: result.value.attachment.mediaType, data: result.value.data })
  }

  async cancel(sessionId: string): Promise<void> {
    const result = await this.requireSession(sessionId).cancel()
    errorMessage(result, 'Cancel')
  }

  async selectModel(sessionId: string, selection: ModelSelectionView): Promise<void> {
    const generation = this.modelGeneration
    const response = await this.services.api.sessions.selectModel({ sessionId: sessionId as never, ...selection })
    errorMessage(response.result, 'Select model')
    if (this.disposed || generation !== this.modelGeneration || String(this.services.sessions.list.getSnapshot().current) !== sessionId) return
    await this.loadModels(sessionId)
  }

  async invokeSkill(sessionId: string, name: string, argument = ''): Promise<void> {
    const line = `/${name}${argument.trim() ? ` ${argument.trim()}` : ''}`
    await this.sendMessage(sessionId, { text: line, images: [] })
  }

  openSubagent(parentSessionId: string, childSessionId: string, mode: 'one-shot' | 'continuable'): void {
    this.services.sessions.openSubagent({ parentSessionId, childSessionId, mode } as never)
  }

  async promptSubagent(parentSessionId: string, childSessionId: string, text: string, signal = new AbortController().signal): Promise<void> {
    const response = await this.services.api.subagents.prompt({ parentSessionId: parentSessionId as never, childSessionId: childSessionId as never, mode: 'continuable', content: [{ type: 'text', text }] }, signal)
    errorMessage(response.result, 'Prompt subagent')
  }

  async interruptSubagent(parentSessionId: string, childSessionId: string): Promise<void> {
    const response = await this.services.api.subagents.interrupt({ parentSessionId: parentSessionId as never, childSessionId: childSessionId as never, mode: 'continuable' })
    errorMessage(response.result, 'Interrupt subagent')
  }

  async createGoal(sessionId: string, objective: string, maxGoalRounds?: number): Promise<void> {
    const response = await this.services.api.goals.create({ sessionId: sessionId as never, objective, ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) })
    errorMessage(response.result, 'Create goal')
  }

  editGoal(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>, changes: { objective?: string; maxGoalRounds?: number }): Promise<void> {
    return this.mutateGoal('edit', sessionId, goal, changes)
  }

  pauseGoal(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void> { return this.mutateGoal('pause', sessionId, goal) }
  resumeGoal(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void> { return this.mutateGoal('resume', sessionId, goal) }
  completeGoal(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void> { return this.mutateGoal('complete', sessionId, goal) }
  clearGoal(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void> { return this.mutateGoal('clear', sessionId, goal) }

  async answerApproval(sessionId: string, interactionKey: string, decision: ApprovalDecision): Promise<void> {
    const wait = this.requirePending(sessionId, interactionKey, 'approval')
    const receipt = await wait.respond({
      ok: true,
      value: {
        sessionId: wait.sessionId,
        approvalId: wait.payload.approvalId,
        outcome: decision,
      },
    })
    receiptError(receipt, 'Answer approval')
  }

  async answerQuestions(sessionId: string, interactionKey: string, answers: readonly QuestionAnswerItem[]): Promise<void> {
    const wait = this.requirePending(sessionId, interactionKey, 'question')
    const receipt = await wait.respond({
      ok: true,
      value: {
        sessionId: wait.sessionId,
        answer: {
          answers: answers.map((answer) => ({
            id: answer.id,
            selected: [...answer.selected],
            ...(answer.custom === undefined ? {} : { custom: answer.custom }),
          })),
        },
      },
    })
    receiptError(receipt, 'Answer questions')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeSession?.()
    this.disposeGoal?.()
    this.disposeSessions()
    this.disposeWorkspaces()
    this.settings.dispose()
    this.listeners.clear()
  }

  private resolveCurrentSession(): SessionFace | undefined {
    const current = this.services.sessions.list.getSnapshot().current
    if (current === undefined) return undefined
    return this.services.sessions.binding(current)?.session
  }

  private rebindCurrentSession(): void {
    const next = this.resolveCurrentSession()
    const nextId = this.selectedSessionId()
    if (next === this.currentSession && nextId === this.currentSessionId) return
    this.disposeSession?.()
    this.disposeGoal?.()
    this.currentSession = next
    this.currentSessionId = nextId
    this.modelGeneration += 1
    this.modelCatalog = emptyModelCatalog(next === undefined ? 'idle' : 'loading')
    this.activity = Object.freeze({ skills: Object.freeze([]), skillsState: 'idle', subagents: Object.freeze([]), jobs: Object.freeze([]) })
    this.disposeSession = next?.subscribe(() => this.publish())
    this.disposeGoal = next?.projections.faceOf('goal').subscribe(() => this.publish())
    this.publish()
    void this.loadModels(nextId)
    void this.loadActivity()
  }

  private readSnapshot(): AgentClientSnapshot {
    const base = mapAgentSnapshot(
      this.services.sessions.list.getSnapshot(),
      this.services.workspaces.list.getSnapshot(),
      this.currentSession,
    )
    const sessionState = this.services.sessions.list.getSnapshot()
    const sessionId = sessionState.current
    const goal = this.readGoal()
    const activity = Object.freeze({
      ...this.activity,
      goal,
      jobs: Object.freeze((sessionId === undefined ? [] : (sessionState.jobsBySession[sessionId] ?? [])).map((job) => Object.freeze({ ...job, id: String(job.id) }))),
    })
    return Object.freeze({ ...base, models: this.modelCatalog, activity })
  }

  private publish(): void {
    if (this.disposed) return
    this.snapshot = this.readSnapshot()
    for (const listener of [...this.listeners]) listener()
  }

  private selectedSessionId(): string | undefined {
    const current = this.services.sessions.list.getSnapshot().current
    return current === undefined ? undefined : String(current)
  }

  private async loadModels(sessionId: string | undefined = this.selectedSessionId()): Promise<void> {
    const generation = ++this.modelGeneration
    if (sessionId === undefined) {
      this.modelCatalog = emptyModelCatalog()
      this.publish()
      return
    }
    this.modelCatalog = emptyModelCatalog('loading')
    this.publish()
    try {
      const response = await this.services.api.sessions.models({ sessionId: sessionId as never })
      if (generation !== this.modelGeneration || this.disposed || this.currentSessionId !== sessionId || this.selectedSessionId() !== sessionId) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.modelCatalog = mapModels(response.result.value)
    } catch (cause) {
      if (generation !== this.modelGeneration || this.disposed || this.currentSessionId !== sessionId || this.selectedSessionId() !== sessionId) return
      this.modelCatalog = Object.freeze({ ...emptyModelCatalog('error'), error: cause instanceof Error ? cause.message : String(cause) })
    }
    this.publish()
  }

  private syncActivityFromSessionState(): void {
    const state = this.services.sessions.list.getSnapshot()
    const sessionId = state.current
    const catalog = sessionId === undefined ? undefined : state.subagentsByParent[sessionId]
    const subagents = Object.freeze((catalog?.entries ?? []).map((entry) => entry.kind === 'diagnostic'
      ? Object.freeze({ id: String(entry.id), mode: 'one-shot' as const, activity: 'inactive' as const, diagnostic: entry.reason })
      : Object.freeze({ id: String(entry.id), mode: entry.mode, activity: entry.activity, hasChildren: entry.hasChildren, ...(entry.label === undefined ? {} : { label: entry.label }) })))
    this.activity = Object.freeze({ ...this.activity, subagents })
  }

  private async loadActivity(): Promise<void> {
    const state = this.services.sessions.list.getSnapshot()
    const sessionId = state.current
    const selectedSessionId = sessionId === undefined ? undefined : String(sessionId)
    const generation = ++this.activityGeneration
    this.syncActivityFromSessionState()
    if (sessionId === undefined) {
      this.activity = Object.freeze({ ...this.activity, skills: Object.freeze([]), skillsState: 'idle', skillsError: undefined })
      this.publish()
      return
    }
    this.activity = Object.freeze({ ...this.activity, skills: Object.freeze([]), skillsState: 'loading', skillsError: undefined })
    this.publish()
    try {
      const response = await this.services.api.skills.list({ sessionId })
      if (generation !== this.activityGeneration || this.disposed || this.selectedSessionId() !== selectedSessionId) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.activity = Object.freeze({
        ...this.activity,
        skillsState: 'ready',
        skills: Object.freeze(response.result.value.skills.map((skill) => Object.freeze({ ...skill }))),
        skillsError: undefined,
      })
    } catch (cause) {
      if (generation !== this.activityGeneration || this.disposed || this.selectedSessionId() !== selectedSessionId) return
      this.activity = Object.freeze({ ...this.activity, skillsState: 'error', skillsError: cause instanceof Error ? cause.message : String(cause) })
    }
    this.publish()
  }

  private readGoal(): GoalView | null | undefined {
    if (!this.currentSession) return undefined
    const projection = this.currentSession.projections.faceOf('goal').getSnapshot() as { goal: Omit<GoalView, 'roundsStarted' | 'createdAt' | 'updatedAt'>; roundsStarted: number; createdAt: number; updatedAt: number } | null | undefined
    if (projection === undefined || projection === null) return projection
    return Object.freeze({ ...projection.goal, id: String(projection.goal.id), roundsStarted: projection.roundsStarted, createdAt: projection.createdAt, updatedAt: projection.updatedAt })
  }

  private async mutateGoal(operation: 'edit' | 'pause' | 'resume' | 'complete' | 'clear', sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>, changes: { objective?: string; maxGoalRounds?: number } = {}): Promise<void> {
    const payload = { sessionId: sessionId as never, ref: { id: goal.id as never, revision: goal.revision }, ...changes }
    const response = operation === 'edit' ? await this.services.api.goals.edit(payload)
      : operation === 'pause' ? await this.services.api.goals.pause(payload)
      : operation === 'resume' ? await this.services.api.goals.resume(payload)
      : operation === 'complete' ? await this.services.api.goals.complete(payload)
      : await this.services.api.goals.clear(payload)
    errorMessage(response.result, `${operation[0].toUpperCase()}${operation.slice(1)} goal`)
  }

  private requirePending<K extends 'approval' | 'question'>(sessionId: string, interactionKey: string, kind: K): Extract<ReturnType<SessionFace['getSnapshot']>['pending'][number], { kind: K }> {
    const wait = this.requireSession(sessionId).getSnapshot().pending.find((candidate) => candidate.key === interactionKey)
    if (wait === undefined) throw new Error(`Unknown pending interaction ${interactionKey}`)
    if (wait.kind !== kind) throw new Error(`Pending interaction ${interactionKey} is ${wait.kind}, not ${kind}`)
    return wait as Extract<ReturnType<SessionFace['getSnapshot']>['pending'][number], { kind: K }>
  }

  private requireSession(sessionId: string): SessionFace {
    const binding = this.services.sessions.binding(sessionId as Parameters<ISessions['binding']>[0])
    if (binding === undefined) throw new Error(`Unknown Harness session ${sessionId}`)
    return binding.session
  }
}

export function createRc6AgentClient(services: Rc6AgentClientServices): Rc6AgentClient {
  return new Rc6AgentClient(services)
}
