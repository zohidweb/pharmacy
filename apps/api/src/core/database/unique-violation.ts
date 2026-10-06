/** The name of the unique constraint a statement violated (SQLSTATE 23505), otherwise null. */
export function uniqueConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}
