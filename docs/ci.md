# Continuous integration

The `WebWatch CI` workflow runs on every pull request targeting `main` and every push to `main`. Its `Quality gates` job installs the pinned pnpm version from the root `package.json` and runs lint, typecheck, tests, and build on Node.js 24.

## Require CI before merging

In the repository's GitHub settings, create or update a branch protection rule (or repository ruleset) targeting `main`:

1. Enable **Require a pull request before merging**.
2. Enable **Require status checks to pass before merging**.
3. Select **Quality gates** as a required status check.

The workflow grants the token read-only `contents` permission and does not run with `pull_request_target`.
