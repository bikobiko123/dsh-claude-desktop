import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import WebSocket, { WebSocketServer } from 'ws'

const BOOT_MANIFEST_PATH = '/dsh-runtime/boot-manifest'
const CAPABILITY_QUERY = '__dsh_cap'
const CAPABILITY_COOKIE = 'dsh_loopback_cap'
const SENSITIVE_REQUEST_HEADERS = new Set(['cookie', 'referer', 'referrer', 'x-dsh-capability'])/** Reserved application origin port. Chromium localStorage is keyed by origin. */
export const DEFAULT_PACKAGED_PORT = 32123
const PACKAGED_PORT_FALLBACKS = [DEFAULT_PACKAGED_PORT + 1, DEFAULT_PACKAGED_PORT + 2, DEFAULT_PACKAGED_PORT + 3, DEFAULT_PACKAGED_PORT + 4] as const
const PRIVILEGED_PATH_PREFIXES = ['/api/', '/plugins/'] as const
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export interface PackagedLoopbackServerOptions {
  rendererDir: string
  upstreamOrigin: string | URL
  host?: string
  port?: number
  fetch?: typeof globalThis.fetch
}

export interface PackagedLoopbackServer {
  readonly origin: string
  /** One-run bootstrap URL. Loading it installs an HttpOnly capability cookie then redirects. */
  readonly url: string
  readonly address: { host: string; port: number }
  close(): Promise<void>
}

function normalizeUpstreamOrigin(value: string | URL): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`DSH upstream must use http or https, received ${url.protocol}`)
  }
  if (url.username || url.password) throw new TypeError('DSH upstream must not contain credentials')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('DSH upstream must be an origin without a path, query, or fragment')
  }
  return url
}

/** Extract the JSON assigned to window.__DSH_BOOT__ without executing host HTML. */
export function extractPackagedBootGraph(html: string): unknown {
  const marker = 'window.__DSH_BOOT__'
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) throw new Error('DSH host page does not contain window.__DSH_BOOT__')
  const assignmentIndex = html.indexOf('=', markerIndex + marker.length)
  if (assignmentIndex < 0) throw new Error('DSH boot graph assignment is malformed')
  let start = assignmentIndex + 1
  while (/\s/.test(html[start] ?? '')) start += 1
  if (html[start] !== '{') throw new Error('DSH boot graph must be a JSON object')

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(html.slice(start, index + 1))
    }
  }
  throw new Error('DSH boot graph JSON object is unterminated')
}

function requestPath(request: IncomingMessage): string {
  return request.url ?? '/'
}

function requestPathname(request: IncomingMessage): string {
  return new URL(requestPath(request), 'http://dsh.desktop.local').pathname
}

function parseCookie(request: IncomingMessage, name: string): string | undefined {
  for (const entry of (request.headers.cookie ?? '').split(';')) {
    const separator = entry.indexOf('=')
    if (separator < 0) continue
    const key = entry.slice(0, separator).trim()
    if (key === name) return decodeURIComponent(entry.slice(separator + 1).trim())
  }
  return undefined
}

function capabilityMatches(request: IncomingMessage, capability: string): boolean {
  const supplied = parseCookie(request, CAPABILITY_COOKIE) ?? request.headers['x-dsh-capability']
  if (typeof supplied !== 'string') return false
  const expected = Buffer.from(capability)
  const actual = Buffer.from(supplied)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function reject(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('referrer-policy', 'no-referrer')
  response.end(JSON.stringify({ error: message }))
}

function validatePrivilegedRequest(request: IncomingMessage, expectedOrigin: string, expectedHost: string, capability: string, requireOrigin = false, requireFetchMetadata = true): boolean {
  if (request.headers.host !== expectedHost) return false
  const origin = request.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return false
  if (requireOrigin && origin !== expectedOrigin) return false
  const fetchSite = request.headers['sec-fetch-site']
  if (requireFetchMetadata && fetchSite !== 'same-origin') return false
  if ((request.method !== 'GET' && request.method !== 'HEAD' && origin !== expectedOrigin) || !capabilityMatches(request, capability)) return false
  return true
}

function setCapabilityCookie(response: ServerResponse, capability: string): void {
  response.setHeader('set-cookie', `${CAPABILITY_COOKIE}=${encodeURIComponent(capability)}; Path=/; HttpOnly; SameSite=Strict`)
}

function copyRequestHeaders(request: IncomingMessage, upstream: URL): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name) && !SENSITIVE_REQUEST_HEADERS.has(name) && value !== undefined) headers[name] = value
  }
  headers.host = upstream.host
  headers.origin = upstream.origin
  return headers
}

function copyResponseHeaders(source: http.IncomingHttpHeaders, response: ServerResponse): void {
  for (const [name, value] of Object.entries(source)) {
    if (!HOP_BY_HOP_HEADERS.has(name) && value !== undefined) response.setHeader(name, value)
  }
}

async function proxyHttp(request: IncomingMessage, response: ServerResponse, upstream: URL): Promise<void> {
  const target = new URL(requestPath(request), upstream)
  const transport = target.protocol === 'https:' ? https : http
  await new Promise<void>((resolve) => {
    const proxy = transport.request(target, {
      method: request.method,
      headers: copyRequestHeaders(request, upstream),
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502
      if (upstreamResponse.statusMessage) response.statusMessage = upstreamResponse.statusMessage
      copyResponseHeaders(upstreamResponse.headers, response)
      upstreamResponse.on('error', () => response.destroy())
      upstreamResponse.pipe(response)
      upstreamResponse.on('end', resolve)
    })
    proxy.on('error', (error) => {
      if (!response.headersSent) {
        response.statusCode = 502
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ error: 'dsh_upstream_unavailable', message: error.message }))
      } else response.destroy(error)
      resolve()
    })
    request.pipe(proxy)
  })
}

async function serveBootManifest(
  request: IncomingMessage,
  response: ServerResponse,
  upstream: URL,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('allow', 'GET, HEAD')
    response.end()
    return
  }
  try {
    const upstreamResponse = await fetchImpl(new URL('/', upstream), {
      headers: { accept: 'text/html', host: upstream.host, origin: upstream.origin },
      signal: AbortSignal.timeout(10_000),
    })
    if (!upstreamResponse.ok) throw new Error(`DSH host returned HTTP ${upstreamResponse.status}`)
    const body = JSON.stringify(extractPackagedBootGraph(await upstreamResponse.text()))
    response.statusCode = 200
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-length', Buffer.byteLength(body))
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    response.statusCode = 502
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(JSON.stringify({ error: 'dsh_boot_graph_unavailable', message }))
  }
}

function decodedStaticPath(request: IncomingMessage): string | null {
  const rawPath = requestPath(request).split('?', 1)[0] ?? '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const segments = decoded.split('/')
  if (segments.some((segment) => segment === '..')) return null
  return decoded
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, rendererDir: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('allow', 'GET, HEAD')
    response.end()
    return
  }
  const decoded = decodedStaticPath(request)
  if (decoded === null) {
    response.statusCode = 400
    response.end('Bad request')
    return
  }

  const root = path.resolve(rendererDir)
  const relative = decoded.replace(/^\/+/, '')
  let filePath = path.resolve(root, relative || 'index.html')
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.statusCode = 403
    response.end('Forbidden')
    return
  }

  if (!(await existingFile(filePath))) {
    if (path.extname(relative) !== '') {
      response.statusCode = 404
      response.end('Not found')
      return
    }
    filePath = path.join(root, 'index.html')
  }
  if (!(await existingFile(filePath))) {
    response.statusCode = 404
    response.end('Not found')
    return
  }

  const stat = await fs.stat(filePath)
  response.statusCode = 200
  response.setHeader('content-type', MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
  response.setHeader('content-length', stat.size)
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-frame-options', 'DENY')
  if (path.basename(filePath) === 'index.html') {
    response.setHeader('content-security-policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:")
  }
  response.setHeader('cache-control', path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
  if (request.method === 'HEAD') response.end()
  else await pipeline(createReadStream(filePath), response)
}

function bridgeWebSockets(client: WebSocket, upstreamSocket: WebSocket): void {
  const close = (socket: WebSocket, code: number, reason: Buffer) => {
    if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) return
    if (code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006 && code !== 1015) socket.close(code, reason)
    else socket.close()
  }
  client.on('message', (data, binary) => {
    if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary })
  })
  upstreamSocket.on('message', (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
  })
  client.on('close', (code, reason) => close(upstreamSocket, code, reason))
  upstreamSocket.on('close', (code, reason) => close(client, code, reason))
  client.on('error', () => upstreamSocket.terminate())
  upstreamSocket.on('error', () => client.terminate())
}

function loopbackOrigin(host: string, port: number): string {
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${formattedHost}:${port}`
}

function serverAddressHost(server: Server, configuredHost: string): { origin: string; host: string; port: number } {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Packaged loopback server did not bind a TCP address')
  const origin = loopbackOrigin(configuredHost, address.port)
  return { origin, host: new URL(origin).host, port: address.port }
}

async function listenOnPort(server: Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function attachWebSocketProxy(server: Server, upstream: URL, applicationOrigin: string, expectedHost: string, capability: string): WebSocketServer {
  const websocketServer = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const pathname = requestPathname(request)
    if (!pathname.startsWith('/api/') || !validatePrivilegedRequest(request, applicationOrigin, expectedHost, capability, true, false)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      const target = new URL(requestPath(request), upstream)
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
      const upstreamSocket = new WebSocket(target, {
        headers: { host: upstream.host, origin: upstream.origin },
      })
      const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = []
      const queuePending = (data: WebSocket.RawData, binary: boolean) => {
        if (upstreamSocket.readyState === WebSocket.CONNECTING) pending.push({ data, binary })
      }
      client.on('message', queuePending)
      upstreamSocket.once('open', () => {
        client.off('message', queuePending)
        for (const item of pending) upstreamSocket.send(item.data, { binary: item.binary })
        bridgeWebSockets(client, upstreamSocket)
      })
      upstreamSocket.once('error', () => {
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'DSH upstream unavailable')
      })
    })
  })
  return websocketServer
}

export async function startPackagedLoopbackServer(options: PackagedLoopbackServerOptions): Promise<PackagedLoopbackServer> {
  const rendererDir = path.resolve(options.rendererDir)
  const upstream = normalizeUpstreamOrigin(options.upstreamOrigin)
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const host = options.host ?? '127.0.0.1'
  const capability = randomBytes(32).toString('base64url')
  let applicationOrigin = ''
  let expectedHost = ''
  let bootstrapConsumed = false
  const server = createServer((request, response) => {
    const requestUrl = new URL(requestPath(request), `http://${request.headers.host ?? 'dsh.desktop.local'}`)
    if (requestUrl.pathname === '/' && requestUrl.searchParams.has(CAPABILITY_QUERY)) {
      const supplied = requestUrl.searchParams.get(CAPABILITY_QUERY)
      if (supplied !== capability || bootstrapConsumed) { reject(response, 403, 'dsh_capability_invalid'); return }
      bootstrapConsumed = true
      setCapabilityCookie(response, capability)
      response.statusCode = 302
      response.setHeader('referrer-policy', 'no-referrer')
      requestUrl.searchParams.delete(CAPABILITY_QUERY)
      const redirectLocation = `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`
      response.setHeader('location', redirectLocation || '/')
      response.setHeader('cache-control', 'no-store')
      response.end()
      return
    }
    const pathname = requestUrl.pathname
    void (async () => {
      if (PRIVILEGED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !validatePrivilegedRequest(request, applicationOrigin, expectedHost, capability)) {
        reject(response, 403, 'dsh_origin_or_capability_invalid')
        return
      }
      if (pathname === BOOT_MANIFEST_PATH) await serveBootManifest(request, response, upstream, fetchImpl)
      else if (PRIVILEGED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) await proxyHttp(request, response, upstream)
      else await serveStatic(request, response, rendererDir)
    })().catch((error) => {
      if (!response.headersSent) {
        response.statusCode = 500
        response.end('Internal server error')
      } else response.destroy(error)
    })
  })
  const preferredPort = options.port ?? DEFAULT_PACKAGED_PORT
  const ports = options.port === undefined ? [preferredPort, ...PACKAGED_PORT_FALLBACKS] : [preferredPort]
  let lastError: unknown
  for (const port of ports) {
    try {
      await listenOnPort(server, host, port)
      lastError = undefined
      break
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || options.port !== undefined) throw error
    }
  }
  if (lastError !== undefined) throw lastError
  const bound = serverAddressHost(server, host)
  applicationOrigin = bound.origin
  expectedHost = bound.host
  const websocketServer = attachWebSocketProxy(server, upstream, applicationOrigin, expectedHost, capability)
  let closed = false
  return {
    origin: applicationOrigin,
    url: `${applicationOrigin}/?${CAPABILITY_QUERY}=${encodeURIComponent(capability)}`,
    address: { host: bound.host, port: bound.port },
    async close() {
      if (closed) return
      closed = true
      for (const client of websocketServer.clients) client.terminate()
      websocketServer.close()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}
