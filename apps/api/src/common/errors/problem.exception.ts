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
