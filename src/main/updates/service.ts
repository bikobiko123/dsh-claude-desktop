import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateState } from '../../shared/update-contract.js'

const OWNER = 'bikobiko123'
const REPOSITORY = 'dsh-claude-desktop'
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`
const CHECKSUM_ASSET = 'SHA256SUMS.txt'
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
const CHECK_TIMEOUT_MS = 20_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const ASSET_REDIRECT_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])

interface GitHubAsset { name: string; size: number; url: string }
interface GitHubRelease { draft: boolean; prerelease: boolean; tag_name: string; assets: GitHubAsset[] }
interface SelectedRelease { version: string; asset: GitHubAsset; checksumAsset: GitHubAsset; sha256: string }

export interface UpdateServiceOptions {
  currentVersion: string
  platform: NodeJS.Platform
  arch: string
  updatesDirectory: string
  fetchImpl?: typeof fetch
  onStateChanged?(state: UpdateState): void
}

function parseSemver(value: string): [number, number, number] | undefined {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isSemanticallyNewer(candidate: string, current: string): boolean {
  const a = parseSemver(candidate)
  const b = parseSemver(current)
  if (!a || !b) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

export function artifactName(version: string, arch: string): string {
  if (arch !== 'arm64' && arch !== 'x64') throw new Error('This macOS architecture is not supported by published updates.')
  return `DSH-Desktop-${version}-mac-${arch}.zip`
}

export function checksumForArtifact(manifest: string, fileName: string): string | undefined {
  const matches: string[] = []
  for (const line of manifest.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+[*]?(.+)$/.exec(line.trim())
    if (match?.[2] === fileName) matches.push(match[1].toLowerCase())
  }
  return matches.length === 1 ? matches[0] : undefined
}

function normalizeVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

function validateRelease(value: unknown): GitHubRelease {
  if (!value || typeof value !== 'object') throw new Error('GitHub returned an invalid release response.')
  const release = value as Partial<GitHubRelease>
  if (typeof release.tag_name !== 'string' || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean' || !Array.isArray(release.assets)) {
    throw new Error('GitHub returned an invalid release response.')
  }
  const assets = release.assets.map((asset): GitHubAsset => {
    if (!asset || typeof asset !== 'object') throw new Error('GitHub returned invalid release asset metadata.')
    const candidate = asset as Partial<GitHubAsset>
    if (typeof candidate.name !== 'string' || typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size < 0 || typeof candidate.url !== 'string') {
      throw new Error('GitHub returned invalid release asset metadata.')
    }
    const url = new URL(candidate.url)
    if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || !url.pathname.startsWith(`/repos/${OWNER}/${REPOSITORY}/releases/assets/`)) {
      throw new Error('GitHub returned an unexpected release asset URL.')
    }
    return { name: candidate.name, size: candidate.size, url: url.toString() }
  })
  return { draft: release.draft, prerelease: release.prerelease, tag_name: release.tag_name, assets }
}

function requestHeaders(accept: string): HeadersInit {
  return { Accept: accept, 'User-Agent': `${REPOSITORY}-updater`, 'X-GitHub-Api-Version': '2022-11-28' }
}

async function checkedFetch(fetchImpl: typeof fetch, url: string, accept: string, timeoutMs: number, allowedHosts: ReadonlySet<string>): Promise<Response> {
  const response = await fetchImpl(url, { headers: requestHeaders(accept), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`)
  const finalUrl = new URL(response.url || url)
  if (finalUrl.protocol !== 'https:' || !allowedHosts.has(finalUrl.hostname)) throw new Error('GitHub redirected the request to an unexpected host.')
  return response
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, maxBytes)) as unknown
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('The checksum manifest is too large.')
  if (!response.body) throw new Error('The checksum manifest response was empty.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of Readable.fromWeb(response.body as never)) {
    const data = chunk as Buffer
    bytes += data.byteLength
    if (bytes > maxBytes) throw new Error('The checksum manifest is too large.')
    chunks.push(data)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'The GitHub request timed out.'
  return error instanceof Error ? error.message : 'The update operation failed.'
}

export class GitHubUpdateService {
  private state: UpdateState = { status: 'idle' }
  private selected?: SelectedRelease
  private downloadedPath?: string
  private operation?: Promise<UpdateState>
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  getState(): UpdateState { return this.state }
  getDownloadedPath(): string | undefined { return this.downloadedPath }

  private setState(state: UpdateState): UpdateState {
    this.state = state
    this.options.onStateChanged?.(state)
    return state
  }

  async check(): Promise<UpdateState> {
    if (this.operation) return this.operation
    this.operation = this.performCheck().finally(() => { this.operation = undefined })
    return this.operation
  }

  private async performCheck(): Promise<UpdateState> {
    this.selected = undefined
    this.downloadedPath = undefined
    this.setState({ status: 'checking' })
    try {
      if (this.options.platform !== 'darwin') throw new Error('Public updates are currently available for macOS only.')
      const response = await checkedFetch(this.fetchImpl, RELEASE_API, 'application/vnd.github+json', CHECK_TIMEOUT_MS, new Set(['api.github.com']))
      const release = validateRelease(await readBoundedJson(response, MAX_METADATA_BYTES))
      const version = normalizeVersion(release.tag_name)
      if (release.draft || release.prerelease || !parseSemver(version)) throw new Error('The latest GitHub release is not a stable semantic version.')
      if (!isSemanticallyNewer(version, this.options.currentVersion)) return this.setState({ status: 'up-to-date', currentVersion: this.options.currentVersion })
      const fileName = artifactName(version, this.options.arch)
      const matchingAssets = release.assets.filter((item) => item.name === fileName)
      const matchingChecksums = release.assets.filter((item) => item.name === CHECKSUM_ASSET)
      if (matchingAssets.length !== 1 || matchingChecksums.length !== 1) throw new Error('The release does not contain exactly one macOS artifact and checksum manifest required for this computer.')
      const asset = matchingAssets[0]
      const checksumAsset = matchingChecksums[0]
      if (asset.size <= 0 || asset.size > MAX_ARTIFACT_BYTES) throw new Error('The release artifact size is outside the allowed range.')
      if (checksumAsset.size <= 0 || checksumAsset.size > MAX_MANIFEST_BYTES) throw new Error('The checksum manifest size is outside the allowed range.')
      const manifestResponse = await checkedFetch(this.fetchImpl, checksumAsset.url, 'application/octet-stream', CHECK_TIMEOUT_MS, ASSET_REDIRECT_HOSTS)
      const sha256 = checksumForArtifact(await readBoundedText(manifestResponse, MAX_MANIFEST_BYTES), fileName)
      if (!sha256) throw new Error('The checksum manifest does not contain the selected artifact.')
      this.selected = { version, asset, checksumAsset, sha256 }
      return this.setState({ status: 'available', currentVersion: this.options.currentVersion, version, fileName, size: asset.size })
    } catch (error) {
      return this.setState({ status: 'error', operation: 'check', message: safeMessage(error) })
    }
  }

  async download(): Promise<UpdateState> {
    if (this.operation) return this.operation
    this.operation = this.performDownload().finally(() => { this.operation = undefined })
    return this.operation
  }

  private async performDownload(): Promise<UpdateState> {
    const selected = this.selected
    if (!selected) return this.setState({ status: 'error', operation: 'download', message: 'Check for an available update before downloading.' })
    const { asset, version, sha256 } = selected
    const finalPath = path.join(this.options.updatesDirectory, asset.name)
    const temporaryPath = path.join(this.options.updatesDirectory, `.${asset.name}.${randomUUID()}.partial`)
    try {
      await mkdir(this.options.updatesDirectory, { recursive: true, mode: 0o700 })
      const response = await checkedFetch(this.fetchImpl, asset.url, 'application/octet-stream', DOWNLOAD_TIMEOUT_MS, ASSET_REDIRECT_HOSTS)
      if (!response.body) throw new Error('The release artifact response was empty.')
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_ARTIFACT_BYTES) throw new Error('The release artifact is too large.')
      if (Number.isFinite(declared) && declared !== asset.size) throw new Error('The downloaded artifact size does not match GitHub metadata.')
      const hash = createHash('sha256')
      let received = 0
      const meter = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          received += chunk.byteLength
          if (received > MAX_ARTIFACT_BYTES || received > asset.size) return callback(new Error('The downloaded artifact exceeded its expected size.'))
          hash.update(chunk)
          this.setState({ status: 'downloading', version, fileName: asset.name, received, total: asset.size, percent: Math.min(100, Math.round(received * 100 / asset.size)) })
          callback(null, chunk)
        },
      })
      this.setState({ status: 'downloading', version, fileName: asset.name, received: 0, total: asset.size, percent: 0 })
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }))
      if (received !== asset.size) throw new Error('The downloaded artifact is incomplete.')
      const actual = Buffer.from(hash.digest('hex'), 'hex')
      const expected = Buffer.from(sha256, 'hex')
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) throw new Error('SHA-256 verification failed. The downloaded file was deleted.')
      await rename(temporaryPath, finalPath)
      this.downloadedPath = finalPath
      return this.setState({ status: 'downloaded', version, fileName: asset.name, size: received })
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      return this.setState({ status: 'error', operation: 'download', message: safeMessage(error) })
    }
  }
}
