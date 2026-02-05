import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';

const CONFIG_FILENAME = 'pkg-manager.config.ts';
const DEFAULT_HASH_STORE_PATH = 'node_modules/.pkg-manager/hashes.json';

const prePublishScriptSchema = z.object({
  command: z.string(),
  label: z.string(),
});

const monorepoPackageSchema = z.object({
  name: z.string(),
  path: z.string(),
  dependsOn: z.array(z.string()).optional(),
});

const pkgManagerConfigSchema = z.object({
  prePublish: z.array(prePublishScriptSchema).optional(),
  monorepo: z.object({
    packages: z.array(monorepoPackageSchema),
  }).optional(),
  hashStorePath: z.string().optional(),
  requireMajorConfirmation: z.boolean().optional(),
});

export type PrePublishScript = {
  /** The shell command to execute */
  command: string;
  /** Display label shown during execution */
  label: string;
};

export type MonorepoPackage = {
  /** Package name (as in package.json) */
  name: string;
  /** Relative path to the package directory */
  path: string;
  /** Package names this package depends on (for topological ordering) */
  dependsOn?: string[];
};

/**
 * Configuration for pkg-manager.
 */
export type PkgManagerConfig = {
  /** Scripts to run before publishing (e.g., build commands) */
  prePublish?: PrePublishScript[];
  /** Monorepo configuration for multi-package projects */
  monorepo?: {
    /** Array of packages in the monorepo */
    packages: MonorepoPackage[];
  };
  /**
   * Custom path for storing publish hashes.
   * @default "node_modules/.pkg-manager/hashes.json"
   */
  hashStorePath?: string;
  /**
   * Require confirmation for major version bumps.
   * @default true
   */
  requireMajorConfirmation?: boolean;
};

/**
 * Defines the configuration for pkg-manager.
 *
 * @param config - The configuration object
 * @param config.prePublish - Scripts to run before publishing (e.g., build commands)
 * @param config.prePublish[].command - The shell command to execute
 * @param config.prePublish[].label - Display label shown during execution
 * @param config.monorepo - Monorepo configuration for multi-package projects
 * @param config.monorepo.packages - Array of packages in the monorepo
 * @param config.monorepo.packages[].name - Package name (as in package.json)
 * @param config.monorepo.packages[].path - Relative path to the package directory
 * @param config.monorepo.packages[].dependsOn - Package names this package depends on (for topological ordering)
 * @param config.hashStorePath - Custom path for storing publish hashes (default: `node_modules/.pkg-manager/hashes.json`)
 * @param config.requireMajorConfirmation - Require confirmation for major version bumps (default: `true`)
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   requireMajorConfirmation: true,
 *   prePublish: [{ command: 'pnpm build', label: 'Building' }],
 * });
 * ```
 */
export function defineConfig(config: PkgManagerConfig): PkgManagerConfig {
  return config;
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_FILENAME);
}

export function configExists(cwd: string = process.cwd()): boolean {
  return existsSync(getConfigPath(cwd));
}

const defaultConfig: PkgManagerConfig = {
  hashStorePath: DEFAULT_HASH_STORE_PATH,
  requireMajorConfirmation: true,
};

export async function loadConfig(cwd: string = process.cwd()): Promise<PkgManagerConfig> {
  const configPath = getConfigPath(cwd);

  if (!existsSync(configPath)) return defaultConfig;

  const configModule: { default: unknown } = await import(pathToFileURL(configPath).href);
  const config = pkgManagerConfigSchema.parse(configModule.default);

  return {
    ...config,
    hashStorePath: config.hashStorePath ?? DEFAULT_HASH_STORE_PATH,
    requireMajorConfirmation: config.requireMajorConfirmation ?? true,
  };
}

export function generateConfigFile(
  config: PkgManagerConfig,
  cwd: string = process.cwd(),
): void {
  const configPath = getConfigPath(cwd);

  const lines: string[] = [
    `import { defineConfig } from '@ls-stack/pkg-manager';`,
    '',
    'export default defineConfig({',
  ];

  if (config.requireMajorConfirmation !== undefined) {
    lines.push(`  requireMajorConfirmation: ${config.requireMajorConfirmation},`);
  }

  if (config.prePublish && config.prePublish.length > 0) {
    lines.push('  prePublish: [');
    for (const script of config.prePublish) {
      lines.push(`    { command: '${script.command}', label: '${script.label}' },`);
    }
    lines.push('  ],');
  }

  if (config.monorepo) {
    lines.push('  monorepo: {');
    lines.push('    packages: [');
    for (const pkg of config.monorepo.packages) {
      if (pkg.dependsOn && pkg.dependsOn.length > 0) {
        const depsStr = pkg.dependsOn.map((d) => `'${d}'`).join(', ');
        lines.push(`      { name: '${pkg.name}', path: '${pkg.path}', dependsOn: [${depsStr}] },`);
      } else {
        lines.push(`      { name: '${pkg.name}', path: '${pkg.path}' },`);
      }
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('});');
  lines.push('');

  writeFileSync(configPath, lines.join('\n'));
}

export function getHashStorePath(config: PkgManagerConfig): string {
  return config.hashStorePath ?? DEFAULT_HASH_STORE_PATH;
}
