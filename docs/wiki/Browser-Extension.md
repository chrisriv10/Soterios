# Browser Extension

The Soterios browser extension adds credential safety to Chrome/Edge: breach checks on password entry, local reuse detection, and optional malicious-site warnings.

## Install and set up

1. Load the unpacked extension from `browser-extension/` via `chrome://extensions` (Developer mode → Load unpacked).
2. Open the extension options page and paste a Google Safe Browsing API key (optional — only needed for malicious-site warnings).
3. Install the [desktop app](Installation.md) to receive breach alerts through native messaging.

## Privacy Mode

Privacy Mode is a single switch that disables every call to a third-party service, including Have I Been Pwned and Google Safe Browsing. Password and reuse checks stay fully local:

- The HIBP check uses k-anonymity: only the first 5 characters of the password's SHA-1 hash leave the device.
- Reuse detection hashes each password locally (SHA-256) and stores only the hash plus hostname in `chrome.storage.local`.
- With Privacy Mode on, password fields show a neutral "Checks disabled" indicator instead of calling any remote API.

## Malicious-site warnings (Safe Browsing)

When Safe Browsing is enabled with an API key, the extension checks top-frame navigations against Google Safe Browsing v5 (No-Storage Real-Time Mode, `hashes:search`):

- Only a 4-byte SHA-256 hash prefix of the canonicalized URL leaves the device (k-anonymity — never the full URL).
- Matching full hashes are compared locally; only Google-listed sites trigger a warning.
- Verdicts are cached per origin until the earlier of the server `expireTime` or 30 minutes; stale data is never used to warn.
- API failures, timeouts (5 s), and rate limits (HTTP 429) produce no warning — the verdict is "unknown", never "safe" from absence of data.
- Warnings are non-blocking, dismissible banners with Google's required attribution ("Advisory provided by Google" linked to https://safebrowsing.google.com/).

### Getting an API key

1. Create a Google Cloud project and enable the Safe Browsing API.
2. Create an API key restricted to the Safe Browsing API.
3. Paste it into the Safe Browsing section of the extension options.

Note: Google Safe Browsing is for non-commercial use only. The extension respects the 30-minute freshness requirement and shows the protection notice in options before enabling.

### Canonicalization note

URLs are canonicalized before hashing (lowercase host, default ports removed, dot segments resolved, fragment stripped) using the WHATWG URL standard. This is an approximation of Google's canonicalization rules; a non-Google-form URL may occasionally miss a match (a false negative), never a false positive.

## Desktop alerting

Breach and reuse findings are forwarded to the Soterios desktop app via native messaging, which shows the alert in the dashboard. Threat notifications for malicious sites use the `soterios://threat-detected` deep link.

## Files

- `src/content.js` — password field detection, breach/reuse badges, threat banner, navigation monitoring
- `src/background.js` — service worker, HIBP checks, Safe Browsing client calls, per-origin verdict cache, native messaging
- `src/threatChecks.js` — shared check modules (HIBP, Safe Browsing v5), also used by tests
- `src/options.js` / `options.html` — settings UI
- `src/native-host.js` — native messaging host bridge