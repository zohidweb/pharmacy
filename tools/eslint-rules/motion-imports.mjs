// ADR-0024: the animation library `motion` lives only in apps/site. The root eslint.config.mjs bans it everywhere;
// configs that set their own `no-restricted-imports` (FSD layers, apps/api) add these paths again, because a later
// config object replaces the rule's options instead of merging them. apps/site turns the ban off.

const message = 'ADR-0024: motion only in apps/site.';

/** `paths` of `no-restricted-imports`. */
export const motionImportBan = ['motion', 'motion/react', 'framer-motion'].map(
  (name) => ({ name, message }),
);
