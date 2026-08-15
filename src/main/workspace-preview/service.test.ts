import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WORKSPACE_PREVIEW_MAX_TEXT_BYTES } from '../../shared/workspace-preview-contract.js'
import { listWorkspacePreviewFiles, readWorkspacePreviewFile } from './service.js'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-preview-'))
  roots.push(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'main.ts'), 'export const answer = 42\n')
  await writeFile(path.join(root, 'src', 'data.bin'), Buffer.from([0, 1, 2, 3]))
  await writeFile(path.join(root, 'src', 'photo.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  await writeFile(path.join(root, 'src', 'archive.zip'), 'unsupported')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace preview service', () => {
  it('lists only immediate regular files with relative paths and preview kinds', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'src', 'nested'))
    const result = await listWorkspacePreviewFiles({ workspaceRoot: root, directory: 'src' })
    expect(result).toEqual({
      ok: true,
      value: {
        directory: 'src',
        files: [
          { name: 'archive.zip', path: 'src/archive.zip', size: 11, kind: 'unsupported' },
          { name: 'data.bin', path: 'src/data.bin', size: 4, kind: 'unsupported' },
          { name: 'main.ts', path: 'src/main.ts', size: 25, kind: 'text' },
          { name: 'photo.png', path: 'src/photo.png', size: 8, kind: 'image' },
        ],
      },
    })
  })

  it('reads bounded UTF-8 text and supported images as structured previews', async () => {
    const root = await fixture()
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/main.ts' })).resolves.toEqual({
      ok: true,
      value: { kind: 'text', path: 'src/main.ts', name: 'main.ts', size: 25, language: 'ts', text: 'export const answer = 42\n' },
    })
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/photo.png' })).resolves.toEqual({
      ok: true,
      value: { kind: 'image', path: 'src/photo.png', name: 'photo.png', size: 8, mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    })
  })

  it('rejects traversal, absolute paths, symlinks, and symlinked directories', async () => {
    const root = await fixture()
    const outside = await mkdtemp(path.join(os.tmpdir(), 'dsh-workspace-outside-'))
    roots.push(outside)
    await writeFile(path.join(outside, 'secret.txt'), 'secret')
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'src', 'secret-link.txt'))
    await symlink(outside, path.join(root, 'external'))

    for (const requested of ['../secret.txt', path.join(outside, 'secret.txt'), 'src/../../secret.txt']) {
      const result = await readWorkspacePreviewFile({ workspaceRoot: root, path: requested })
      expect(result).toMatchObject({ ok: false, error: { code: 'outside-workspace' } })
    }
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/secret-link.txt' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'symlink-not-allowed' } })
    await expect(listWorkspacePreviewFiles({ workspaceRoot: root, directory: 'external' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'symlink-not-allowed' } })
  })

  it('rejects unsupported, binary, oversized, missing, and non-file targets', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'src', 'binary.txt'), Buffer.from([0, 1, 2, 3]))
    await writeFile(path.join(root, 'src', 'large.md'), Buffer.alloc(WORKSPACE_PREVIEW_MAX_TEXT_BYTES + 1, 65))

    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/archive.zip' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'unsupported-file' } })
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/binary.txt' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'binary-file' } })
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/large.md' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'file-too-large' } })
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'missing.md' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'file-not-found' } })
    await expect(readWorkspacePreviewFile({ workspaceRoot: root, path: 'src' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'not-a-file' } })
  })

  it('fails closed if the validated file is swapped before the read', async () => {
    const root = await fixture()
    const target = path.join(root, 'src', 'main.ts')
    const replacement = path.join(root, 'src', 'replacement.ts')
    await writeFile(replacement, 'replacement\n')
    const original = await readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/main.ts' })
    expect(original).toMatchObject({ ok: true })

    // Exercise the same attack shape repeatedly; the service must never return
    // content from a different filesystem object after path validation.
    for (let i = 0; i < 20; i += 1) {
      await rename(target, `${target}.old`)
      await symlink(replacement, target)
      const result = await readWorkspacePreviewFile({ workspaceRoot: root, path: 'src/main.ts' })
      expect(result.ok).toBe(false)
      await rm(target, { force: true })
      await rename(`${target}.old`, target)
    }
  })
  it('requires an existing absolute workspace directory', async () => {
    await expect(listWorkspacePreviewFiles({ workspaceRoot: 'relative', directory: '' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    await expect(listWorkspacePreviewFiles({ workspaceRoot: path.join(os.tmpdir(), 'missing-workspace'), directory: '' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
  })
})
