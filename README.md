# pkg-manager

CLI tool for managing package publishing with hash-based change tracking and monorepo support.

**Requires Node.js >= 25.0.0** (uses native TypeScript support)

## Installation

```bash
pnpm add -D @ls-stack/pkg-manager
```

## Quick Start

```bash
# Initialize configuration
pkg-manager init

# Publish a package
pkg-manager publish
```

## Commands

### `init`

Creates a `pkg-manager.config.ts` configuration file.

```bash
pkg-manager init [--force]
```

**Options:**

- `--force` - Overwrite existing config file

**Features:**

- Detects monorepo setup (looks for `pnpm-workspace.yaml`)
- Prompts for pre-publish scripts (lint, test, build)
- Scans `packages/` directory for monorepo packages
- Allows configuring inter-package dependencies

### `publish`

Publishes a package with hash-based change detection.

```bash
pkg-manager publish [package] [--type <major|minor|patch>] [--force] [--dry-run] [--skip-confirm]
```

**Arguments:**

- `package` - Package name to publish (monorepo only, optional - prompts if not provided)

**Options:**

- `--type <type>` - Version bump type: `major`, `minor`, or `patch`
- `--force` - Publish even if no changes detected
- `--dry-run` - Preview what would happen without making changes
- `--skip-confirm` - Skip major version confirmation prompt

**Workflow:**

1. Verifies git working directory is clean
2. Prompts for version type if not provided
3. Confirms major version bumps (configurable)
4. Builds dependencies first (monorepo, topological order)
5. Runs pre-publish scripts (required - see [Pre-Publish Scripts](#pre-publish-scripts))
6. Generates SHA256 hash of `dist/` directory
7. Checks hash against stored hashes (prevents duplicate publishes)
8. Bumps version with `pnpm version`
9. Creates git tag (`packageName@version`)
10. Publishes with `pnpm publish --access public`
11. Saves hash for future duplicate detection

## Configuration

Configuration is optional and stored in `pkg-manager.config.ts`:

```typescript
import { defineConfig } from '@ls-stack/pkg-manager'

export default defineConfig({
  requireMajorConfirmation: true,
  prePublish: [
    { command: 'pnpm lint', label: 'Linting' },
    { command: 'pnpm test', label: 'Testing' },
    { command: 'pnpm build', label: 'Building' },
  ],
  monorepo: {
    packages: [
      { name: '@scope/core', path: 'packages/core' },
      {
        name: '@scope/utils',
        path: 'packages/utils',
        dependsOn: ['@scope/core'],
      },
    ],
  },
})
```

### Options

| Option                          | Type       | Default                                 | Description                             |
| ------------------------------- | ---------- | --------------------------------------- | --------------------------------------- |
| `prePublish`                    | `array`    | Uses `pre-publish` script               | Scripts to run before publishing        |
| `prePublish[].command`          | `string`   | Required                                | Command to execute                      |
| `prePublish[].label`            | `string`   | Required                                | Display label for the script            |
| `monorepo`                      | `object`   | -                                       | Monorepo configuration                  |
| `monorepo.packages`             | `array`    | Required                                | List of packages                        |
| `monorepo.packages[].name`      | `string`   | Required                                | Package name (from package.json)        |
| `monorepo.packages[].path`      | `string`   | Required                                | Path to package directory               |
| `monorepo.packages[].dependsOn` | `string[]` | `[]`                                    | Package names this depends on           |
| `hashStorePath`                 | `string`   | `node_modules/.pkg-manager/hashes.json` | Where to store publish hashes           |
| `requireMajorConfirmation`      | `boolean`  | `true`                                  | Require confirmation for major versions |

## Pre-Publish Scripts

Pre-publish scripts are **required**. They ensure your package is built and validated before publishing.

**Resolution order:**

1. If `prePublish` is configured in `pkg-manager.config.ts`, those scripts are used
2. Otherwise, looks for a `pre-publish` script in `package.json`
3. If neither exists, the publish command exits with an error

**Simplest setup** - add a `pre-publish` script to your `package.json`:

```json
{
  "scripts": {
    "pre-publish": "pnpm lint && pnpm build"
  }
}
```

This works without any config file.

## Hash-Based Change Detection

pkg-manager generates a SHA256 hash of the entire `dist/` directory (file paths + contents) before publishing. This hash is stored locally and checked on subsequent publishes to prevent publishing identical builds.

Hashes are stored in `node_modules/.pkg-manager/hashes.json` by default (not committed to git).

Use `--force` to bypass hash checking when needed.

## Monorepo Support

For monorepos, pkg-manager:

1. Detects monorepo setup via `pnpm-workspace.yaml`
2. Scans `packages/` for package.json files
3. Builds dependencies in topological order before the target package
4. Runs pre-publish scripts with `pnpm --filter <package>` in monorepo mode

### Dependency Order

If package B depends on package A (`dependsOn: ["@scope/a"]`), publishing B will first build A to ensure B has the latest dependency code.

## Examples

```bash
# Initialize with default settings
pkg-manager init

# Re-initialize, overwriting existing config
pkg-manager init --force

# Publish with interactive prompts
pkg-manager publish

# Publish a specific package with patch version
pkg-manager publish @scope/utils --type patch

# Preview publish without making changes
pkg-manager publish --dry-run

# Force publish even if unchanged
pkg-manager publish --force --type patch

# Publish major version without confirmation
pkg-manager publish --type major --skip-confirm
```

## License

MIT
