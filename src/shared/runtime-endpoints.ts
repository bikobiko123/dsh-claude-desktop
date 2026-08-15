export interface RuntimeEndpointConfig {
  /** Renderer-relative same-origin route proxied to the loopback DSH host. */
  bootManifestPath: string
  /** Renderer-relative prefix for DSH API and event transports. */
  apiPrefix: string
  /** Renderer-relative prefix from which ClientModuleSystem loads bundles. */
  pluginPrefix: string
}

export const defaultRuntimeEndpoints: RuntimeEndpointConfig = {
  bootManifestPath: '/dsh-runtime/boot-manifest',
  apiPrefix: '/api',
  pluginPrefix: '/plugins',
}
