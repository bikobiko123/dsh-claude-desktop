import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'

export const DSH_RC6_VERSION = '0.1.0-rc.6' as const

/**
 * Host graph identity accepted by the vendored rc.6 registrar. Keep this in
 * lockstep with the exact five core bundles used by the local fork; a changed
 * graph must fail closed rather than configure helpers against unknown APIs.
 */
export const DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT =
  '89708573e814|@deepseek-ai/dsh-typert-registry=f41d56e0b747|@deepseek-ai/dsh-client-connection=bc3c3fa9d26b|@deepseek-ai/dsh-api-gateway=9e83e9d9c076|@deepseek-ai/dsh-api-remotes=e17dd6016653|@deepseek-ai/dsh-client-runtime=5404bd0408a5' as const

export const DSH_RC6_EXPECTED_PLUGIN_INJECTS = {
  '@deepseek-ai/dsh-typert-registry': [],
  '@deepseek-ai/dsh-client-connection': [],
  '@deepseek-ai/dsh-api-gateway': ['@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-client-connection'],
  '@deepseek-ai/dsh-api-remotes': ['@deepseek-ai/dsh-api-gateway'],
  '@deepseek-ai/dsh-client-runtime': ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-remotes'],
} as const

/** Transport/object-layer services. These alone expose sessions/workspaces, but no Chat definitions. */
export const DSH_RC6_CORE_PLUGIN_IDS = [
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-runtime',
] as const

// Conversation projection is registered locally from the pinned definition-only fork.
export const DSH_RC6_CONVERSATION_PLUGIN_IDS = [] as const

export const DSH_RC6_RUNTIME_PLUGIN_IDS = [
  ...DSH_RC6_CORE_PLUGIN_IDS,
  ...DSH_RC6_CONVERSATION_PLUGIN_IDS,
] as const

export type DshRc6CorePluginId = (typeof DSH_RC6_CORE_PLUGIN_IDS)[number]
export type DshRc6ConversationPluginId = (typeof DSH_RC6_CONVERSATION_PLUGIN_IDS)[number]
export type DshRc6RuntimePluginId = (typeof DSH_RC6_RUNTIME_PLUGIN_IDS)[number]

export interface DshRc6BootEntry {
  id: string
  url: string
  rev: string
  inject?: readonly string[]
  immediately?: boolean
}

export interface DshRc6BootGraph {
  rev: string
  entries: DshRc6BootEntry[]
}

export interface DshRc6PluginHandoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

export interface DshRc6ModuleLoaderGlobal {
  load(handoff: DshRc6PluginHandoff): void
}

export interface DshRc6ContextServices {
  sessions: ISessions
  workspaces: IWorkspaces
  connection: ConnectionHandle
}

export interface DshRc6SettledRuntime extends DshRc6ContextServices {
  readonly version: typeof DSH_RC6_VERSION
  readonly ctx: unknown
  readonly pluginIds: readonly DshRc6RuntimePluginId[]
  dispose(): Promise<void>
}

export interface DshRc6Window extends Window {
  __DSH_BOOT__?: unknown
  __ModuleLoader__?: DshRc6ModuleLoaderGlobal
}
