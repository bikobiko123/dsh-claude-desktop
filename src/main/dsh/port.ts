import net from 'node:net'
import { DSH_LOOPBACK_HOST } from './types.js'

export interface PortReservation {
  readonly host: typeof DSH_LOOPBACK_HOST
  readonly port: number
  release(): Promise<void>
}

export interface ReserveLoopbackPortOptions {
  readonly createServer?: typeof net.createServer
}

/** Hold an OS-selected TCP port until immediately before the sidecar is spawned. */
export async function reserveLoopbackPort(options: ReserveLoopbackPortOptions = {}): Promise<PortReservation> {
  const server = (options.createServer ?? net.createServer)()
  server.unref()
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: DSH_LOOPBACK_HOST, port: 0, exclusive: true })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Failed to reserve a numeric loopback port.')
  }
  let released = false
  return {
    host: DSH_LOOPBACK_HOST,
    port: address.port,
    release: async () => {
      if (released) return
      released = true
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}
