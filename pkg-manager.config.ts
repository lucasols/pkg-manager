import { defineConfig } from '../src/exports.ts';

export default defineConfig({
  requireMajorConfirmation: true,
  prePublish: [
    { command: 'pnpm lint', label: 'Linting' },
    { command: 'pnpm build', label: 'Building' },
  ],
  monorepo: {
    packages: [
      { name: '@scope/core', path: 'packages/core' },
      { name: '@scope/utils', path: 'packages/utils', dependsOn: ['@scope/core'] },
    ],
  },
});
