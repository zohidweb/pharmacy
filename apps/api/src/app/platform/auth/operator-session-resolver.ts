import { Injectable } from '@nestjs/common';
import type { OperatorPrincipal } from '../../../common/context/request-context';
import { OperatorPrincipalResolver } from '../../../common/middleware/operator-principal-resolver';
import { SessionTokenService } from '../../../core/crypto';
import { PlatformDatabase } from '../../../core/database/platform';
import { OperatorSessionStore } from '../../../core/sessions';

// The idle lifetime is extended at most once per this interval per session, as for employees.
const TOUCH_INTERVAL_MS = 60_000;
// Upper bound of the per-process touch map; the oldest entries are evicted first.
const MAX_TRACKED_SESSIONS = 1_000;

// The operator of an operator-contour token (auth design 2026-10-02, section 9): the JWT
// (aud=admin, no tenant), the server-side session and the operator's status on every request
// (plan decision P4: a blocked operator loses every session at once). Fails closed to null.
@Injectable()
export class OperatorSessionResolver extends OperatorPrincipalResolver {
  private readonly touchedAt = new Map<string, number>();

  constructor(
    private readonly tokens: SessionTokenService,
    private readonly sessions: OperatorSessionStore,
    private readonly db: PlatformDatabase,
  ) {
    super();
  }

  async resolve(token: string): Promise<OperatorPrincipal | null> {
    const claims = await this.tokens.verifyOperator(token);
    if (claims === null) return null;
    const { jti: sessionId, sub: operatorId } = claims;

    const record = await this.sessions.lookup(sessionId, operatorId);
    if (record === null) return null;

    const status = await this.status(operatorId);
    if (status !== 'active') {
      await this.sessions.destroyAllFor(operatorId);
      return null;
    }

    if (this.claimTouch(sessionId, Date.now())) {
      try {
        await this.sessions.touch(sessionId, record.idleTtlSeconds);
      } catch (error) {
        this.touchedAt.delete(sessionId);
        throw error;
      }
    }

    return {
      kind: 'operator',
      operatorId,
      sessionId,
      role: 'full_access',
      authenticatedAt: record.authenticatedAt,
    };
  }

  /** operators.status, or null for an unknown operator. */
  private status(operatorId: string): Promise<string | null> {
    return this.db.platformTransaction(
      { kind: 'operator', operatorId },
      async (trx) => {
        const row = await trx
          .selectFrom('operators')
          .select('status')
          .where('id', '=', operatorId)
          .executeTakeFirst();
        return row?.status ?? null;
      },
    );
  }

  private claimTouch(sessionId: string, now: number): boolean {
    const last = this.touchedAt.get(sessionId);
    if (last !== undefined && now - last < TOUCH_INTERVAL_MS) return false;
    this.touchedAt.delete(sessionId);
    if (this.touchedAt.size >= MAX_TRACKED_SESSIONS) {
      const oldest = this.touchedAt.keys().next();
      if (!oldest.done) this.touchedAt.delete(oldest.value);
    }
    this.touchedAt.set(sessionId, now);
    return true;
  }
}
