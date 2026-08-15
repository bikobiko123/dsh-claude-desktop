// Adapted from @deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6.
// Presentation-neutral Chat projection contracts only; no renderer or DOM code.
import type {
  AssistantBlock,
  AssistantMessageNode,
  ChatConversationViewNode,
  CommandNode,
  CompactionSummaryNode,
  ContextMessageNode,
  ModelRetryNode,
  RunningToolCall,
  SteeringMessageNode,
  ToolCallBlock,
  TurnErrorNode,
  TurnMaxTokensNode,
  UnknownSurfaceNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'

export interface AssistantChatData {
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly turn: number
  readonly step: number
  readonly blocks: readonly AssistantBlock[]
  readonly time: number
  readonly usage?: unknown
  readonly finalNode?: AssistantMessageNode
}

export type FinalAssistantChatData = AssistantChatData & { readonly finalNode: AssistantMessageNode }
export interface ToolChatData { readonly root: ToolCallBlock }
export interface ManualCompactionChatData { readonly command: CommandNode; readonly compaction: CompactionSummaryNode | null }
export interface RetryChatData { readonly attempts: readonly ModelRetryNode[]; readonly current: ModelRetryNode }
export interface TurnTailChatData {
  readonly turn: number
  readonly seq: number
  readonly time: number
  readonly closing: FinalAssistantChatData | null
  readonly branchUnavailable: boolean
  readonly ttftMs?: number
  readonly tokensPerSecond?: number
}

export interface ChatNodeDataMap {
  user: UserMessageNode
  steering: SteeringMessageNode
  context: ContextMessageNode
  'assistant-step': AssistantChatData
  'tool-call': ToolChatData
  command: CommandNode
  compaction: CompactionSummaryNode
  'manual-compaction': ManualCompactionChatData
  'model-retry': RetryChatData
  'turn-error': TurnErrorNode
  'turn-max-tokens': TurnMaxTokensNode
  'turn-tail': TurnTailChatData
  unknown: UnknownSurfaceNode
}

export type ChatNodeKind = Extract<keyof ChatNodeDataMap, string>
export type ChatNode<Kind extends ChatNodeKind = ChatNodeKind> = {
  [RegisteredKind in Kind]: ChatConversationViewNode & {
    readonly kind: RegisteredKind
    readonly data: ChatNodeDataMap[RegisteredKind]
  }
}[Kind]

export function isSettledTool(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

export function isRunningTool(block: ToolCallBlock): block is RunningToolCall {
  return !isSettledTool(block)
}
