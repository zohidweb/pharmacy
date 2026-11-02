// ADR-0024: the animation library `motion` lives only in apps/site, imported as `motion/react`. The root
// eslint.config.mjs bans it everywhere; configs that set their own `no-restricted-imports` (FSD layers, apps/api) add
// these paths again, because a later config object replaces the rule's options instead of merging them. apps/site
// replaces the ban with `motionSiteImportBan`.

const message = 'ADR-0024: motion only in apps/site.';
const siteMessage = 'ADR-0024: import motion only as motion/react.';

/** `paths` of `no-restricted-imports` outside apps/site. */
export const motionImportBan = ['motion', 'motion/react', 'framer-motion'].map(
  (name) => ({ name, message }),
);

/** `paths` of `no-restricted-imports` in apps/site: everything but `motion/react`. */
export const motionSiteImportBan = ['motion', 'framer-motion'].map((name) => ({
  name,
  message: siteMessage,
}));
