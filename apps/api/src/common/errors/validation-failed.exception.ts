import { ProblemException } from './problem.exception';

// One rejected field of a request body (ADR-0015, axis 4: the web client lays these onto form fields).
// `field` is a DTO property path ("login", "items.1.qty"), empty for an entry that names no field;
// `code` is a stable snake_case rule name ("max_length"). Never a value or a message.
export interface FieldError {
  field: string;
  code: string;
}

// 400 validation_failed with errors[]; built by the global ValidationPipe, rendered by the filter.
export class ValidationFailedException extends ProblemException {
  readonly errors: readonly FieldError[];

  constructor(errors: readonly FieldError[]) {
    super(400, 'validation_failed');
    this.name = 'ValidationFailedException';
    this.errors = errors;
  }
}
