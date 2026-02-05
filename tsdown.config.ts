import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/main.ts', 'src/exports.ts'],
  clean: true,
  dts: true,
  sourcemap: true,
  format: ['esm'],
});
