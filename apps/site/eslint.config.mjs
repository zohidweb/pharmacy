import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';
import { fsdLayerRules } from '../../tools/eslint-rules/fsd-layers.mjs';

export default [
  { plugins: { '@next/next': nextEslintPluginNext } },
  ...nx.configs['flat/react-typescript'],
  ...baseConfig,
  {
    ignores: ['.next/**/*', '**/out-tsc'],
  },
  // ADR-0024: the site is the one place `motion` is allowed (the root config bans it)
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  ...fsdLayerRules({ allowMotion: true }),
];
