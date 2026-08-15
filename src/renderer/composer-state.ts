import type { AgentClientSnapshot } from '../shared/agent-client'
import type { ImageSelectionRequest, SelectedImage } from '../shared/desktop-api'

export function createImageSelectionRequest(
  snapshot: Pick<AgentClientSnapshot, 'imageLimits'>,
  attachments: readonly SelectedImage[],
): ImageSelectionRequest {
  return {
    ...(snapshot.imageLimits ? { limits: snapshot.imageLimits } : {}),
    selectedCount: attachments.length,
    selectedBytes: attachments.reduce((sum, image) => sum + image.bytes, 0),
  }
}

export function attachmentMessagesForResult(result: { rejected: readonly string[] }): readonly string[] {
  return Object.freeze([...result.rejected])
}

export function removeAttachmentById(attachments: readonly SelectedImage[], id: string): readonly SelectedImage[] {
  return Object.freeze(attachments.filter((image) => image.id !== id))
}

export function canSendMessage(
  ready: boolean,
  selectedSessionId: string | undefined,
  draft: string,
  attachmentCount: number,
): boolean {
  return ready && Boolean(selectedSessionId) && (Boolean(draft.trim()) || attachmentCount > 0)
}
