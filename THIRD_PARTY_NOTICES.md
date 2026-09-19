# Third-Party Notices

This file records third-party material distributed with Soterios and the
terms that apply to each item. Soterios's own application and tooling source
code remains under the repository's MIT license (see `LICENSE`); the licenses
below apply only to the listed third-party items, not to unrelated Soterios
source code.

## EasyList and EasyPrivacy filter data

- Source project: EasyList filter subscription
  (https://github.com/easylist/easylist), which hosts EasyList, EasyPrivacy,
  and related lists.
- Upstream license page: https://easylist.to/pages/licence.html
- Applicable filter-data license elected by Soterios for generated artifacts:
  **Creative Commons Attribution-ShareAlike 3.0 Unported or later
  (CC BY-SA 3.0-or-later)**. The upstream repository dual-licenses its
  contents under GPL-3.0-or-later and CC BY-SA 3.0-or-later; Soterios
  distributes EasyList/EasyPrivacy-derived rule data under the CC BY-SA
  option. (The **GPL option is not** the basis for Soterios distribution of
  this data.)
- Attribution, as requested upstream: **The EasyList authors
  (https://easylist.to/)**.
- Pinned inputs (see `tools/filter-sources.json` for full provenance).
  Each entry records an upstream repository reference (the commit SHA the
  published subscription build claims to derive from, corroborated by date
  but not a cryptographic pin of the published bytes) alongside the
  authoritative content pin: the vendored snapshot's SHA-256:
  - EasyList, upstream repository reference
    `8532102a8465aba707cd5062a6f62d99cef12f9d`
    (list version 202609170011)
  - EasyPrivacy, upstream repository reference
    `b44410f9ed471a59daf44ad1f3bc9b87269e9045`
    (list version 202609170008)
- Derived artifacts: `browser-extension/rules/ads.json` and
  `browser-extension/rules/trackers.json` are machine-generated Chrome MV3
  Declarative Net Request rulesets derived from the above lists by the
  Soterios-owned converter (`tools/compile-filter-lists.js`, MIT). The
  generated rule data files are distributed under CC BY-SA 3.0-or-later;
  the converter code itself remains MIT.
- Provenance for each build (source commits, SHA-256 digests, rule counts,
  converter version) is recorded in `browser-extension/rules/SOURCES.json`.

No other third-party filter data, blocker implementation code, or runtime
dependencies are used by the Ad & Tracker Protection build pipeline.
