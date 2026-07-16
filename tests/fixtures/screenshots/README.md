# UI screenshot fixtures (validation only)

Screenshot PNGs are **not stored in git** (`tests/fixtures/screenshots/*.png` is gitignored).

Use this folder for **local captures during PR review** — not for shipped app assets.

## For README / issue verification (#28)

1. Run the app on Windows: `npm start`
2. Capture dashboard, malware scan, process inspector, and firewall views
3. Save PNGs here temporarily, then attach them to the pull request for reviewer reference

## Suggested filenames

- `dashboard.png`
- `scan.png`
- `processes.png`
- `firewall.png`

## Notes

- Use real application views, not splash/loading screens
- Avoid personal paths or sensitive data in captures
- Do not commit PNGs; attach to PRs or release notes instead
