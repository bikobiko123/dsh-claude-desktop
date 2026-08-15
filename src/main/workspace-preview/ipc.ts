import type { IpcMain } from 'electron'
import { workspacePreviewChannels } from '../../shared/workspace-preview-contract.js'
import { listWorkspacePreviewFiles, readWorkspacePreviewFile } from './service.js'
import type { ResolveWorkspaceRoot } from './workspace-resolver.js'

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

export function registerWorkspacePreviewIpc(ipc: Pick<IpcMain, 'handle'>, resolveWorkspaceRoot: ResolveWorkspaceRoot): void {
  ipc.handle(workspacePreviewChannels.listFiles, async (_event, value: unknown) => {
    const workspaceId = stringField(value, 'workspaceId')
    const directory = stringField(value, 'directory')
    if (!workspaceId || directory === undefined) {
      return { ok: false as const, error: { code: 'invalid-request' as const, message: 'workspaceId and directory must be strings.' } }
    }
    const workspaceRoot = await resolveWorkspaceRoot(workspaceId)
    if (!workspaceRoot) return { ok: false as const, error: { code: 'workspace-not-found' as const, message: 'Workspace is not available.' } }
    return listWorkspacePreviewFiles({ workspaceRoot, directory })
  })
  ipc.handle(workspacePreviewChannels.readFile, async (_event, value: unknown) => {
    const workspaceId = stringField(value, 'workspaceId')
    const filePath = stringField(value, 'path')
    if (!workspaceId || filePath === undefined) {
      return { ok: false as const, error: { code: 'invalid-request' as const, message: 'workspaceId and path must be strings.' } }
    }
    const workspaceRoot = await resolveWorkspaceRoot(workspaceId)
    if (!workspaceRoot) return { ok: false as const, error: { code: 'workspace-not-found' as const, message: 'Workspace is not available.' } }
    return readWorkspacePreviewFile({ workspaceRoot, path: filePath })
  })
}
