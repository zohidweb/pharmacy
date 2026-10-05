import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passwordProblems } from '@pharmacy/shared-domain';
import { ProblemException } from '../../../common/errors/problem.exception';
import { PasswordHasher, sha256Hex } from '../../../core/crypto';
import { PlatformDatabase } from '../../../core/database/platform';
import { OperatorSessionStore } from '../../../core/sessions';
import {
  hashActivationCode,
  normalizeActivationCode,
} from '../../auth/activation-code';
import { normalizeIdentifier } from '../../auth/identifier';
import { LoginClock, padFailure } from '../../auth/login-clock';
import { LoginLimiter } from '../../auth/login-limiter';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { OperatorAuthRepository } from './operator-auth.repository';

const ACTIVATION_JOB = { kind: 'system', job: 'operator-activation' } as const;

// One answer for every failed code: unknown login, no code, expired, used or wrong code.
const invalidCode = () => new ProblemException(401, 'invalid_code');

// The first password of an operator by the one-time code from scripts/create-operator.mjs (plan
// decision P1), the same mechanism as owner activation (auth design, section 6). Passwords,
// codes, hashes and login values are never logged or audited.
@Injectable()
export class OperatorActivationsService {
  private readonly failureFloorMs: number;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: OperatorAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: OperatorSessionStore,
    private readonly limiter: LoginLimiter,
    private readonly audit: PlatformAuditService,
    private readonly clock: LoginClock,
    config: ConfigService,
  ) {
    this.failureFloorMs = config.getOrThrow<number>('LOGIN_FAILURE_FLOOR_MS');
  }

  async activate(rawLogin: string, rawCode: string, newPassword: string): Promise<void> {
    // The policy is checked before any lookup: a 422 reveals nothing and does not spend the code.
    if (passwordProblems(newPassword).length > 0) {
      throw new ProblemException(422, 'password_policy');
    }
    const started = this.clock.now();
    try {
      await this.attempt(rawLogin, rawCode, newPassword);
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'invalid_code') {
        await padFailure(this.clock, this.failureFloorMs, started);
      }
      throw error;
    }
  }

  private async attempt(rawLogin: string, rawCode: string, newPassword: string): Promise<void> {
    const identifier = normalizeIdentifier(rawLogin);
    const code = normalizeActivationCode(rawCode);
    if (identifier === null || identifier.kind !== 'email' || code === null) {
      throw invalidCode();
    }
    const login = identifier.value;

    // Reserved atomically before hashing; never shared with the sign-in keys.
    const key = `activation:operator:${sha256Hex(login)}`;
    const attempt = await this.limiter.tryAcquire(key);
    if (!attempt.allowed) throw new ProblemException(429, 'login_locked');

    // The same scrypt cost whether the login exists or not; no transaction held open meanwhile.
    const next = await this.hasher.hash(newPassword);
    const codeHash = hashActivationCode(code);

    const operatorId = await this.db.platformTransaction(ACTIVATION_JOB, async (trx) => {
      const consumed = await this.repository.consumeActivationCode(trx, login, codeHash, next);
      if (consumed === null) throw invalidCode();
      await this.audit.append(trx, {
        action: 'operator.activated',
        entityType: 'operator',
        entityId: consumed,
      });
      return consumed;
    });

    // After the commit: sessions opened with an old password end, the attempts are forgotten.
    await this.sessions.destroyAllFor(operatorId);
    await this.limiter.reset(key);
  }
}
