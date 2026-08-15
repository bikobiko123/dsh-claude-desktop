import type {
  AssistantBlock,
  ConversationNode,
  ConversationSnapshot,
  SessionFace,
  SessionListState,
  WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AgentClientSnapshot,
  ConversationImage,
  ConversationMessage,
  ConversationView,
  ImageAttachmentLimitsView,
  ImageMediaType,
  PresentationalInteraction,
  SessionSummary,
  WorkspaceSummary,
} from '../agent-client.js'

function iso(time: number): string {
  return new Date(time).toISOString()
}

function contentText(content: readonly unknown[]): string {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null) return []
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
}

function attachmentImage(value: unknown): ConversationImage | undefined {
  if (typeof value !== 'object' || value === null) return
  const candidate = value as Record<string, unknown>
  const mediaTypes: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  if (typeof candidate.attachmentId !== 'string' || !mediaTypes.includes(candidate.mediaType as ImageMediaType)) return
  if (![candidate.bytes, candidate.width, candidate.height].every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item > 0)) return
  return Object.freeze({
    attachmentId: candidate.attachmentId,
    mediaType: candidate.mediaType as ImageMediaType,
    bytes: candidate.bytes as number,
    width: candidate.width as number,
    height: candidate.height as number,
    ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
  })
}

function contentImages(content: readonly unknown[]): readonly ConversationImage[] {
  return Object.freeze(content.flatMap((block) => {
    if (typeof block !== 'object' || block === null || (block as { type?: unknown }).type !== 'image') return []
    const image = attachmentImage((block as { attachment?: unknown }).attachment)
    return image ? [image] : []
  }))
}

function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap((block) => {
    if (block.kind === 'text') return [block.text]
    if (block.kind === 'tool-call') return [`Tool call: ${block.name}${block.argsRaw ? `\n${block.argsRaw}` : ''}`]
    return []
  }).join('\n')
}

function assistantImages(blocks: readonly AssistantBlock[]): readonly ConversationImage[] {
  return Object.freeze(blocks.flatMap((block) => {
    if (block.kind !== 'image') return []
    const image = attachmentImage(block.attachment)
    return image ? [image] : []
  }))
}

function toolResultText(node: Extract<ConversationNode, { kind: 'tool-result' }>): string {
  const name = node.call?.name ?? node.callId
  const body = contentText(node.content)
  const status = node.isError ? 'failed' : 'completed'
  return [`Tool ${name} ${status}`, body].filter(Boolean).join('\n')
}

export function mapConversationNode(node: ConversationNode): ConversationMessage | null {
  switch (node.kind) {
    case 'user':
    case 'steering': {
      const content = contentText(node.content)
      const images = contentImages(node.content)
      if (!content && images.length === 0) return null
      return Object.freeze({ id: `${node.kind}:${node.seq}`, role: 'user', content, images, createdAt: iso(node.time) })
    }
    case 'assistant': {
      const content = assistantText(node.blocks)
      const images = assistantImages(node.blocks)
      if (!content && images.length === 0) return null
      return Object.freeze({ id: `assistant:${node.seq}`, role: 'assistant', content, images, createdAt: iso(node.time) })
    }
    case 'tool-result':
      return Object.freeze({ id: `tool-result:${node.seq}`, role: 'system', content: toolResultText(node), images: Object.freeze([]), createdAt: iso(node.time) })
    default:
      return null
  }
}

function runningToolMessages(snapshot: ConversationSnapshot): ConversationMessage[] {
  return snapshot.runningCalls.map((call) => Object.freeze({
    id: `tool-running:${call.callId}`,
    role: 'system' as const,
    content: `Tool ${call.name} running${call.argsRaw ? `\n${call.argsRaw}` : ''}`,
    images: Object.freeze([]),
    createdAt: iso(call.time),
  }))
}

function partialMessage(snapshot: ConversationSnapshot): ConversationMessage | null {
  if (snapshot.partial === null) return null
  const content = assistantText(snapshot.partial.blocks)
  const images = assistantImages(snapshot.partial.blocks)
  if (!content && images.length === 0) return null
  return Object.freeze({
    id: `assistant-partial:${snapshot.partial.turn}:${snapshot.partial.step}`,
    role: 'assistant',
    content,
    images,
    createdAt: new Date(0).toISOString(),
  })
}

function mapPendingInteraction(wait: ConversationSnapshot['pending'][number]): PresentationalInteraction {
  if (wait.kind === 'approval') {
    return Object.freeze({
      kind: 'approval', key: wait.key, sessionId: String(wait.sessionId), toolName: wait.payload.toolName,
      ...(wait.payload.callId === undefined ? {} : { callId: String(wait.payload.callId) }),
      ...(wait.payload.reason === undefined ? {} : { reason: wait.payload.reason }),
    })
  }
  return Object.freeze({
    kind: 'question', key: wait.key, sessionId: String(wait.sessionId),
    questions: Object.freeze(wait.payload.questions.map((question) => Object.freeze({
      id: question.id, question: question.question,
      ...(question.detail === undefined ? {} : { detail: question.detail }),
      ...(question.header === undefined ? {} : { header: question.header }),
      options: Object.freeze((question.options ?? []).map((option) => Object.freeze({ ...option }))),
      multiSelect: question.multiSelect ?? false,
      ...(question.intent === undefined ? {} : { intent: Object.freeze({ ...question.intent }) }),
    }))),
  })
}

export function mapConversationSnapshot(snapshot: ConversationSnapshot, title: string): ConversationView {
  const messages = snapshot.nodes.flatMap((node) => {
    const mapped = mapConversationNode(node)
    return mapped === null ? [] : [mapped]
  })
  messages.push(...runningToolMessages(snapshot))
  const partial = partialMessage(snapshot)
  if (partial !== null) messages.push(partial)
  return Object.freeze({ sessionId: String(snapshot.sessionId), title, messages: Object.freeze(messages), interactions: Object.freeze(snapshot.pending.map(mapPendingInteraction)), running: snapshot.running })
}

export function mapWorkspaceList(state: WorkspaceListState): readonly WorkspaceSummary[] {
  return Object.freeze(state.items.map((workspace) => Object.freeze({ id: String(workspace.workspaceId), name: workspace.title, path: workspace.path })))
}

export function workspaceIdBySession(state: WorkspaceListState): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const workspace of state.items) for (const sessionId of workspace.sessionIds) result.set(String(sessionId), String(workspace.workspaceId))
  return result
}

export function mapSessionList(state: SessionListState, workspaces: WorkspaceListState): readonly SessionSummary[] {
  const workspaceIds = workspaceIdBySession(workspaces)
  const archived = new Set(workspaces.archivedSessionIds.map(String))
  return Object.freeze(state.ids.flatMap((id) => {
    if (archived.has(String(id))) return []
    const session = state.byId[id]
    if (session === undefined) return []
    return [Object.freeze({ id: String(session.id), title: session.displayTitle, updatedAt: iso(session.updatedAt), running: session.running, ...(workspaceIds.get(String(session.id)) ? { workspaceId: workspaceIds.get(String(session.id)) } : {}) })]
  }))
}

export function selectedWorkspaceId(state: SessionListState, workspaces: WorkspaceListState): string | undefined {
  if (state.current === undefined) return workspaces.recentWorkspaceId === undefined ? undefined : String(workspaces.recentWorkspaceId)
  return workspaceIdBySession(workspaces).get(String(state.current))
}

export function titleForSession(state: SessionListState, sessionId: string): string {
  const row = state.byId[sessionId as keyof typeof state.byId]
  return row?.displayTitle ?? sessionId
}

function imageLimits(session: SessionFace | undefined): ImageAttachmentLimitsView | undefined {
  const value = session?.projections.faceOf('imageLimits').getSnapshot()
  if (typeof value !== 'object' || value === null) return
  const limits = value as Record<string, unknown>
  const mediaTypes = Array.isArray(limits.mediaTypes) ? limits.mediaTypes.filter((type): type is ImageMediaType => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(type))) : []
  if (![limits.maxImageBytes, limits.maxImagesPerMessage, limits.maxMessageImageBytes, limits.maxImagePixels].every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item > 0)) return
  return Object.freeze({ maxImageBytes: limits.maxImageBytes as number, maxImagesPerMessage: limits.maxImagesPerMessage as number, maxMessageImageBytes: limits.maxMessageImageBytes as number, maxImagePixels: limits.maxImagePixels as number, mediaTypes: Object.freeze(mediaTypes) })
}

export function mapAgentSnapshot(sessions: SessionListState, workspaces: WorkspaceListState, session: SessionFace | undefined): AgentClientSnapshot {
  return Object.freeze({
    availability: sessions.phase === 'pending' || workspaces.phase === 'pending' ? 'loading' : 'ready', connectionStatus: 'connected',
    workspaces: mapWorkspaceList(workspaces), sessions: mapSessionList(sessions, workspaces), selectedWorkspaceId: selectedWorkspaceId(sessions, workspaces),
    selectedSessionId: sessions.current === undefined ? undefined : String(sessions.current),
    conversation: session === undefined ? null : mapConversationSnapshot(session.getSnapshot(), titleForSession(sessions, String(session.sessionId))),
    ...(imageLimits(session) === undefined ? {} : { imageLimits: imageLimits(session) }),
    models: Object.freeze({ state: 'idle', routable: false, options: Object.freeze([]), failures: Object.freeze([]) }),
  })
}
