import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentClient, ConversationImage, ConversationMessage } from '../shared/agent-client'
import { ConversationMessageView, MessageImageState } from './ConversationMessageView'
import { loadConversationImage } from './conversation-image'

const image: ConversationImage = {
  attachmentId: 'attachment-1',
  mediaType: 'image/png',
  bytes: 4,
  width: 20,
  height: 10,
  name: 'screen.png',
}

function message(content: string, images: readonly ConversationImage[]): ConversationMessage {
  return { id: 'message-1', role: 'user', content, images, createdAt: '2026-01-01T00:00:00.000Z' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('conversation message images', () => {
  it('renders image-only messages without requiring text content', () => {
    const html = renderToStaticMarkup(<ConversationMessageView message={message('', [image])} sessionId="session-1" />)
    expect(html).toContain('data-message-id="message-1"')
    expect(html).toContain('data-image-state="loading"')
    expect(html).not.toContain('message-content')
  })

  it('renders mixed text and image messages', () => {
    const html = renderToStaticMarkup(<ConversationMessageView message={message('Look here', [image])} sessionId="session-1" />)
    expect(html).toContain('Look here')
    expect(html).toContain('message-images')
    expect(html).toContain('Loading image screen.png')
  })

  it('renders explicit loading and error states', () => {
    const loading = renderToStaticMarkup(<MessageImageState image={image} state="loading" />)
    const error = renderToStaticMarkup(<MessageImageState image={image} state="error" />)
    expect(loading).toContain('data-image-state="loading"')
    expect(error).toContain('data-image-state="error"')
    expect(error).toContain('Image unavailable: screen.png')
  })

  it('uses session and attachment identity and revokes object URLs on cleanup', async () => {
    const readImage = vi.fn(async () => ({ mediaType: 'image/png' as const, data: new Uint8Array([1, 2, 3]) }))
    const createObjectURL = vi.fn(() => 'blob:image-1')
    const revokeObjectURL = vi.fn()
    const onReady = vi.fn()
    const load = loadConversationImage({
      agentClient: { readImage } as unknown as AgentClient,
      image,
      identity: { sessionId: 'session-1', messageId: 'message-1', attachmentId: 'attachment-1' },
      onReady,
      onError: vi.fn(),
      urlApi: { createObjectURL, revokeObjectURL },
    })
    await flush()
    expect(readImage).toHaveBeenCalledWith('session-1', 'attachment-1')
    expect(load.identity).toEqual({ sessionId: 'session-1', messageId: 'message-1', attachmentId: 'attachment-1' })
    expect(onReady).toHaveBeenCalledWith('blob:image-1')
    load.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
  })

  it('ignores stale completion after session or message identity is disposed', async () => {
    const pending = deferred<{ mediaType: 'image/png'; data: Uint8Array }>()
    const createObjectURL = vi.fn(() => 'blob:stale')
    const revokeObjectURL = vi.fn()
    const onReady = vi.fn()
    const onError = vi.fn()
    const load = loadConversationImage({
      agentClient: { readImage: vi.fn(() => pending.promise) } as unknown as AgentClient,
      image,
      identity: { sessionId: 'old-session', messageId: 'old-message', attachmentId: 'attachment-1' },
      onReady,
      onError,
      urlApi: { createObjectURL, revokeObjectURL },
    })
    load.dispose()
    pending.resolve({ mediaType: 'image/png', data: new Uint8Array([1]) })
    await flush()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('reports read failures for the current identity', async () => {
    const onError = vi.fn()
    loadConversationImage({
      agentClient: { readImage: vi.fn(async () => { throw new Error('missing') }) } as unknown as AgentClient,
      image,
      identity: { sessionId: 'session-1', messageId: 'message-1', attachmentId: 'attachment-1' },
      onReady: vi.fn(),
      onError,
      urlApi: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
    })
    await flush()
    expect(onError).toHaveBeenCalledOnce()
  })
})
