import path from 'node:path'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import {
  WORKSPACE_PREVIEW_MAX_IMAGE_BYTES,
  WORKSPACE_PREVIEW_MAX_TEXT_BYTES,
  type WorkspaceFilePreview,
  type WorkspacePreviewDirectory,
  type WorkspacePreviewErrorCode,
  type WorkspacePreviewFileEntry,
  type WorkspacePreviewResult,
} from '../../shared/workspace-preview-contract.js'

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
] as const)

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.json', '.jsonc', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml', '.svg', '.yaml', '.yml', '.toml',
  '.ini', '.conf', '.env', '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.php', '.java', '.kt',
  '.kts', '.go', '.rs', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift', '.sql', '.graphql',
  '.gql', '.csv', '.tsv', '.log', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.lock',
])

const TEXT_BASENAMES = new Set(['README', 'LICENSE', 'CHANGELOG', 'Dockerfile', 'Makefile'])

function failure<T>(code: WorkspacePreviewErrorCode, message: string): WorkspacePreviewResult<T> {
  return { ok: false, error: { code, message } }
}

function normalizeRelative(value: string): string | undefined {
  if (typeof value !== 'string' || value.includes('\0')) return undefined
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (path.posix.isAbsolute(normalized)) return undefined
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) return undefined
  return segments.join('/')
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function previewKind(fileName: string): WorkspacePreviewFileEntry['kind'] {
  const extension = path.extname(fileName).toLowerCase()
  if (IMAGE_TYPES.has(extension as never)) return 'image'
  if (TEXT_EXTENSIONS.has(extension) || TEXT_BASENAMES.has(fileName)) return 'text'
  return 'unsupported'
}

function languageFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace('.', '')
  return extension || fileName.toLowerCase()
}

function isSupportedImage(contents: Buffer, mediaType: string): boolean {
  if (mediaType === 'image/png') return contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mediaType === 'image/jpeg') return contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff
  if (mediaType === 'image/gif') return contents.subarray(0, 6).toString('ascii') === 'GIF87a' || contents.subarray(0, 6).toString('ascii') === 'GIF89a'
  if (mediaType === 'image/webp') return contents.subarray(0, 4).toString('ascii') === 'RIFF' && contents.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

function appearsBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  if (sample.includes(0)) return true
  let suspicious = 0
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return sample.length > 0 && suspicious / sample.length > 0.08
}

function sameFile(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function openValidatedFile(
  root: string,
  absolute: string,
): Promise<WorkspacePreviewResult<{ handle: FileHandle; info: Awaited<ReturnType<FileHandle['stat']>> }>> {
  let handle: FileHandle | undefined
  try {
    // O_NOFOLLOW is supported on macOS/Linux and prevents the final path component
    // from being swapped to a symlink between validation and open. On Windows it is
    // unavailable, so the identity/containment checks below are the fail-closed fallback.
    handle = await open(absolute, process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) {
      await handle.close()
      return failure('not-a-file', 'The requested path is not a regular file.')
    }
    const resolvedAfterOpen = await realpath(absolute)
    if (!isWithin(root, resolvedAfterOpen)) {
      await handle.close()
      return failure('outside-workspace', 'The resolved path leaves the workspace.')
    }
    const pathInfo = await stat(resolvedAfterOpen)
    if (!sameFile(info, pathInfo)) {
      await handle.close()
      return failure('read-failed', 'The requested file changed while it was being opened.')
    }
    return { ok: true, value: { handle, info } }
  } catch {
    if (handle) await handle.close().catch(() => undefined)
    return failure('read-failed', 'The workspace file could not be opened safely.')
  }
}

async function readValidatedFile(
  root: string,
  absolute: string,
): Promise<WorkspacePreviewResult<{ contents: Buffer; info: Awaited<ReturnType<FileHandle['stat']>> }>> {
  const opened = await openValidatedFile(root, absolute)
  if (!opened.ok) return opened
  const { handle, info } = opened.value
  try {
    const contents = await handle.readFile()
    const resolvedAfterRead = await realpath(absolute)
    if (!isWithin(root, resolvedAfterRead)) return failure('outside-workspace', 'The resolved path leaves the workspace.')
    const pathInfo = await stat(resolvedAfterRead)
    if (!sameFile(info, pathInfo)) return failure('read-failed', 'The requested file changed while it was being read.')
    return { ok: true, value: { contents, info } }
  } catch {
    return failure('read-failed', 'The workspace file could not be read safely.')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function resolveRoot(workspaceRoot: unknown): Promise<WorkspacePreviewResult<string>> {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || workspaceRoot.includes('\0')) {
    return failure('invalid-request', 'workspaceRoot must be an absolute filesystem path.')
  }
  try {
    const root = await realpath(workspaceRoot)
    const info = await stat(root)
    return info.isDirectory() ? { ok: true, value: root } : failure('workspace-not-found', 'Workspace root is not a directory.')
  } catch {
    return failure('workspace-not-found', 'Workspace root does not exist or cannot be resolved.')
  }
}

async function resolveContained(
  root: string,
  relativePath: string,
  expected: 'file' | 'directory',
): Promise<WorkspacePreviewResult<{ absolute: string; relative: string }>> {
  const normalized = normalizeRelative(relativePath)
  if (normalized === undefined) return failure('outside-workspace', 'The requested path must remain inside the workspace.')
  const lexical = path.resolve(root, normalized)
  if (!isWithin(root, lexical)) return failure('outside-workspace', 'The requested path must remain inside the workspace.')
  try {
    const linkInfo = await lstat(lexical)
    if (linkInfo.isSymbolicLink()) return failure('symlink-not-allowed', 'Symbolic links are not available through workspace preview.')
    const resolved = await realpath(lexical)
    if (!isWithin(root, resolved)) return failure('outside-workspace', 'The resolved path leaves the workspace.')
    const info = await stat(resolved)
    if (expected === 'file' && !info.isFile()) return failure('not-a-file', 'The requested path is not a regular file.')
    if (expected === 'directory' && !info.isDirectory()) return failure('not-a-directory', 'The requested path is not a directory.')
    return { ok: true, value: { absolute: resolved, relative: normalized } }
  } catch {
    return failure(expected === 'file' ? 'file-not-found' : 'directory-not-found', `The requested ${expected} does not exist.`)
  }
}

export interface ResolvedWorkspacePreviewListRequest {
  workspaceRoot: string
  directory: string
}

export interface ResolvedWorkspacePreviewReadRequest {
  workspaceRoot: string
  path: string
}

export async function listWorkspacePreviewFiles(
  request: ResolvedWorkspacePreviewListRequest,
): Promise<WorkspacePreviewResult<WorkspacePreviewDirectory>> {
  if (typeof request !== 'object' || request === null) return failure('invalid-request', 'A preview request is required.')
  const root = await resolveRoot(request.workspaceRoot)
  if (!root.ok) return root
  const directory = await resolveContained(root.value, request.directory, 'directory')
  if (!directory.ok) return directory
  try {
    const entries = await readdir(directory.value.absolute, { withFileTypes: true })
    const files: WorkspacePreviewFileEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue
      const absolute = path.join(directory.value.absolute, entry.name)
      const resolved = await realpath(absolute)
      if (!isWithin(root.value, resolved)) continue
      const info = await stat(resolved)
      files.push({
        name: entry.name,
        path: path.posix.join(directory.value.relative, entry.name),
        size: Number(info.size),
        kind: previewKind(entry.name),
      })
    }
    files.sort((left, right) => left.name.localeCompare(right.name))
    return { ok: true, value: { directory: directory.value.relative, files } }
  } catch {
    return failure('read-failed', 'The workspace directory could not be listed.')
  }
}

export async function readWorkspacePreviewFile(
  request: ResolvedWorkspacePreviewReadRequest,
): Promise<WorkspacePreviewResult<WorkspaceFilePreview>> {
  if (typeof request !== 'object' || request === null) return failure('invalid-request', 'A preview request is required.')
  const root = await resolveRoot(request.workspaceRoot)
  if (!root.ok) return root
  const file = await resolveContained(root.value, request.path, 'file')
  if (!file.ok) return file
  const name = path.basename(file.value.absolute)
  const kind = previewKind(name)
  if (kind === 'unsupported') return failure('unsupported-file', 'This file type is not supported for preview.')
  try {
    const opened = await readValidatedFile(root.value, file.value.absolute)
    if (!opened.ok) {
      if (opened.error.code === 'read-failed' && opened.error.message.includes('could not be opened')) {
        return failure('file-not-found', 'The requested file does not exist.')
      }
      return opened
    }
    const { contents, info } = opened.value
    const limit = kind === 'image' ? WORKSPACE_PREVIEW_MAX_IMAGE_BYTES : WORKSPACE_PREVIEW_MAX_TEXT_BYTES
    if (info.size > limit) return failure('file-too-large', `The file exceeds the ${limit}-byte preview limit.`)
    if (kind === 'image') {
      const mediaType = IMAGE_TYPES.get(path.extname(name).toLowerCase() as never)
      if (!mediaType) return failure('unsupported-file', 'This image type is not supported for preview.')
      if (!isSupportedImage(contents, mediaType)) return failure('binary-file', 'The image content does not match its supported file type.')
      return {
        ok: true,
        value: { kind: 'image', path: file.value.relative, name, size: Number(info.size), mediaType, data: contents.toString('base64') },
      }
    }
    if (appearsBinary(contents)) return failure('binary-file', 'Binary files cannot be shown as text.')
    return {
      ok: true,
      value: { kind: 'text', path: file.value.relative, name, size: Number(info.size), language: languageFor(name), text: contents.toString('utf8') },
    }
  } catch {
    return failure('read-failed', 'The workspace file could not be read.')
  }
}
