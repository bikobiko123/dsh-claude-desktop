# DSH headless integration notes

This app owns its renderer and does **not** import the official DSH App or presentation UI. The target architecture is to reuse DSH's official browser-side services and session projection, then render those services through the custom Claude-inspired React surface.

## Preferred path: official headless client runtime

A `dsh web` host injects a `window.__DSH_BOOT__` graph and serves each browser plugin at the graph row's `/plugins/.../client.js?rev=...` URL. The independent renderer can bootstrap that graph without mounting the official App:

1. Run or connect to the real `dsh web` host and discover its actual URL. Prefer `DSH_WEB_URL` or a URL handed to Electron by the process launcher; `3080` is only the common default.
2. Make the renderer same-origin with that host (host it below the DSH origin or proxy the API/plugin routes). The host intentionally has no CORS surface and rejects cross-site/authority-mismatched browser requests.
3. Fetch and validate the JSON graph from `/dsh-runtime/boot-manifest`, or pass an already-fetched `bootGraph`, using the isolated rc.6 integration in `src/shared/rc6/bootstrap.ts`.
4. Install a private `window.__ModuleLoader__` registration sink, load only the five selected graph bundles from their host-provided URLs, and materialize their factories against the shared Cordis module identity.
5. Apply the materialized plugins to one Cordis `Context` in dependency order and await every fiber.
6. Expose only the settled `ctx.sessions` and `ctx.workspaces` faces through `createHarnessRc6Adapter`. The loaded core service plugins are:
   - `@deepseek-ai/dsh-client-connection` (official HTTP/WebSocket carrier and reconnect controller)
   - `@deepseek-ai/dsh-typert-registry`
   - `@deepseek-ai/dsh-api-gateway`
   - `@deepseek-ai/dsh-api-remotes`
   - `@deepseek-ai/dsh-client-runtime` (official `SessionRuntime`, stores, slots, and session projection consumption)

The five service plugins form the headless runtime spine. After they settle, the pinned local definition-only registrar registers 11 ordinary conversation definitions, the sole append-surface fallback, and the `chat` view builder through the browser/client `conversationEvents` and `conversationViews` registries. These registries are independent of the official UI, enforce unique kind/target keys, participate in Cordis owner lifetimes, and invalidate/rebuild existing session projections when definitions change. Every registered view target must have an app-owned consumer; target and `buildViewNode` output must stay paired. Never use the package root/host entry for this integration.

This registrar seam is pre-1.0 and strictly pinned to `dsh-client-runtime@0.1.0-rc.6` and `cordis@4.0.1`, including the required client declaration merging and legacy ChatSnapshot compatibility. The private loader is pre-Cordis bootstrap machinery, not an additional client plugin. Keep `@deepseek-ai/dsh-cordis-client-runner` optional unless dynamic Cordis browser packages are required; it currently injects the official theme service and is therefore not part of the minimal headless set.

### Current feasibility boundary

The published plugin `./client` files are lazy bundle handoffs (`window.__ModuleLoader__.load(...)`), not ordinary ESM libraries. Therefore they must be loaded through the boot manifest/module system. Direct Vite imports of `@deepseek-ai/dsh-client-connection/client` or `@deepseek-ai/dsh-client-runtime/client` are not a supported standalone SDK path. The custom bootstrap should be implemented once the Electron renderer is served/proxied from the DSH authority and receives the host-composed manifest; inventing a local manifest would bypass the host's authoritative plugin graph and version hashes.

Do not implement another session reducer/projection while this path is pending. The custom UI should subscribe to official runtime stores/services after activation.

## Fallback/probe transport

`src/shared/dsh-sidecar-transport.ts` is intentionally a small carrier probe, not an application state layer. It supports:

- typed unary POST calls to `/api/<method>`;
- POST `/api/respond` for `client-response` envelopes;
- downlink-only WebSockets at `/api/events.mux` and `/api/events.host`;
- full RPC envelope validation plus method-specific unary value and stream-frame validation;
- abort/deadline handling and malformed-frame diagnostics.

Node/Electron main can inject `nodeWebSocketFactory` from `src/main/dsh-node-websocket.ts`. A renderer can use the native browser WebSocket only when it is same-origin/trusted by the DSH host.

The fallback deliberately does **not** provide reconnect orchestration, history refetch, stores, or session projection. If used beyond a connectivity probe, the next step is to replace it with the official `ConnectionController`/`SessionRuntime` bootstrap rather than add those duplicate responsibilities here.

## Host trust assumptions

- Browser trust is an origin/Host DNS-rebinding fence, not token authentication.
- Loopback authorities (`localhost`, `[::1]`, and `127/8`) are accepted; configured trusted authorities may also be accepted.
- Cross-site `Sec-Fetch-Site` and mismatched `Origin`/Host authorities are rejected.
- WebSockets accept no client messages and use no subprotocol.
- Recovery after either stream ends is reopen plus history/baseline refetch; the host stream is delta-only and sends no initial baseline, so the official controller/runtime must refetch `session.list` and `workspace.list` after reconnect.
- The official reconnect delay uses equal jitter (upper-half jitter): `cap / 2 + random * cap / 2`, not full `0..cap` jitter.
