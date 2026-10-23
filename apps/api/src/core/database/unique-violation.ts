/** Whether a statement violated a unique constraint (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/** The name of the unique constraint a statement violated (SQLSTATE 23505), otherwise null. */
export function uniqueConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}

/** The name of the foreign key a statement violated (SQLSTATE 23503), otherwise null. */
export function foreignKeyConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  return code === '23503' && typeof constraint === 'string' ? constraint : null;
}
