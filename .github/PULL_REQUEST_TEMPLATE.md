<!--
Thanks for the PR! A few things to know first:

- Every PR must be linked to an existing issue. Drive-by PRs without prior discussion will be closed -- see CONTRIBUTING.md.
- Every PR is reviewed by a Demi-Build maintainer; we don't auto-merge.
- For security issues, do NOT open a PR with the fix description. See SECURITY.md.
-->

## Linked issue

Closes #

## Why

The motivation, not just the change. What problem does this solve, what user-facing behavior changes, and why this approach over alternatives.

## What changed

A short summary of the actual modifications. Bullet list is fine.

## Screenshots / recordings

For any UI change, before-and-after images or a short clip.

## Local checks (mirrors CI)

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run format:check`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd src-tauri && cargo fmt --all -- --check`
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [ ] `cd src-tauri && cargo test --lib`

## Tests

- [ ] New behavior is covered by tests, OR
- [ ] This change is purely refactor / docs / config and doesn't need new tests

## Scope

- [ ] In scope for v0.1 (read-only inspector — bug fix, perf, a11y, tests, docs), OR
- [ ] Maintainer has confirmed this is wanted before v0.2+

## Code of Conduct

- [ ] I agree to abide by the project [Code of Conduct](../CODE_OF_CONDUCT.md).
