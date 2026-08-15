import { nodeAtPath, rehydrateSchema } from '@deepseek-ai/dsh-client-schema-form'
import type { ConfigurableProviderView, IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-client-connection/client'
import type {
  CredentialStatusView,
  PermissionPresetView,
  ProviderStatusView,
  SettingsClient,
  SettingsSnapshot,
} from '../agent-client.js'

const PERMISSION_NS = 'permission'
const DEFAULT_PRESET_PATH = ['defaultPreset'] as const

function unwrap<T>(response: { result: { ok: true; value: T } | { ok: false; error: { message?: string; code?: string } } }, operation: string): T {
  if (response.result.ok) return response.result.value
  throw new Error(response.result.error.message ?? response.result.error.code ?? `${operation} failed`)
}

function objectAt(value: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let cursor: unknown = value
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return typeof cursor === 'object' && cursor !== null && !Array.isArray(cursor)
    ? cursor as Record<string, unknown>
    : undefined
}

/** Extract only credential reference names; provider configuration values never enter the renderer snapshot. */
export function credentialRefsOf(view: SettingsNamespaceView | undefined, provider: ConfigurableProviderView): readonly string[] {
  if (!view) return Object.freeze([])
  const profile = objectAt(view.value, provider.settingsPath)
  if (!profile) return Object.freeze([])
  const refs = new Set<string>()
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'string' && key === 'apiKeyEnv' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) refs.add(value)
    else if (Array.isArray(value)) value.forEach((entry) => visit(entry))
    else if (typeof value === 'object' && value !== null) {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey)
    }
  }
  visit(profile)
  return Object.freeze([...refs])
}

export function permissionPresetOf(view: SettingsNamespaceView): { current: string; options: readonly PermissionPresetView[] } {
  const value = objectAt(view.value, [])?.defaultPreset
  if (typeof value !== 'string') throw new Error('Permission settings has no defaultPreset value.')
  const node = nodeAtPath(rehydrateSchema(view.schema), [...DEFAULT_PRESET_PATH])
  if (!node) throw new Error('Permission settings schema has no defaultPreset field.')
  const candidates = node.type === 'union' ? node.list ?? [] : [node]
  const options = candidates.flatMap((candidate) => {
    if (candidate.type !== 'const' || typeof candidate.value !== 'string') return []
    const description = candidate.meta?.description
    return [Object.freeze({
      id: candidate.value,
      label: typeof description === 'string' && description.trim() ? description : candidate.value,
    })]
  })
  if (!options.some((option) => option.id === value)) throw new Error('Permission settings schema does not advertise its current preset.')
  return { current: value, options: Object.freeze(options) }
}

function emptySnapshot(): SettingsSnapshot {
  return Object.freeze({
    state: 'idle',
    runtime: null,
    providers: Object.freeze([]),
    credentials: Object.freeze([]),
    permission: Object.freeze({ available: false, writable: false, current: '', options: Object.freeze([]) }),
  })
}

/** rc.6-only, redacting adapter for the custom renderer settings surface. */
export class Rc6SettingsClient implements SettingsClient {
  private snapshot = emptySnapshot()
  private readonly listeners = new Set<() => void>()
  private permissionRevision?: number
  private generation = 0

  readonly model = Object.freeze({
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  })

  constructor(private readonly api: IApiClient) {}

  async refresh(): Promise<void> {
    const generation = ++this.generation
    this.publish(Object.freeze({ ...this.snapshot, state: 'loading', error: undefined }))
    try {
      const [hostResponse, settingsResponse, providersResponse, modelsResponse] = await Promise.all([
        this.api.host.describe({}),
        this.api.settings.describe({}),
        this.api.llm.providers({}),
        this.api.llm.models({}),
      ])
      const host = unwrap(hostResponse, 'Describe runtime')
      const settings = unwrap(settingsResponse, 'Describe settings')
      const providerDirectory = unwrap(providersResponse, 'List providers')
      const modelCatalog = unwrap(modelsResponse, 'List models')
      const namespaces = new Map(settings.namespaces.map((entry) => [entry.ns, entry]))
      const providerRefs = providerDirectory.providers.map((provider) => ({
        provider,
        refs: credentialRefsOf(namespaces.get(provider.settingsNs), provider),
      }))
      const refs = [...new Set(providerRefs.flatMap((entry) => entry.refs))]
      const credentialMap = refs.length
        ? unwrap(await this.api.credentials.describe({ refs }), 'Describe credentials').credentials
        : {}
      if (generation !== this.generation) return

      const modelCounts = new Map(modelCatalog.groups.map((group) => [group.id, group.models.length]))
      const providers: readonly ProviderStatusView[] = Object.freeze(providerRefs.map(({ provider, refs: credentialRefs }) => Object.freeze({
        id: provider.provider,
        name: provider.displayName,
        active: provider.active,
        declared: provider.declared,
        settingsNamespace: provider.settingsNs,
        modelCount: modelCounts.get(provider.provider) ?? 0,
        credentialRefs,
      })))
      const credentials: readonly CredentialStatusView[] = Object.freeze(refs.map((ref) => {
        const status = credentialMap[ref]
        return Object.freeze({ ref, configured: status?.configured ?? false, source: status?.source, writable: status?.writable ?? false })
      }))
      const permissionView = namespaces.get(PERMISSION_NS)
      let permission: SettingsSnapshot['permission'] = Object.freeze({ available: false, writable: false, current: '', options: Object.freeze([]) })
      if (permissionView) {
        const parsed = permissionPresetOf(permissionView)
        this.permissionRevision = permissionView.revision
        permission = Object.freeze({
          available: true,
          writable: settings.writable,
          current: parsed.current,
          options: parsed.options,
          applies: permissionView.applies,
        })
      } else this.permissionRevision = undefined
      this.publish(Object.freeze({
        state: 'ready',
        runtime: Object.freeze({
          version: host.version,
          cwd: host.cwd,
          provider: host.provider,
          model: host.model,
          attachedSessions: host.attachedSessions,
          canOpenPath: host.canOpenPath,
        }),
        providers,
        credentials,
        permission,
        modelFailureCount: modelCatalog.failures.length,
      }))
    } catch (cause) {
      if (generation !== this.generation) return
      this.publish(Object.freeze({ ...this.snapshot, state: 'error', error: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  async selectPermissionPreset(preset: string): Promise<void> {
    if (!this.snapshot.permission.available || !this.snapshot.permission.writable) throw new Error('Permission defaults are read-only.')
    if (!this.snapshot.permission.options.some((option) => option.id === preset)) throw new Error('Unknown permission preset.')
    const response = await this.api.settings.mutate({
      ns: PERMISSION_NS,
      ops: [{ op: 'set', path: [...DEFAULT_PRESET_PATH], value: preset }],
      expectedRevision: this.permissionRevision,
    })
    const view = unwrap(response, 'Save permission preset')
    const parsed = permissionPresetOf(view)
    this.permissionRevision = view.revision
    this.publish(Object.freeze({
      ...this.snapshot,
      permission: Object.freeze({ ...this.snapshot.permission, current: parsed.current, options: parsed.options, applies: view.applies }),
    }))
  }

  async setCredential(ref: string, value: string): Promise<void> {
    const credential = this.snapshot.credentials.find((entry) => entry.ref === ref)
    if (!credential?.writable) throw new Error('Credential is not writable.')
    if (typeof value !== 'string' || value.length === 0) throw new Error('Credential value is required.')
    // The rc.6 browser-safe seam accepts secret material only in this narrow
    // one-way action. It is never included in a settings snapshot or response.
    unwrap(await this.api.credentials.set({ ref, value }), 'Save credential')
    await this.refresh()
  }

  async removeCredential(ref: string): Promise<void> {
    const credential = this.snapshot.credentials.find((entry) => entry.ref === ref)
    if (!credential?.writable) throw new Error('Credential is not writable.')
    unwrap(await this.api.credentials.unset({ ref }), 'Remove credential')
    await this.refresh()
  }

  dispose(): void {
    this.generation += 1
    this.listeners.clear()
  }

  private publish(snapshot: SettingsSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }
}
