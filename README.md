# WebWatch

WebWatch is a developer-first CLI for monitoring web quality. It is intended to detect regressions through crawling, browser checks, resource validation, and visual comparisons.

The CLI includes an initial static URL crawler. It fetches HTML, follows unique same-origin links, and rejects non-public network destinations. It does not execute JavaScript or use a browser.

## Development

Install dependencies with `pnpm install`, then run `pnpm lint`, `pnpm typecheck`, `pnpm test`, or `pnpm build` from the repository root.

After building, run the CLI locally with `node apps/cli/dist/index.js --help`. `webwatch init` creates a starter `webwatch.config.ts`; `webwatch scan <url> [--max-pages 100]` crawls up to the selected number of pages.

See [docs/ci.md](docs/ci.md) for CI behavior and the GitHub branch protection settings needed to require its quality checks before merging.
