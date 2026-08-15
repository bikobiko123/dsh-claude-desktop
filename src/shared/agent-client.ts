export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type AgentAvailability = 'unavailable' | 'loading' | 'ready' | 'error'
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageAttachmentLimitsView {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}

export interface DraftImageAttachment {
  name: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  base64: string
}

export interface SendMessageInput {
  text: string
  images: readonly DraftImageAttachment[]
}

export interface ConversationImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

export interface ResolvedConversationImage {
  mediaType: ImageMediaType
  data: Uint8Array
}

/** Minimal React-independent observable contract implemented by DSH snapshot faces. */
export interface ObservableModel<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface WorkspaceSummary {
  id: string
  name: string
  path: string
}

export interface WorkspaceDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface WorkspaceDirectoryListing {
  path: string
  home: string
  crumbs: readonly WorkspaceDirectoryEntry[]
  entries: readonly WorkspaceDirectoryEntry[]
  truncated: boolean
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: string
  running: boolean
  workspaceId?: string
}

export interface SessionSearchResult {
  sessionId: string
  title: string
  snippet: string
  updatedAt?: string
  workspaceId?: string
}

export interface ModelReasoningEffortView {
  id: string
  name: string
  description?: string
}

export interface ModelOptionView {
  provider: string
  providerName: string
  id: string
  name: string
  description?: string
  reasoningEfforts: readonly ModelReasoningEffortView[]
  defaultReasoningEffort?: string
}

export interface ModelSelectionView {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelCatalogView {
  state: 'idle' | 'loading' | 'ready' | 'error'
  current?: ModelSelectionView
  routable: boolean
  options: readonly ModelOptionView[]
  failures: readonly { provider: string; name: string; message: string }[]
  error?: string
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  images: readonly ConversationImage[]
  createdAt: string
}

export interface ApprovalInteraction {
  kind: 'approval'
  key: string
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options: readonly QuestionOption[]
  multiSelect: boolean
  intent?: {
    kind: 'plan-review'
    approve: string
  }
}

export interface QuestionInteraction {
  kind: 'question'
  key: string
  sessionId: string
  questions: readonly QuestionItem[]
}

export type PresentationalInteraction = ApprovalInteraction | QuestionInteraction

export interface QuestionAnswerItem {
  id: string
  selected: readonly string[]
  custom?: string
}

export type ApprovalDecision = 'allowed-once' | 'rejected'

export interface RuntimeSettingsView {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath: boolean
}

export interface ProviderStatusView {
  id: string
  name: string
  active: boolean
  declared?: boolean
  settingsNamespace: string
  modelCount: number
  credentialRefs: readonly string[]
}

/** Value-free credential descriptor. Secret material never enters a renderer snapshot. */
export interface CredentialStatusView {
  ref: string
  configured: boolean
  source?: string
  writable: boolean
}

export interface PermissionPresetView {
  id: string
  label: string
}

export interface SettingsSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'error'
  runtime: RuntimeSettingsView | null
  providers: readonly ProviderStatusView[]
  credentials: readonly CredentialStatusView[]
  permission: {
    available: boolean
    writable: boolean
    current: string
    options: readonly PermissionPresetView[]
    applies?: 'live' | 'restart'
  }
  modelFailureCount?: number
  error?: string
}

export interface SettingsClient {
  readonly model: ObservableModel<SettingsSnapshot>
  refresh(): Promise<void>
  selectPermissionPreset(preset: string): Promise<void>
  setCredential(ref: string, value: string): Promise<void>
  removeCredential(ref: string): Promise<void>
}

/**
 * Already-projected conversation data supplied by the official Harness runtime
 * adapter. The renderer only presents this model; it never folds SessionEvents.
 */
export interface ConversationView {
  sessionId: string
  title: string
  messages: readonly ConversationMessage[]
  interactions: readonly PresentationalInteraction[]
  running: boolean
}

export interface SkillView {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

export interface SubagentView {
  id: string
  mode: 'one-shot' | 'continuable'
  activity: 'running' | 'inactive'
  label?: string
  hasChildren?: boolean
  diagnostic?: string
}

export interface GoalView {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  maxGoalRounds: number
  roundsStarted: number
  blockedReason?: { code: string; message: string }
  createdAt: number
  updatedAt: number
}

export interface JobView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

export interface ActivityView {
  skills: readonly SkillView[]
  skillsState: 'idle' | 'loading' | 'ready' | 'error'
  skillsError?: string
  subagents: readonly SubagentView[]
  goal?: GoalView | null
  jobs: readonly JobView[]
}

export interface AgentClientSnapshot {
  availability: AgentAvailability
  connectionStatus: ConnectionStatus
  workspaces: readonly WorkspaceSummary[]
  sessions: readonly SessionSummary[]
  selectedWorkspaceId?: string
  selectedSessionId?: string
  conversation: ConversationView | null
  activity?: ActivityView
  imageLimits?: ImageAttachmentLimitsView
  models?: ModelCatalogView
  message?: string
}

/** Stable empty snapshot used before a HarnessRuntimeAdapter is available. */
export const UNAVAILABLE_AGENT_SNAPSHOT: AgentClientSnapshot = Object.freeze({
  availability: 'unavailable',
  connectionStatus: 'disconnected',
  workspaces: Object.freeze([]),
  sessions: Object.freeze([]),
  conversation: null,
  models: Object.freeze({ state: 'idle', routable: false, options: Object.freeze([]), failures: Object.freeze([]) }),
  message: 'Harness runtime is not available yet.',
})

/**
 * Stable view-facing facade over services obtained from the official settled
 * Cordis client graph. Implementations must delegate connection, session
 * projection, tools, approvals, questions, and cancellation to DSH services;
 * this interface is not permission to recreate those state machines.
 */
export interface AgentClient {
  /** Atomic renderer model. Implementations should publish immutable snapshots. */
  readonly model: ObservableModel<AgentClientSnapshot>
  readonly settings?: SettingsClient
  refresh(): Promise<void>
  selectWorkspace(workspaceId: string): Promise<void> | void
  selectSession(sessionId: string): Promise<void> | void
  createSession(workspaceId: string): Promise<SessionSummary>
  /** Start the official New Chat flow; null explicitly opens the no-workspace view. */
  startSession?(workspaceId?: string | null): Promise<void> | void
  createWorkspace?(path: string): Promise<WorkspaceSummary>
  renameWorkspace?(workspaceId: string, title: string): Promise<void>
  deleteWorkspace?(workspaceId: string): Promise<void>
  renameSession?(sessionId: string, title: string): Promise<void>
  archiveSession?(sessionId: string): Promise<void>
  searchSessions?(query: string, signal: AbortSignal): Promise<readonly SessionSearchResult[]>
  listDirectory?(path?: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing>
  openPath?(path: string): Promise<void>
  sendMessage(sessionId: string, input: SendMessageInput): Promise<void>
  readImage?(sessionId: string, attachmentId: string): Promise<ResolvedConversationImage>
  cancel(sessionId: string): Promise<void>
  selectModel?(sessionId: string, selection: ModelSelectionView): Promise<void>
  invokeSkill?(sessionId: string, name: string, argument?: string): Promise<void>
  openSubagent?(parentSessionId: string, childSessionId: string, mode: 'one-shot' | 'continuable'): Promise<void> | void
  promptSubagent?(parentSessionId: string, childSessionId: string, text: string, signal?: AbortSignal): Promise<void>
  interruptSubagent?(parentSessionId: string, childSessionId: string): Promise<void>
  createGoal?(sessionId: string, objective: string, maxGoalRounds?: number): Promise<void>
  editGoal?(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>, changes: { objective?: string; maxGoalRounds?: number }): Promise<void>
  pauseGoal?(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void>
  resumeGoal?(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void>
  completeGoal?(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void>
  clearGoal?(sessionId: string, goal: Pick<GoalView, 'id' | 'revision'>): Promise<void>
  answerApproval(sessionId: string, interactionKey: string, decision: ApprovalDecision): Promise<void>
  answerQuestions(sessionId: string, interactionKey: string, answers: readonly QuestionAnswerItem[]): Promise<void>
}
