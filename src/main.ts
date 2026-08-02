#!/usr/bin/env node
import { createCLI, createCmd } from '@ls-stack/cli';
import { initCommand } from './commands/init.ts';
import { publishAllCommand } from './commands/publishAll.ts';
import { publishCommand } from './commands/publish.ts';

await createCLI(
  {
    name: 'pkg-manager',
    baseCmd: 'pkg-manager',
    sort: ['publish', 'publish-all', 'init'],
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
          description: 'Version bump type (e.g., patch, minor, major, prerelease, release, prepatch-alpha)',
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
        noPush: {
          type: 'flag',
          name: 'no-push',
          description: 'Skip pushing the version commit and tag',
        },
      },
      examples: [
        { args: ['--type', 'patch'], description: 'Publish a patch version' },
        { args: ['@my-scope/pkg', '--type', 'minor'], description: 'Publish specific package' },
        { args: ['--dry-run'], description: 'Preview publish without changes' },
        { args: ['--force', '--type', 'patch'], description: 'Force publish even if unchanged' },
        { args: ['--type', 'patch', '--no-push'], description: 'Publish without pushing git refs' },
      ],
      run: async ({ package: pkg, type, force, dryRun, skipConfirm, noPush }) => {
        await publishCommand({
          package: pkg || undefined,
          type,
          force,
          dryRun,
          skipConfirm,
          noPush,
        });
      },
    }),

    'publish-all': createCmd({
      short: 'pa',
      description: 'Publish every changed package in dependency order',
      args: {
        type: {
          type: 'value-string-flag',
          name: 'type',
          description: 'Version bump type for changed packages (default: patch)',
        },
        force: {
          type: 'flag',
          name: 'force',
          description: 'Publish every configured package, including unchanged packages',
        },
        dryRun: {
          type: 'flag',
          name: 'dry-run',
          description: 'Show what would be done without making changes',
        },
        skipConfirm: {
          type: 'flag',
          name: 'skip-confirm',
          description: 'Skip major version confirmation prompts',
        },
        noPush: {
          type: 'flag',
          name: 'no-push',
          description: 'Skip pushing version commits and tags',
        },
      },
      examples: [
        { args: [], description: 'Publish changed packages with patch bumps' },
        { args: ['--type', 'minor'], description: 'Publish changed packages with minor bumps' },
        { args: ['--dry-run'], description: 'Preview changed package releases' },
      ],
      run: async ({ type, force, dryRun, skipConfirm, noPush }) => {
        await publishAllCommand({
          type,
          force,
          dryRun,
          skipConfirm,
          noPush,
        });
      },
    }),
  },
);
