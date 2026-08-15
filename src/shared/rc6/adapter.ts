import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { bootDshRc6HeadlessRuntime, type DshRc6BootstrapOptions } from './bootstrap.js'
import { DSH_RC6_VERSION, type DshRc6SettledRuntime } from './contracts.js'

export interface HarnessRc6Services {
  readonly version: typeof DSH_RC6_VERSION
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly connection: ConnectionHandle
}

export interface HarnessRc6Adapter extends HarnessRc6Services {
  readonly runtime: DshRc6SettledRuntime
  dispose(): Promise<void>
}

/** Versioned adapter returned to the application layer after the core graph settles. */
export async function createHarnessRc6Adapter(options: DshRc6BootstrapOptions = {}): Promise<HarnessRc6Adapter> {
  const runtime = await bootDshRc6HeadlessRuntime(options)
  return Object.freeze({
    version: DSH_RC6_VERSION,
    runtime,
    sessions: runtime.sessions,
    workspaces: runtime.workspaces,
    connection: runtime.connection,
    dispose: () => runtime.dispose(),
  })
}
