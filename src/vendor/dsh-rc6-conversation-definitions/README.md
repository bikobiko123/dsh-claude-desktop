# DSH rc.6 conversation definitions fork

This directory is a presentation-neutral adaptation of the conversation business projection code from:

- Package: `@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6`
- Project: https://github.com/deepseek-ai/deepseek-harness
- Upstream package directory: `packages/client/ui-conversation`
- Installed rc.6 bundle used as canonical reference: `lib/client.js`, definition closure lines 2618–2682 and 7177–8861
- Canonical `lib/client.js` SHA-256: `0f7927e6284159b9b4138df50a1d64755e6e3ff76064bb06309678392530a829`
- Reviewed vendored source-set SHA-256: `10f253c869124cc88604191f8069d9a81dd51b1804edf9ee848029cb79c51490`
- npm distribution integrity: `sha512-pKDKZYTRvO9pBTyHvVOtPDuTzNfCHwy7GmeIaRLjyCORLPM3uv0BuMc1qIHVI6LcK54l+cRGIuSSGah3bO/0vw==`
- License: MIT, Copyright (c) 2026 DeepSeek
- Project-level attribution: `THIRD_PARTY_NOTICES.md`

## Scope

Only the `conversationEvents` definitions and the `conversationViews` Chat snapshot builder are included. The minimal closure includes the adapted payload boundary in `contracts.ts`, turn-metric derivation in `metrics.ts`, the 11 ordinary definitions, sole fallback, and legacy-compatible `ChatSnapshotBuilder`. Registration order is pinned in `register.ts`. This fork intentionally contains no React components, JSX runtime, slots, renderers, locale dictionaries, settings, themes, layouts, stores, CSS injection, animation-frame DOM alignment, or other presentation effects.

The registrar gate always verifies the reviewed vendored source-set fingerprint. When a canonical published `lib/client.js` is available, set `DSH_RC6_CONVERSATION_CLIENT_ARTIFACT` to its path; the gate also verifies its pinned SHA-256 without importing or executing the private browser handoff artifact.

## Updating to another DSH version

1. Pin the new DSH packages and verify their exact installed versions.
2. Audit the installed `dsh-client-ui-conversation/lib/client.js`; do not assume an untagged repository checkout matches the published artifact.
3. Identify the complete executable closure for business definitions, turn metrics, contracts, and the Chat view builder.
4. Reconcile every adapted file against that installed bundle, preserving definition and fallback order.
5. Confirm runtime imports remain limited to `@deepseek-ai/dsh-client-runtime/client` and type-only Cordis/plugin event declarations.
6. Update provenance above and the version marker in application contracts.
7. Run the registrar golden tests, full unit suite, production build, Electron E2E, and packaged smoke tests.
8. Reject the upgrade if any presentation service or DOM/React dependency becomes necessary; never call the upstream monolithic `apply()`.

The original MIT license text is retained in `LICENSE`.
