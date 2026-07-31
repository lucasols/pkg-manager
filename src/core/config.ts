import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { z } from 'zod'

const CONFIG_FILENAME = 'pkg-manager.config.ts'
const DEFAULT_HASH_STORE_PATH = 'node_modules/.pkg-manager/hashes.json'

const prePublishScriptSchema = z.object({
  command: z.string(),
  label: z.string(),
})

const packageReleaseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('napi'),
    npmDir: z.string().optional(),
  }),
])

const monorepoPackageSchema = z.object({
  name: z.string(),
  path: z.string(),
  dependsOn: z.array(z.string()).optional(),
  release: packageReleaseSchema.optional(),
})

const pkgManagerConfigSchema = z.object({
  prePublish: z.array(prePublishScriptSchema).optional(),
  postPublish: z.array(prePublishScriptSchema).optional(),
  monorepo: z
    .object({
      packages: z.array(monorepoPackageSchema),
    })
    .optional(),
  hashStorePath: z.string().optional(),
  requireMajorConfirmation: z.boolean().optional(),
  gitPush: z.boolean().optional(),
})

export type PackageRelease = {
  /** Publish the root package and all @napi-rs platform packages as one unit */
  type: 'napi'
  /** Directory containing generated platform packages, relative to the package */
  npmDir?: string
}

export type MonorepoPackage = {
  /** Package name (as in package.json) */
  name: string
  /** Relative path to the package directory */
  path: string
  /** Package names this package depends on (for topological ordering) */
  dependsOn?: string[]
  /** Specialized release lifecycle for this package */
  release?: PackageRelease
}

export type PrePublishScript = {
  /** The shell command to execute */
  command: string
  /** Display label shown during execution */
  label: string
}

/**
 * Configuration for pkg-manager.
 */
export type PkgManagerConfig = {
  /** Scripts to run before publishing (e.g., build commands) */
  prePublish?: PrePublishScript[]
  /** Scripts to run after publishing (e.g., deploy, notifications) */
  postPublish?: PrePublishScript[]
  /** Monorepo configuration for multi-package projects */
  monorepo?: {
    /** Array of packages in the monorepo */
    packages: MonorepoPackage[]
  }
  /**
   * Custom path for storing publish hashes.
   * @default "node_modules/.pkg-manager/hashes.json"
   */
  hashStorePath?: string
  /**
   * Require confirmation for major version bumps.
   * @default true
   */
  requireMajorConfirmation?: boolean
  /**
   * Push the version commit and tag after publishing.
   * @default true
   */
  gitPush?: boolean
}

/**
 * Defines the configuration for pkg-manager.
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
  return config
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, CONFIG_FILENAME)
}

export function configExists(cwd: string = process.cwd()): boolean {
  return existsSync(getConfigPath(cwd))
}

const defaultConfig: PkgManagerConfig = {
  hashStorePath: DEFAULT_HASH_STORE_PATH,
  requireMajorConfirmation: true,
  gitPush: true,
}

export async function loadConfig(
  cwd: string = process.cwd()
): Promise<PkgManagerConfig> {
  const configPath = getConfigPath(cwd)

  if (!existsSync(configPath)) return defaultConfig

  const configModule: { default: unknown } = await import(
    pathToFileURL(configPath).href
  )
  const config = pkgManagerConfigSchema.parse(configModule.default)

  return {
    ...config,
    hashStorePath: config.hashStorePath ?? DEFAULT_HASH_STORE_PATH,
    requireMajorConfirmation: config.requireMajorConfirmation ?? true,
    gitPush: config.gitPush ?? true,
  }
}

export function generateConfigFile(
  config: PkgManagerConfig,
  cwd: string = process.cwd()
): void {
  const configPath = getConfigPath(cwd)

  const lines: string[] = [
    `import { defineConfig } from '@ls-stack/pkg-manager';`,
    '',
    'export default defineConfig({',
  ]

  if (config.requireMajorConfirmation !== undefined) {
    lines.push(
      `  requireMajorConfirmation: ${config.requireMajorConfirmation},`
    )
  }

  if (config.gitPush !== undefined) {
    lines.push(`  gitPush: ${config.gitPush},`)
  }

  if (config.prePublish && config.prePublish.length > 0) {
    lines.push('  prePublish: [')
    for (const script of config.prePublish) {
      lines.push(
        `    { command: '${script.command}', label: '${script.label}' },`
      )
    }
    lines.push('  ],')
  }

  if (config.postPublish && config.postPublish.length > 0) {
    lines.push('  postPublish: [')
    for (const script of config.postPublish) {
      lines.push(
        `    { command: '${script.command}', label: '${script.label}' },`
      )
    }
    lines.push('  ],')
  }

  if (config.monorepo) {
    lines.push('  monorepo: {')
    lines.push('    packages: [')
    for (const pkg of config.monorepo.packages) {
      const fields = [`name: '${pkg.name}'`, `path: '${pkg.path}'`]

      if (pkg.dependsOn && pkg.dependsOn.length > 0) {
        const depsStr = pkg.dependsOn.map((dependency) => `'${dependency}'`)
        fields.push(`dependsOn: [${depsStr.join(', ')}]`)
      }

      if (pkg.release?.type === 'napi') {
        const npmDir = pkg.release.npmDir
          ? `, npmDir: '${pkg.release.npmDir}'`
          : ''
        fields.push(`release: { type: 'napi'${npmDir} }`)
      }

      lines.push(`      { ${fields.join(', ')} },`)
    }
    lines.push('    ],')
    lines.push('  },')
  }

  lines.push('});')
  lines.push('')

  writeFileSync(configPath, lines.join('\n'))
}

export function getHashStorePath(config: PkgManagerConfig): string {
  return config.hashStorePath ?? DEFAULT_HASH_STORE_PATH
}
