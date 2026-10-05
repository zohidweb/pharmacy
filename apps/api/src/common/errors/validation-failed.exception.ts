import { ProblemException } from './problem.exception';

// One rejected field of a request body (ADR-0015, axis 4: the web client lays these onto form fields).
// `field` is a DTO property path ("login", "items.1.qty"), empty for an entry that names no field;
// `code` is a stable snake_case rule name ("max_length"). Never a value or a message.
export interface FieldError {
  field: string;
  code: string;
}

// A problem that names the rejected fields in errors[] (ADR-0015): the filter renders them for
// every status. A business rule on one field (a wrong current password) is a 422 of this kind.
export class FieldProblemException extends ProblemException {
  readonly errors: readonly FieldError[];

  constructor(status: number, code: string, errors: readonly FieldError[]) {
    super(status, code);
    this.name = 'FieldProblemException';
    this.errors = errors;
  }
}

// 400 validation_failed with errors[]; built by the global ValidationPipe, rendered by the filter.
export class ValidationFailedException extends FieldProblemException {
  constructor(errors: readonly FieldError[]) {
    super(400, 'validation_failed', errors);
    this.name = 'ValidationFailedException';
  }
}
