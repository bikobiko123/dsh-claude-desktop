import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AgentClient, WorkspaceDirectoryListing, WorkspaceSummary } from '../../shared/agent-client'
import type { WorkspaceFilePreview, WorkspacePreviewFileEntry } from '../../shared/workspace-preview-contract'

export interface ArtifactsPanelProps {
  agentClient?: AgentClient
  workspace?: WorkspaceSummary
}

export function workspacePathWithin(workspacePath: string, candidatePath: string): boolean {
  const root = workspacePath.replaceAll('\\', '/').replace(/\/+$/, '')
  const candidate = candidatePath.replaceAll('\\', '/')
  return candidate === root || candidate.startsWith(`${root}/`)
}

export function containWorkspaceListing(workspacePath: string, listing: WorkspaceDirectoryListing): WorkspaceDirectoryListing {
  if (!workspacePathWithin(workspacePath, listing.path)) throw new Error('Runtime returned a directory outside the selected workspace.')
  return Object.freeze({
    ...listing,
    crumbs: Object.freeze(listing.crumbs.filter((crumb) => workspacePathWithin(workspacePath, crumb.path))),
    entries: Object.freeze(listing.entries.filter((entry) => workspacePathWithin(workspacePath, entry.path))),
  })
}

export function workspaceRelativeDirectory(workspacePath: string, absolutePath: string): string {
  const root = workspacePath.replace(/[\\/]+$/, '')
  if (absolutePath === root) return ''
  const prefix = `${root}/`
  const normalized = absolutePath.replaceAll('\\', '/')
  const normalizedRoot = root.replaceAll('\\', '/')
  if (!normalized.startsWith(`${normalizedRoot}/`)) return ''
  return normalized.slice(normalizedRoot.length + 1)
}

function previewError(result: { ok: false; error: { message: string } }): Error {
  return new Error(result.error.message)
}

export interface ArtifactsRequestToken {
  readonly generation: number
  readonly signal?: AbortSignal
}

export class ArtifactsRequestTracker {
  private generation = 0
  private controller?: AbortController

  begin(abortable = false): ArtifactsRequestToken {
    this.controller?.abort()
    this.controller = abortable ? new AbortController() : undefined
    return { generation: ++this.generation, ...(this.controller ? { signal: this.controller.signal } : {}) }
  }

  invalidate(): void {
    this.controller?.abort()
    this.controller = undefined
    this.generation += 1
  }

  isCurrent(token: ArtifactsRequestToken): boolean {
    return token.generation === this.generation
  }
}

export function ArtifactsPanel({ agentClient, workspace }: ArtifactsPanelProps): ReactElement {
  const [listing, setListing] = useState<WorkspaceDirectoryListing>()
  const [files, setFiles] = useState<readonly WorkspacePreviewFileEntry[]>([])
  const [preview, setPreview] = useState<WorkspaceFilePreview>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState<string>()
  const directoryRequests = useRef(new ArtifactsRequestTracker())
  const previewRequests = useRef(new ArtifactsRequestTracker())
  const openRequests = useRef(new ArtifactsRequestTracker())

  const loadDirectory = useCallback(async (path?: string) => {
    if (!agentClient?.listDirectory || !workspace) return
    const request = directoryRequests.current.begin(true)
    previewRequests.current.invalidate()
    openRequests.current.invalidate()
    setLoading(true)
    setPreviewLoading(false)
    setError(undefined)
    setPreview(undefined)
    setSelectedPath(undefined)
    try {
      const next = containWorkspaceListing(workspace.path, await agentClient.listDirectory(path ?? workspace.path, request.signal))
      if (!directoryRequests.current.isCurrent(request)) return
      let immediateFiles: readonly WorkspacePreviewFileEntry[] = []
      const previewApi = window.desktop?.workspacePreview
      if (previewApi) {
        const result = await previewApi.listFiles({
          workspaceId: workspace.id,
          directory: workspaceRelativeDirectory(workspace.path, next.path),
        })
        if (result.ok) immediateFiles = result.value.files
        else throw previewError(result)
      }
      if (!directoryRequests.current.isCurrent(request)) return
      setListing(next)
      setFiles(immediateFiles)
    } catch (cause) {
      if (!directoryRequests.current.isCurrent(request) || request.signal?.aborted) return
      setError(cause instanceof Error ? cause.message : 'Directory could not be loaded.')
    } finally {
      if (directoryRequests.current.isCurrent(request)) setLoading(false)
    }
  }, [agentClient, workspace])

  useEffect(() => {
    directoryRequests.current.invalidate()
    previewRequests.current.invalidate()
    openRequests.current.invalidate()
    setListing(undefined)
    setFiles([])
    setPreview(undefined)
    setSelectedPath(undefined)
    setLoading(false)
    setPreviewLoading(false)
    setError(undefined)
    if (agentClient && workspace) void loadDirectory(workspace.path)
    return () => {
      directoryRequests.current.invalidate()
      previewRequests.current.invalidate()
      openRequests.current.invalidate()
    }
  }, [agentClient, workspace?.id, workspace?.path, loadDirectory])

  const openPreview = useCallback(async (file: WorkspacePreviewFileEntry) => {
    if (!workspace || !window.desktop?.workspacePreview) return
    const request = previewRequests.current.begin()
    setSelectedPath(file.path)
    setPreview(undefined)
    setError(undefined)
    if (file.kind === 'unsupported') {
      setPreviewLoading(false)
      setError('This file format cannot be previewed in the desktop panel.')
      return
    }
    setPreviewLoading(true)
    try {
      const result = await window.desktop.workspacePreview.readFile({ workspaceId: workspace.id, path: file.path })
      if (!result.ok) throw previewError(result)
      if (!previewRequests.current.isCurrent(request)) return
      setPreview(result.value)
    } catch (cause) {
      if (!previewRequests.current.isCurrent(request)) return
      setError(cause instanceof Error ? cause.message : 'File preview could not be loaded.')
    } finally {
      if (previewRequests.current.isCurrent(request)) setPreviewLoading(false)
    }
  }, [workspace])

  const selectedAbsolutePath = useMemo(() => {
    if (!workspace || !selectedPath) return undefined
    const separator = workspace.path.includes('\\') ? '\\' : '/'
    return `${workspace.path.replace(/[\\/]+$/, '')}${separator}${selectedPath.replaceAll('/', separator)}`
  }, [selectedPath, workspace])

  return (
    <aside className="artifact-panel" aria-label="Artifacts">
      <header>
        <div>
          <strong>Artifacts</strong>
          <small>{workspace?.name ?? 'No workspace'}</small>
        </div>
        <button
          disabled={!selectedAbsolutePath || !agentClient?.openPath}
          onClick={() => {
            if (!selectedAbsolutePath || !agentClient?.openPath) return
            const request = openRequests.current.begin()
            void agentClient.openPath(selectedAbsolutePath).catch((cause) => {
              if (!openRequests.current.isCurrent(request)) return
              setError(cause instanceof Error ? cause.message : 'Path could not be opened.')
            })
          }}
          type="button"
        >Open</button>
      </header>

      {!workspace || !agentClient?.listDirectory ? (
        <div className="artifact-empty">
          <div className="artifact-icon">A</div>
          <h2>Select a workspace</h2>
          <p>Workspace files and generated artifacts will appear here.</p>
        </div>
      ) : (
        <div className="artifact-browser">
          <nav className="artifact-crumbs" aria-label="Artifact path">
            {listing?.crumbs.map((crumb, index) => (
              <button key={crumb.path} onClick={() => void loadDirectory(crumb.path)} title={crumb.path} type="button">
                {index === 0 ? 'Root' : crumb.name}
              </button>
            ))}
          </nav>

          {error ? <div className="artifact-error" role="alert">{error}</div> : null}
          {listing?.truncated ? <div className="artifact-notice">Directory results are truncated.</div> : null}

          <div className="artifact-entries" aria-busy={loading}>
            {loading ? <div className="artifact-loading">Loading workspace…</div> : null}
            {!loading && listing?.entries.filter((entry) => !entry.hidden).map((entry) => (
              <button className="artifact-entry artifact-directory" key={entry.path} onClick={() => void loadDirectory(entry.path)} type="button">
                <span>Folder</span><strong>{entry.name}</strong>
              </button>
            ))}
            {!loading && files.map((file) => (
              <button
                className={file.path === selectedPath ? 'artifact-entry artifact-file artifact-entry-selected' : 'artifact-entry artifact-file'}
                key={file.path}
                onClick={() => void openPreview(file)}
                type="button"
              >
                <span>{file.kind}</span><strong>{file.name}</strong><small>{file.size.toLocaleString()} B</small>
              </button>
            ))}
            {!loading && listing && listing.entries.length === 0 && files.length === 0 ? <div className="artifact-loading">This folder is empty.</div> : null}
          </div>

          <section className="artifact-preview" aria-busy={previewLoading}>
            {previewLoading ? <div className="artifact-loading">Loading preview…</div> : null}
            {!previewLoading && preview?.kind === 'text' ? (
              <><div className="artifact-preview-meta"><strong>{preview.name}</strong><span>{preview.language} · {preview.size.toLocaleString()} B</span></div><pre>{preview.text}</pre></>
            ) : null}
            {!previewLoading && preview?.kind === 'image' ? (
              <><div className="artifact-preview-meta"><strong>{preview.name}</strong><span>{preview.mediaType} · {preview.size.toLocaleString()} B</span></div><img alt={preview.name} src={`data:${preview.mediaType};base64,${preview.data}`} /></>
            ) : null}
            {!previewLoading && !preview && selectedPath ? <div className="artifact-loading">No preview available.</div> : null}
          </section>
        </div>
      )}
    </aside>
  )
}
