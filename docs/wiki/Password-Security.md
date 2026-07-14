# Password Security

The **Credential Safety Hub** provides local password tools and optional online breach checks.

## Password generator

Generate cryptographically random passwords with configurable rules:

- Length: 4–128 characters
- Character sets: lowercase, uppercase, digits, symbols
- Option to exclude ambiguous characters (`Il1O0o`)

Generated passwords include a live strength assessment.

## Password strength checker

Analyzes passwords against common attack patterns, not just character-set math:

- Common password dictionary (including leetspeak variants)
- Keyboard walks (qwerty, asdf, etc.)
- Sequential and repeated character runs
- Embedded dates and birth years
- Length and character-class requirements

Returns a score, label (Very Weak → Very Strong), entropy estimate, and a list of specific issues.

## Password breach check (HIBP)

Checks whether a password appears in known breach corpora using [Have I Been Pwned – Pwned Passwords](https://haveibeenpwned.com/Passwords).

**Privacy:** Only the **first 5 characters** of the SHA-1 hash are sent (k-anonymity). Your full password never leaves your machine.

Requires **External Lookups** enabled in Settings.

## Email breach check (XposedOrNot)

Checks whether an email address appears in public breach records via [XposedOrNot](https://xposedornot.com/).

Requires **External Lookups** enabled in Settings.

## Privacy controls

Disable all external breach checks in **Settings → External Lookups**. When disabled, generator and strength checker continue to work fully offline.
