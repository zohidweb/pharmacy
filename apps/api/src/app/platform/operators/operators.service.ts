import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateOperatorRequest,
  CreateOperatorResponse,
  IssueOperatorCodeResponse,
  PlatformOperator,
} from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { afterCommitBestEffort } from '../../../common/errors/after-commit';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { type DB, newId, uniqueConstraint } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { OperatorSessionStore } from '../../../core/sessions';
import {
  generateActivationCode,
  hashActivationCode,
} from '../../auth/activation-code';
import { normalizeIdentifier } from '../../auth/identifier';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { OperatorsRepository } from './operators.repository';

const LOGIN_UNIQUE_INDEX = 'operators_login_uq';

const notFound = () => new ProblemException(404, 'not_found');
// The acting operator was disabled meanwhile (his session ends on the next request anyway).
const unauthenticated = () => new ProblemException(401, 'unauthenticated');

// The platform team (auth design 2026-10-02, section 9): adding an operator with a one-time code
// for the first sign-in, a new code, disabling. The same rules as scripts/create-operator.mjs: the
// login is a work e-mail, only the code's hash is stored, the code is shown once. Codes and logins
// are never logged or audited.
@Injectable()
export class OperatorsService {
  private readonly logger = new Logger(OperatorsService.name);
  private readonly codeTtlHours: number;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: OperatorsRepository,
    private readonly sessions: OperatorSessionStore,
    private readonly audit: PlatformAuditService,
    config: ConfigService,
  ) {
    this.codeTtlHours = config.getOrThrow<number>('ACTIVATION_CODE_TTL_HOURS');
  }

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  private newCode() {
    const { code, display } = generateActivationCode();
    return {
      display,
      hash: hashActivationCode(code),
      expiresAt: new Date(Date.now() + this.codeTtlHours * 3600_000),
    };
  }

  list(): Promise<PlatformOperator[]> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.list(trx),
    );
  }

  /** 400 `validation_failed` (`login` — `email_format`), 409 `login_taken`. */
  async create(
    request: CreateOperatorRequest,
  ): Promise<CreateOperatorResponse> {
    const login = normalizeIdentifier(request.login);
    if (login === null || login.kind !== 'email') {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'login', code: 'email_format' },
      ]);
    }
    const code = this.newCode();
    const operatorId = newId();
    try {
      const operator = await this.db.platformTransaction(
        this.actor(),
        async (trx) => {
          await this.lockActing(trx, []);
          await this.repository.create(trx, {
            id: operatorId,
            login: login.value,
            fullName: request.fullName,
            codeHash: code.hash,
            codeExpiresAt: code.expiresAt,
          });
          // The event of the script: a code for a new operator.
          await this.audit.append(trx, {
            action: 'operator.code-issued',
            entityType: 'operator',
            entityId: operatorId,
            details: { created: true },
          });
          return this.repository.find(trx, operatorId);
        },
      );
      if (operator === null)
        throw new Error('The created operator is not found');
      return {
        operator,
        activationCode: code.display,
        activationCodeExpiresAt: code.expiresAt.toISOString(),
      };
    } catch (error) {
      if (uniqueConstraint(error) === LOGIN_UNIQUE_INDEX) {
        throw new FieldProblemException(409, 'login_taken', [
          { field: 'login', code: 'login_taken' },
        ]);
      }
      throw error;
    }
  }

  /**
   * A new one-time code (a lost or expired code, a forgotten password). Not for oneself: a code
   * would set a new password without the current one, which the profile asks for. 404, 409
   * `cannot_issue_self`, 409 `operator_disabled`.
   */
  async issueCode(id: string): Promise<IssueOperatorCodeResponse> {
    const actor = this.actor();
    // The canonical form: the pipe accepts upper case, and `uuid` compares without it.
    const operatorId = id.toLowerCase();
    if (operatorId === actor.operatorId) {
      throw new ProblemException(409, 'cannot_issue_self');
    }
    const code = this.newCode();
    await this.db.platformTransaction(actor, async (trx) => {
      const status = await this.lockActing(trx, [operatorId]);
      if (status === undefined) throw notFound();
      if (status !== 'active')
        throw new ProblemException(409, 'operator_disabled');
      await this.repository.issueCode(
        trx,
        operatorId,
        code.hash,
        code.expiresAt,
      );
      await this.audit.append(trx, {
        action: 'operator.code-issued',
        entityType: 'operator',
        entityId: operatorId,
        details: { created: false },
      });
    });
    return {
      activationCode: code.display,
      activationCodeExpiresAt: code.expiresAt.toISOString(),
    };
  }

  /**
   * Disables an operator: his sessions end at once (the session resolver also refuses a blocked
   * operator on every request). One's own account is not disabled, so an active operator always
   * remains. 404, 409 `cannot_disable_self`, 409 `already_disabled`.
   */
  async disable(id: string): Promise<PlatformOperator> {
    const actor = this.actor();
    // The canonical form: the pipe accepts upper case, and `uuid` compares without it.
    const operatorId = id.toLowerCase();
    if (operatorId === actor.operatorId) {
      throw new ProblemException(409, 'cannot_disable_self');
    }
    const operator = await this.db.platformTransaction(actor, async (trx) => {
      // Both rows locked: two operators disabling each other at once cannot both succeed, so an
      // active operator always remains.
      const status = await this.lockActing(trx, [operatorId]);
      if (status === undefined) throw notFound();
      if (status !== 'active')
        throw new ProblemException(409, 'already_disabled');
      await this.repository.block(trx, operatorId);
      await this.audit.append(trx, {
        action: 'operator.disabled',
        entityType: 'operator',
        entityId: operatorId,
      });
      return this.repository.find(trx, operatorId);
    });
    if (operator === null) throw notFound();
    // The status already refuses every request of his; the sessions are only cleaned up.
    await afterCommitBestEffort(
      this.logger,
      'Ending the sessions of a disabled operator',
      () => this.sessions.destroyAllFor(operatorId),
    );
    return operator;
  }

  /**
   * Locks the acting operator's row and the target's (in id order, FOR UPDATE) and checks that
   * the acting operator is still active: one disabled meanwhile acts no more (401). The status of
   * the target, undefined for an unknown one.
   */
  private async lockActing(
    trx: Transaction<DB>,
    targets: string[],
  ): Promise<string | undefined> {
    const actorId = requireOperator().operatorId;
    const rows = await this.repository.lockStatuses(trx, [actorId, ...targets]);
    const status = new Map(rows.map((row) => [row.id, row.status]));
    if (status.get(actorId) !== 'active') throw unauthenticated();
    return targets.length > 0 ? status.get(targets[0]) : undefined;
  }
}
