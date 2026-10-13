import { HttpException } from '@nestjs/common';

export interface ProblemBody {
  status: number;
  code: string;
  detail?: string;
}

// An HTTP error with a machine-readable code (auth design 2026-10-02, section 11), rendered as
// application/problem+json by the exception filter (a later task). `detail` is a fixed,
// human-readable text: never input values, secrets or personal data.
export class ProblemException extends HttpException {
  readonly code: string;
  readonly detail?: string;

  constructor(status: number, code: string, detail?: string) {
    const body: ProblemBody =
      detail === undefined ? { status, code } : { status, code, detail };
    super(body, status);
    this.name = 'ProblemException';
    this.message = code;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * A refusal while a lock of attempts lasts (429 `login_locked`, 423 `terminal_locked`): the answer
 * carries Retry-After with the seconds left, so a client need not guess when to try again.
 */
export class LockedException extends ProblemException {
  constructor(
    status: 423 | 429,
    code: string,
    readonly retryAfterSeconds: number,
  ) {
    super(status, code);
    this.name = 'LockedException';
  }
}
