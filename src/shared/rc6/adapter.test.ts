import { describe, expect, it } from 'vitest'
import { createHarnessRc6Adapter } from './adapter.js'
import {
  DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT,
  DSH_RC6_EXPECTED_PLUGIN_INJECTS,
  DSH_RC6_RUNTIME_PLUGIN_IDS,
  DSH_RC6_VERSION,
} from './contracts.js'

function graph() {
  const [rev, ...pluginParts] = DSH_RC6_COMPATIBLE_BOOT_FINGERPRINT.split('|')
  const revisions = new Map(pluginParts.map((part) => {
    const separator = part.lastIndexOf('=')
    return [part.slice(0, separator), part.slice(separator + 1)]
  }))
  return {
    rev,
    entries: DSH_RC6_RUNTIME_PLUGIN_IDS.map((id) => ({ id, url: `/${id}.js`, rev: revisions.get(id)!, inject: [...DSH_RC6_EXPECTED_PLUGIN_INJECTS[id]] })),
  }
}

describe('Harness rc.6 adapter', () => {
  it('keeps unstable runtime behind a versioned sessions/workspaces face', async () => {
    const globalObject = {} as Window & { __ModuleLoader__?: { load(handoff: any): void } }
    const sessions = { list: { getSnapshot: () => ({}) } }
    const workspaces = { list: { getSnapshot: () => ({}) } }
    const adapter = await createHarnessRc6Adapter({
      bootGraph: graph(),
      staticModules: {},
      global: globalObject,
      loadBundle: async (_url, id) => {
        globalObject.__ModuleLoader__!.load({
          id,
          factory: () => {
            const helper = () => undefined
            return {
              inject: [],
              emptyAssistantBlock: helper,
              toAssistantBlock: helper,
              toAssistantBlocks: () => [],
              isTokenDelta: helper,
              isAppendSurfaceEvent: helper,
              isReplacementSurfaceEvent: helper,
              contextProvenance: helper,
              contextForm: helper,
              displayFailureMessage: helper,
              apply(ctx: any) {
              if (id === '@deepseek-ai/dsh-client-connection') ctx.provide('connection', {})
              else if (id === '@deepseek-ai/dsh-client-runtime') {
                ctx.provide('conversationEvents', { register: () => undefined, registerFallback: () => undefined })
                ctx.provide('conversationViews', { register: () => undefined })
                ctx.provide('sessions', sessions)
                ctx.provide('workspaces', workspaces)
              } else ctx.provide(`test-${id}`, {})
              },
            }
          },
        })
      },
    })

    expect(adapter.version).toBe(DSH_RC6_VERSION)
    expect(adapter.sessions).toBe(sessions)
    expect(adapter.workspaces).toBe(workspaces)
    expect(Object.isFrozen(adapter)).toBe(true)
    await adapter.dispose()
  })
})
