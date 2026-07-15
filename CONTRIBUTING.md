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

- Node.js (LTS recommended)
- npm
- Git
- A Windows development environment (recommended for testing system-level features)

Check your installed versions:

```bash
node -v
npm -v
git --version
```

### Clone the Repository

```bash
git clone https://github.com/chrisriv10/Soterios.git
cd Soterios
```

Install dependencies:

```bash
npm install
```

Run the application:

```bash
npm start
```

---

## Development Guidelines

### Branching

Create a branch for your work:

```bash
git checkout -b feature/my-new-feature
```

Use descriptive branch names:

```
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

Soterios uses Node.js built-in test runner (`node:test`) for most unit tests. Test files live in `tests/` and follow the `*.test.js` naming convention.

### Run all tests

```bash
npm test
```

This runs every Node `tests/*.test.js` file (via `scripts/run-node-tests.js`, excluding Jest-only suites), then Jest (`passwordTools`, `reportExport`).

You can also invoke the Node runner directly:

```bash
node --test tests/
```

### Run a specific test file

```bash
node --test tests/realTimeWatcher.test.js
node --test tests/blocklistService.test.js
node --test tests/scoringEngine.test.js
```

### Jest-only suites

```bash
npx jest tests/passwordTools.test.js
npx jest tests/reportExport.test.js
```

Contributors should run `npm test` before submitting a pull request.

### Expected output

A successful run looks like:

```text
✔ BlocklistService tests (12ms)
✔ Real-time watcher tests (28ms)

ℹ tests X
ℹ pass X
ℹ fail 0
```

Counts and timings may vary as the test suite evolves.

Run the full suite before opening a pull request.

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

```
Add Windows firewall audit module

Fix process scanner crash on missing permissions

Improve IPC validation
```

Avoid vague messages like:

```
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
