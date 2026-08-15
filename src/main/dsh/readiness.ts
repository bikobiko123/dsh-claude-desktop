export interface WaitForDshReadinessOptions {
  readonly origin: string
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly signal?: AbortSignal
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('Readiness wait aborted.')) }
    function done() { signal?.removeEventListener('abort', onAbort); resolve() }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

/** Poll same-host HTML; a successful page proves the listener and boot graph are ready. */
export async function waitForDshReadiness(options: WaitForDshReadinessOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const intervalMs = options.intervalMs ?? 100
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const deadline = now() + timeoutMs
  let lastError: unknown
  while (now() < deadline) {
    options.signal?.throwIfAborted()
    try {
      const response = await fetchImpl(`${options.origin}/`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.min(1_000, Math.max(1, deadline - now()))),
          ...(options.signal ? [options.signal] : []),
        ]),
      })
      if (response.ok) {
        const html = await response.text()
        if (html.includes('window.__DSH_BOOT__')) return
        lastError = new Error('DSH page did not contain a boot graph.')
      } else lastError = new Error(`DSH readiness probe returned HTTP ${response.status}.`)
    } catch (error) {
      lastError = error
    }
    if (now() < deadline) await sleep(Math.min(intervalMs, Math.max(0, deadline - now())), options.signal)
  }
  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : ''
  throw new Error(`DSH sidecar did not become ready within ${timeoutMs} ms.${detail}`)
}
