import type { AgentClient, ConversationImage } from '../shared/agent-client'

export interface ImageUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export interface ConversationImageIdentity {
  sessionId: string
  messageId: string
  attachmentId: string
}

export interface ConversationImageLoad {
  identity: ConversationImageIdentity
  dispose(): void
}

export function loadConversationImage(options: {
  agentClient: AgentClient
  image: ConversationImage
  identity: ConversationImageIdentity
  onReady(source: string): void
  onError(): void
  urlApi?: ImageUrlApi
}): ConversationImageLoad {
  const urlApi = options.urlApi ?? URL
  let active = true
  let objectUrl: string | undefined

  void options.agentClient.readImage!(options.identity.sessionId, options.identity.attachmentId).then((resolved) => {
    if (!active) return
    try {
      const bytes = Uint8Array.from(resolved.data)
      objectUrl = urlApi.createObjectURL(new Blob([bytes.buffer], { type: resolved.mediaType }))
      if (!active) {
        urlApi.revokeObjectURL(objectUrl)
        objectUrl = undefined
        return
      }
      options.onReady(objectUrl)
    } catch {
      if (active) options.onError()
    }
  }).catch(() => {
    if (active) options.onError()
  })

  return {
    identity: options.identity,
    dispose() {
      active = false
      if (objectUrl) {
        urlApi.revokeObjectURL(objectUrl)
        objectUrl = undefined
      }
    },
  }
}
