// @ts-check
import { cfgFlags, lsStackEslintCfg } from '@ls-stack/eslint-cfg';

const { OFF } = cfgFlags;

export default lsStackEslintCfg({
  tsconfigRootDir: import.meta.dirname,
  extraRuleGroups: [
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-console': OFF,
      },
    },
  ],
});
