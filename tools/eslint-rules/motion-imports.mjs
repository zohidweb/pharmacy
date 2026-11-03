// ADR-0024: the animation library `motion` lives only in apps/site, imported as `motion/react`. The root
// eslint.config.mjs bans it everywhere; configs that set their own `no-restricted-imports` (FSD layers, apps/api) add
// these patterns again, because a later config object replaces the rule's options instead of merging them. apps/site
// replaces the ban with `motionSiteImportPatterns`.
//
// Patterns, not paths: `paths` match a specifier exactly, so subpaths (`motion/react-m`, `framer-motion/dom`) and the
// packages motion is built from (`motion-dom`, `motion-utils`) would pass. A regex, not a gitignore `group`: the group
// `motion` would match any path segment named so, `@/shared/ui/motion` of the site included.

/** Files the root ban covers: every script the configs lint, ES modules and CommonJS included. */
export const motionBanFiles = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.cts',
  '**/*.mts',
  '**/*.js',
  '**/*.jsx',
  '**/*.cjs',
  '**/*.mjs',
];

/** The packages and every subpath: `motion`, `motion/*`, `framer-motion(/*)`, `motion-dom(/*)`, `motion-utils(/*)`. */
const MOTION = '(?:motion|framer-motion|motion-dom|motion-utils)(?:/.*)?';

/** `patterns` of `no-restricted-imports` outside apps/site: motion in any form. */
export const motionImportPatterns = [
  {
    regex: `^${MOTION}$`,
    caseSensitive: true,
    message: 'ADR-0024: motion only in apps/site.',
  },
];

/** `patterns` of `no-restricted-imports` in apps/site: everything but `motion/react`. */
export const motionSiteImportPatterns = [
  {
    regex: `^(?!motion/react$)${MOTION}$`,
    caseSensitive: true,
    message: 'ADR-0024: import motion only as motion/react.',
  },
];
