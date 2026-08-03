import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getVersionCommand } from '../src/commands/publish.ts'

test('lets pkg-manager version a package after generated files change', () => {
  assert.deepEqual(getVersionCommand(['patch']), [
    'pnpm',
    'version',
    'patch',
    '--no-git-checks',
    '--no-git-tag-version',
  ])
})

test('preserves prerelease arguments while pkg-manager owns git refs', () => {
  assert.deepEqual(getVersionCommand(['preminor', '--preid=beta']), [
    'pnpm',
    'version',
    'preminor',
    '--preid=beta',
    '--no-git-checks',
    '--no-git-tag-version',
  ])
})
