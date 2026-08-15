import WebSocket from 'ws'
import type { DshWebSocketFactory, DshWebSocketLike } from '../shared/dsh-sidecar-contract.js'

/** Node/Electron-main adapter for the fallback sidecar transport. */
export const nodeWebSocketFactory: DshWebSocketFactory = (url) =>
  new WebSocket(url) as unknown as DshWebSocketLike
