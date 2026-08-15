import { contextBridge, ipcRenderer } from 'electron'
import { desktopChannels, type DesktopApi, type ImageSelectionRequest } from '../shared/desktop-api.js'
import { updateChannels, type UpdateState } from '../shared/update-contract.js'
import {
  workspacePreviewChannels,
  type WorkspacePreviewListRequest,
  type WorkspacePreviewReadRequest,
} from '../shared/workspace-preview-contract.js'

const desktopApi: DesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(desktopChannels.getAppInfo),
  openExternal: (url: string) => ipcRenderer.invoke(desktopChannels.openExternal, url),
  selectImages: (request: ImageSelectionRequest) => ipcRenderer.invoke(desktopChannels.selectImages, request),
  updates: Object.freeze({
    getState: () => ipcRenderer.invoke(updateChannels.getState),
    check: () => ipcRenderer.invoke(updateChannels.check),
    download: () => ipcRenderer.invoke(updateChannels.download),
    reveal: () => ipcRenderer.invoke(updateChannels.reveal),
    open: () => ipcRenderer.invoke(updateChannels.open),
    onStateChanged: (listener: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state)
      ipcRenderer.on(updateChannels.stateChanged, handler)
      return () => ipcRenderer.removeListener(updateChannels.stateChanged, handler)
    },
  }),
  workspacePreview: Object.freeze({
    listFiles: (request: WorkspacePreviewListRequest) => ipcRenderer.invoke(workspacePreviewChannels.listFiles, request),
    readFile: (request: WorkspacePreviewReadRequest) => ipcRenderer.invoke(workspacePreviewChannels.readFile, request),
  }),
})

contextBridge.exposeInMainWorld('desktop', desktopApi)
