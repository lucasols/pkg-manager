// @ts-check
import { cfgFlags, lsStackEslintCfg } from '@ls-stack/eslint-cfg'

const { OFF } = cfgFlags

export default lsStackEslintCfg({
  tsconfigRootDir: import.meta.dirname,
  globalRules: {
    '@ls-stack/no-reexport': OFF,
  },
  extraRuleGroups: [
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-console': OFF,
      },
    },
  ],
})
