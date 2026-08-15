import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'

export const DEFAULT_DSH_DEV_ORIGIN = 'http://127.0.0.1:3080'
export const DSH_BOOT_GRAPH_PATH = '/dsh-runtime/boot-manifest'

export function normalizeDshDevOrigin(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_DSH_DEV_ORIGIN
  const url = new URL(candidate)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`DSH_DEV_ORIGIN must use http or https, received ${url.protocol}`)
  }
  if (url.username || url.password) throw new TypeError('DSH_DEV_ORIGIN must not contain credentials')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('DSH_DEV_ORIGIN must be an origin without a path, query, or fragment')
  }
  return url.origin
}

/** Extract the JSON object assigned to window.__DSH_BOOT__ without executing host HTML. */
export function extractDshBootGraph(html: string): unknown {
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

export interface DshBootGraphHandlerOptions {
  origin: string
  fetch?: typeof globalThis.fetch
}

export interface DshBootGraphResponse {
  statusCode: number
  setHeader(name: string, value: string | number | readonly string[]): unknown
  end(body?: string): unknown
}

export function createDshBootGraphHandler(options: DshBootGraphHandlerOptions) {
  const origin = normalizeDshDevOrigin(options.origin)
  const fetchImpl = options.fetch ?? globalThis.fetch

  return async function dshBootGraphHandler(
    request: Pick<IncomingMessage, 'method'>,
    response: DshBootGraphResponse,
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405
      response.setHeader('allow', 'GET, HEAD')
      response.end()
      return
    }

    try {
      const hostResponse = await fetchImpl(`${origin}/`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!hostResponse.ok) throw new Error(`DSH host returned HTTP ${hostResponse.status}`)
      const graph = extractDshBootGraph(await hostResponse.text())
      const body = JSON.stringify(graph)
      response.statusCode = 200
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.setHeader('content-length', String(Buffer.byteLength(body)))
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const body = JSON.stringify({ error: 'dsh_boot_graph_unavailable', message })
      response.statusCode = 502
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(body)
    }
  }
}

export function dshDevelopmentProxyPlugin(originValue: string | undefined): Plugin {
  const origin = normalizeDshDevOrigin(originValue)
  const handler = createDshBootGraphHandler({ origin })

  return {
    name: 'dsh-development-boot-graph',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://dsh.desktop.local').pathname
        if (pathname !== DSH_BOOT_GRAPH_PATH) return next()
        await handler(request, response)
      })
    },
  }
}
