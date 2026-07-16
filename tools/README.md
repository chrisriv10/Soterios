# Build and install tools

Scripts here run during development setup or packaging — not during normal app runtime.

| Script | Used by |
|--------|---------|
| `download-clamav.js` | `npm install` / `npm run prepack` — downloads ClamAV into `assets/clamav/` |

For tests, smoke checks, and validation fixtures, see [tests/README.md](../tests/README.md).
