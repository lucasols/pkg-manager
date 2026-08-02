import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  updateDependencyVersions,
  updateVersionRange,
} from '../src/core/dependencyVersions.ts'

test('preserves workspace protocols and advances explicit semver ranges', () => {
  assert.equal(updateVersionRange('workspace:*', '2.0.0'), 'workspace:*')
  assert.equal(updateVersionRange('workspace:^', '2.0.0'), 'workspace:^')
  assert.equal(updateVersionRange('^1.2.3', '2.0.0'), '^2.0.0')
  assert.equal(updateVersionRange('1.2.3', '2.0.0'), '2.0.0')
})

test('updates internal dependencies in every dependency section', () => {
  const packagePath = mkdtempSync(join(tmpdir(), 'pkg-manager-test-'))
  const packageJsonPath = join(packagePath, 'package.json')

  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: 'consumer',
        version: '1.0.0',
        dependencies: { core: '^1.0.0' },
        devDependencies: { core: 'workspace:*' },
        peerDependencies: { core: '*' },
      },
      null,
      2,
    )}\n`,
  )

  const updates = updateDependencyVersions(
    packagePath,
    new Map([['core', '1.1.0']]),
  )
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const topLevelKeys = Object.keys(packageJson)

  assert.deepEqual(updates, ['dependencies.core: ^1.0.0 -> ^1.1.0'])
  assert.equal(packageJson.dependencies.core, '^1.1.0')
  assert.equal(packageJson.devDependencies.core, 'workspace:*')
  assert.equal(packageJson.peerDependencies.core, '*')
  assert.deepEqual(topLevelKeys.slice(0, 2), ['name', 'version'])
})
