# Browser Extension

Soterios 2.0 is a standalone-capable credential and phishing protection extension for Chrome, Edge, and Brave on Windows. The desktop app is optional. The extension contains no analytics, product telemetry, tracking identifiers, advertising code, cloud account, vault, or autofill system.

## Build and install

Requirements for contributors are Node.js and npm. End users do not need Node.js: the Windows native host is built as a standalone executable.

```powershell
npm run extension:build
npm run extension:validate
npm run extension:package
npm run native-host:build
npm run extension:install
```

The install command atomically stages the validated extension at `%LOCALAPPDATA%\Soterios\browser-extension`, registers the native host, and opens the supported browser's extensions page. Enable Developer mode, choose **Load unpacked**, and select that fixed folder. After an update, use the extension card's **Reload** button.

Generated deliverables are:

- `browser-extension/dist/chromium` — load-unpacked directory included in the Electron installer.
- `dist/extension/soterios-extension-2.0.0.zip` and its SHA-256 file — deterministic archive.
- `build/native-host/SoteriosNativeHost.exe` — Node Single Executable Application included in the unpacked Electron payload so release signing covers it.

## First-run privacy boundary

HIBP Pwned Passwords and signed Soterios feed updates are selected by default, but the service worker makes no external request until the user clicks **Confirm choices**. Closing onboarding keeps online protection suspended. Google Safe Browsing is off until the user supplies a key.

The global **Online protection services** switch is a hard network gate. Provider switches cancel in-flight requests and remove their optional provider permission where Chromium's permission model allows it. If continuous all-site access also covers that origin, the service-worker gate still guarantees that a disabled provider is never called.

Continuous HTTP/HTTPS access is optional. Without it, **Protect this page** uses temporary `activeTab` access. `storage.sync` contains only display preferences. Consent, provider settings, secrets, pause rules, and history metadata use trusted-context `storage.local`; one-time bypasses use `storage.session`; signed feed shards use IndexedDB.

## Protection behavior

- Password breach checks run once after a completed password field loses focus or after an explicit popup action. They use HIBP k-anonymity with `Add-Padding: true`, bounded timeouts, strict response parsing, and zero-count padding removal.
- Strength analysis and the cryptographic password/passphrase generator run locally.
- Reuse detection uses a per-install HMAC inside the service worker and compares registrable domains. Plaintext passwords, SHA-1 values, HIBP prefixes, and unkeyed password hashes are never persisted or logged.
- Signed high-confidence feed matches show an interaction-blocking warning with **Go back** and a short-lived, tab-scoped **Continue once** choice.
- Local URL and credential-form heuristics show non-blocking advisories with exact reason codes. Heuristics never trigger the blocking surface.
- Only actual findings are retained for 30 days. Incognito findings and reuse data are not retained. Activity can be exported as JSON or deleted in one click.

The page component lives in an isolated Shadow DOM overlay. It does not modify the host page's parent layout. It observes dynamically added password fields, open shadow roots, frames covered by the granted permission, resizing, scrolling, and SPA navigation, and it tears down cleanly when reinjected.

## Threat-feed publishing

`.github/workflows/threat-feed.yml` runs every six hours. It reads active, analyst-reviewed domains from the public CERT Polska Dangerous Websites Warning List and active URLhaus entries, canonicalizes them, publishes category-tagged 128-bit SHA-256 tokens in checksummed shards, signs the manifest with Ed25519, and deploys to GitHub Pages. Domain indicators apply to the listed domain and its subdomains, never its parent. The extension downloads changed shards on the schedule—not in response to site visits.

The signing private key is held outside the repository at `%LOCALAPPDATA%\Soterios\signing\threat-feed-ed25519.pem` on the provisioning workstation. Add its PEM contents to the repository's `THREAT_FEED_PRIVATE_KEY` Actions secret. The corresponding public key is pinned in `browser-extension/src/feed-public-key.json`. Also configure `URLHAUS_AUTH_KEY`; CERT Polska requires no key. Do not replace the public key without coordinating a signed feed-key rotation release.

If signature validation, schema limits, freshness checks, checksum validation, or rollback protection fails, the last valid feed is retained and the UI reports degraded/unknown protection; it does not claim a clean verdict.

## Native protocol

The native host manifest uses the exact unpacked extension origin and points directly to `SoteriosNativeHost.exe`. Chrome's four-byte little-endian framing is bounded to 64 KiB. `NativeEnvelopeV2` requires protocol version 2, a correlation ID, a known message type, and a schema-validated payload.

The host launches Soterios without sensitive command-line arguments, waits with bounded backoff for a per-user named pipe, and forwards only category, severity, registrable domain, and optional prevalence count. Legacy `CREDENTIAL_LEAK` and `THREAT_DETECTED` names are translated for one release only; any legacy message containing a plaintext password is rejected.

## Tests and release gates

`npm test` builds the extension before running the existing suite. Extension coverage includes migrations and pre-consent gating, permissions and CSP, HIBP padding, HMAC reuse, URL canonicalization, heuristics, feed signatures and rollback primitives, retention, native framing, plaintext rejection, the standalone executable, and artifact validation.

Before packaging, run:

```powershell
npm run extension:build
npm run extension:validate
npm run native-host:build
npm test
```

Publishing to Chrome Web Store or other stores is intentionally outside the 2.0 release scope.
