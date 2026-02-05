import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import type { MonorepoPackage } from './config.ts';
import { runCmdOrExit } from '../utils/runCmd.ts';

export function detectMonorepo(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, 'pnpm-workspace.yaml'));
}

const packageJsonSchema = z.object({
  name: z.string().optional(),
});

export function scanPackages(cwd: string = process.cwd()): MonorepoPackage[] {
  const workspacePath = join(cwd, 'pnpm-workspace.yaml');

  if (!existsSync(workspacePath)) return [];

  const packages: MonorepoPackage[] = [];
  const packagesDir = join(cwd, 'packages');

  if (!existsSync(packagesDir)) return [];

  const items = readdirSync(packagesDir);

  for (const item of items) {
    const itemPath = join(packagesDir, item);
    const stat = statSync(itemPath);

    if (!stat.isDirectory()) continue;

    const packageJsonPath = join(itemPath, 'package.json');

    if (!existsSync(packageJsonPath)) continue;

    try {
      const content = readFileSync(packageJsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      const packageJson = packageJsonSchema.parse(parsed);

      if (packageJson.name) {
        packages.push({
          name: packageJson.name,
          path: `packages/${item}`,
        });
      }
    } catch {
      continue;
    }
  }

  return packages;
}

export function topologicalSort(packages: MonorepoPackage[]): MonorepoPackage[] {
  const nameToPackage = new Map<string, MonorepoPackage>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const pkg of packages) {
    nameToPackage.set(pkg.name, pkg);
    inDegree.set(pkg.name, 0);
    dependents.set(pkg.name, []);
  }

  for (const pkg of packages) {
    if (pkg.dependsOn) {
      for (const dep of pkg.dependsOn) {
        if (nameToPackage.has(dep)) {
          inDegree.set(pkg.name, (inDegree.get(pkg.name) ?? 0) + 1);
          dependents.get(dep)?.push(pkg.name);
        }
      }
    }
  }

  const queue: string[] = [];

  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  const sorted: MonorepoPackage[] = [];

  while (queue.length > 0) {
    const name = queue.shift();

    if (!name) continue;

    const pkg = nameToPackage.get(name);

    if (pkg) {
      sorted.push(pkg);
    }

    for (const dependent of dependents.get(name) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);

      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== packages.length) {
    throw new Error('Circular dependency detected in package graph');
  }

  return sorted;
}

export function getDependencyOrder(
  targetPackage: string,
  packages: MonorepoPackage[],
): MonorepoPackage[] {
  const nameToPackage = new Map<string, MonorepoPackage>();

  for (const pkg of packages) {
    nameToPackage.set(pkg.name, pkg);
  }

  const target = nameToPackage.get(targetPackage);

  if (!target) return [];

  const visited = new Set<string>();
  const result: MonorepoPackage[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;

    visited.add(name);

    const pkg = nameToPackage.get(name);

    if (!pkg) return;

    if (pkg.dependsOn) {
      for (const dep of pkg.dependsOn) {
        visit(dep);
      }
    }

    if (name !== targetPackage) {
      result.push(pkg);
    }
  }

  visit(targetPackage);

  return result;
}

export async function buildPackage(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<void> {
  await runCmdOrExit(`build ${packageName}`, [
    'pnpm',
    '--filter',
    packageName,
    'build',
  ], { cwd });
}

export async function buildDependencies(
  targetPackage: string,
  packages: MonorepoPackage[],
  cwd: string = process.cwd(),
): Promise<void> {
  const deps = getDependencyOrder(targetPackage, packages);

  for (const dep of deps) {
    console.log(`Building dependency: ${dep.name}`);
    await buildPackage(dep.name, cwd);
  }
}
