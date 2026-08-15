# Manual updates

The Settings dialog supports a user-initiated, manual macOS update check for `bikobiko123/dsh-claude-desktop`.

1. Open **Settings** and choose **Check for updates**.
2. If a newer stable release is available, confirm the exact architecture ZIP shown by the dialog.
3. Choose **Download and verify**. The app streams the ZIP into its private updates directory and verifies the SHA-256 listed in `SHA256SUMS.txt`.
4. Choose **Reveal downloaded artifact** and manually replace the application. The app never installs or replaces itself.

Supported release assets are exactly:

```text
DSH-Desktop-<version>-mac-arm64.zip
DSH-Desktop-<version>-mac-x64.zip
SHA256SUMS.txt
```

Only stable `X.Y.Z` versions strictly newer than the running version are eligible. Draft, prerelease, malformed, duplicate, missing, oversized, and checksum-incomplete releases are rejected. The updater supports only macOS arm64 and x64.

Checksums detect corruption; they do not prove publisher identity. These personal-use artifacts are unsigned and not notarized, so review `SECURITY.md` and macOS Gatekeeper warnings before opening them.
