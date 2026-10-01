/**
 * Joins class names, skipping falsy values (ADR-0007: own helper instead of clsx/tailwind-merge).
 * Conflicts are prevented by API design: a component's external className is for layout only.
 */
export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}
