export const workspacePreviewChannels = {
  listFiles: 'workspace-preview:list-files',
  readFile: 'workspace-preview:read-file',
} as const

export const WORKSPACE_PREVIEW_MAX_TEXT_BYTES = 1_048_576
export const WORKSPACE_PREVIEW_MAX_IMAGE_BYTES = 8_388_608

export type WorkspacePreviewErrorCode =
  | 'invalid-request'
  | 'workspace-not-found'
  | 'outside-workspace'
  | 'directory-not-found'
  | 'file-not-found'
  | 'not-a-directory'
  | 'not-a-file'
  | 'symlink-not-allowed'
  | 'unsupported-file'
  | 'binary-file'
  | 'file-too-large'
  | 'read-failed'

export interface WorkspacePreviewError {
  code: WorkspacePreviewErrorCode
  message: string
}

export type WorkspacePreviewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorkspacePreviewError }

export interface WorkspacePreviewListRequest {
  /** Opaque Harness workspace identity; main resolves its authoritative path. */
  workspaceId: string
  /** Workspace-relative directory. Empty string addresses the root. */
  directory: string
}

export interface WorkspacePreviewReadRequest {
  /** Opaque Harness workspace identity; main resolves its authoritative path. */
  workspaceId: string
  /** Workspace-relative regular file path. */
  path: string
}

export interface WorkspacePreviewFileEntry {
  name: string
  path: string
  size: number
  kind: 'text' | 'image' | 'unsupported'
}

export interface WorkspacePreviewDirectory {
  directory: string
  files: readonly WorkspacePreviewFileEntry[]
}

export interface WorkspaceTextPreview {
  kind: 'text'
  path: string
  name: string
  size: number
  language: string
  text: string
}

export interface WorkspaceImagePreview {
  kind: 'image'
  path: string
  name: string
  size: number
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string
}

export type WorkspaceFilePreview = WorkspaceTextPreview | WorkspaceImagePreview

export interface WorkspacePreviewApi {
  listFiles(request: WorkspacePreviewListRequest): Promise<WorkspacePreviewResult<WorkspacePreviewDirectory>>
  readFile(request: WorkspacePreviewReadRequest): Promise<WorkspacePreviewResult<WorkspaceFilePreview>>
}
