export const updateChannels = {
  getState: 'desktop:update:get-state',
  check: 'desktop:update:check',
  download: 'desktop:update:download',
  reveal: 'desktop:update:reveal',
  open: 'desktop:update:open',
  stateChanged: 'desktop:update:state-changed',
} as const

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'available'; currentVersion: string; version: string; fileName: string; size: number }
  | { status: 'downloading'; version: string; fileName: string; received: number; total: number; percent: number }
  | { status: 'downloaded'; version: string; fileName: string; size: number }
  | { status: 'error'; operation: 'check' | 'download' | 'reveal'; message: string }

export interface DesktopUpdateApi {
  getState(): Promise<UpdateState>
  check(): Promise<UpdateState>
  download(): Promise<UpdateState>
  reveal(): Promise<boolean>
  open(): Promise<boolean>
  onStateChanged(listener: (state: UpdateState) => void): () => void
}
