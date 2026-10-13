import type { Logger } from '@nestjs/common';
import { getRequestContext } from '../context/request-context';

/**
 * Work that follows a committed change and must not turn it into an error answer (a session
 * cleanup the client cannot repeat, a cache write that expires by itself): a failure is logged
 * with the correlation id and never thrown. The error name only: a message may carry keys or
 * values. Where a retry of the request completes the work (a revocation), the caller answers the
 * error instead and does not use this.
 */
export async function afterCommitBestEffort(
  logger: Logger,
  what: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    logger.error(
      `${what} failed after the commit (${name}) [correlationId=${getRequestContext()?.correlationId}]`,
    );
  }
}
