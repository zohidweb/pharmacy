/*
 * The one request the browser sends to the API (spec 6.4, 7.3): POST public/connection-requests on the site's own
 * origin (Caddy; in dev — the rewrite of next.config). Client-side: it never imports the server-only segments
 * (@/shared/api, @/shared/config). No cookie: the public contour has no session.
 */
import type { SubmitConnectionRequest } from '@pharmacy/shared-dto';

export interface SubmitFieldError {
  field: string;
  code: string;
}

export type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      /** 0 — no answer (network, timeout). */
      status: number;
      /** `code` of the problem+json; `network` without an answer, `unexpected` for a body that is not one. */
      code: string;
      fields: SubmitFieldError[];
      /** Retry-After of a 429 in seconds; `null` without the header. */
      retryAfterSeconds: number | null;
    };

const ENDPOINT = '/api/v1/public/connection-requests';
const TIMEOUT_MS = 15_000;

interface ProblemBody {
  code?: unknown;
  errors?: unknown;
}

function fieldErrorsOf(errors: unknown): SubmitFieldError[] {
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (error): error is SubmitFieldError =>
      typeof error === 'object' &&
      error !== null &&
      typeof (error as SubmitFieldError).field === 'string' &&
      typeof (error as SubmitFieldError).code === 'string',
  );
}

/** Seconds of a Retry-After; the HTTP-date form is not sent by the API and counts as none. */
function retryAfterOf(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

export async function submitConnectionRequest(
  body: SubmitConnectionRequest,
): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'network',
      fields: [],
      retryAfterSeconds: null,
    };
  }
  if (response.ok) return { ok: true };
  const problem: ProblemBody = await response
    .json()
    .catch(() => ({}) as ProblemBody);
  return {
    ok: false,
    status: response.status,
    code: typeof problem.code === 'string' ? problem.code : 'unexpected',
    fields: fieldErrorsOf(problem.errors),
    retryAfterSeconds: retryAfterOf(response),
  };
}
