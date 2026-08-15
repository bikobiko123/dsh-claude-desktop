import type { IpcMain, Shell, WebContents } from 'electron'
import type { GitHubUpdateService } from './service.js'
import { updateChannels, type UpdateState } from '../../shared/update-contract.js'

export function registerUpdateIpc(ipcMain: Pick<IpcMain, 'handle'>, shell: Pick<Shell, 'showItemInFolder'>, service: GitHubUpdateService): void {
  ipcMain.handle(updateChannels.getState, (): UpdateState => service.getState())
  ipcMain.handle(updateChannels.check, (): Promise<UpdateState> => service.check())
  ipcMain.handle(updateChannels.download, (): Promise<UpdateState> => service.download())
  ipcMain.handle(updateChannels.reveal, (): boolean => {
    const downloadedPath = service.getDownloadedPath()
    if (!downloadedPath) return false
    shell.showItemInFolder(downloadedPath)
    return true
  })
}

export function sendUpdateState(webContents: Pick<WebContents, 'isDestroyed' | 'send'> | undefined, state: UpdateState): void {
  if (!webContents || webContents.isDestroyed()) return
  webContents.send(updateChannels.stateChanged, state)
}
