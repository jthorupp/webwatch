# WebWatch – AI Agent Instructions

## Project Overview

WebWatch is an open-source, developer-first CLI for web quality monitoring.

Its purpose is to help developers detect, investigate and prevent website regressions through crawling, browser checks, resource validation, performance analysis and visual comparisons.

### Core Principles

- Developer-first user experience.
- Local-first execution.
- Open-source core.
- Minimal dependencies.
- Security by default.
- Deterministic and reproducible results.
- Evidence-based findings.
- Modular architecture without premature complexity.

## Development Guidelines

- Use TypeScript throughout the project.
- Use pnpm for package management.
- Preserve the existing monorepo structure.
- Keep package responsibilities clearly separated.
- Prefer small, focused changes.
- Avoid unnecessary dependencies.
- Write tests for new functionality and bug fixes.
- Never introduce unrelated refactoring.
- Preserve backwards compatibility unless explicitly requested.
- Do not commit or push changes unless explicitly instructed.

## Code Quality

Before considering a task complete:

1. Run relevant tests.
2. Run linting.
3. Run TypeScript type checking.
4. Run the build.
5. Review the final diff.
6. Report any known limitations.

Never claim a check passed unless it was actually executed successfully.

## Security

Security is a fundamental product requirement.

- Validate all user-provided URLs.
- Protect against SSRF.
- Validate DNS resolutions and redirect destinations.
- Prevent access to private and internal network addresses.
- Apply request timeouts and response size limits.
- Avoid executing untrusted website code unnecessarily.
- Do not weaken existing security protections to simplify implementation.
- Add regression tests for security-related bug fixes.

## Commit Message Convention

Follow Conventional Commits.

All commit messages must use:

`<type>(<scope>): <description>`

### Allowed Types

- `feat`: New functionality.
- `fix`: Bug fixes.
- `docs`: Documentation changes.
- `test`: Test additions or modifications.
- `refactor`: Code changes without behavior changes.
- `perf`: Performance improvements.
- `build`: Build system and dependency changes.
- `ci`: CI/CD changes.
- `chore`: Maintenance tasks.
- `style`: Formatting changes without behavior changes.

### Scopes

Use the relevant package or functional area when appropriate:

- `cli`
- `core`
- `crawler`
- `checks`
- `visual`
- `reporter`
- `config`
- `deps`

Scopes may be omitted when they do not add meaningful context.

### Commit Message Rules

- Always write commit messages in English.
- Use the imperative mood: `add`, `fix`, `update`, `remove`.
- Start the description with lowercase.
- Do not end with a period.
- Keep subject lines concise, preferably under 72 characters.
- Each commit should represent one logical change.
- Never use vague messages such as `updates`, `misc changes` or `WIP`.

### Examples

Good:

- `feat(cli): add scan command`
- `feat(crawler): discover same-origin URLs`
- `fix(crawler): close redirect responses immediately`
- `test(crawler): cover redirect timeout handling`
- `docs(readme): document installation`
- `refactor(core): simplify URL normalization`

### Breaking Changes

Mark breaking changes using `!`:

`feat(core)!: change crawler result format`

Include a `BREAKING CHANGE:` footer when additional explanation is required.

## Working With Tasks

- Inspect existing code before making changes.
- Understand existing architecture and conventions.
- Prefer extending existing abstractions over creating duplicate implementations.
- Ask for clarification when requirements are ambiguous and the decision materially affects architecture.
- Keep changes focused on the requested task.
- Explain important architectural decisions.
- Summarize changed files, tests and potential risks after implementation.

## Product Direction

WebWatch should evolve into a reliable web quality platform.

Potential future capabilities include:

- HTTP and resource validation.
- Browser-based checks.
- Visual regression detection.
- Performance monitoring.
- CDN and cache diagnostics.
- Release correlation and root cause analysis.
- AI-assisted investigation.

Do not implement future capabilities unless they are explicitly part of the current task.

Always prioritize a reliable, focused developer tool over feature breadth.
