import { StrictMode, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import type { HarnessRc6Adapter } from '../shared/harness-runtime-adapter'
import { createRc6AgentClient } from '../shared/rc6/agent-client'
import { App } from './App'
import {
  createRendererRuntimeHost,
  installAgentClientFactory,
  type RendererRuntimeHost,
  type RendererRuntimeSnapshot,
} from './agent-client-host'

export interface RendererStartupProps {
  host: RendererRuntimeHost
}

function startupMessage(snapshot: RendererRuntimeSnapshot): { title: string; detail: string } {
  switch (snapshot.phase) {
    case 'loading-manifest':
      return { title: 'Connecting to Harness', detail: 'Loading the host boot graph.' }
    case 'booting-runtime':
      return { title: 'Starting Harness runtime', detail: 'Activating the rc.6 headless client services.' }
    case 'waiting-agent-client':
      return { title: 'Preparing conversations', detail: 'The runtime is ready and is waiting for its renderer adapter.' }
    case 'creating-agent-client':
      return { title: 'Preparing conversations', detail: 'Connecting the renderer to sessions and workspaces.' }
    case 'error':
      return { title: 'Harness could not start', detail: snapshot.error?.message ?? 'An unknown startup error occurred.' }
    default:
      return { title: 'Starting DSH Desktop', detail: 'Preparing the independent renderer.' }
  }
}

export function RendererStartup({ host }: RendererStartupProps): ReactElement {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot)
  if (snapshot.phase === 'ready' && snapshot.agentClient) return <App agentClient={snapshot.agentClient} />

  const message = startupMessage(snapshot)
  return (
    <div className="startup-screen" role={snapshot.phase === 'error' ? 'alert' : 'status'}>
      <div className="startup-mark" aria-hidden="true">D</div>
      <h1>{message.title}</h1>
      <p>{message.detail}</p>
      {snapshot.phase === 'error' ? (
        <button className="startup-retry" onClick={() => void host.start()} type="button">Retry</button>
      ) : <span className="startup-progress" aria-hidden="true" />}
    </div>
  )
}

export interface MountRendererOptions {
  element: HTMLElement
  host?: RendererRuntimeHost
}

export function mountRenderer(options: MountRendererOptions): { host: RendererRuntimeHost; dispose(): Promise<void> } {
  const host = options.host ?? createRendererRuntimeHost()
  const root = createRoot(options.element)
  root.render(
    <StrictMode>
      <RendererStartup host={host} />
    </StrictMode>,
  )
  void host.start()

  return {
    host,
    async dispose() {
      root.unmount()
      await host.dispose()
    },
  }
}

const isE2eFixture = new URLSearchParams(window.location.search).get('e2eFixture') === '1'
const uninstallAgentClientFactory = installAgentClientFactory(async (adapter: HarnessRc6Adapter) => {
  if (isE2eFixture) {
    const { createE2eFixtureAgentClient } = await import('./e2e-fixture-client')
    const client = await createE2eFixtureAgentClient()
    return { client, dispose: () => client.dispose() }
  }
  const client = createRc6AgentClient({ ...adapter, api: adapter.connection.api })
  return { client, dispose: () => client.dispose() }
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Renderer root element was not found.')

const runtimeHost = isE2eFixture ? createRendererRuntimeHost({
  createAdapter: async () => ({
    version: '0.1.0-rc.6',
    runtime: {} as never,
    sessions: {} as never,
    workspaces: {} as never,
    connection: { api: {} } as never,
    dispose: async () => undefined,
  }),
}) : undefined
const mounted = mountRenderer({ element: rootElement, host: runtimeHost })
const disposeOnUnload = () => {
  uninstallAgentClientFactory()
  void mounted.dispose()
}
window.addEventListener('beforeunload', disposeOnUnload, { once: true })

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('beforeunload', disposeOnUnload)
    uninstallAgentClientFactory()
    void mounted.dispose()
  })
}
