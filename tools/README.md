# Build and install tools

Scripts here run during development setup or packaging — not during normal app runtime.

| Script | Used by |
|--------|---------|
| `download-clamav.js` | `npm install` / `npm run prepack` — downloads ClamAV into `assets/clamav/` |
| `validate-i18n.js` | `npm run validate:i18n` — checks every locale in `src/i18n/locales/` for missing, extra, duplicate, or nested keys vs `en.json` |
| `check-i18n.js` | `npm run check:i18n` — reports locale strings still identical to `en.json` (likely untranslated); read-only, exits 0 unless `--strict` |

For tests, smoke checks, and validation fixtures, see [tests/README.md](../tests/README.md).
