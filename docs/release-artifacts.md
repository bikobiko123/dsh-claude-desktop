# Release artifacts

The release workflow is `.github/workflows/release.yml`. A protected SemVer tag such as `v0.2.0` must match `package.json` and produces unsigned macOS ZIP assets on macOS runners:

- `DSH-Desktop-0.2.0-mac-arm64.zip`
- `DSH-Desktop-0.2.0-mac-x64.zip`
- `SHA256SUMS.txt`

The manifest uses GNU coreutils-compatible records:

```text
<64 lowercase hexadecimal SHA-256>  <exact filename>
```

The desktop client selects the exact current-platform filename and never downloads a caller-provided URL. Artifact downloads are bounded, streamed, hashed, and atomically published only after manifest verification. No release asset is extracted or executed by the application.

This workflow does not sign or notarize. Add Developer ID signing, notarization, and independent signature verification before treating releases as suitable for general public distribution.
