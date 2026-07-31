import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { z } from 'zod';

const packageHashesSchema = z.object({
  versions: z.record(z.string(), z.string()),
  lastVersion: z.string().optional(),
});

const hashStoreSchema = z.object({
  packages: z.record(z.string(), packageHashesSchema),
});

const npmPackResultSchema = z.array(
  z.object({
    files: z.array(
      z.object({
        path: z.string(),
      }),
    ),
  }),
);

const packageJsonHashSchema = z.record(z.string(), z.unknown());
const dependenciesHashSchema = z.record(z.string(), z.unknown());

type PackageHashOptions = {
  normalizedOptionalDependencies: string[];
};

export function generatePackageHash(
  packagePath: string,
  options: PackageHashOptions = { normalizedOptionalDependencies: [] },
): string {
  const files = getPackedFiles(packagePath);

  if (files.length === 0) {
    throw new Error('Package would not publish any files');
  }

  return generateFileHash(packagePath, files, options);
}

type DirectoryHashOptions = {
  normalizePackageJsonVersions: boolean;
};

export function generateDirectoryHash(
  dirPath: string,
  options: DirectoryHashOptions = { normalizePackageJsonVersions: false },
): string {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }

  const hash = createHash('sha256');
  const files: string[] = [];

  function collectFiles(currentPath: string, relativePath = '') {
    const items = readdirSync(currentPath).sort();
    for (const item of items) {
      const fullPath = join(currentPath, item);
      const itemRelativePath = relativePath ? join(relativePath, item) : item;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        collectFiles(fullPath, itemRelativePath);
      } else {
        files.push(itemRelativePath);
      }
    }
  }

  collectFiles(dirPath);

  for (const filePath of files) {
    const fullPath = join(dirPath, filePath);
    const content = readFileSync(fullPath);
    const hashContent =
      options.normalizePackageJsonVersions && filePath.endsWith('package.json')
        ? Buffer.from(normalizePackageJsonForHash(content.toString('utf-8')))
        : content;
    hash.update(filePath);
    hash.update(hashContent);
  }

  return hash.digest('hex');
}

function getPackedFiles(packagePath: string): string[] {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packagePath,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to list package files');
  }

  const parsed = JSON.parse(result.stdout);
  const packResults = npmPackResultSchema.parse(parsed);
  const [packResult] = packResults;

  if (!packResult) return [];

  return packResult.files.map((file) => file.path).sort();
}

function generateFileHash(
  basePath: string,
  files: string[],
  options: PackageHashOptions,
): string {
  const hash = createHash('sha256');

  for (const filePath of files) {
    const content = readFileForHash(basePath, filePath, options);
    hash.update(filePath);
    hash.update(content);
  }

  return hash.digest('hex');
}

function readFileForHash(
  basePath: string,
  filePath: string,
  options: PackageHashOptions,
): Buffer {
  const content = readFileSync(join(basePath, filePath));

  if (filePath !== 'package.json') return content;

  return Buffer.from(
    normalizePackageJsonForHash(
      content.toString('utf-8'),
      options.normalizedOptionalDependencies,
    ),
  );
}

function normalizePackageJsonForHash(
  content: string,
  normalizedOptionalDependencies: string[] = [],
): string {
  const packageJson = packageJsonHashSchema.parse(JSON.parse(content));
  delete packageJson.version;

  const optionalDependenciesResult = dependenciesHashSchema.safeParse(
    packageJson.optionalDependencies,
  );

  if (optionalDependenciesResult.success) {
    for (const packageName of normalizedOptionalDependencies) {
      if (packageName in optionalDependenciesResult.data) {
        optionalDependenciesResult.data[packageName] = '<platform-version>';
      }
    }

    packageJson.optionalDependencies = optionalDependenciesResult.data;
  }

  return `${JSON.stringify(packageJson)}\n`;
}

type HashStore = z.infer<typeof hashStoreSchema>;

export function readHashStore(hashStorePath: string): HashStore {
  if (!existsSync(hashStorePath)) {
    return { packages: {} };
  }

  try {
    const content = readFileSync(hashStorePath, 'utf-8');
    const parsed = JSON.parse(content);
    return hashStoreSchema.parse(parsed);
  } catch {
    return { packages: {} };
  }
}

export function writeHashStore(hashStorePath: string, store: HashStore): void {
  const dir = dirname(hashStorePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(hashStorePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function checkHashForDuplicate(
  hashStorePath: string,
  packageName: string,
  currentHash: string,
): { isDuplicate: boolean; existingVersion?: string } {
  const store = readHashStore(hashStorePath);
  const packageHashes = store.packages[packageName];

  if (!packageHashes) {
    return { isDuplicate: false };
  }

  for (const [version, hash] of Object.entries(packageHashes.versions)) {
    if (hash === currentHash) {
      return { isDuplicate: true, existingVersion: version };
    }
  }

  return { isDuplicate: false };
}

export function savePackageHash(
  hashStorePath: string,
  packageName: string,
  version: string,
  hash: string,
): void {
  const store = readHashStore(hashStorePath);

  if (!store.packages[packageName]) {
    store.packages[packageName] = { versions: {} };
  }

  const pkgStore = store.packages[packageName];

  pkgStore.versions[version] = hash;
  pkgStore.lastVersion = version;

  writeHashStore(hashStorePath, store);
}
