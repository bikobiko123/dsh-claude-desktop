import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactName, checksumForArtifact, GitHubUpdateService, isSemanticallyNewer } from './service.js'

const created: string[] = []
afterEach(() => { vi.restoreAllMocks() })

function asset(id: number, name: string, size: number) {
  return { name, size, url: `https://api.github.com/repos/bikobiko123/dsh-claude-desktop/releases/assets/${id}` }
}

function response(body: string | Uint8Array, contentType = 'application/octet-stream'): Response {
  const responseBody: string | ArrayBuffer = typeof body === 'string' ? body : Uint8Array.from(body).buffer
  return new Response(responseBody, { status: 200, headers: { 'content-type': contentType, 'content-length': String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength) } })
}

describe('update helpers', () => {
  it('compares stable semantic versions numerically', () => {
    expect(isSemanticallyNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isSemanticallyNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isSemanticallyNewer('0.9.9', '1.0.0')).toBe(false)
    expect(isSemanticallyNewer('01.0.0', '1.0.0')).toBe(false)
  })

  it('maps only exact supported mac architectures', () => {
    expect(artifactName('1.2.3', 'arm64')).toBe('DSH-Desktop-1.2.3-mac-arm64.zip')
    expect(artifactName('1.2.3', 'x64')).toBe('DSH-Desktop-1.2.3-mac-x64.zip')
    expect(() => artifactName('1.2.3', 'ia32')).toThrow(/not supported/)
  })

  it('selects an exact checksum record', () => {
    expect(checksumForArtifact(`${'a'.repeat(64)}  app.zip\n`, 'app.zip')).toBe('a'.repeat(64))
    expect(checksumForArtifact(`${'a'.repeat(64)}  other.zip\n`, 'app.zip')).toBeUndefined()
  })
})

describe('GitHubUpdateService', () => {
  it('checks the fixed repository and selects the exact architecture asset', async () => {
    const artifact = artifactName('0.2.0', 'arm64')
    const bytes = Buffer.from('verified update')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(JSON.stringify({ draft: false, prerelease: false, tag_name: 'v0.2.0', assets: [asset(1, artifact, bytes.length), asset(2, 'SHA256SUMS.txt', 80)] }), 'application/json'))
      .mockResolvedValueOnce(response(`${digest}  ${artifact}\n`))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-test-')); created.push(directory)
    const service = new GitHubUpdateService({ currentVersion: '0.1.0', platform: 'darwin', arch: 'arm64', updatesDirectory: directory, fetchImpl })
    await expect(service.check()).resolves.toMatchObject({ status: 'available', version: '0.2.0', fileName: artifact })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/bikobiko123/dsh-claude-desktop/releases/latest')
  })

  it('streams, verifies, and atomically publishes a selected artifact', async () => {
    const artifact = artifactName('0.2.0', 'x64')
    const bytes = Buffer.from('verified update bytes')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(JSON.stringify({ draft: false, prerelease: false, tag_name: '0.2.0', assets: [asset(1, artifact, bytes.length), asset(2, 'SHA256SUMS.txt', 100)] }), 'application/json'))
      .mockResolvedValueOnce(response(`${digest}  ${artifact}\n`))
      .mockResolvedValueOnce(response(bytes))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-test-')); created.push(directory)
    const states: string[] = []
    const service = new GitHubUpdateService({ currentVersion: '0.1.0', platform: 'darwin', arch: 'x64', updatesDirectory: directory, fetchImpl, onStateChanged: (state) => states.push(state.status) })
    await service.check()
    await expect(service.download()).resolves.toMatchObject({ status: 'downloaded', version: '0.2.0' })
    await expect(readFile(path.join(directory, artifact))).resolves.toEqual(bytes)
    expect(states).toContain('downloading')
  })

  it('deletes a corrupt download and reports an error', async () => {
    const artifact = artifactName('0.2.0', 'arm64')
    const bytes = Buffer.from('corrupt')
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(JSON.stringify({ draft: false, prerelease: false, tag_name: '0.2.0', assets: [asset(1, artifact, bytes.length), asset(2, 'SHA256SUMS.txt', 100)] }), 'application/json'))
      .mockResolvedValueOnce(response(`${'0'.repeat(64)}  ${artifact}\n`))
      .mockResolvedValueOnce(response(bytes))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-test-')); created.push(directory)
    const service = new GitHubUpdateService({ currentVersion: '0.1.0', platform: 'darwin', arch: 'arm64', updatesDirectory: directory, fetchImpl })
    await service.check()
    await expect(service.download()).resolves.toMatchObject({ status: 'error', operation: 'download', message: expect.stringMatching(/SHA-256/) })
    await expect(readFile(path.join(directory, `${artifact}.partial`))).rejects.toThrow()
  })

  it('rejects unsupported platforms before any asset download', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new GitHubUpdateService({ currentVersion: '0.1.0', platform: 'win32', arch: 'x64', updatesDirectory: '/unused', fetchImpl })
    await expect(service.check()).resolves.toMatchObject({ status: 'error', operation: 'check' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
