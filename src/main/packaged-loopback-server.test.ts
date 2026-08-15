import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { extractPackagedBootGraph, startPackagedLoopbackServer, DEFAULT_PACKAGED_PORT, type PackagedLoopbackServer } from './packaged-loopback-server.js'

const active: Array<{ close(): Promise<void> | void }> = []

let activeCapabilityCookie = ''
let activeBootstrapLocation = ''
let activeBootstrapReferrerPolicy = ''

afterEach(async () => {
  activeCapabilityCookie = ''
  activeBootstrapLocation = ''
  activeBootstrapReferrerPolicy = ''
  await Promise.all(active.splice(0).reverse().map((item) => item.close()))
})

async function rendererFixture(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-renderer-'))
  await fs.mkdir(path.join(directory, 'assets'))
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><main>desktop index</main>')
  await fs.writeFile(path.join(directory, 'assets', 'app.js'), 'console.log("desktop")')
  active.push({ close: () => fs.rm(directory, { recursive: true, force: true }) })
  return directory
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  active.push({ close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind')
  return `http://127.0.0.1:${address.port}`
}

async function start(rendererDir: string, upstreamOrigin: string): Promise<PackagedLoopbackServer> {
  const server = await startPackagedLoopbackServer({ rendererDir, upstreamOrigin })
  active.push(server)
  const bootstrap = await fetch(server.url, { redirect: 'manual' })
  activeCapabilityCookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  activeBootstrapLocation = bootstrap.headers.get('location') ?? ''
  activeBootstrapReferrerPolicy = bootstrap.headers.get('referrer-policy') ?? ''
  expect(bootstrap.status).toBe(302)
  expect(activeCapabilityCookie).toContain('dsh_loopback_cap=')
  return server
}

function privilegedHeaders(server: PackagedLoopbackServer): Record<string, string> {
  return { cookie: activeCapabilityCookie, origin: server.origin, 'sec-fetch-site': 'same-origin' }
}

describe('packaged loopback static server', () => {
  it('serves assets with MIME types and falls back to the SPA index', async () => {
    const upstream = await listen(createServer((_request, response) => response.end('unused')))
    const server = await start(await rendererFixture(), upstream)

    const asset = await fetch(`${server.origin}/assets/app.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(await asset.text()).toContain('desktop')

    const route = await fetch(`${server.origin}/conversation/session-1`)
    expect(route.status).toBe(200)
    expect(route.headers.get('content-type')).toContain('text/html')
    expect(route.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(route.headers.get('content-security-policy')).toContain("object-src 'none'")
    expect(route.headers.get('x-content-type-options')).toBe('nosniff')
    expect(route.headers.get('referrer-policy')).toBe('no-referrer')
    expect(route.headers.get('x-frame-options')).toBe('DENY')
    expect(await route.text()).toContain('desktop index')

    const missingAsset = await fetch(`${server.origin}/assets/missing.js`)
    expect(missingAsset.status).toBe(404)
  })

  it('rejects encoded traversal instead of escaping rendererDir', async () => {
    const upstream = await listen(createServer((_request, response) => response.end('unused')))
    const server = await start(await rendererFixture(), upstream)
    const response = await new Promise<Response>((resolve, reject) => {
      const request = http.get(`${server.origin}/..%5c..%5cetc%5cpasswd`, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk) => chunks.push(chunk))
        incoming.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode })))
      })
      request.on('error', reject)
    })
    expect([400, 403]).toContain(response.status)
    expect(await response.text()).not.toContain('root:')
  })
})

describe('packaged loopback DSH forwarding', () => {
  it('forwards API method, body, query and trusted Host/Origin headers', async () => {
    let received: unknown
    const upstream = await listen(createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        received = {
          method: request.method,
          url: request.url,
          host: request.headers.host,
          origin: request.headers.origin,
          body: Buffer.concat(chunks).toString(),
        }
        response.statusCode = 201
        response.setHeader('content-type', 'application/json')
        response.end('{"forwarded":true}')
      })
    }))
    const server = await start(await rendererFixture(), upstream)
    const response = await fetch(`${server.origin}/api/session.list?x=1`, {
      method: 'POST',
      headers: { ...privilegedHeaders(server), 'content-type': 'application/json' },
      body: '{"hello":"world"}',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ forwarded: true })
    expect(received).toEqual({
      method: 'POST',
      url: '/api/session.list?x=1',
      host: new URL(upstream).host,
      origin: upstream,
      body: '{"hello":"world"}',
    })
  })

  it('rejects cross-origin and unauthenticated privileged HTTP before proxying', async () => {
    let upstreamRequests = 0
    const upstream = await listen(createServer((_request, response) => {
      upstreamRequests += 1
      response.end('should not proxy')
    }))
    const server = await start(await rendererFixture(), upstream)
    const missing = await fetch(`${server.origin}/api/private`)
    expect(missing.status).toBe(403)
    const forged = await fetch(`${server.origin}/api/private`, { headers: { origin: server.origin, 'sec-fetch-site': 'same-origin', cookie: 'dsh_loopback_cap=forged' } })
    expect(forged.status).toBe(403)
    const crossOrigin = await fetch(`${server.origin}/api/private`, { headers: { ...privilegedHeaders(server), origin: 'http://evil.invalid' } })
    expect(crossOrigin.status).toBe(403)
    const crossSiteMetadata = await fetch(`${server.origin}/api/private`, { headers: { ...privilegedHeaders(server), 'sec-fetch-site': 'cross-site' } })
    expect(crossSiteMetadata.status).toBe(403)
    expect(upstreamRequests).toBe(0)
  })
  it('does not leak the bootstrap capability through redirects, referrers, or upstream headers', async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {}
    const upstream = await listen(createServer((request, response) => {
      receivedHeaders = request.headers
      response.statusCode = 200
      response.end('ok')
    }))
    const server = await start(await rendererFixture(), upstream)
    expect(activeBootstrapLocation).toBe('/')
    expect(activeBootstrapReferrerPolicy).toBe('no-referrer')
    expect(activeBootstrapLocation).not.toContain('__dsh_cap')
    const response = await fetch(`${server.origin}/api/private`, {
      headers: { ...privilegedHeaders(server), referer: server.url },
    })
    expect(response.status).toBe(200)
    expect(receivedHeaders.referer).toBeUndefined()
    expect(JSON.stringify(receivedHeaders)).not.toContain('__dsh_cap')
  })

  it('uses deterministic fallback ports and documents origin persistence tradeoff', async () => {
    const blocker = createServer((_request, response) => response.end('occupied'))
    await new Promise<void>((resolve) => blocker.listen(DEFAULT_PACKAGED_PORT, '127.0.0.1', resolve))
    active.push({ close: () => new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve())) })
    const upstream = await listen(createServer((_request, response) => response.end('unused')))
    const server = await start(await rendererFixture(), upstream)
    expect(server.address.port).toBeGreaterThan(DEFAULT_PACKAGED_PORT)
    expect(server.address.port).toBeLessThanOrEqual(DEFAULT_PACKAGED_PORT + 4)
    expect(server.origin).toContain(`:${server.address.port}`)
  })
  it('extracts and returns the upstream boot graph as non-cacheable JSON', async () => {
    const graph = { rev: 'abc', entries: [{ id: 'plugin', url: '/plugins/plugin/client.js', rev: '1', note: 'brace } in string' }] }
    const upstream = await listen(createServer((request, response) => {
      expect(request.headers.host).toBe(new URL(upstream).host)
      expect(request.headers.origin).toBe(upstream)
      response.setHeader('content-type', 'text/html')
      response.end(`<script>window.__DSH_BOOT__ = ${JSON.stringify(graph)}</script>`)
    }))
    const server = await start(await rendererFixture(), upstream)
    const response = await fetch(`${server.origin}/dsh-runtime/boot-manifest`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(graph)
  })

  it('rejects cross-origin and unauthenticated WebSocket upgrades', async () => {
    const upstreamServer = createServer()
    let upgrades = 0
    upstreamServer.on('upgrade', (_request, socket) => { upgrades += 1; socket.destroy() })
    const upstream = await listen(upstreamServer)
    const server = await start(await rendererFixture(), upstream)

    const rejected = async (headers: Record<string, string>) => await new Promise<number>((resolve) => {
      const socket = new WebSocket(server.origin.replace('http:', 'ws:') + '/api/events.mux', { headers })
      socket.once('unexpected-response', (_request, response) => { resolve(response.statusCode ?? 0); socket.terminate() })
      socket.once('error', () => resolve(0))
    })
    expect(await rejected({ origin: server.origin, 'sec-fetch-site': 'same-origin' })).toBe(403)
    expect(await rejected({ ...privilegedHeaders(server), origin: 'http://evil.invalid' })).toBe(403)
    expect(await rejected({ ...privilegedHeaders(server), origin: '' })).toBe(403)
    expect(upgrades).toBe(0)
  })

  it('allows only same-origin capable WebSocket proxying and rewrites trusted upstream headers', async () => {
    let seenHeaders: { host?: string; origin?: string } = {}
    const upstreamServer = createServer()
    const upstreamWs = new WebSocketServer({ noServer: true })
    upstreamServer.on('upgrade', (request, socket, head) => {
      seenHeaders = { host: request.headers.host, origin: request.headers.origin }
      upstreamWs.handleUpgrade(request, socket, head, (client) => {
        client.on('message', (data) => client.send(`echo:${data.toString()}`))
      })
    })
    const upstream = await listen(upstreamServer)
    active.push({ close: () => new Promise<void>((resolve) => upstreamWs.close(() => resolve())) })
    const server = await start(await rendererFixture(), upstream)

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(server.origin.replace('http:', 'ws:') + '/api/events.mux', {
      headers: { ...privilegedHeaders(server) },
      })
      socket.once('open', () => socket.send('hello'))
      socket.once('message', (data) => { resolve(data.toString()); socket.close() })
      socket.once('error', reject)
    })
    expect(message).toBe('echo:hello')
    expect(seenHeaders).toEqual({ host: new URL(upstream).host, origin: upstream })
  })
})

describe('extractPackagedBootGraph', () => {
  it('rejects pages without a boot graph', () => {
    expect(() => extractPackagedBootGraph('<html></html>')).toThrow('does not contain')
  })
})
