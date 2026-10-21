# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Run CLI locally: tsx src/main.ts
pnpm lint         # Type check + lint (pnpm tsc && pnpm eslint)
pnpm build        # Full build: pnpm lint && tsdown
pnpm tsc          # Type check only
pnpm eslint       # Lint only (CI=true, --max-warnings=0)
```

No test framework is configured. Testing is manual via pre-publish scripts.

## Architecture

This is a CLI tool for publishing npm packages with hash-based duplicate detection and monorepo support.

### Core Flow

1. **Config Loading** (`src/core/config.ts`): Loads and validates `pkg-manager.config.ts` using Zod schemas
2. **Change Detection** (`src/core/hash.ts`): SHA256 hashes `dist/` directory to detect actual changes, stores in `.pkg-manager-hash`
3. **Monorepo Resolution** (`src/core/monorepo.ts`): Detects monorepo packages, topologically sorts by dependencies
4. **Publish Command** (`src/commands/publish.ts`): Orchestrates build → hash check → version bump → npm publish → git tag

### Key Design Decisions

- **Hash-based publishing**: Prevents duplicate publishes by comparing `dist/` hash, not version numbers
- **Git integration**: Validates clean working directory, auto-commits hash files, creates version tags
- **Topological builds**: In monorepos, builds/publishes packages in dependency order using pnpm filters
- **Non-interactive support**: Every command must work in non-interactive shells (CI, scripts, agents). Every interactive prompt (`cliInput.*`) needs a flag or arg that bypasses it (e.g. `--type`, the package positional, `--skip-confirm`). When a prompt is reached without a TTY, `@ls-stack/cli` prints an error and exits 1, so a missing bypass fails the run instead of hanging. Never add a prompt that can't be skipped by args. To verify, run with stdin from `/dev/null` and stdout piped (e.g. `node src/main.ts publish --dry-run --type patch </dev/null | cat`)

### Entry Points

- `src/main.ts`: CLI commands registration (uses `@ls-stack/cli`)
- `src/exports.ts`: Public API for programmatic usage

## Dependencies

- `@ls-stack/cli`: Custom CLI framework for commands, args, and prompts
- `zod@^4`: Runtime schema validation for config files
- Requires Node.js >= 25.0.0 (native TypeScript support)
