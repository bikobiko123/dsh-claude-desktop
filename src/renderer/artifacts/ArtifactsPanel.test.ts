import { describe, expect, it } from 'vitest'
import { ArtifactsRequestTracker, containWorkspaceListing, workspacePathWithin, workspaceRelativeDirectory } from './ArtifactsPanel.js'

describe('workspaceRelativeDirectory', () => {
  it('maps the workspace root and descendants to preview-relative paths', () => {
    expect(workspaceRelativeDirectory('/tmp/project', '/tmp/project')).toBe('')
    expect(workspaceRelativeDirectory('/tmp/project', '/tmp/project/src')).toBe('src')
    expect(workspaceRelativeDirectory('C:\\work\\project', 'C:\\work\\project\\src')).toBe('src')
  })

  it('keeps external runtime breadcrumbs and entries out of the preview listing', () => {
    expect(workspacePathWithin('/tmp/project', '/tmp/project-elsewhere')).toBe(false)
    const listing = containWorkspaceListing('/tmp/project', {
      path: '/tmp/project', home: '/tmp', truncated: false,
      crumbs: [{ name: 'root', path: '/tmp/project', hidden: false }, { name: 'external', path: '/tmp/other', hidden: false }],
      entries: [{ name: 'inside', path: '/tmp/project/src', hidden: false }, { name: 'outside', path: '/tmp/other/file', hidden: false }],
    })
    expect(listing.crumbs.map((crumb) => crumb.path)).toEqual(['/tmp/project'])
    expect(listing.entries.map((entry) => entry.path)).toEqual(['/tmp/project/src'])
  })

  it('rejects a listing whose current directory is outside the workspace', () => {
    expect(() => containWorkspaceListing('/tmp/project', {
      path: '/tmp/other', home: '/tmp', truncated: false, crumbs: [], entries: [],
    })).toThrow('outside the selected workspace')
  })
})

describe('ArtifactsRequestTracker', () => {
  it('aborts the prior directory request and rejects its stale completion', () => {
    const tracker = new ArtifactsRequestTracker()
    const first = tracker.begin(true)
    const second = tracker.begin(true)

    expect(first.signal?.aborted).toBe(true)
    expect(second.signal?.aborted).toBe(false)
    expect(tracker.isCurrent(first)).toBe(false)
    expect(tracker.isCurrent(second)).toBe(true)
  })

  it('invalidates directory and preview ownership independently', () => {
    const directory = new ArtifactsRequestTracker()
    const preview = new ArtifactsRequestTracker()
    const directoryRequest = directory.begin(true)
    const previewRequest = preview.begin()

    preview.invalidate()

    expect(directory.isCurrent(directoryRequest)).toBe(true)
    expect(preview.isCurrent(previewRequest)).toBe(false)
    expect(directoryRequest.signal?.aborted).toBe(false)
  })

  it('invalidates in-flight preview work across workspace changes', () => {
    const tracker = new ArtifactsRequestTracker()
    const request = tracker.begin()

    tracker.invalidate()

    expect(tracker.isCurrent(request)).toBe(false)
  })
})
