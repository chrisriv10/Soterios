# License note for `browser-extension/rules/`

- `ads.json` and `trackers.json` are generated Chrome MV3 Declarative Net
  Request rulesets **derived from EasyList and EasyPrivacy** filter data.
  They are distributed under **CC BY-SA 3.0-or-later** with attribution to
  **The EasyList authors (https://easylist.to/)**.
  See `THIRD_PARTY_NOTICES.md` (repository root) and `SOURCES.json`
  (this directory) for upstream commits, digests, and provenance.
- `SOURCES.json` is Soterios-generated build metadata (MIT, like the rest of
  Soterios tooling output), except that it quotes upstream titles, URLs, and
  commit identifiers as provenance facts.
- The generator, `tools/compile-filter-lists.js`, is Soterios-owned source
  code under the repository MIT license. No third-party blocker
  implementation code is used or distributed.
