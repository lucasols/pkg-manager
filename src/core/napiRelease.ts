import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { PackageRelease } from './config.ts'
import { generateDirectoryHash, generatePackageHash } from './hash.ts'
import { runCmd } from '../utils/runCmd.ts'

const DEFAULT_NPM_DIR = 'npm'
const platformPackageSchema = z.object({ name: z.string() })

function getNpmDir(release: PackageRelease): string {
  return release.npmDir ?? DEFAULT_NPM_DIR
}

export function generateNapiReleaseHash(
  packagePath: string,
  release: PackageRelease,
): string {
  const platformDir = join(packagePath, getNpmDir(release))
  const platformPackageNames = readdirSync(platformDir, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = readFileSync(
        join(platformDir, entry.name, 'package.json'),
        'utf-8',
      )
      return platformPackageSchema.parse(JSON.parse(manifest)).name
    })
  const rootHash = generatePackageHash(packagePath, {
    normalizedOptionalDependencies: platformPackageNames,
  })
  const platformHash = generateDirectoryHash(platformDir, {
    normalizePackageJsonVersions: true,
  })

  return createHash('sha256')
    .update(rootHash)
    .update(platformHash)
    .digest('hex')
}

export async function prepareNapiRelease(
  packagePath: string,
  release: PackageRelease,
) {
  const npmDir = getNpmDir(release)
  const versionResult = await runCmd(
    'sync N-API platform versions',
    ['pnpm', 'exec', 'napi', 'version', '--npm-dir', npmDir],
    { cwd: packagePath },
  )

  if (!versionResult.ok) return versionResult

  const validationResult = await runCmd(
    'validate N-API platform packages',
    [
      'pnpm',
      'exec',
      'napi',
      'pre-publish',
      '--npm-dir',
      npmDir,
      '--skip-optional-publish',
      '--no-gh-release',
    ],
    { cwd: packagePath },
  )

  if (!validationResult.ok) return validationResult

  return runCmd(
    'sync lockfile after N-API version update',
    ['pnpm', 'install', '--lockfile-only'],
    { cwd: packagePath },
  )
}

export function publishNapiPlatformPackages(
  packagePath: string,
  release: PackageRelease,
  distTag: string | undefined,
) {
  const npmConfig = distTag ? { npm_config_tag: distTag } : undefined

  return runCmd(
    'publish N-API platform packages',
    [
      'pnpm',
      'exec',
      'napi',
      'pre-publish',
      '--npm-dir',
      getNpmDir(release),
      '--no-gh-release',
    ],
    { cwd: packagePath, env: npmConfig },
  )
}

export function describeNapiRelease(release: PackageRelease): string[] {
  const npmDir = getNpmDir(release)

  return [
    `Would synchronize platform package versions in ${npmDir}.`,
    'Would validate every configured platform artifact before publishing.',
    'Would synchronize the workspace lockfile with the new native version.',
    'Would publish all platform packages before the root package.',
  ]
}
