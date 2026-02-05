export type PkgManagerConfig = {
  prePublish?: { command: string; label: string }[];
  monorepo?: {
    packages: {
      name: string;
      path: string;
      dependsOn?: string[];
    }[];
  };
  hashStorePath?: string;
  requireMajorConfirmation?: boolean;
};

export function defineConfig(config: PkgManagerConfig): PkgManagerConfig {
  return config;
}
