import { defineConfig } from './src/exports.ts'

export default defineConfig({
  requireMajorConfirmation: true,
  prePublish: [{ command: 'pnpm build', label: 'Building' }],
})
