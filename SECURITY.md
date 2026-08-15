# Security

## Security model

This application treats the Electron renderer as untrusted web content, even though it is bundled locally.

Current safeguards:

- `nodeIntegration` is disabled.
- `contextIsolation` is enabled.
- Chromium sandboxing is enabled.
- The renderer receives only the typed methods exposed through `contextBridge`.
- External navigation is denied in the application window.
- New windows are denied; approved `https:` and `mailto:` links open through the operating system.
- The external-link IPC handler validates protocols again in the main process.
- Arbitrary Electron IPC is not exposed to the renderer.
- Update network access is main-process-only and fixed to public releases from `bikobiko123/dsh-claude-desktop`.
- The update bridge has no arbitrary URL, repository, filename, destination, extraction, execution, or installation operation.
- File selection is initiated by the main process and returns only selected file metadata.

## Future Harness integration requirements

Before connecting DeepSeek Harness, preserve these boundaries:

1. Do not expose raw `ipcRenderer`, `child_process`, filesystem, shell, or Electron objects to the renderer.
2. Start and manage Harness only in the main process or a dedicated utility process.
3. Validate all IPC payloads at runtime, preferably with explicit schemas.
4. Bind local Harness services to loopback only and use per-launch authentication material where supported.
5. Do not place API tokens or provider credentials in renderer state, logs, URLs, or localStorage.
6. Treat tool output, workspace files, Markdown, HTML artifacts, and remote content as untrusted input.
7. Render HTML artifacts in isolated sandboxed views with no preload bridge and a restrictive Content Security Policy.
8. Require explicit user confirmation before opening external URLs or executing privileged desktop operations.
9. Pin supported Harness versions and test adapter compatibility before upgrades.
10. Sign application updates and verify their signatures before installation.

## Manual update security

The optional manual updater is deliberately not an auto-updater. It calls only the fixed GitHub Releases API endpoint for `bikobiko123/dsh-claude-desktop` from the main process, rejects non-HTTPS/unexpected GitHub asset metadata, stable-only malformed or non-newer versions, unsupported platforms, and non-exact architecture asset names. It does not accept a token or any URL from the renderer.

The selected `SHA256SUMS.txt` manifest is bounded to 1 MiB and the selected ZIP is bounded to 1 GiB. The artifact is streamed to a restrictive app-owned `userData/updates` directory with a ten-minute operation timeout, byte-count checks, incremental SHA-256 hashing, cleanup on errors, and temp-to-final atomic rename only after verification. The UI receives only typed status/progress metadata and can reveal the service-owned downloaded artifact for manual replacement. It cannot install, execute, extract, or overwrite the running application.

A checksum manifest authenticates integrity only if the release metadata and repository are trusted; it is not publisher authentication. These builds are unsigned and not notarized. Do not use this mechanism for unattended or high-assurance distribution. Add Apple Developer ID signing, notarization, and an independently verified signature policy before public production distribution.

The release workflow uses tag-triggered builds on macOS runners, verifies the tag against `package.json`, creates exact arm64/x64 ZIP assets, and publishes `SHA256SUMS.txt` with least-privilege `contents: write` permissions. Review branch/tag protection and the Actions supply chain before enabling releases.

The current Electron Builder configuration produces unsigned, unpacked development artifacts only. It has no updater, publishing provider, signing identity, notarization, installer, or automatic download path.

DeepSeek Harness remains external and must not be copied into `app.asar`, `Resources`, or an installer. Packaging includes only the compiled desktop application and its narrow runtime dependencies. The packaged smoke inspection fails when it finds a bundled `dsh`/DeepSeek Harness executable in application resources.

Before any public release, add platform signing and notarization in a separate reviewed change, store credentials outside the repository, verify update signatures, and define a supported DSH upgrade policy. Do not enable auto-update until those controls exist.

## Content Security Policy

A production Content Security Policy should be added before introducing remote content. Development currently requires Vite's local scripts and refresh connection. Production should default to local packaged assets only.

## Reporting vulnerabilities

This is currently a local scaffold without a public security contact. Do not publish sensitive vulnerability details in a public issue. Add a dedicated private reporting address before external distribution.
