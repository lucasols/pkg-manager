import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

const SIMPLE_SEMVER_RANGE_REGEX =
  /^(\^|~|>=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

const packageJsonSchema = z.record(z.string(), z.unknown())
const dependenciesSchema = z.record(z.string(), z.string())

export function updateDependencyVersions(
  packagePath: string,
  versions: ReadonlyMap<string, string>,
): string[] {
  const packageJsonPath = join(packagePath, 'package.json')
  const packageJson = packageJsonSchema.parse(
    JSON.parse(readFileSync(packageJsonPath, 'utf-8')),
  )
  const updated: string[] = []

  for (const field of dependencyFields) {
    const dependenciesResult = dependenciesSchema.safeParse(packageJson[field])
    if (!dependenciesResult.success) continue

    const dependencies = dependenciesResult.data

    for (const [packageName, version] of versions) {
      const currentRange = dependencies[packageName]
      if (!currentRange) continue

      const nextRange = updateVersionRange(currentRange, version)
      if (nextRange === currentRange) continue

      dependencies[packageName] = nextRange
      updated.push(`${field}.${packageName}: ${currentRange} -> ${nextRange}`)
    }

    packageJson[field] = dependencies
  }

  if (updated.length > 0) {
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
  }

  return updated
}

export function updateVersionRange(
  currentRange: string,
  version: string,
): string {
  if (
    currentRange.startsWith('workspace:') ||
    currentRange.startsWith('catalog:') ||
    currentRange === '*' ||
    currentRange === 'latest'
  ) {
    return currentRange
  }

  const match = SIMPLE_SEMVER_RANGE_REGEX.exec(currentRange)

  if (!match) return currentRange

  return `${match[1] ?? ''}${version}`
}
