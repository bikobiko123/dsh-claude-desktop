export { createHarnessRc6Adapter } from './rc6/adapter.js'
export { createRc6AgentClient, Rc6AgentClient } from './rc6/agent-client.js'
export type { HarnessRc6Adapter, HarnessRc6Services } from './rc6/adapter.js'
export type { Rc6AgentClientServices } from './rc6/agent-client.js'

/**
 * Stable application import point. All release-candidate-specific loading,
 * factory materialization, and Cordis graph details remain under ./rc6/.
 */
export const HARNESS_ADAPTER_VERSION = '0.1.0-rc.6' as const
