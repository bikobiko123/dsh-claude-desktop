import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { workspaceListValueSchema } from '@deepseek-ai/dsh-host-apiproxy/api/workspace.schema'

export type ResolveWorkspaceRoot = (workspaceId: string) => Promise<string | undefined>

export interface DshWorkspaceRootResolverOptions {
  /** Returns the authoritative DSH Host origin, not the renderer proxy. */
  getUpstreamOrigin(): string | undefined
  fetch?: typeof globalThis.fetch
}

/** Resolve opaque workspace ids against the authoritative DSH workspace.list projection. */
export function createDshWorkspaceRootResolver(options: DshWorkspaceRootResolverOptions): ResolveWorkspaceRoot {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  return async (workspaceId: string): Promise<string | undefined> => {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0 || workspaceId.length > 200) return undefined
    const origin = options.getUpstreamOrigin()
    if (!origin) return undefined
    const rpcId = RpcId(crypto.randomUUID())
    const response = await fetchImpl(new URL('/api/workspace.list', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspace.list', payload: {} }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const envelope = serverResponseSchema.parse(await response.json())
    if (envelope.rpcId !== rpcId || !envelope.result.ok) return undefined
    const value = workspaceListValueSchema.parse(envelope.result.value)
    return value.items.find((workspace) => String(workspace.workspaceId) === workspaceId)?.path
  }
}
