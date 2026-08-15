import type { HarnessRc6Adapter } from './adapter.js'
import { createRc6AgentClient } from './agent-client.js'

/**
 * Concrete rc.6 renderer contribution. Startup loads this asynchronously only
 * after the official headless runtime has settled.
 */
export function createAgentClient(adapter: HarnessRc6Adapter) {
  const client = createRc6AgentClient({ ...adapter, api: adapter.connection.api })
  return {
    client,
    dispose: () => client.dispose(),
  }
}
