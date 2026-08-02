import assert from 'node:assert/strict'
import { test } from 'node:test'
import { topologicalSort } from '../src/core/monorepo.ts'

test('sorts packages with dependencies before their dependents', () => {
  const result = topologicalSort([
    { name: 'vite-plugin', path: 'vite-plugin', dependsOn: ['core'] },
    { name: 'native', path: 'native' },
    { name: 'eslint-plugin', path: 'eslint-plugin', dependsOn: ['core'] },
    { name: 'core', path: 'core', dependsOn: ['native'] },
  ])

  assert.deepEqual(
    result.map((pkg) => pkg.name),
    ['native', 'core', 'vite-plugin', 'eslint-plugin'],
  )
})

test('rejects circular package dependencies', () => {
  assert.throws(
    () =>
      topologicalSort([
        { name: 'a', path: 'a', dependsOn: ['b'] },
        { name: 'b', path: 'b', dependsOn: ['a'] },
      ]),
    /Circular dependency/,
  )
})
