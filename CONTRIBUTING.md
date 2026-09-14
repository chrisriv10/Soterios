# Contributing to Soterios

Thank you for your interest in contributing to **Soterios**! Contributions from the community help improve security, reliability, performance, and usability.

This document explains how to set up your development environment, submit changes, report issues, and follow project standards.

---

## Code of Conduct

By participating in this project, you agree to be respectful and constructive toward other contributors.

Security projects require careful collaboration. Please avoid hostile language, personal attacks, or dismissing security concerns without discussion.

---

## Getting Started

### Prerequisites

Before contributing, make sure you have:

- Node.js 26 or newer (required; Node 26 is Current, not LTS)
- npm
- Git
- Rust toolchain 1.85.1 for the native process inspector
- A Windows development environment (recommended for testing system-level features)

Check your installed versions:

```bash
node -v
npm -v
git --version
rustc --version
```

Set up the pinned Windows Rust toolchain:

```bash
rustup toolchain install 1.85.1-x86_64-pc-windows-msvc --profile minimal --component clippy,rustfmt
```

For the canonical clone, dependency installation, and application startup instructions, follow the [Development Setup](README.md#development-setup) section in the README.

### Environment Variables

Runtime environment variables are documented in the [Environment Variables](README.md#environment-variables) section of the README.

Contributor-relevant variables include:

- `SOTERIOS_DISABLE_GPU=1`
- `SOTERIOS_USERDATA=<path>`
- `SOTERIOS_LOG_FILE=1` or `SOTERIOS_LOG_FILE=<path>`
- `SOTERIOS_SKIP_CLAMAV=1`
- `SOTERIOS_FORCE_CLAMAV=1`

`npm install` downloads a prebuilt Windows ClamAV archive via `tools/download-clamav.js`. The pinned archive only contains Windows binaries, so the download is skipped automatically on Linux and macOS. Set `SOTERIOS_SKIP_CLAMAV=1` to skip it on Windows as well (for example when working offline or on a metered connection), or `SOTERIOS_FORCE_CLAMAV=1` to force the download on a non-Windows host when assembling a Windows package. Transient download failures are retried a few times before the install fails, and the archive's SHA-256 checksum is always verified.

See the [Logging](#logging) section below for additional details about `SOTERIOS_LOG_FILE`.

---

## Development Guidelines

### Claiming an Issue

Before starting substantial work, find an unassigned issue and comment that you would like to work on it. Please wait for a maintainer to assign the issue before beginning substantial work.

If the requirements are unclear, ask questions in the issue before proceeding. When opening a pull request, reference the issue (for example, `Fixes #136`) and keep the PR focused on that issue.

If you can no longer complete an assigned issue, let the maintainers know so the issue can be reassigned.

### Branching

Create a branch for your work:

```bash
git checkout -b feature/my-new-feature
```

Use descriptive branch names:

```text
feature/firewall-improvements
bugfix/process-scanner-crash
docs/update-readme
security/harden-ipc
```

---

### Making Changes

#### Keep Changes Focused

Try to keep pull requests small and focused. Good examples:

- Fix one bug
- Add one feature
- Improve one subsystem
- Update documentation

Avoid combining unrelated changes into one pull request.

#### Code Quality

Please:

- Write readable and maintainable code
- Add comments where behavior is not obvious
- Avoid unnecessary dependencies
- Handle errors safely
- Avoid exposing sensitive information in logs
- Follow existing project structure and style

#### Security Contributions

Because Soterios is a security-focused application, security reports are especially important.

Please do not publicly disclose:

- Vulnerabilities
- Exploitable bugs
- Bypass methods
- Sensitive implementation details

...until they have been reviewed.

Include:

- Description of the issue
- Steps to reproduce
- Potential impact
- Suggested mitigation (if known)

---

### Testing

Before submitting a pull request:

- Test your changes locally
- Verify existing features still work
- Check for runtime errors
- Test edge cases
- Confirm the application starts successfully

If your change affects system-level operations, test carefully.

---

## Running Tests

Soterios uses Node.js built-in test runner (`node:test`) for most unit tests, with Jest used for specific suites.

### Run the main test suite

```bash
npm test
```

This runs the Node test suite through `tests/node-test-runner.js`, followed by the Jest suites for `passwordTools`, `reportExport`, and `splashProgress`.

### Run the Node test suite with forced exit

```bash
npm run test:force
```

This runs the tests using Node's built-in test runner with forced process exit after completion.

### Run integration smoke checks

```bash
npm run smoke:integration
```

This runs the integration smoke checks for project functionality that does not require the full Electron UI.

### Run network alert smoke checks

```bash
npm run smoke:alerts
```

This runs the network alerts smoke test.

### Visual PR verification

For changes that affect the user interface, capture screenshots for pull request verification with:

```bash
npm run capture:screenshots
```

Attach the relevant screenshots to the pull request when visual verification is needed.

Contributors should run `npm test` before submitting a pull request and run any relevant smoke or visual checks for the areas they changed.

---

### Pull Requests

Before opening a PR:

1. Make sure your branch is up to date
2. Ensure the application runs
3. Explain what changed
4. Explain why the change is needed

A good pull request includes:

```markdown
## Summary

What changed?

## Motivation

Why was this needed?

## Testing

How was this tested?

## Screenshots

(Optional)
```

---

### Commit Messages

Use clear and descriptive commit messages. Good examples:

```text
Add Windows firewall audit module

Fix process scanner crash on missing permissions

Improve IPC validation
```

Avoid vague messages like:

```text
fixed stuff
changes
update
```

---

## Feature Requests

Feature ideas are welcome. When suggesting a feature, include:

- The problem it solves
- Why it benefits users
- Possible implementation approach
- Any security considerations

---

## Documentation

Documentation improvements are appreciated. Examples:

- Setup instructions
- Security explanations
- User guides
- Developer notes
- Troubleshooting guides

---

## Logging

Use the shared logger in `src/utils/logger.js` for main-process and security code:

```js
const logger = require('../utils/logger');

logger.debug('Detailed diagnostic');
logger.info('Normal lifecycle event', { scanId });
logger.warn('Recoverable problem', { path });
logger.error('Failure that needs attention', { error: err.message });
```

Guidelines:

- Prefer `logger.*` over direct `console.log` / `console.warn` / `console.error`
- Use **debug** for high-volume details, **info** for lifecycle milestones, **warn** for recoverable issues, **error** for failures
- Include useful context as a meta object (ids, paths, counts) — never passwords, tokens, or full file contents
- File logging is **opt-in and disabled by default**. Pass `filePath` to `logger.configure(...)`, or set `SOTERIOS_LOG_FILE=1` (default userData log) / `SOTERIOS_LOG_FILE=/path/to/file.log`

---

## Style Guidelines

Prefer:

- Simple solutions
- Clear naming
- Minimal complexity
- Defensive programming
- Security-focused design

Security-related code should prioritize correctness and safety.

---

Thank you for helping improve Soterios!