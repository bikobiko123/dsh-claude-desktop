import { useEffect, useState, type ReactElement } from 'react'
import type { AgentClient, ConversationImage, ConversationMessage } from '../shared/agent-client'
import { loadConversationImage } from './conversation-image'

export interface MessageImageProps {
  agentClient?: AgentClient
  image: ConversationImage
  messageId: string
  sessionId: string
}

export function MessageImageState({ image, source, state }: { image: ConversationImage; source?: string; state: 'loading' | 'ready' | 'error' }): ReactElement {
  if (state === 'error') {
    return <span className="message-image-error" data-image-state="error" role="status">Image unavailable: {image.name ?? 'attachment'}</span>
  }
  if (state === 'loading' || !source) {
    return <span aria-label={`Loading image ${image.name ?? 'attachment'}`} className="message-image-loading" data-image-state="loading" />
  }
  return <img alt={image.name ?? 'Conversation attachment'} className="message-image" data-image-state="ready" height={image.height} src={source} width={image.width} />
}

export function MessageImage({ agentClient, image, messageId, sessionId }: MessageImageProps): ReactElement {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [source, setSource] = useState<string>()

  useEffect(() => {
    setState('loading')
    setSource(undefined)

    if (!agentClient?.readImage) {
      setState('error')
      return
    }

    const load = loadConversationImage({
      agentClient,
      image,
      identity: { sessionId, messageId, attachmentId: image.attachmentId },
      onReady: (nextSource) => {
        setSource(nextSource)
        setState('ready')
      },
      onError: () => setState('error'),
    })
    return () => load.dispose()
  }, [agentClient, image.attachmentId, messageId, sessionId])

  return <MessageImageState image={image} source={source} state={state} />
}

export interface ConversationMessageViewProps {
  agentClient?: AgentClient
  message: ConversationMessage
  sessionId: string
}

export function ConversationMessageView({ agentClient, message, sessionId }: ConversationMessageViewProps): ReactElement {
  return (
    <article className={`message-row message-${message.role}`} data-message-id={message.id}>
      <div className="message-author">{message.role === 'assistant' ? 'DSH' : message.role === 'user' ? 'You' : 'System'}</div>
      <div className="message-body">
        {message.content ? <div className="message-content">{message.content}</div> : null}
        {message.images?.length ? (
          <div className="message-images">
            {message.images.map((image) => (
              <MessageImage agentClient={agentClient} image={image} key={`${message.id}:${image.attachmentId}`} messageId={message.id} sessionId={sessionId} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}
