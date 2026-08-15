#!/usr/bin/env node
import http from 'node:http'
import { WebSocketServer } from 'ws'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('0.1.0-rc.6\n')
  process.exit(0)
}
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : fallback
}
const host = valueAfter('--host', '127.0.0.1')
const port = Number(valueAfter('--port', '0'))
const promptLog = []
let baselineVersion = 1
let messages = [
  { id: 'fixture-user-1', role: 'user', content: 'Fixture hello', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'fixture-assistant-1', role: 'assistant', content: 'Fixture response', createdAt: '2026-01-01T00:00:01.000Z' },
]

const snapshot = () => ({
  availability: 'ready',
  connectionStatus: 'connected',
  workspaces: [{ id: 'fixture-workspace', name: 'Fixture Workspace', path: '/fixture/workspace' }],
  sessions: [{ id: 'fixture-session', title: 'Fixture Session', updatedAt: '2026-01-01T00:00:01.000Z', running: false, workspaceId: 'fixture-workspace' }],
  selectedWorkspaceId: 'fixture-workspace',
  selectedSessionId: 'fixture-session',
  conversation: {
    sessionId: 'fixture-session',
    title: 'Fixture Session',
    messages,
    interactions: [],
    running: false,
  },
  message: `Fixture baseline ${baselineVersion}`,
  baselineVersion,
})

const json = (response, status, body) => {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  if (url.pathname === '/') {
    const graph = { rev: 'fixture-rev', entries: [] }
    const html = `<!doctype html><html><head><script>window.__DSH_BOOT__ = ${JSON.stringify(graph)}</script></head><body><div id="official-ui-must-not-load">fixture host only</div></body></html>`
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
    return
  }
  if (url.pathname === '/api/test.snapshot') return json(response, 200, snapshot())
  if (url.pathname === '/api/test.prompts') return json(response, 200, { items: promptLog })
  if (url.pathname === '/api/test.prompt' && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    promptLog.push(input)
    messages = [...messages,
      { id: `fixture-user-${messages.length + 1}`, role: 'user', content: input.content, createdAt: '2026-01-01T00:00:02.000Z' },
      { id: `fixture-assistant-${messages.length + 2}`, role: 'assistant', content: `Echo: ${input.content}`, createdAt: '2026-01-01T00:00:03.000Z' },
    ]
    return json(response, 200, { accepted: true })
  }
  if (url.pathname === '/api/test.events-ready' && request.method === 'GET') return json(response, 200, { connected: events.clients.size > 0 })
  if (url.pathname === '/api/test.reconnect' && request.method === 'POST') {
    for (const client of events.clients) client.send(JSON.stringify({ type: 'reconnecting' }))
    setTimeout(() => {
      baselineVersion += 1
      messages = [...messages, { id: `baseline-${baselineVersion}`, role: 'system', content: `Baseline ${baselineVersion} loaded`, createdAt: '2026-01-01T00:00:04.000Z' }]
      for (const client of events.clients) client.send(JSON.stringify({ type: 'baseline-invalidated' }))
    }, 100)
    return json(response, 200, { accepted: true, nextBaselineVersion: baselineVersion + 1 })
  }
  if (url.pathname === '/api/test.session' && request.method === 'POST') return json(response, 200, snapshot().sessions[0])
  json(response, 404, { error: 'not_found', path: url.pathname })
})

const events = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  if (url.pathname !== '/api/test.events') return socket.destroy()
  events.handleUpgrade(request, socket, head, (client) => events.emit('connection', client, request))
})

server.listen(port, host, () => {
  const address = server.address()
  console.log(`fake-dsh ready http://${host}:${address.port}`)
})

const stop = () => {
  for (const client of events.clients) client.terminate()
  events.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
