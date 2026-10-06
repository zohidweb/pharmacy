import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateTenantRequest,
  CreateTenantResponse,
  IssueOwnerCodeResponse,
  StoreSummary,
  TenantDetails,
  TenantListResponse,
} from '@pharmacy/shared-dto';
import {
  getRequestContext,
  requireOperator,
} from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { SessionStore } from '../../../core/sessions';
import {
  generateActivationCode,
  hashActivationCode,
} from '../../auth/activation-code';
import { normalizeIdentifier } from '../../auth/identifier';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { type TenantListParams, TenantsRepository } from './tenants.repository';

// The owner role of every new network (ADR-0018: the system role «Владелец», the whole catalog).
const OWNER_ROLE_NAME = { ru: 'Владелец', tj: 'Соҳиб' } as const;

// tenants.code: never used for sign-in, generated — `t-` and 8 lower-case base32 characters.
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const CODE_ATTEMPTS = 3;

function tenantCode(): string {
  const bytes = randomBytes(8);
  let out = 't-';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

// Unique indexes that name a field of the request (spec, section 8).
const CONFLICTS: Readonly<Record<string, { code: string; field: string }>> = {
  tenants_inn_uq: { code: 'inn_taken', field: 'inn' },
  employees_login_global_uq: { code: 'login_taken', field: 'owner.login' },
  employees_phone_global_uq: { code: 'phone_taken', field: 'owner.phone' },
  employees_email_global_uq: { code: 'email_taken', field: 'owner.email' },
};
const TENANT_CODE_CONSTRAINT = 'tenants_code_key';

function uniqueConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && typeof constraint === 'string' ? constraint : null;
}

const notFound = () => new ProblemException(404, 'not_found');

function invalidField(field: string, code: string): FieldProblemException {
  return new FieldProblemException(400, 'validation_failed', [{ field, code }]);
}

// Networks of the platform (spec 2026-10-05-tenants-module): the registry, provisioning with the
// owner's one-time code, and blocking. Tenant data is reached only through the provisioning
// functions (ADR-0013, amendment 2026-10-05). Codes, logins and reasons are never logged or audited.
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);
  private readonly codeTtlHours: number;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: TenantsRepository,
    private readonly sessions: SessionStore,
    private readonly audit: PlatformAuditService,
    config: ConfigService,
  ) {
    this.codeTtlHours = config.getOrThrow<number>('ACTIVATION_CODE_TTL_HOURS');
  }

  private actor() {
    return { kind: 'operator' as const, operatorId: requireOperator().operatorId };
  }

  async list(params: TenantListParams): Promise<TenantListResponse> {
    const { items, total, counts } = await this.db.platformTransaction(
      this.actor(),
      (trx) => this.repository.list(trx, params),
    );
    return { items, total, limit: params.limit, offset: params.offset, counts };
  }

  async details(tenantId: string): Promise<TenantDetails> {
    const details = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.details(trx, tenantId),
    );
    if (details === null) throw notFound();
    return details;
  }

  async stores(tenantId: string): Promise<StoreSummary[]> {
    return this.db.platformTransaction(this.actor(), async (trx) => {
      if ((await this.repository.status(trx, tenantId)) === null) throw notFound();
      return this.repository.stores(trx, tenantId);
    });
  }

  async create(request: CreateTenantRequest): Promise<CreateTenantResponse> {
    const owner = this.normalizeOwner(request.owner);
    const { code, display } = generateActivationCode();
    const codeExpiresAt = new Date(Date.now() + this.codeTtlHours * 3600_000);
    const tenantId = newId();

    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.db.platformTransaction(this.actor(), async (trx) => {
          await this.repository.provision(trx, {
            tenantId,
            code: tenantCode(),
            name: request.name.trim(),
            city: request.city.trim(),
            inn: request.inn.trim(),
            ownerEmployeeId: newId(),
            ownerRoleId: newId(),
            ownerRoleName: OWNER_ROLE_NAME,
            owner,
            codeHash: hashActivationCode(code),
            codeExpiresAt,
          });
          await this.audit.append(trx, {
            action: 'tenant.created',
            tenantId,
            entityType: 'tenant',
            entityId: tenantId,
          });
        });
        return {
          id: tenantId,
          activationCode: display,
          activationCodeExpiresAt: codeExpiresAt.toISOString(),
        };
      } catch (error) {
        const constraint = uniqueConstraint(error);
        if (constraint === TENANT_CODE_CONSTRAINT && attempt < CODE_ATTEMPTS) continue;
        const conflict = constraint === null ? undefined : CONFLICTS[constraint];
        if (conflict) {
          throw new FieldProblemException(409, conflict.code, [
            { field: conflict.field, code: conflict.code },
          ]);
        }
        throw error;
      }
    }
  }

  async issueOwnerCode(tenantId: string): Promise<IssueOwnerCodeResponse> {
    const { code, display } = generateActivationCode();
    const expiresAt = new Date(Date.now() + this.codeTtlHours * 3600_000);
    const actor = this.actor();
    await this.db.platformTransaction(actor, async (trx) => {
      const issued = await this.repository.issueOwnerCode(trx, {
        tenantId,
        codeHash: hashActivationCode(code),
        expiresAt,
        operatorId: actor.operatorId,
        auditId: newId(),
        correlationId: getRequestContext()?.correlationId ?? newId(),
      });
      if (!issued) {
        const status = await this.repository.status(trx, tenantId);
        if (status === 'blocked') throw new ProblemException(409, 'tenant_blocked');
        throw notFound();
      }
      await this.audit.append(trx, {
        action: 'tenant.owner-code-issued',
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
      });
    });
    return {
      activationCode: display,
      activationCodeExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Blocks the network; every session of it ends on its next request (spec, section 6). Blocking
   * an already blocked network sets the session flag again and answers 409, so a retry after a
   * Redis failure completes the block.
   */
  async block(tenantId: string, reason: string): Promise<TenantDetails> {
    const actor = this.actor();
    const blocked = await this.db.platformTransaction(actor, async (trx) => {
      if (await this.repository.block(trx, tenantId, actor.operatorId, reason.trim())) {
        await this.audit.append(trx, {
          action: 'tenant.blocked',
          tenantId,
          entityType: 'tenant',
          entityId: tenantId,
        });
        return true;
      }
      const status = await this.repository.status(trx, tenantId);
      if (status === null) throw notFound();
      return false;
    });
    await this.afterCommit(() => this.sessions.markTenantBlocked(tenantId));
    if (!blocked) throw new ProblemException(409, 'already_blocked');
    return this.details(tenantId);
  }

  async unblock(tenantId: string): Promise<TenantDetails> {
    const unblocked = await this.db.platformTransaction(this.actor(), async (trx) => {
      if (await this.repository.unblock(trx, tenantId)) {
        await this.audit.append(trx, {
          action: 'tenant.unblocked',
          tenantId,
          entityType: 'tenant',
          entityId: tenantId,
        });
        return true;
      }
      const status = await this.repository.status(trx, tenantId);
      if (status === null) throw notFound();
      return false;
    });
    await this.afterCommit(() => this.sessions.clearTenantBlocked(tenantId));
    if (!unblocked) throw new ProblemException(409, 'not_blocked');
    return this.details(tenantId);
  }

  // After the commit the database already holds the state; a store failure is answered as an
  // error (logged), so the operator retries and the retry completes the session side.
  private async afterCommit(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `Tenant session flag was not updated (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
      throw error;
    }
  }

  // The owner's identifiers as sign-in stores them (ADR-0008): a plain login, an E.164 phone, an
  // optional e-mail; each must normalize to its own kind.
  private normalizeOwner(owner: CreateTenantRequest['owner']) {
    const login = normalizeIdentifier(owner.login);
    if (login === null || login.kind !== 'login') throw invalidField('owner.login', 'login_format');
    const phone = normalizeIdentifier(owner.phone);
    if (phone === null || phone.kind !== 'phone') throw invalidField('owner.phone', 'phone_format');
    let email: string | null = null;
    if (owner.email !== undefined && owner.email.trim() !== '') {
      const parsed = normalizeIdentifier(owner.email);
      if (parsed === null || parsed.kind !== 'email') {
        throw invalidField('owner.email', 'email_format');
      }
      email = parsed.value;
    }
    return {
      fullName: owner.fullName.trim(),
      login: login.value,
      phone: phone.value,
      email,
    };
  }
}
