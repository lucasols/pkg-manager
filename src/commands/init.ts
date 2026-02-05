import { cliInput } from '@ls-stack/cli';
import { styleText } from 'node:util';
import {
  configExists,
  generateConfigFile,
  type MonorepoPackage,
  type PkgManagerConfig,
  type PrePublishScript,
} from '../core/config.ts';
import { detectMonorepo, scanPackages } from '../core/monorepo.ts';

type InitArgs = {
  force: boolean;
};

export async function initCommand({ force }: InitArgs): Promise<void> {
  if (configExists() && !force) {
    console.error(
      styleText(['red', 'bold'], 'Config file already exists. Use --force to overwrite.'),
    );
    process.exit(1);
  }

  console.log(styleText(['blue', 'bold'], 'Initializing pkg-manager config...\n'));

  const isMonorepo = detectMonorepo();

  if (isMonorepo) {
    console.log(styleText(['green'], 'Detected monorepo (pnpm-workspace.yaml found)\n'));
  }

  const prePublishScripts = await selectPrePublishScripts();
  let monorepoConfig: { packages: MonorepoPackage[] } | undefined;

  if (isMonorepo) {
    const packages = scanPackages();

    if (packages.length > 0) {
      console.log(styleText(['blue'], `\nFound ${packages.length} packages:`));

      for (const pkg of packages) {
        console.log(styleText(['dim'], `  - ${pkg.name} (${pkg.path})`));
      }

      const configureDeps = await cliInput.confirm(
        '\nConfigure package dependencies?',
        { initial: true },
      );

      if (configureDeps) {
        monorepoConfig = await configureMonorepoDependencies(packages);
      } else {
        monorepoConfig = { packages };
      }
    }
  }

  const config: PkgManagerConfig = {
    requireMajorConfirmation: true,
  };

  if (prePublishScripts.length > 0) {
    config.prePublish = prePublishScripts;
  }

  if (monorepoConfig) {
    config.monorepo = monorepoConfig;
  }

  generateConfigFile(config);

  console.log(styleText(['green', 'bold'], '\npkg-manager.config.ts created successfully!'));
}

async function selectPrePublishScripts(): Promise<PrePublishScript[]> {
  const scripts: PrePublishScript[] = [];

  const selectedScripts = await cliInput.multipleSelect(
    'Select pre-publish scripts to run:',
    {
      options: [
        {
          value: 'lint',
          label: 'Lint',
          hint: 'Run pnpm lint',
        },
        {
          value: 'test',
          label: 'Test',
          hint: 'Run pnpm test',
        },
        {
          value: 'build',
          label: 'Build',
          hint: 'Run pnpm build',
        },
      ],
    },
  );

  for (const script of selectedScripts) {
    switch (script) {
      case 'lint':
        scripts.push({ command: 'pnpm lint', label: 'Linting' });
        break;
      case 'test':
        scripts.push({ command: 'pnpm test', label: 'Testing' });
        break;
      case 'build':
        scripts.push({ command: 'pnpm build', label: 'Building' });
        break;
    }
  }

  return scripts;
}

async function configureMonorepoDependencies(
  packages: MonorepoPackage[],
): Promise<{ packages: MonorepoPackage[] }> {
  const configuredPackages: MonorepoPackage[] = [];

  for (const pkg of packages) {
    const otherPackages = packages.filter((p) => p.name !== pkg.name);

    if (otherPackages.length === 0) {
      configuredPackages.push(pkg);
      continue;
    }

    const deps = await cliInput.multipleSelect(
      `Select dependencies for ${pkg.name}:`,
      {
        options: [
          { value: '__none__', label: 'None', hint: 'No dependencies' },
          ...otherPackages.map((p) => ({
            value: p.name,
            label: p.name,
            hint: p.path,
          })),
        ],
      },
    );

    const filteredDeps = deps.filter((d) => d !== '__none__');

    if (filteredDeps.length > 0) {
      configuredPackages.push({
        ...pkg,
        dependsOn: filteredDeps,
      });
    } else {
      configuredPackages.push(pkg);
    }
  }

  return { packages: configuredPackages };
}
