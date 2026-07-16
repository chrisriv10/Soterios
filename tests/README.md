# Tests and validation

```text
tests/
  *.test.js              unit tests (node:test and Jest)
  node-test-runner.js    runs all node:test suites (npm test)
  smoke/
    integration-smoke.js integration smoke checks (maintenance, tray, updater)
  fixtures/
    screenshots/         optional local UI captures for PR verification (PNGs gitignored)
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Unit tests (node:test + Jest) |
| `npm run smoke:integration` | Integration smoke checks (no Electron UI) |

Build/install helpers (ClamAV download) live in `tools/`, not here.

Production maintenance scripts used by the app are under `src/scripts/`.
