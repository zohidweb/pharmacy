// Feature-Sliced Design import rules for apps/web and apps/admin (ADR-0017).
// Editor-time complement to Steiger (`nx fsd <app>`): blocks imports into higher
// layers and deep imports that bypass a slice's public API (index.ts).

const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const SLICED_LAYERS = ['pages', 'widgets', 'features', 'entities'];

/** @returns {import('eslint').Linter.Config[]} */
export function fsdLayerRules() {
  return LAYERS.map((layer, index) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...LAYERS.slice(0, index).map((higher) => ({
              group: [`@/${higher}`, `@/${higher}/*`],
              message: `FSD (ADR-0017): layer "${layer}" must not import from higher layer "${higher}".`,
            })),
            {
              group: [
                ...SLICED_LAYERS.map((sliced) => `@/${sliced}/*/*`),
                // entities cross-imports go through the slice's @x public API (ADR-0017 §3)
                '!@/entities/*/@x',
              ],
              message:
                'FSD (ADR-0017): import a slice only through its public API (index.ts).',
            },
          ],
        },
      ],
    },
  }));
}
