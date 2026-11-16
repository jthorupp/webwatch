# WebWatch

WebWatch is a developer-first CLI for monitoring web quality. It is intended to detect regressions through crawling, browser checks, resource validation, and visual comparisons.

The CLI includes a static URL crawler and HTTP resource checks. It follows unique same-origin links, checks internal links plus image, stylesheet, and script URLs, and rejects non-public network destinations. It does not execute JavaScript or use a browser.

## Development

Install dependencies with `pnpm install`, then run `pnpm lint`, `pnpm typecheck`, `pnpm test`, or `pnpm build` from the repository root.

After building, run the CLI locally with `node apps/cli/dist/index.js --help`. `webwatch init` creates a starter `webwatch.config.ts`; `webwatch scan <url> [--max-pages 100] [--concurrency 4]` crawls pages and checks HTTP resources.

```sh
node apps/cli/dist/index.js scan https://example.com
```

Scans print a deterministic summary and findings grouped by severity and type. Exit code `0` means the scan completed without findings, `1` means error findings were detected, and `2` means checks were incomplete without error findings. See [docs/scan-results.md](docs/scan-results.md) for details.

See [docs/ci.md](docs/ci.md) for CI behavior and the GitHub branch protection settings needed to require its quality checks before merging.
