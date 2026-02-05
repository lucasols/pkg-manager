import { cliInput } from '@ls-stack/cli';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { styleText } from 'node:util';
import { z } from 'zod';
import {
  getHashStorePath,
  loadConfig,
  type PkgManagerConfig,
  type PrePublishScript,
} from '../core/config.ts';
import { commitIfDirty, isGitClean } from '../core/git.ts';
import {
  checkHashForDuplicate,
  generateDirectoryHash,
  savePackageHash,
} from '../core/hash.ts';
import { buildDependencies } from '../core/monorepo.ts';
import { runCmdOrExit } from '../utils/runCmd.ts';

const VERSION_TYPES = ['major', 'minor', 'patch'] as const;
type VersionType = (typeof VERSION_TYPES)[number];

const packageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

type PublishArgs = {
  package: string | undefined;
  type: string | undefined;
  force: boolean;
  dryRun: boolean;
  skipConfirm: boolean;
};

export async function publishCommand(args: PublishArgs): Promise<void> {
  const config = await loadConfig();
  const cwd = process.cwd();

  const isClean = await isGitClean();

  if (!isClean) {
    console.error(
      styleText(['red', 'bold'], 'Git working directory is not clean.'),
    );
    console.error('Please commit or stash your changes before publishing.');
    process.exit(1);
  }

  const targetPackage = await resolveTargetPackage(args.package, config);
  const packagePath = getPackagePath(targetPackage, config, cwd);
  const packageName = getPackageName(packagePath);

  console.log(styleText(['blue', 'bold'], `\nPublishing: ${packageName}`));

  if (args.dryRun) {
    console.log(styleText(['yellow'], '(dry-run mode - no changes will be made)\n'));
  }

  const versionType = await resolveVersionType(args.type);

  if (versionType === 'major' && config.requireMajorConfirmation && !args.skipConfirm) {
    const confirmed = await cliInput.confirm(
      'You are about to publish a MAJOR version. Are you sure?',
      { initial: false },
    );

    if (!confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  if (config.monorepo?.packages) {
    console.log(styleText(['dim'], '\nBuilding dependencies...'));
    if (!args.dryRun) {
      await buildDependencies(packageName, config.monorepo.packages, cwd);
    }
  }

  const prePublishScripts = getPrePublishScripts(config, packagePath, packageName);

  console.log(styleText(['dim'], '\nRunning pre-publish scripts...'));

  for (const script of prePublishScripts) {
    console.log(styleText(['blue'], `\n${script.label}...`));

    if (!args.dryRun) {
      const [cmd, ...cmdArgs] = script.command.split(' ');

      if (!cmd) {
        console.error(styleText(['red'], `Invalid command: ${script.command}`));
        process.exit(1);
      }

      if (config.monorepo) {
        await runCmdOrExit(script.label, ['pnpm', '--filter', packageName, ...cmdArgs], {
          cwd,
        });
      } else {
        await runCmdOrExit(script.label, [cmd, ...cmdArgs], { cwd: packagePath });
      }
    }
  }

  const distPath = join(packagePath, 'dist');

  if (!existsSync(distPath)) {
    console.error(styleText(['red', 'bold'], `dist directory not found at ${distPath}`));
    console.error('Please build your package first.');
    process.exit(1);
  }

  console.log(styleText(['dim'], '\nGenerating build hash...'));
  const currentHash = generateDirectoryHash(distPath);
  console.log(styleText(['dim'], `Hash: ${currentHash.slice(0, 12)}...`));

  const hashStorePath = join(cwd, getHashStorePath(config));
  const hashCheck = checkHashForDuplicate(hashStorePath, packageName, currentHash);

  if (hashCheck.isDuplicate && !args.force) {
    console.error(
      styleText(
        ['red', 'bold'],
        `\nThis build has already been published as ${packageName}@${hashCheck.existingVersion}`,
      ),
    );
    console.error('No changes detected in the build output.');
    console.error('Make code changes before attempting to publish.');
    console.error('Or use --force to publish anyway.');
    process.exit(1);
  }

  if (hashCheck.isDuplicate && args.force) {
    console.warn(
      styleText(
        ['yellow'],
        `\nWarning: This build was already published as ${packageName}@${hashCheck.existingVersion}`,
      ),
    );
    console.warn('Force flag enabled - proceeding with publish anyway.');
  }

  console.log(styleText(['blue'], `\nBumping version (${versionType})...`));

  if (!args.dryRun) {
    await runCmdOrExit('bump version', ['pnpm', 'version', versionType], {
      cwd: packagePath,
    });

    await commitIfDirty(`chore: bump ${packageName} to next ${versionType} version`);
  }

  const newVersion = getPackageVersion(packagePath);
  console.log(styleText(['green'], `New version: ${newVersion}`));

  console.log(styleText(['blue'], '\nCreating git tag...'));

  if (!args.dryRun) {
    const tagName = `${packageName}@${newVersion}`;
    await runCmdOrExit('create tag', ['git', 'tag', tagName]);
    console.log(styleText(['dim'], `Created tag: ${tagName}`));
  }

  console.log(styleText(['blue'], '\nPublishing to npm...'));

  if (!args.dryRun) {
    await runCmdOrExit('publish', ['pnpm', 'publish', '--access', 'public'], {
      cwd: packagePath,
    });

    savePackageHash(hashStorePath, packageName, newVersion, currentHash);

    await commitIfDirty(`chore: update publish hashes for ${packageName}@${newVersion}`);
  }

  console.log(
    styleText(['green', 'bold'], `\nSuccessfully published ${packageName}@${newVersion}`),
  );
}

async function resolveTargetPackage(
  packageArg: string | undefined,
  config: PkgManagerConfig,
): Promise<string | undefined> {
  if (packageArg) return packageArg;

  if (!config.monorepo?.packages || config.monorepo.packages.length === 0) {
    return undefined;
  }

  const packageName = await cliInput.select('Select package to publish:', {
    options: config.monorepo.packages.map((pkg) => ({
      value: pkg.name,
      label: pkg.name,
      hint: pkg.path,
    })),
  });

  return packageName;
}

async function resolveVersionType(typeArg: string | undefined): Promise<VersionType> {
  if (typeArg) {
    const normalizedType = typeArg.toLowerCase();
    const matchingType = VERSION_TYPES.find((t) => t === normalizedType);

    if (!matchingType) {
      console.error(
        styleText(['red', 'bold'], `Invalid version type: ${typeArg}`),
      );
      console.error(`Valid types: ${VERSION_TYPES.join(', ')}`);
      process.exit(1);
    }
    return matchingType;
  }

  const versionType = await cliInput.select('Select version bump type:', {
    options: [
      { value: 'patch', label: 'patch', hint: 'Bug fixes (0.0.x)' },
      { value: 'minor', label: 'minor', hint: 'New features (0.x.0)' },
      { value: 'major', label: 'major', hint: 'Breaking changes (x.0.0)' },
    ],
  });

  return versionType;
}

function getPackagePath(
  targetPackage: string | undefined,
  config: PkgManagerConfig,
  cwd: string,
): string {
  if (!targetPackage) return cwd;

  const pkg = config.monorepo?.packages.find((p) => p.name === targetPackage);

  if (pkg) return join(cwd, pkg.path);

  return cwd;
}

function readPackageJson(packagePath: string): z.infer<typeof packageJsonSchema> {
  const packageJsonPath = join(packagePath, 'package.json');
  const content = readFileSync(packageJsonPath, 'utf-8');
  const parsed = JSON.parse(content);
  return packageJsonSchema.parse(parsed);
}

function getPackageName(packagePath: string): string {
  const packageJsonPath = join(packagePath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    console.error(
      styleText(['red', 'bold'], `package.json not found at ${packagePath}`),
    );
    process.exit(1);
  }

  const packageJson = readPackageJson(packagePath);

  if (!packageJson.name) {
    console.error(
      styleText(['red', 'bold'], 'package.json does not have a name field'),
    );
    process.exit(1);
  }

  return packageJson.name;
}

function getPackageVersion(packagePath: string): string {
  const packageJson = readPackageJson(packagePath);
  return packageJson.version ?? '0.0.0';
}

function getPrePublishScripts(
  config: PkgManagerConfig,
  packagePath: string,
  packageName: string,
): PrePublishScript[] {
  if (config.prePublish && config.prePublish.length > 0) {
    return config.prePublish;
  }

  const packageJson = readPackageJson(packagePath);
  const hasPrePublishScript = packageJson.scripts?.['pre-publish'] !== undefined;

  if (hasPrePublishScript) {
    return [{ command: 'pnpm pre-publish', label: 'Running pre-publish script' }];
  }

  console.error(
    styleText(
      ['red', 'bold'],
      `\nNo pre-publish scripts configured for ${packageName}`,
    ),
  );
  console.error(
    'Either add a "pre-publish" script to package.json or configure "prePublish" in pkg-manager.config.ts',
  );
  process.exit(1);
}
