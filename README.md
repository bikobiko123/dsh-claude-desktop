# DSH Claude Desktop

An independent sibling desktop application scaffold for a Claude-inspired DeepSeek Harness client. It does **not** load or wrap the existing DSH Web GUI. The Electron renderer is its own Vite/React application, with a stable application-facing contract ready for a future reusable Harness client adapter.

## Current scope

- Electron main process with a secure `BrowserWindow` baseline.
- Sandboxed renderer with `nodeIntegration: false` and `contextIsolation: true`.
- Narrow, typed preload API for application information, safe external links, and native file selection.
- Vite + React + TypeScript renderer.
- Claude-inspired three-column placeholder shell.
- Shared `AgentClient` contract to keep future DSH integration out of UI components.
- Typecheck and production build scripts.

This scaffold intentionally does not yet start or connect to DeepSeek Harness. The next technical milestone is a small adapter proof of concept that reuses the official client connection, session projection, workspace, tool, approval, and question services without mounting the official DSH application UI.

## Requirements

- Node.js 22 or later.
- npm, pnpm, or another package manager capable of installing the declared dependencies.

## Install

```sh
npm install
```

## Development

```sh
npm run dev
```

The command starts Vite, watches the Electron main/preload TypeScript build, waits for both, and launches Electron with the development URL.

## Verification

```sh
npm run typecheck
npm run build
# or both:
npm run verify
```

Production output:

```text
dist/
  main/index.js
  preload/index.cjs
  renderer/index.html
  renderer/assets/*
```

Run the built app locally with:

```sh
npm start
```

## Packaging

Electron Builder is configured by `electron-builder.yml` for unsigned local builds and deterministic public macOS ZIP artifacts. It packages the compiled `dist/**` application, `package.json`, and the runtime `ws` dependency required by the packaged loopback proxy. Source files, tests, maps, logs, and the DSH installation are excluded.

```sh
# Current host platform, unpacked
npm run build:dir

# Explicit unpacked targets
npm run build:dir:mac
npm run build:dir:win

# Inspect an unpacked output without launching, signing, or publishing
npm run smoke:packaged
```

Outputs are written below `release/`, such as `release/mac-arm64/DSH Desktop.app` or `release/win-unpacked/`. Cross-building Windows from macOS may require host tooling that is not installed; CI should run the Windows command on Windows when reliable native packaging is required.

No automatic installer is configured. Public macOS releases are intentionally unsigned and not notarized for personal use.

### Manual public updates

Settings includes a manual updater for the fixed public repository `bikobiko123/dsh-claude-desktop`. All GitHub API and asset traffic stays in the Electron main process. The renderer can only request a check, request the already-selected download, observe typed progress, or reveal the verified file; it cannot provide a repository, URL, filename, or destination path.

The updater accepts only a stable semantic version strictly newer than the running app, and selects one exact ZIP for the current macOS architecture:

- `DSH-Desktop-<version>-mac-arm64.zip`
- `DSH-Desktop-<version>-mac-x64.zip`

Each release must also contain `SHA256SUMS.txt`. Downloads are streamed with size and timeout bounds into the app `userData/updates` directory, hashed during transfer, and atomically renamed only after the exact manifest SHA-256 matches. The app never extracts, launches, installs, or replaces itself. Use **Reveal downloaded artifact** and replace the application manually.

The tag release workflow in `.github/workflows/release.yml` builds both architectures and publishes the ZIP files plus their checksum manifest. Tags must match the package version (`vX.Y.Z`). No GitHub token is embedded in the app; Actions uses its short-lived repository token only while publishing.

Unsigned applications may trigger macOS Gatekeeper warnings. Checksums protect against corruption but do not replace code signing or notarization and cannot protect against compromise of the GitHub repository itself. See `SECURITY.md` before distributing builds beyond personal use.

### External DSH runtime policy

DeepSeek Harness is not bundled into the application or `app.asar`. The desktop application requires an independently installed, compatible `dsh` executable and manages it as a private loopback sidecar at runtime. This avoids silently shipping a second Harness distribution and keeps Harness credentials, plugins, profiles, and upgrades under the user's existing installation.

This client is pinned to exactly DeepSeek Harness `0.1.0-rc.6`. Check the installed command before packaging or integration testing:

```sh
npm run check:dsh
# Override discovery when needed:
DSH_BIN=/absolute/path/to/dsh npm run check:dsh
```

A missing executable or any different version is a compatibility failure. The application must show a useful unavailable/incompatible state rather than downloading or replacing DSH implicitly.

## Architecture

```text
Electron main
  - native window lifecycle
  - navigation policy
  - safe IPC handlers
  - future Harness process/update management

Electron preload
  - contextBridge only
  - narrow DesktopApi contract

React renderer
  - independent Claude-inspired UI
  - no Node.js access
  - future AgentClient consumer

Shared contracts
  - DesktopApi
  - AgentClient
  - view-facing workspace/session/message models
```

## Development Harness proxy

During `npm run dev`, the Vite origin is the renderer's only network authority. The development server proxies these paths to the existing DSH host:

- `/api/**` → DSH `/api/**`, including WebSocket upgrades for `/api/events.mux` and `/api/events.host`;
- `/plugins/**` → DSH client bundle endpoints;
- `/dsh-runtime/boot-manifest` → a custom JSON endpoint that fetches the DSH host root page and extracts the raw `window.__DSH_BOOT__` graph without loading or executing the official UI.

The target defaults to `http://127.0.0.1:3080` and can be changed for development:

```sh
DSH_DEV_ORIGIN=http://127.0.0.1:4080 npm run dev
```

`DSH_DEV_ORIGIN` must be an HTTP(S) origin without credentials, a path, query, or fragment. The independent renderer should use the same-origin runtime endpoints in `src/shared/runtime-endpoints.ts`; it must never navigate to or embed the proxied DSH root page.

### Production implication

The Vite proxy exists only in development and is not emitted into `dist/renderer`. A packaged `file://` renderer therefore cannot rely on these routes. Production provides an app-owned loopback origin or equivalent main-process reverse proxy that serves the custom renderer and forwards `/api` (including WebSocket upgrades) and `/plugins`, plus the boot-graph JSON endpoint. The packaged proxy reserves the deterministic loopback port `32123` so Chromium's origin-scoped localStorage (including selected-session state) survives app restarts. If that port is occupied, it tries a short deterministic fallback range (`32124`–`32127`) rather than binding a random port; this is a deliberate migration tradeoff for conflict safety, while normal runs remain stable. A fallback port is a different browser origin, so state stored under `32123` is not automatically visible for that run; returning to `32123` restores the original origin-scoped state. An explicit `port` option is fail-closed and never silently falls back. The one-run capability bootstrap remains HttpOnly/SameSite=Strict, redirects immediately to a query-free `/` with `Referrer-Policy: no-referrer`, and capability-bearing cookies/headers and `Referer` are stripped before upstream proxying. Privileged HTTP/WS requests still require exact Host/Origin, same-origin Fetch Metadata, and the per-run capability, so stable origin does not weaken CSRF protection. The proxy must be bound to loopback, restricted to the managed DSH sidecar, validate the upstream origin, preserve Electron navigation/CSP protections, and shut down with the app. Do not solve production by loading the official DSH Web UI.

## Planned Harness integration

The renderer must not import internal DSH implementation details directly. A future adapter should implement `AgentClient` and translate reusable Harness client services into stable application models. Initial validation should cover:

1. Client runtime startup without the official App component.
2. Connection and reconnection.
3. Workspace and session listing.
4. Session creation and message submission.
5. Session projection and streaming updates.
6. Tool call/result states.
7. Approval and Ask User responses.
8. Cancellation and restoration after reconnect.

## Branding

The interface is visually inspired by Claude Desktop, but this project is not affiliated with Anthropic. Public distribution should use an original product name, icon, and licensed font assets.
