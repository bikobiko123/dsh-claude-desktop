import { describe, expect, it } from 'vitest'
import type { AgentClientSnapshot } from '../shared/agent-client'
import type { SelectedImage } from '../shared/desktop-api'
import { canSendMessage, createImageSelectionRequest, attachmentMessagesForResult, removeAttachmentById } from './composer-state'

const image: SelectedImage = {
  id: 'image-1',
  name: 'screen.png',
  mediaType: 'image/png',
  bytes: 123,
  width: 10,
  height: 10,
  base64: 'AA==',
}

describe('composer state', () => {
  it('passes runtime image limits and current attachment totals to selection', () => {
    const imageLimits = {
      maxImageBytes: 1000,
      maxImagesPerMessage: 3,
      maxMessageImageBytes: 2000,
      maxImagePixels: 5000,
      mediaTypes: ['image/png'] as const,
    }
    const request = createImageSelectionRequest({ imageLimits } satisfies Pick<AgentClientSnapshot, 'imageLimits'>, [image, { ...image, id: 'image-2', bytes: 77 }])
    expect(request).toEqual({ limits: imageLimits, selectedCount: 2, selectedBytes: 200 })
  })

  it('preserves rejected attachment diagnostics and removes only the requested attachment', () => {
    const messages = attachmentMessagesForResult({ rejected: ['bad.png: unsupported or invalid image data.'] })
    expect(messages).toEqual(['bad.png: unsupported or invalid image data.'])
    expect(Object.isFrozen(messages)).toBe(true)
    expect(removeAttachmentById([image, { ...image, id: 'image-2' }], 'image-1').map((item) => item.id)).toEqual(['image-2'])
  })

  it('allows image-only messages while rejecting empty messages', () => {
    expect(canSendMessage(true, 'session-1', '', 1)).toBe(true)
    expect(canSendMessage(true, 'session-1', '   ', 0)).toBe(false)
    expect(canSendMessage(false, 'session-1', 'hello', 0)).toBe(false)
    expect(canSendMessage(true, undefined, 'hello', 0)).toBe(false)
  })
})
