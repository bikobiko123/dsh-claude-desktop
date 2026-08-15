/**
 * Low-level main-process transport contract retained for diagnostics and native
 * host mediation only. It is not the primary renderer architecture: normal
 * client state must come from the official boot manifest + ClientModuleSystem
 * + Cordis Loader runtime and its existing projection services.
 */
import type {
  ClientResponse,
  HostFrame,
  MuxFrame,
  RequestPayload,
  ResponseValue,
  RpcMethodMap,
  RpcMessage,
  RpcReceipt,
  RpcRequest,
  RpcResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'

export const DSH_API_PREFIX = '/api' as const
export const DSH_MUX_EVENTS_PATH = '/api/events.mux' as const
export const DSH_HOST_EVENTS_PATH = '/api/events.host' as const

export type DshUnaryMethod = keyof RpcMethodMap
export type DshUnaryPayload<K extends DshUnaryMethod> = RequestPayload<K>
export type DshUnaryResponse<K extends DshUnaryMethod> = RpcResponse<ResponseValue<K>>
export type DshMuxEnvelope = RpcRequest<MuxFrame>
export type DshHostEnvelope = RpcRequest<HostFrame>
export type DshStreamKind = 'mux' | 'host'

export interface DshSidecarTransportOptions {
  /** Explicit loopback DSH web origin, for example http://127.0.0.1:3080. */
  baseUrl: string | URL
  /** Bounded unary deadline. User-paced calls can pass timeoutMs: false per call. */
  timeoutMs?: number
  /** Dependency injection seam used by tests and Electron main. */
  fetch?: typeof globalThis.fetch
  /** Dependency injection seam. Defaults to ws in Node/Electron main. */
  webSocketFactory?: DshWebSocketFactory
  /** Observe validated full-form RPC messages for diagnostics. */
  onEnvelope?: (message: RpcMessage) => void
  /** Malformed frames are dropped by default, matching the official browser carrier. */
  onMalformedFrame?: (error: unknown, raw: unknown, stream: DshStreamKind) => void
}

export interface DshUnaryCallOptions {
  signal?: AbortSignal
  /** false disables the transport deadline; useful for native user-paced methods. */
  timeoutMs?: number | false
}

export interface DshStreamOptions {
  signal?: AbortSignal
  onOpen?: () => void
}

export interface DshWebSocketLike {
  readonly readyState: number
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  removeEventListener(type: 'open', listener: () => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void
  removeEventListener(type: 'error', listener: (event: unknown) => void): void
  close(code?: number, reason?: string): void
}

export type DshWebSocketFactory = (url: URL) => DshWebSocketLike

export interface DshSidecarTransport {
  readonly baseUrl: URL
  call<K extends DshUnaryMethod>(
    method: K,
    payload: DshUnaryPayload<K>,
    options?: DshUnaryCallOptions,
  ): Promise<DshUnaryResponse<K>>
  respond(message: ClientResponse, options?: DshUnaryCallOptions): Promise<RpcReceipt>
  mux(options?: DshStreamOptions): AsyncIterable<DshMuxEnvelope>
  host(options?: DshStreamOptions): AsyncIterable<DshHostEnvelope>
}
