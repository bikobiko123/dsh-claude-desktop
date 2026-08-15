export const desktopChannels = {
  getAppInfo: 'desktop:get-app-info',
  openExternal: 'desktop:open-external',
  selectImages: 'desktop:select-images',
} as const

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageSelectionLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}

export interface ImageSelectionRequest {
  limits?: ImageSelectionLimits
  selectedCount: number
  selectedBytes: number
}

/** Validated image bytes. Local filesystem paths never cross the preload boundary. */
export interface SelectedImage {
  id: string
  name: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  base64: string
}

export interface ImageSelectionResult {
  images: readonly SelectedImage[]
  rejected: readonly string[]
}

export interface DesktopAppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  isPackaged: boolean
}

export interface DesktopApi {
  getAppInfo(): Promise<DesktopAppInfo>
  openExternal(url: string): Promise<boolean>
  selectImages(request: ImageSelectionRequest): Promise<ImageSelectionResult>
  updates: import('./update-contract.js').DesktopUpdateApi
  workspacePreview: import('./workspace-preview-contract.js').WorkspacePreviewApi
}
