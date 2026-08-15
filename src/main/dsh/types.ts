export const DSH_LOOPBACK_HOST = '127.0.0.1' as const

export type DshSidecarPhase = 'idle' | 'starting' | 'ready' | 'stopping' | 'failed'

export interface DshDiagnosticEntry {
  readonly stream: 'stdout' | 'stderr' | 'lifecycle'
  readonly time: number
  readonly text: string
}

export interface DshSidecarSnapshot {
  readonly phase: DshSidecarPhase
  readonly executable?: string
  readonly port?: number
  readonly origin?: string
  readonly pid?: number
  readonly startedAt?: number
  readonly error?: string
  readonly diagnostics: readonly DshDiagnosticEntry[]
}

export interface DshSidecarHandle {
  readonly origin: string
  readonly port: number
  readonly pid?: number
}
