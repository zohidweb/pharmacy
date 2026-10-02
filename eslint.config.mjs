import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/.next', '**/out', '**/test-output'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // Module boundaries (CLAUDE.md, ADR-0002): apps never import each other,
          // libs/shared/domain depends on nothing applied, the API never imports the UI kit.
          depConstraints: [
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:dto', 'type:domain', 'type:util', 'type:ui'] },
            { sourceTag: 'type:e2e', onlyDependOnLibsWithTags: ['type:dto', 'type:domain', 'type:util'] },
            { sourceTag: 'scope:api', notDependOnLibsWithTags: ['type:ui'] },
            { sourceTag: 'type:domain', onlyDependOnLibsWithTags: ['type:domain'] },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:util', 'type:domain'] },
            { sourceTag: 'type:dto', onlyDependOnLibsWithTags: ['type:dto', 'type:domain', 'type:util'] },
            { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:domain', 'type:dto'] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
