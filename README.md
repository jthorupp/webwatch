# WebWatch

WebWatch is a developer-first CLI for monitoring web quality. It is intended to detect regressions through crawling, browser checks, resource validation, and visual comparisons.

The project is at its foundation stage. Scanning functionality has not been implemented yet.

## Development

Install dependencies with `pnpm install`, then run `pnpm lint`, `pnpm typecheck`, `pnpm test`, or `pnpm build` from the repository root.

After building, run the CLI locally with `node apps/cli/dist/index.js --help`. `webwatch init` creates a starter `webwatch.config.ts`; `webwatch scan <url>` currently validates the URL and reports that scanning is not implemented yet.
