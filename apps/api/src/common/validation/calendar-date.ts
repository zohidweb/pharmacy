import { registerDecorator, type ValidationOptions } from 'class-validator';

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day `YYYY-MM-DD` (no 2026-02-30, no 2025-13-01) within the years the document
 * counters keep (2000–2999). The shape alone lets such a value reach PostgreSQL, which answers 500.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !SHAPE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2999) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Field code `is_calendar_date` (validation-pipe.ts). */
export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName: String(propertyName),
      options,
      validator: { validate: (value: unknown) => isCalendarDate(value) },
    });
}
