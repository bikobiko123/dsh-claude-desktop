import {
  RpcId,
  clientRequestSchema,
  serverRequestSchema,
  serverResponseSchema,
  type ClientRequest,
  type ClientResponse,
  type HostFrame,
  type MuxFrame,
  type RpcMessage,
  type RpcRequest,
  type RpcResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { clientResponseSchema, rpcReceiptSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { agentPresetCopyValueSchema, agentPresetListValueSchema, agentPresetOpenDocumentValueSchema, agentPresetReadValueSchema, agentPresetRemoveValueSchema, agentPresetSelectValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets.schema'
import { credentialsDescribeValueSchema, credentialsSetValueSchema, credentialsUnsetValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/credentials.schema'
import { goalClearValueSchema, goalCompleteValueSchema, goalCreateValueSchema, goalEditValueSchema, goalPauseValueSchema, goalResumeValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/goals.schema'
import { hostCreateDirectoryValueSchema, hostDescribeValueSchema, hostListDirectoryValueSchema, hostOpenPathValueSchema, hostPickDirectoryValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/host.schema'
import { llmDiscoverModelsValueSchema, llmModelsValueSchema, llmProvidersValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/llm.schema'
import { sessionAttachmentValueSchema, sessionCancelValueSchema, sessionCreateValueSchema, sessionForkValueSchema, sessionHistoryValueSchema, sessionListValueSchema, sessionModelsValueSchema, sessionPromptValueSchema, sessionRenameValueSchema, sessionSearchValueSchema, sessionSelectModelValueSchema, sessionUpdateQueueValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'
import { settingsDescribeValueSchema, settingsMutateValueSchema, settingsOpenDocumentValueSchema, settingsReplaceValueSchema, settingsUpdateValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/settings.schema'
import { skillListValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/skills.schema'
import { subagentHistoryValueSchema, subagentInterruptValueSchema, subagentListValueSchema, subagentPromptValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/subagents.schema'
import { workspaceArchiveSessionValueSchema, workspaceCreateValueSchema, workspaceDeleteValueSchema, workspaceInsertBeforeValueSchema, workspaceInsertSessionBeforeValueSchema, workspaceListValueSchema, workspaceRenameValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/workspace.schema'
import type { z } from 'zod'
import {
  DSH_HOST_EVENTS_PATH,
  DSH_MUX_EVENTS_PATH,
  type DshHostEnvelope,
  type DshMuxEnvelope,
  type DshSidecarTransport,
  type DshSidecarTransportOptions,
  type DshStreamKind,
  type DshStreamOptions,
  type DshUnaryCallOptions,
  type DshUnaryMethod,
  type DshUnaryPayload,
  type DshUnaryResponse,
  type DshWebSocketFactory,
  type DshWebSocketLike,
} from './dsh-sidecar-contract.js'

const DEFAULT_TIMEOUT_MS = 30_000

const unaryValueSchemas = {
  'session.list': sessionListValueSchema,
  'session.search': sessionSearchValueSchema,
  'session.create': sessionCreateValueSchema,
  'session.history': sessionHistoryValueSchema,
  'session.models': sessionModelsValueSchema,
  'session.selectModel': sessionSelectModelValueSchema,
  'session.rename': sessionRenameValueSchema,
  'session.fork': sessionForkValueSchema,
  'session.prompt': sessionPromptValueSchema,
  'session.attachment': sessionAttachmentValueSchema,
  'session.updateQueue': sessionUpdateQueueValueSchema,
  'session.cancel': sessionCancelValueSchema,
  'subagent.list': subagentListValueSchema,
  'subagent.history': subagentHistoryValueSchema,
  'subagent.prompt': subagentPromptValueSchema,
  'subagent.interrupt': subagentInterruptValueSchema,
  'host.describe': hostDescribeValueSchema,
  'host.pickDirectory': hostPickDirectoryValueSchema,
  'host.listDirectory': hostListDirectoryValueSchema,
  'host.createDirectory': hostCreateDirectoryValueSchema,
  'host.openPath': hostOpenPathValueSchema,
  'workspace.list': workspaceListValueSchema,
  'workspace.create': workspaceCreateValueSchema,
  'workspace.rename': workspaceRenameValueSchema,
  'workspace.delete': workspaceDeleteValueSchema,
  'workspace.insertBefore': workspaceInsertBeforeValueSchema,
  'workspace.insertSessionBefore': workspaceInsertSessionBeforeValueSchema,
  'workspace.archiveSession': workspaceArchiveSessionValueSchema,
  'skill.list': skillListValueSchema,
  'agentPreset.list': agentPresetListValueSchema,
  'agentPreset.select': agentPresetSelectValueSchema,
  'agentPreset.read': agentPresetReadValueSchema,
  'agentPreset.copy': agentPresetCopyValueSchema,
  'agentPreset.openDocument': agentPresetOpenDocumentValueSchema,
  'agentPreset.remove': agentPresetRemoveValueSchema,
  'goal.create': goalCreateValueSchema,
  'goal.edit': goalEditValueSchema,
  'goal.pause': goalPauseValueSchema,
  'goal.resume': goalResumeValueSchema,
  'goal.complete': goalCompleteValueSchema,
  'goal.clear': goalClearValueSchema,
  'settings.describe': settingsDescribeValueSchema,
  'settings.openDocument': settingsOpenDocumentValueSchema,
  'settings.update': settingsUpdateValueSchema,
  'settings.replace': settingsReplaceValueSchema,
  'settings.mutate': settingsMutateValueSchema,
  'credentials.describe': credentialsDescribeValueSchema,
  'credentials.set': credentialsSetValueSchema,
  'credentials.unset': credentialsUnsetValueSchema,
  'llm.providers': llmProvidersValueSchema,
  'llm.models': llmModelsValueSchema,
  'llm.discoverModels': llmDiscoverModelsValueSchema,
} satisfies Record<DshUnaryMethod, z.ZodType>

function normalizeBaseUrl(value: string | URL): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`DSH baseUrl must use http or https, received ${url.protocol}`)
  }
  if (url.username || url.password) throw new TypeError('DSH baseUrl must not contain credentials')
  url.pathname = url.pathname.replace(/\/?$/, '/')
  url.search = ''
  url.hash = ''
  return url
}

function websocketUrl(baseUrl: URL, path: string): URL {
  const url = new URL(path, baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

function defaultWebSocketFactory(url: URL): DshWebSocketLike {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('No global WebSocket implementation; inject webSocketFactory in Electron main/Node')
  }
  return new globalThis.WebSocket(url) as unknown as DshWebSocketLike
}

function mergeSignal(signal: AbortSignal | undefined, timeoutMs: number | false): AbortSignal | undefined {
  if (timeoutMs === false) return signal
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

async function decodeMessageData(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return new TextDecoder().decode(bytes)
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text()
  throw new TypeError(`Unsupported WebSocket message payload: ${Object.prototype.toString.call(data)}`)
}

class AsyncFrameQueue<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void }> = []
  private ended = false
  private failure: unknown

  push(value: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve({ value, done: false })
    else this.values.push(value)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
  }

  fail(error: unknown): void {
    if (this.ended) return
    this.ended = true
    this.failure = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ value, done: false })
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.ended) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }
}

export class LoopbackDshSidecarTransport implements DshSidecarTransport {
  readonly baseUrl: URL
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly webSocketFactory: DshWebSocketFactory
  private readonly onEnvelope?: (message: RpcMessage) => void
  private readonly onMalformedFrame?: DshSidecarTransportOptions['onMalformedFrame']

  constructor(options: DshSidecarTransportOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof this.fetchImpl !== 'function') throw new Error('No fetch implementation available')
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
    this.onEnvelope = options.onEnvelope
    this.onMalformedFrame = options.onMalformedFrame
  }

  async call<K extends DshUnaryMethod>(method: K, payload: DshUnaryPayload<K>, options: DshUnaryCallOptions = {}): Promise<DshUnaryResponse<K>> {
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId(crypto.randomUUID()),
      method,
      payload,
    }
    const validatedRequest = clientRequestSchema.parse(request)
    this.onEnvelope?.(validatedRequest)
    const raw = await this.postJson(`/api/${method}`, validatedRequest, options)
    const response = serverResponseSchema.parse(raw)
    this.onEnvelope?.(response)
    if (response.rpcId !== request.rpcId) {
      throw new Error(`rpcId mismatch for ${method}: sent ${request.rpcId}, got ${response.rpcId}`)
    }
    if (!response.result.ok) return { rpcId: response.rpcId, result: response.result } as DshUnaryResponse<K>
    const value = unaryValueSchemas[method].parse(response.result.value)
    return { rpcId: response.rpcId, result: { ok: true, value } } as DshUnaryResponse<K>
  }

  async respond(message: ClientResponse, options: DshUnaryCallOptions = {}) {
    const validatedMessage = clientResponseSchema.parse(message)
    this.onEnvelope?.(validatedMessage)
    const raw = await this.postJson('/api/respond', validatedMessage, options)
    return rpcReceiptSchema.parse(raw)
  }

  mux(options: DshStreamOptions = {}): AsyncIterable<DshMuxEnvelope> {
    return this.openStream('mux', DSH_MUX_EVENTS_PATH, muxFrameSchema, options)
  }

  host(options: DshStreamOptions = {}): AsyncIterable<DshHostEnvelope> {
    return this.openStream('host', DSH_HOST_EVENTS_PATH, hostFrameSchema, options)
  }

  private async postJson(path: string, body: unknown, options: DshUnaryCallOptions): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: mergeSignal(options.signal, timeoutMs),
    })
    if (!response.ok) throw new Error(`transport failure for ${path}: HTTP ${response.status}`)
    return response.json()
  }

  private async *openStream<F extends MuxFrame | HostFrame>(
    kind: DshStreamKind,
    path: string,
    frameSchema: z.ZodType<F>,
    options: DshStreamOptions,
  ): AsyncIterable<RpcRequest<F>> {
    const socket = this.webSocketFactory(websocketUrl(this.baseUrl, path))
    const queue = new AsyncFrameQueue<RpcRequest<F>>()
    let opened = false

    const onOpen = () => {
      opened = true
      options.onOpen?.()
    }
    const onMessage = (event: { data: unknown }) => {
      void decodeMessageData(event.data).then((text) => {
        const raw: unknown = JSON.parse(text)
        const envelope = serverRequestSchema.parse(raw)
        const payload = frameSchema.parse(envelope.payload)
        this.onEnvelope?.(envelope)
        queue.push({ rpcId: envelope.rpcId, payload })
      }).catch((error) => this.onMalformedFrame?.(error, event.data, kind))
    }
    const onClose = () => queue.end()
    const onError = (event: unknown) => queue.fail(event instanceof Error ? event : new Error(`${kind} WebSocket transport error`))
    const onAbort = () => {
      socket.close(1000, 'aborted')
      queue.end()
    }

    socket.addEventListener('open', onOpen)
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose)
    socket.addEventListener('error', onError)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()

    try {
      while (true) {
        const next = await queue.next()
        if (next.done) return
        yield next.value
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      socket.removeEventListener('error', onError)
      if (opened || socket.readyState < 2) socket.close(1000, 'iterator closed')
    }
  }
}

export function createLoopbackDshSidecarTransport(options: DshSidecarTransportOptions): DshSidecarTransport {
  return new LoopbackDshSidecarTransport(options)
}
