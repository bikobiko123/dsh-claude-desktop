import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesktopRuntimeLifecycle } from './app-lifecycle.js'
import { registerWorkspacePreviewIpc } from './workspace-preview/ipc.js'
import { GitHubUpdateService } from './updates/service.js'
import { registerUpdateIpc, sendUpdateState } from './updates/ipc.js'
import { createDshWorkspaceRootResolver } from './workspace-preview/workspace-resolver.js'
import { desktopChannels, type DesktopAppInfo, type ImageSelectionResult, type SelectedImage } from '../shared/desktop-api.js'
import { inspectImage, sanitizeImageSelectionRequest } from './images/validation.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const rendererDir = path.join(currentDir, '../renderer')
const preloadEntry = path.join(currentDir, '../preload/index.cjs')
const developmentUrl = process.env.VITE_DEV_SERVER_URL
const runtime = new DesktopRuntimeLifecycle({
  developmentUrl,
  developmentUpstreamOrigin: process.env.DSH_DEV_ORIGIN ?? 'http://127.0.0.1:3080',
  rendererDir,
  rendererSearch: process.env.DSH_DESKTOP_E2E === '1' ? '?e2eFixture=1' : undefined,
})

let mainWindow: BrowserWindow | null = null
let applicationOrigin: string | undefined
let quitting = false
const updateService = new GitHubUpdateService({
  currentVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  updatesDirectory: path.join(app.getPath('userData'), 'updates'),
  onStateChanged: (state) => sendUpdateState(mainWindow?.webContents, state),
})

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function registerIpc(): void {
  registerWorkspacePreviewIpc(ipcMain, createDshWorkspaceRootResolver({ getUpstreamOrigin: () => runtime.getUpstreamOrigin() }))
  registerUpdateIpc(ipcMain, shell, updateService)
  ipcMain.handle(desktopChannels.getAppInfo, (): DesktopAppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  }))

  ipcMain.handle(desktopChannels.openExternal, async (_event, value: unknown): Promise<boolean> => {
    if (typeof value !== 'string' || !isAllowedExternalUrl(value)) return false
    await shell.openExternal(value)
    return true
  })

  ipcMain.handle(desktopChannels.selectImages, async (_event, request: unknown): Promise<ImageSelectionResult> => {
    if (!mainWindow) return { images: [], rejected: [] }
    const { limits, selectedCount, selectedBytes } = sanitizeImageSelectionRequest(request)
    const remainingCount = Math.max(0, limits.maxImagesPerMessage - selectedCount)
    const remainingBytes = Math.max(0, limits.maxMessageImageBytes - selectedBytes)
    if (remainingCount === 0 || remainingBytes === 0 || limits.mediaTypes.length === 0) {
      return { images: [], rejected: ['The current message has reached the image attachment limit.'] }
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    })
    if (result.canceled) return { images: [], rejected: [] }
    const images: SelectedImage[] = []
    const rejected: string[] = []
    let acceptedBytes = 0
    for (const filePath of result.filePaths) {
      const name = path.basename(filePath)
      if (images.length >= remainingCount) { rejected.push(`${name}: too many images.`); continue }
      let data: Buffer
      try { data = await readFile(filePath) } catch { rejected.push(`${name}: could not be read.`); continue }
      const inspected = inspectImage(data)
      if (!inspected) { rejected.push(`${name}: unsupported or invalid image data.`); continue }
      if (!limits.mediaTypes.includes(inspected.mediaType)) { rejected.push(`${name}: ${inspected.mediaType} is not accepted by this host.`); continue }
      if (data.byteLength > limits.maxImageBytes) { rejected.push(`${name}: exceeds the per-image size limit.`); continue }
      if (acceptedBytes + data.byteLength > remainingBytes) { rejected.push(`${name}: exceeds the message image size limit.`); continue }
      if (!Number.isSafeInteger(inspected.width) || !Number.isSafeInteger(inspected.height) || inspected.width <= 0 || inspected.height <= 0 || inspected.width * inspected.height > limits.maxImagePixels) {
        rejected.push(`${name}: exceeds the image pixel limit.`); continue
      }
      acceptedBytes += data.byteLength
      images.push({ id: randomUUID(), name, mediaType: inspected.mediaType, bytes: data.byteLength, width: inspected.width, height: inspected.height, base64: data.toString('base64') })
    }
    return { images, rejected }
  })
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#f7f6f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: preloadEntry,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  mainWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    let targetOrigin: string
    try {
      targetOrigin = new URL(url).origin
    } catch {
      event.preventDefault()
      return
    }
    if (applicationOrigin === undefined || targetOrigin !== applicationOrigin) {
      event.preventDefault()
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    }
  })

  applicationOrigin = await runtime.load(window)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    registerIpc()
    await createWindow()
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow()
    })
  }).catch((error: unknown) => {
    console.error('Desktop application startup failed.', error)
    app.quit()
  })
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void runtime.stop().catch((error: unknown) => {
    console.error('Desktop runtime shutdown failed.', error)
  }).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
