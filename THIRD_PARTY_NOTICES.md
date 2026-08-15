# Third-Party Notices

## DeepSeek Harness conversation definitions

Parts of `src/vendor/dsh-rc6-conversation-definitions/` are copied and adapted from:

- Package: `@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6`
- Project: https://github.com/deepseek-ai/deepseek-harness
- Upstream directory: `packages/client/ui-conversation`
- Canonical published artifact: `lib/client.js`
- npm distribution integrity: `sha512-pKDKZYTRvO9pBTyHvVOtPDuTzNfCHwy7GmeIaRLjyCORLPM3uv0BuMc1qIHVI6LcK54l+cRGIuSSGah3bO/0vw==`
- Copyright: Copyright (c) 2026 DeepSeek
- License: MIT

The local adaptation contains only the presentation-neutral conversation event definitions and Chat snapshot/view projection. It intentionally excludes the upstream React renderer, slots, layout, locale, settings, theme, CSS, and other presentation effects. It also does not copy or redistribute the identifiable cosmokit, schemastery/Shigma, or clsx sections embedded elsewhere in the upstream browser bundle; those notices must be added if that copied dependency closure changes.

The full applicable MIT license is retained at `src/vendor/dsh-rc6-conversation-definitions/LICENSE`.
