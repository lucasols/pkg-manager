import { cliInput } from '@ls-stack/cli'
import clipboardy from 'clipboardy'
import { env } from 'node:process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { styleText } from 'node:util'
import { z } from 'zod'
import {
  getHashStorePath,
  loadConfig,
  type PkgManagerConfig,
  type PrePublishScript,
} from '../core/config.ts'
import { commitIfDirty, isGitClean } from '../core/git.ts'
import {
  checkHashForDuplicate,
  generatePackageHash,
  savePackageHash,
} from '../core/hash.ts'
import { buildDependencies } from '../core/monorepo.ts'
import {
  bumpVersionPreview,
  getNextTags,
  getPrereleaseTag,
  isPrerelease,
  PRERELEASE_TAGS,
  type PrereleaseTag,
} from '../core/semver.ts'
import { runCmd, runCmdOrExit } from '../utils/runCmd.ts'

const PRE_TYPE_REGEX = /^(prepatch|preminor|premajor)-(\w+)$/

type VersionBumpSpec = {
  label: string
  versionArgs: string[]
  isMajor: boolean
  distTag: string | undefined
}

const packageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  publishConfig: z
    .object({
      registry: z.string().optional(),
    })
    .optional(),
  scripts: z.record(z.string(), z.string()).optional(),
})

type PublishArgs = {
  package: string | undefined
  type: string | undefined
  force: boolean
  dryRun: boolean
  skipConfirm: boolean
  noPush: boolean
}

export async function publishCommand(args: PublishArgs): Promise<void> {
  const config = await loadConfig()
  const cwd = process.cwd()

  const isClean = await isGitClean()

  if (!isClean) {
    console.error(
      styleText(['red', 'bold'], 'Git working directory is not clean.'),
    )
    console.error('Please commit or stash your changes before publishing.')
    process.exit(1)
  }

  const targetPackage = await resolveTargetPackage(args.package, config)
  const packagePath = getPackagePath(targetPackage, config, cwd)
  const packageName = getPackageName(packagePath)

  const currentVersion = getPackageVersion(packagePath)

  console.log(
    styleText(
      ['blue', 'bold'],
      `\nPublishing: ${packageName} (current: ${currentVersion})`,
    ),
  )

  if (args.dryRun) {
    console.log(
      styleText(['yellow'], '(dry-run mode - no changes will be made)\n'),
    )
  }

  const skipPublishGitChecks = await checkPublishBranch(packagePath)

  const versionBump = await resolveVersionBump(args.type, currentVersion)

  if (
    versionBump.isMajor &&
    config.requireMajorConfirmation &&
    !args.skipConfirm
  ) {
    const confirmed = await cliInput.confirm(
      'You are about to publish a MAJOR version. Are you sure?',
      { initial: false },
    )

    if (!confirmed) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  if (config.monorepo?.packages) {
    console.log(styleText(['dim'], '\nBuilding dependencies...'))
    if (!args.dryRun) {
      await buildDependencies(packageName, config.monorepo.packages, cwd)
    }
  }

  const prePublishScripts = getPrePublishScripts(
    config,
    packagePath,
    packageName,
  )

  console.log(styleText(['dim'], '\nRunning pre-publish scripts...'))

  for (const script of prePublishScripts) {
    console.log(styleText(['blue'], `\n${script.label}...`))

    if (!args.dryRun) {
      const [cmd, ...cmdArgs] = script.command.split(' ')

      if (!cmd) {
        console.error(styleText(['red'], `Invalid command: ${script.command}`))
        process.exit(1)
      }

      if (config.monorepo) {
        await runCmdOrExit(
          script.label,
          ['pnpm', '--filter', packageName, ...cmdArgs],
          {
            cwd,
          },
        )
      } else {
        await runCmdOrExit(script.label, [cmd, ...cmdArgs], {
          cwd: packagePath,
        })
      }
    }
  }

  console.log(styleText(['dim'], '\nGenerating package hash...'))
  const currentHash = generatePackageHash(packagePath)
  console.log(styleText(['dim'], `Hash: ${currentHash.slice(0, 12)}...`))

  const hashStorePath = join(cwd, getHashStorePath(config))
  const hashCheck = checkHashForDuplicate(
    hashStorePath,
    packageName,
    currentHash,
  )

  if (hashCheck.isDuplicate && !args.force) {
    console.error(
      styleText(
        ['red', 'bold'],
        `\nThis build has already been published as ${packageName}@${hashCheck.existingVersion}`,
      ),
    )
    console.error('No changes detected in the package files.')
    console.error('Make code changes before attempting to publish.')
    console.error('Or use --force to publish anyway.')
    process.exit(1)
  }

  if (hashCheck.isDuplicate && args.force) {
    console.warn(
      styleText(
        ['yellow'],
        `\nWarning: This build was already published as ${packageName}@${hashCheck.existingVersion}`,
      ),
    )
    console.warn('Force flag enabled - proceeding with publish anyway.')
  }

  const preBumpHead = !args.dryRun ? await getCurrentHead() : undefined
  const existingTags = !args.dryRun ? await getGitTags() : new Set<string>()
  const createdTags: string[] = []
  const shouldPushGitRefs = config.gitPush !== false && !args.noPush

  console.log(
    styleText(['blue'], `\nBumping version (${versionBump.label})...`),
  )

  if (!args.dryRun) {
    const bumpResult = await runCmd(
      'bump version',
      ['pnpm', 'version', ...versionBump.versionArgs],
      {
        cwd: packagePath,
      },
    )

    if (!bumpResult.ok) {
      console.error(styleText(['red', 'bold'], 'Failed: bump version'))
      console.error(bumpResult.error)
      await rollbackVersionChanges(
        'Version bump failed after making changes.',
        requireRollbackHead(preBumpHead),
        packageName,
        getPackageVersion(packagePath),
        createdTags,
        existingTags,
      )
      process.exit(1)
    }

    const commitResult = await commitIfDirtyForPublish(
      `chore: bump ${packageName} version (${versionBump.label})`,
    )

    if (!commitResult.ok) {
      console.error(styleText(['red', 'bold'], 'Failed: commit version bump'))
      console.error(commitResult.error)
      await rollbackVersionChanges(
        'Version commit failed after making changes.',
        requireRollbackHead(preBumpHead),
        packageName,
        getPackageVersion(packagePath),
        createdTags,
        existingTags,
      )
      process.exit(1)
    }
  }

  const newVersion = getPackageVersion(packagePath)
  console.log(styleText(['green'], `New version: ${newVersion}`))

  console.log(styleText(['blue'], '\nCreating git tag...'))

  const tagName = `${packageName}@${newVersion}`

  if (!args.dryRun) {
    const tagResult = await runCmd('create tag', ['git', 'tag', tagName])

    if (!tagResult.ok) {
      console.error(styleText(['red', 'bold'], 'Failed: create tag'))
      console.error(tagResult.error)
      await rollbackVersionChanges(
        'Tag creation failed after the version bump.',
        requireRollbackHead(preBumpHead),
        packageName,
        newVersion,
        createdTags,
        existingTags,
      )
      process.exit(1)
    }

    createdTags.push(tagName)
    console.log(styleText(['dim'], `Created tag: ${tagName}`))
  }

  console.log(styleText(['blue'], '\nPublishing to npm...'))

  if (!args.dryRun) {
    const publishArgs = ['pnpm', 'publish', '--access', 'public']

    if (skipPublishGitChecks) {
      publishArgs.push('--no-git-checks')
    }

    if (versionBump.distTag) {
      publishArgs.push('--tag', versionBump.distTag)
    }

    const publishResult = await runCmd('publish', publishArgs, {
      cwd: packagePath,
    })

    if (!publishResult.ok) {
      console.error(styleText(['red', 'bold'], 'Failed: publish'))
      console.error(publishResult.error)

      if (!preBumpHead) {
        console.error(
          'Could not roll back: original git HEAD was not captured.',
        )
        process.exit(1)
      }

      await rollbackVersionChanges(
        'Publish failed after the version bump.',
        preBumpHead,
        packageName,
        newVersion,
        createdTags,
        existingTags,
      )
      process.exit(1)
    }

    savePackageHash(hashStorePath, packageName, newVersion, currentHash)

    await commitIfDirty(
      `chore: update publish hashes for ${packageName}@${newVersion}`,
    )
  }

  if (args.dryRun) {
    const pushText = shouldPushGitRefs
      ? 'Would push git commits and tag.'
      : 'Would skip git push.'
    console.log(styleText(['dim'], `\n${pushText}`))
  } else if (shouldPushGitRefs) {
    console.log(styleText(['blue'], '\nPushing git commits and tag...'))

    const pushResult = await pushVersionCommitAndTag(tagName)

    if (!pushResult.ok) {
      console.error(styleText(['red', 'bold'], 'Failed: push git refs'))
      console.error(pushResult.error)
      console.error(
        'The package was published, but the git push failed. Push the commit and tag manually after fixing the remote issue.',
      )
      process.exit(1)
    }
  } else {
    console.log(styleText(['dim'], '\nSkipping git push.'))
  }

  console.log(
    styleText(
      ['green', 'bold'],
      `\nSuccessfully published ${packageName}@${newVersion}`,
    ),
  )

  const postPublishScripts = config.postPublish ?? []

  if (postPublishScripts.length > 0) {
    console.log(styleText(['dim'], '\nRunning post-publish scripts...'))

    for (const script of postPublishScripts) {
      console.log(styleText(['blue'], `\n${script.label}...`))

      if (!args.dryRun) {
        const [cmd, ...cmdArgs] = script.command.split(' ')

        if (!cmd) {
          console.error(
            styleText(['red'], `Invalid command: ${script.command}`),
          )
          process.exit(1)
        }

        if (config.monorepo) {
          await runCmdOrExit(
            script.label,
            ['pnpm', '--filter', packageName, ...cmdArgs],
            {
              cwd,
            },
          )
        } else {
          await runCmdOrExit(script.label, [cmd, ...cmdArgs], {
            cwd: packagePath,
          })
        }
      }
    }
  }

  const copyCmdPrefix = env.PKG_MANAGER_COPY_CMD

  if (copyCmdPrefix) {
    const installCmd = `${copyCmdPrefix} ${packageName}@${newVersion}`

    await clipboardy.write(installCmd)

    console.log(styleText(['dim'], `Copied to clipboard: ${installCmd}`))
  }
}

async function resolveTargetPackage(
  packageArg: string | undefined,
  config: PkgManagerConfig,
): Promise<string | undefined> {
  if (packageArg) return packageArg

  if (!config.monorepo?.packages || config.monorepo.packages.length === 0) {
    return undefined
  }

  const packageName = await cliInput.select('Select package to publish:', {
    options: config.monorepo.packages.map((pkg) => ({
      value: pkg.name,
      label: pkg.name,
      hint: pkg.path,
    })),
  })

  return packageName
}

const STABLE_TYPES = ['major', 'minor', 'patch'] as const
type StableType = (typeof STABLE_TYPES)[number]

const VALID_TYPE_ARGS = [
  ...STABLE_TYPES,
  'prerelease',
  'release',
  ...PRERELEASE_TAGS.flatMap((tag) =>
    (['prepatch', 'preminor', 'premajor'] as const).map(
      (base) => `${base}-${tag}`,
    ),
  ),
] as const

function parseTypeArg(
  typeArg: string,
  currentVersion: string,
): VersionBumpSpec {
  const normalized = typeArg.toLowerCase()

  const stableMatch = STABLE_TYPES.find((t) => t === normalized)
  if (stableMatch) {
    return {
      label: stableMatch,
      versionArgs: [stableMatch],
      isMajor: stableMatch === 'major',
      distTag: undefined,
    }
  }

  if (normalized === 'prerelease') {
    const currentTag = getPrereleaseTag(currentVersion)
    if (!currentTag) {
      console.error(
        styleText(
          ['red', 'bold'],
          'Cannot use --type=prerelease on a stable version.',
        ),
      )
      console.error(
        'Use prepatch-alpha, preminor-alpha, or premajor-alpha instead.',
      )
      process.exit(1)
    }
    return {
      label: 'prerelease',
      versionArgs: ['prerelease'],
      isMajor: false,
      distTag: currentTag,
    }
  }

  if (normalized === 'release') {
    if (!isPrerelease(currentVersion)) {
      console.error(
        styleText(
          ['red', 'bold'],
          'Cannot use --type=release on a stable version.',
        ),
      )
      process.exit(1)
    }
    return {
      label: 'release',
      versionArgs: ['patch'],
      isMajor: false,
      distTag: undefined,
    }
  }

  const preMatch = PRE_TYPE_REGEX.exec(normalized)
  if (preMatch) {
    const baseType = preMatch[1]
    const preid = preMatch[2]

    if (baseType && preid) {
      return {
        label: `${baseType} (${preid})`,
        versionArgs: [baseType, `--preid=${preid}`],
        isMajor: false,
        distTag: preid,
      }
    }
  }

  console.error(styleText(['red', 'bold'], `Invalid version type: ${typeArg}`))
  console.error(`Valid types: ${VALID_TYPE_ARGS.join(', ')}`)
  process.exit(1)
}

async function resolveVersionBump(
  typeArg: string | undefined,
  currentVersion: string,
): Promise<VersionBumpSpec> {
  if (typeArg) {
    return parseTypeArg(typeArg, currentVersion)
  }

  const currentPreTag = getPrereleaseTag(currentVersion)

  if (currentPreTag) {
    return resolveVersionBumpFromPrerelease(currentVersion, currentPreTag)
  }

  return resolveVersionBumpFromStable(currentVersion)
}

async function resolveVersionBumpFromStable(
  currentVersion: string,
): Promise<VersionBumpSpec> {
  type StableOption = StableType | 'prerelease-menu'

  const options: Array<{ value: StableOption; label: string; hint?: string }> =
    [
      {
        value: 'patch',
        label: 'patch',
        hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'patch')}`,
      },
      {
        value: 'minor',
        label: 'minor',
        hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'minor')}`,
      },
      {
        value: 'major',
        label: 'major',
        hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'major')}`,
      },
      { value: 'prerelease-menu', label: 'prerelease...' },
    ]

  const selection = await cliInput.select('Select version bump type:', {
    options,
  })

  if (selection === 'prerelease-menu') {
    return resolvePrerelaseSubmenu(currentVersion)
  }

  return {
    label: selection,
    versionArgs: [selection],
    isMajor: selection === 'major',
    distTag: undefined,
  }
}

async function resolvePrerelaseSubmenu(
  currentVersion: string,
): Promise<VersionBumpSpec> {
  const baseTypes = ['prepatch', 'preminor', 'premajor'] as const

  const options: Array<{ value: string; label: string; hint: string }> = []

  for (const tag of PRERELEASE_TAGS) {
    for (const base of baseTypes) {
      const preview = bumpVersionPreview(currentVersion, base, tag)
      options.push({
        value: `${base}-${tag}`,
        label: `${base} (${tag})`,
        hint: `${currentVersion} → ${preview}`,
      })
    }
  }

  const selection = await cliInput.select('Select prerelease type:', {
    options,
  })

  const [baseType, preid] = selection.split('-')

  if (!baseType || !preid) {
    console.error(styleText(['red', 'bold'], 'Unexpected selection format.'))
    process.exit(1)
  }

  return {
    label: `${baseType} (${preid})`,
    versionArgs: [baseType, `--preid=${preid}`],
    isMajor: false,
    distTag: preid,
  }
}

type PrereleaseOption =
  | 'prerelease'
  | 'release'
  | StableType
  | 'prerelease-menu'
  | `graduate-${PrereleaseTag}`

async function resolveVersionBumpFromPrerelease(
  currentVersion: string,
  currentTag: string,
): Promise<VersionBumpSpec> {
  const options: Array<{
    value: PrereleaseOption
    label: string
    hint: string
  }> = []

  options.push({
    value: 'prerelease',
    label: 'prerelease',
    hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'prerelease')}`,
  })

  const nextTags = getNextTags(currentTag)
  for (const tag of nextTags) {
    options.push({
      value: `graduate-${tag}`,
      label: `graduate to ${tag}`,
      hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'prerelease', tag)}`,
    })
  }

  options.push({
    value: 'release',
    label: 'release',
    hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'release')}`,
  })

  options.push(
    {
      value: 'patch',
      label: 'patch',
      hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'patch')}`,
    },
    {
      value: 'minor',
      label: 'minor',
      hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'minor')}`,
    },
    {
      value: 'major',
      label: 'major',
      hint: `${currentVersion} → ${bumpVersionPreview(currentVersion, 'major')}`,
    },
  )

  options.push({
    value: 'prerelease-menu',
    label: 'prerelease...',
    hint: 'start a new prerelease cycle',
  })

  const selection = await cliInput.select('Select version bump type:', {
    options,
  })

  if (selection === 'prerelease-menu') {
    return resolvePrerelaseSubmenu(currentVersion)
  }

  if (selection === 'prerelease') {
    return {
      label: 'prerelease',
      versionArgs: ['prerelease'],
      isMajor: false,
      distTag: currentTag,
    }
  }

  if (selection === 'release') {
    return {
      label: 'release',
      versionArgs: ['patch'],
      isMajor: false,
      distTag: undefined,
    }
  }

  if (selection.startsWith('graduate-')) {
    const targetTag = selection.replace('graduate-', '')
    return {
      label: `graduate to ${targetTag}`,
      versionArgs: ['prerelease', `--preid=${targetTag}`],
      isMajor: false,
      distTag: targetTag,
    }
  }

  return {
    label: selection,
    versionArgs: [selection],
    isMajor: selection === 'major',
    distTag: undefined,
  }
}

function getPackagePath(
  targetPackage: string | undefined,
  config: PkgManagerConfig,
  cwd: string,
): string {
  if (!targetPackage) return cwd

  const pkg = config.monorepo?.packages.find((p) => p.name === targetPackage)

  if (pkg) return join(cwd, pkg.path)

  return cwd
}

function readPackageJson(
  packagePath: string,
): z.infer<typeof packageJsonSchema> {
  const packageJsonPath = join(packagePath, 'package.json')
  const content = readFileSync(packageJsonPath, 'utf-8')
  const parsed = JSON.parse(content)
  return packageJsonSchema.parse(parsed)
}

function getPackageName(packagePath: string): string {
  const packageJsonPath = join(packagePath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    console.error(
      styleText(['red', 'bold'], `package.json not found at ${packagePath}`),
    )
    process.exit(1)
  }

  const packageJson = readPackageJson(packagePath)

  if (!packageJson.name) {
    console.error(
      styleText(['red', 'bold'], 'package.json does not have a name field'),
    )
    process.exit(1)
  }

  return packageJson.name
}

function getPackageVersion(packagePath: string): string {
  const packageJson = readPackageJson(packagePath)
  return packageJson.version ?? '0.0.0'
}

async function readPnpmConfigValue(
  key: string,
  cwd: string,
): Promise<string | undefined> {
  const result = await runCmd(
    `read pnpm config ${key}`,
    ['pnpm', 'config', 'get', key],
    { silent: true, cwd },
  )

  if (!result.ok) return undefined

  const value = result.output.trim()

  return value === '' || value === 'undefined' ? undefined : value
}

/**
 * Replicates pnpm's `publish-branch` git check before any version changes are
 * made, so a wrong-branch publish fails fast instead of after the version
 * bump. Returns true if `--no-git-checks` should be passed to `pnpm publish`.
 */
async function checkPublishBranch(packagePath: string): Promise<boolean> {
  const gitChecks = await readPnpmConfigValue('git-checks', packagePath)

  if (gitChecks === 'false') return false

  const publishBranch =
    (await readPnpmConfigValue('publish-branch', packagePath)) ?? 'master|main'

  const allowedBranches = publishBranch.split('|').map((branch) =>
    branch.trim(),
  )

  const branchResult = await runCmd(
    'read current branch',
    ['git', 'branch', '--show-current'],
    { silent: true },
  )

  const currentBranch = branchResult.ok ? branchResult.output.trim() : ''

  if (currentBranch && allowedBranches.includes(currentBranch)) return false

  const confirmed = await cliInput.confirm(
    `You're on branch "${currentBranch}" but your "publish-branch" is set to "${publishBranch}". Do you want to continue?`,
    { initial: false },
  )

  if (!confirmed) {
    console.log('Aborted.')
    process.exit(1)
  }

  return true
}

async function getCurrentHead(): Promise<string> {
  const result = await runCmd('read git HEAD', ['git', 'rev-parse', 'HEAD'], {
    silent: true,
  })

  if (!result.ok) {
    console.error(styleText(['red', 'bold'], 'Failed: read git HEAD'))
    console.error(result.error)
    process.exit(1)
  }

  return result.output.trim()
}

async function getGitTags(): Promise<Set<string>> {
  const result = await runCmd('read git tags', ['git', 'tag', '--list'], {
    silent: true,
  })

  if (!result.ok) {
    console.error(styleText(['red', 'bold'], 'Failed: read git tags'))
    console.error(result.error)
    process.exit(1)
  }

  return new Set(result.output.split('\n').filter(Boolean))
}

function requireRollbackHead(preBumpHead: string | undefined): string {
  if (!preBumpHead) {
    console.error('Could not roll back: original git HEAD was not captured.')
    process.exit(1)
  }

  return preBumpHead
}

async function commitIfDirtyForPublish(
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = await isGitClean()

  if (clean) {
    console.log('No changes to commit')
    return { ok: true }
  }

  const addResult = await runCmd('stage changes', ['git', 'add', '.'])

  if (!addResult.ok) return { ok: false, error: addResult.error }

  const commitResult = await runCmd('commit', ['git', 'commit', '-m', message])

  if (!commitResult.ok) return { ok: false, error: commitResult.error }

  return { ok: true }
}

async function pushVersionCommitAndTag(
  tagName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pushTarget = await getGitPushTarget()

  if (!pushTarget.ok) return pushTarget

  return runCmd('push version commit and tag', [
    'git',
    'push',
    '--atomic',
    pushTarget.remote,
    `HEAD:refs/heads/${pushTarget.branch}`,
    `refs/tags/${tagName}:refs/tags/${tagName}`,
  ])
}

async function getGitPushTarget(): Promise<
  { ok: true; remote: string; branch: string } | { ok: false; error: string }
> {
  const upstreamResult = await runCmd(
    'read git upstream',
    ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { silent: true },
  )

  if (upstreamResult.ok) {
    const upstream = upstreamResult.output.trim()
    const slashIndex = upstream.indexOf('/')

    if (slashIndex > 0 && slashIndex < upstream.length - 1) {
      return {
        ok: true,
        remote: upstream.slice(0, slashIndex),
        branch: upstream.slice(slashIndex + 1),
      }
    }
  }

  const branchResult = await runCmd(
    'read current branch',
    ['git', 'branch', '--show-current'],
    {
      silent: true,
    },
  )

  if (!branchResult.ok) return { ok: false, error: branchResult.error }

  const branch = branchResult.output.trim()

  if (!branch) {
    return {
      ok: false,
      error: 'Could not determine the current git branch to push.',
    }
  }

  return { ok: true, remote: 'origin', branch }
}

async function rollbackVersionChanges(
  reason: string,
  preBumpHead: string,
  packageName: string,
  version: string,
  createdTags: string[],
  existingTags: Set<string>,
): Promise<void> {
  console.log(
    styleText(['yellow'], `\n${reason} Rolling back version changes...`),
  )

  const tagsToDelete = [...new Set([...createdTags, `v${version}`])]
  const failedCommands: string[] = []

  for (const tag of tagsToDelete) {
    if (existingTags.has(tag)) continue

    const result = await runCmd('delete tag', ['git', 'tag', '-d', tag], {
      silent: true,
    })

    if (!result.ok && !result.error.includes('not found')) {
      failedCommands.push(`git tag -d ${tag}`)
      console.error(
        styleText(['red'], `Failed to delete tag ${tag}: ${result.error}`),
      )
    }
  }

  const resetResult = await runCmd(
    'reset version commit',
    ['git', 'reset', '--hard', preBumpHead],
    {
      silent: true,
    },
  )

  if (!resetResult.ok) {
    failedCommands.push(`git reset --hard ${preBumpHead}`)
    console.error(
      styleText(
        ['red'],
        `Failed to reset version commit: ${resetResult.error}`,
      ),
    )
  }

  if (failedCommands.length > 0) {
    console.error(
      styleText(['red', 'bold'], 'Automatic rollback was incomplete.'),
    )
    console.error('Run these cleanup commands manually:')
    for (const command of failedCommands) {
      console.error(`  ${command}`)
    }
    return
  }

  console.log(styleText(['green'], `Rolled back ${packageName}@${version}.`))
}

function getPrePublishScripts(
  config: PkgManagerConfig,
  packagePath: string,
  packageName: string,
): PrePublishScript[] {
  if (config.prePublish && config.prePublish.length > 0) {
    return config.prePublish
  }

  const packageJson = readPackageJson(packagePath)
  const hasPrePublishScript = packageJson.scripts?.['pre-publish'] !== undefined

  if (hasPrePublishScript) {
    return [
      { command: 'pnpm pre-publish', label: 'Running pre-publish script' },
    ]
  }

  console.error(
    styleText(
      ['red', 'bold'],
      `\nNo pre-publish scripts configured for ${packageName}`,
    ),
  )
  console.error(
    'Either add a "pre-publish" script to package.json or configure "prePublish" in pkg-manager.config.ts',
  )
  process.exit(1)
}
