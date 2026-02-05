#!/usr/bin/env node
import { createCLI, createCmd } from '@ls-stack/cli';
import { initCommand } from './commands/init.ts';
import { publishCommand } from './commands/publish.ts';

await createCLI(
  {
    name: 'pkg-manager',
    baseCmd: 'pkg-manager',
    sort: ['publish', 'init'],
  },
  {
    init: createCmd({
      description: 'Initialize pkg-manager configuration',
      args: {
        force: {
          type: 'flag',
          name: 'force',
          description: 'Overwrite existing config file',
        },
      },
      run: async ({ force }) => {
        await initCommand({ force });
      },
    }),

    publish: createCmd({
      short: 'p',
      description: 'Publish a package with hash-based change detection',
      args: {
        package: {
          type: 'positional-string',
          name: 'package',
          description: 'Package name to publish (monorepo only)',
          default: '',
        },
        type: {
          type: 'value-string-flag',
          name: 'type',
          description: 'Version bump type: major, minor, or patch',
        },
        force: {
          type: 'flag',
          name: 'force',
          description: 'Force publish even if no changes detected',
        },
        dryRun: {
          type: 'flag',
          name: 'dry-run',
          description: 'Show what would be done without making changes',
        },
        skipConfirm: {
          type: 'flag',
          name: 'skip-confirm',
          description: 'Skip major version confirmation prompt',
        },
      },
      examples: [
        { args: ['--type', 'patch'], description: 'Publish a patch version' },
        { args: ['@my-scope/pkg', '--type', 'minor'], description: 'Publish specific package' },
        { args: ['--dry-run'], description: 'Preview publish without changes' },
        { args: ['--force', '--type', 'patch'], description: 'Force publish even if unchanged' },
      ],
      run: async ({ package: pkg, type, force, dryRun, skipConfirm }) => {
        await publishCommand({
          package: pkg || undefined,
          type,
          force,
          dryRun,
          skipConfirm,
        });
      },
    }),
  },
);
