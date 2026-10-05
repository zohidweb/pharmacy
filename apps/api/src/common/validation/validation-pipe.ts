import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import {
  type FieldError,
  ValidationFailedException,
} from '../errors/validation-failed.exception';

// class-validator reports a property the DTO does not declare (forbidNonWhitelisted) under this key;
// the property name is then chosen by the client and must not be echoed.
const UNKNOWN_PROPERTY_KEY = 'whitelistValidation';
const UNKNOWN_PROPERTY: FieldError = { field: '', code: 'unknown_property' };

const toSnakeCase = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();

// Flattens the error tree: nested objects join with '.', array elements by their index. A field
// takes the first failed constraint as its code. Constraint messages, values and targets are dropped.
function collect(
  errors: readonly ValidationError[],
  prefix: string,
  into: FieldError[],
): void {
  for (const error of errors) {
    const keys = Object.keys(error.constraints ?? {});
    if (keys.includes(UNKNOWN_PROPERTY_KEY)) {
      if (!into.some((entry) => entry.code === UNKNOWN_PROPERTY.code)) {
        into.push({ ...UNKNOWN_PROPERTY });
      }
      continue;
    }
    const field = prefix === '' ? error.property : `${prefix}.${error.property}`;
    if (keys.length > 0) {
      into.push({ field, code: toSnakeCase(keys[0]) });
    }
    if (error.children?.length) collect(error.children, field, into);
  }
}

export function toFieldErrors(errors: readonly ValidationError[]): FieldError[] {
  const result: FieldError[] = [];
  collect(errors, '', result);
  return result;
}

/** The global body validation: whitelist, no unknown properties, transform; 400 with errors[]. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Values and targets stay out of the error objects altogether.
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ValidationFailedException(toFieldErrors(errors)),
  });
}
