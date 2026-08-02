import { styleText } from 'node:util'
import { join } from 'path'
import { loadConfig } from '../core/config.ts'
import { updateDependencyVersions } from '../core/dependencyVersions.ts'
import { isGitClean } from '../core/git.ts'
import { topologicalSort } from '../core/monorepo.ts'
import { runCmd } from '../utils/runCmd.ts'
import { publishCommand, type PublishArgs } from './publish.ts'

export type PublishAllArgs = Omit<PublishArgs, 'package'>

export async function publishAllCommand(args: PublishAllArgs): Promise<void> {
  const config = await loadConfig()
  const packages = config.monorepo?.packages

  if (!packages || packages.length === 0) {
    console.error(
      styleText(
        ['red', 'bold'],
        'publish-all requires monorepo.packages in pkg-manager.config.ts.',
      ),
    )
    process.exit(1)
  }

  const clean = await isGitClean()
  if (!clean && !args.dryRun) {
    console.error(
      styleText(['red', 'bold'], 'Git working directory is not clean.'),
    )
    console.error('Please commit or stash your changes before publishing.')
    process.exit(1)
  }

  const orderedPackages = topologicalSort(packages)
  const releasedVersions = new Map<string, string>()
  const published: string[] = []
  const skipped: string[] = []

  console.log(
    styleText(
      ['blue', 'bold'],
      `\nPublishing changed packages in dependency order (${orderedPackages.map((pkg) => pkg.name).join(' -> ')})`,
    ),
  )

  for (const pkg of orderedPackages) {
    const releasedDependencies = new Map<string, string>()

    for (const dependency of pkg.dependsOn ?? []) {
      const version = releasedVersions.get(dependency)
      if (version) releasedDependencies.set(dependency, version)
    }
    const dependencyChanged = releasedDependencies.size > 0
    let dependencyFilesChanged = false

    if (dependencyChanged && !args.dryRun) {
      const updates = updateDependencyVersions(
        join(process.cwd(), pkg.path),
        releasedDependencies,
      )
      dependencyFilesChanged = updates.length > 0

      for (const update of updates) {
        console.log(styleText(['dim'], `Updated ${pkg.name} ${update}`))
      }

      if (dependencyFilesChanged) {
        const lockfileResult = await runCmd(
          'update workspace lockfile',
          ['pnpm', 'install', '--lockfile-only'],
          { cwd: process.cwd() },
        )

        if (!lockfileResult.ok) {
          console.error(
            styleText(['red', 'bold'], 'Failed: update workspace lockfile'),
          )
          console.error(lockfileResult.error)
          process.exit(1)
        }
      }
    }

    const result = await publishCommand(
      {
        ...args,
        package: pkg.name,
        type: args.type ?? 'patch',
        force: args.force || dependencyChanged,
      },
      {
        allowDirty: dependencyFilesChanged,
        skipUnchanged: true,
        suppressCopyCommand: true,
      },
    )

    if (result.status === 'skipped') {
      skipped.push(result.packageName)
      continue
    }

    releasedVersions.set(result.packageName, result.version)
    published.push(`${result.packageName}@${result.version}`)
  }

  console.log(styleText(['green', 'bold'], '\nBulk publish complete.'))
  console.log(
    published.length > 0
      ? `Published: ${published.join(', ')}`
      : 'Published: none',
  )
  console.log(
    skipped.length > 0 ? `Skipped unchanged: ${skipped.join(', ')}` : '',
  )
}
