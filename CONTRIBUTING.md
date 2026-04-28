# Contributing to Cradle

Cradle is an early read-only release. The codebase is open and we welcome
issues and forks, but external pull requests are not the primary contribution
path right now. Core direction is owned by [Demi](https://github.com/Demi-Build).

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md). Found a security or privacy issue? Don't open a regular issue — see [SECURITY.md](./SECURITY.md).

## Where to start

- **Found a bug or have a feature idea?** Open an
  [issue](https://github.com/Demi-Build/cradle/issues). Reproductions, screenshots,
  or a sample world (or a description of one) help a lot.
- **Want to experiment?** Fork the repo. Anything is fair game inside your fork —
  the [Apache-2.0 license](./LICENSE) lets you use, modify, and redistribute as long
  as you keep the notice.
- **Want to discuss a direction before you build?** Open a
  [discussion](https://github.com/Demi-Build/cradle/discussions) or an issue first
  so we can save you wasted work if it's already in flight or out of scope.

## Pull requests

PRs are welcome but not auto-merged. Every PR — internal or external — must be
reviewed and approved by a member of the Demi-Build organization before it can
land. This is intentional while the project is still pre-1.0 and the canon
schema it depends on is still moving.

If you'd like to send a PR anyway:

1. Open an issue first to confirm the change is wanted. We'll close drive-by PRs
   that don't have an associated issue or prior discussion.
2. Fork, branch off `main`, and keep the change focused — one concern per PR.
3. Make sure you have the prerequisites installed — see the [Prerequisites section in the README](./README.md#prerequisites) for Node, Rust, and platform-specific Tauri build deps.
4. Run the full local check before pushing:

   ```sh
   npm install
   npm run lint
   npm run typecheck
   npm run format:check
   npm test
   npm run build

   cd src-tauri
   cargo fmt --all -- --check
   cargo clippy --all-targets -- -D warnings
   cargo test --lib
   ```

   CI runs the same checks against `main`.

5. New behavior should ship with tests — vitest for the frontend (under `src/test/` or co-located `*.test.ts(x)`) and `cargo test` for the Rust side.
6. Open the PR against `main`. Describe the _why_, not just the _what_. Fill out the PR template.
7. A Demi-Build maintainer will review. We may close PRs that are out of scope
   for v0.1 (read-only inspection) — see the **Roadmap** in the
   [README](./README.md) for what's planned vs. what's not.

## Licensing of contributions

No CLA required. Inbound contributions are licensed [Apache-2.0](./LICENSE) to match the project — by opening a PR you agree your changes are offered under that license.

## What's in scope right now

- Bug fixes in the existing read-only views.
- Performance and accessibility improvements.
- Test coverage for behavior that doesn't already have it.
- Docs and developer-experience improvements.

## What's out of scope until v0.2+

- Editing or writing back to disk (v0.2).
- Live LLM dialogue (v0.3).
- Simulation adapters (v0.4+).
- Schema-typed canon dependency (lands when canon stabilizes).
- New entity types — these need to come from canon first.
