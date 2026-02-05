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

export function generateDirectoryHash(dirPath: string): string {
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
    hash.update(filePath);
    hash.update(content);
  }

  return hash.digest('hex');
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
