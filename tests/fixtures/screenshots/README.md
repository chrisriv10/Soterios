# UI screenshot fixtures (validation only)

Screenshot PNGs are **not stored in git** (`tests/fixtures/screenshots/*.png` is gitignored).

Use this folder for **local captures during PR review** — not for shipped app assets.

## Automated capture

```bash
npm run capture:screenshots
```

Writes PNGs to this folder:

- `01-dashboard.png`
- `02-tools-page.png`
- `03-uninstaller-mac-unsupported.png`
- `04-settings-language.png`

Attach the PNGs to your pull request for visual verification. Do not commit them.

## Manual capture

1. Run the app: `npm start`
2. Capture dashboard, malware scan, process inspector, and firewall views
3. Save PNGs here temporarily, then attach them to the PR

Suggested manual filenames: `dashboard.png`, `scan.png`, `processes.png`, `firewall.png`

## Notes

- Use real application views, not splash/loading screens
- Avoid personal paths or sensitive data in captures
- Do not commit PNGs; attach to PRs or release notes instead
