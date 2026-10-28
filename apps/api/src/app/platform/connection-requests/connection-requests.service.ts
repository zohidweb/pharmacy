import { Injectable } from '@nestjs/common';
import type {
  ConnectionRequest,
  ConnectionRequestListItem,
  ConnectionRequestStatus,
} from '@pharmacy/shared-dto';
import type { Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { type DB, newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { normalizeIdentifier } from '../../auth/identifier';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { LegalDocumentsService } from '../site-content/legal-documents.service';
import { ConnectionRequestLinker } from '../tenants/connection-request-linker';
import { TenantLookup } from '../tenants/tenant-lookup';
import {
  type ConnectionRequestFilter,
  type ConnectionRequestState,
  ConnectionRequestsRepository,
} from './connection-requests.repository';
import type { SubmitConnectionRequestDto } from './dto/connection-requests.dto';

// The protection of the form (spec 2026-10-28-public-site-design, 7.3; P6): a form sent sooner than 3 seconds after it
// opened is spam; 200 requests that are not spam a day in all.
const MIN_FILL_MS = 3_000;
// a clock of the visitor a little ahead of the server is not a bot; further ahead the time is made up
const CLOCK_SKEW_MS = 5 * 60_000;
const DAILY_CAP = 200;

const OPEN: readonly ConnectionRequestStatus[] = ['new', 'in_progress'];

const notFound = () =>
  new ProblemException(404, 'connection_request_not_found');
const decided = () => new ProblemException(409, 'request_already_decided');

function invalidField(field: string, code: string): FieldProblemException {
  return new FieldProblemException(400, 'validation_failed', [{ field, code }]);
}

/** A filled trap, a form sent too fast, an open time not a time or far in the future (A2). */
export function isSpam(
  website: string | undefined,
  openedAt: string,
  now: number,
): boolean {
  if (website !== undefined && website.trim() !== '') return true;
  const opened = Date.parse(openedAt);
  if (Number.isNaN(opened)) return true;
  const elapsed = now - opened;
  if (elapsed < -CLOCK_SKEW_MS) return true;
  return elapsed >= 0 && elapsed < MIN_FILL_MS;
}

const emptyToNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** The phone digits of a search that looks like a phone; null otherwise (a name with a digit is a name). */
function phoneDigitsOf(q: string): string | null {
  if (!/^[+\d\s\-()]+$/.test(q)) return null;
  const digits = q.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

// The connection requests of the public site (spec 2026-10-28-public-site-design, 6.4, 7.2–7.4, 8; ADR-0023): the form
// sends them without a session, the operator takes, declines or marks them spam, and the creation of a network from a
// request marks it `connected` through the port `ConnectionRequestLinker` of `platform/tenants`. A request answered by
// a decision is never reopened. The personal data of a request never goes into the audit or the logs.
@Injectable()
export class ConnectionRequestsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: ConnectionRequestsRepository,
    private readonly audit: PlatformAuditService,
    private readonly legal: LegalDocumentsService,
    private readonly tenants: TenantLookup,
    linker: ConnectionRequestLinker,
  ) {
    linker.register((trx, requestId, tenantId) =>
      this.markConnected(trx, requestId, tenantId),
    );
  }

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  // ── The form ─────────────────────────────────────────────────────────────────────────────

  /**
   * One answer for a new request, spam and a repeat: the bot is not told. Order: the privacy policy, spam (kept, never
   * capped), the daily cap, the duplicate phone, a new request. 400 `validation_failed` (a phone that is not one, a bad
   * e-mail); 409 `privacy_not_published` (the form is closed); 429 `too_many_requests` (the daily cap, for a repeated
   * phone too).
   */
  async submit(
    body: SubmitConnectionRequestDto,
    clientIp: string | null,
  ): Promise<void> {
    const phone = normalizeIdentifier(body.phone);
    if (phone === null || phone.kind !== 'phone')
      throw invalidField('phone', 'phone_format');
    let email: string | null = null;
    const rawEmail = emptyToNull(body.email);
    if (rawEmail !== null) {
      const parsed = normalizeIdentifier(rawEmail);
      if (parsed === null || parsed.kind !== 'email')
        throw invalidField('email', 'email_format');
      email = parsed.value;
    }
    const spam = isSpam(body.website, body.openedAt, Date.now());

    await this.db.platformTransaction(
      { kind: 'system', job: 'site.connection-request' },
      async (trx) => {
        // a closed form is told even to a bot: the site shows «скоро откроется» instead of the form
        const privacyDocumentId = await this.legal.currentPrivacyId(
          trx,
          body.locale,
        );
        if (privacyDocumentId === null)
          throw new ProblemException(409, 'privacy_not_published');
        const row = {
          id: newId(),
          networkName: body.networkName,
          city: body.city,
          storeCount: body.storeCount,
          contactName: body.contactName,
          phone: phone.value,
          email,
          inn: emptyToNull(body.inn),
          callTime: emptyToNull(body.callTime),
          comment: emptyToNull(body.comment),
          locale: body.locale,
          privacyDocumentId,
          clientIp,
        };
        // spam is kept (the operator may look at it) but never counted, never a duplicate and never notified
        if (spam) {
          await this.repository.insert(trx, { ...row, status: 'spam' });
          return;
        }
        // the cap before the duplicate: at the cap every phone gets the same 429, so the answer never tells whether
        // a phone has an open request (spec 7.3)
        if ((await this.repository.countRecentNotSpam(trx)) >= DAILY_CAP)
          throw new ProblemException(429, 'too_many_requests');
        if (await this.repository.hasOpenWithPhone(trx, phone.value)) return;
        await this.repository.insert(trx, { ...row, status: 'new' });
      },
    );
  }

  // ── The operator ─────────────────────────────────────────────────────────────────────────

  list(
    filter: { statuses?: ConnectionRequestStatus[]; q?: string },
    limit: number,
    offset: number,
  ): Promise<{ items: ConnectionRequestListItem[]; total: number }> {
    const q = filter.q === undefined || filter.q === '' ? null : filter.q;
    const where: ConnectionRequestFilter = {
      statuses: filter.statuses ?? OPEN,
      name: q,
      phoneDigits: q === null ? null : phoneDigitsOf(q),
    };
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.list(trx, where, limit, offset),
    );
  }

  /** 404 `connection_request_not_found`. */
  get(id: string): Promise<ConnectionRequest> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.card(trx, id),
    );
  }

  /**
   * The operator takes the request; another operator may take over one in work. Taking one's own again changes
   * nothing. 404; 409 `request_already_decided`.
   */
  take(id: string): Promise<ConnectionRequest> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const state = await this.open(trx, id);
      if (
        state.status === 'in_progress' &&
        state.assignedTo === actor.operatorId
      )
        return this.card(trx, id);
      await this.repository.update(trx, id, {
        status: 'in_progress',
        assignedTo: actor.operatorId,
      });
      await this.audit.append(trx, {
        action: 'connection-request.taken',
        entityType: 'connection-request',
        entityId: id,
        details: { from: state.status },
      });
      return this.card(trx, id);
    });
  }

  /** 404; 409 `request_already_decided`. The reason is not audited: it may name the person. */
  reject(id: string, reason: string): Promise<ConnectionRequest> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const state = await this.open(trx, id);
      await this.repository.update(trx, id, {
        status: 'rejected',
        rejectReason: reason,
        decidedAt: new Date(),
        decidedBy: actor.operatorId,
      });
      await this.audit.append(trx, {
        action: 'connection-request.rejected',
        entityType: 'connection-request',
        entityId: id,
        details: { from: state.status },
      });
      return this.card(trx, id);
    });
  }

  /** 404; 409 `request_already_decided`. */
  markSpam(id: string): Promise<ConnectionRequest> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const state = await this.open(trx, id);
      await this.repository.update(trx, id, {
        status: 'spam',
        decidedAt: new Date(),
        decidedBy: actor.operatorId,
      });
      await this.audit.append(trx, {
        action: 'connection-request.marked-spam',
        entityType: 'connection-request',
        entityId: id,
        details: { from: state.status },
      });
      return this.card(trx, id);
    });
  }

  /** The note of any request whose data is still there; an empty note removes it. 404; 409 `request_already_decided`. */
  note(id: string, note: string): Promise<ConnectionRequest> {
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const state = await this.repository.lock(trx, id);
      if (state === null) throw notFound();
      if (state.anonymized) throw decided();
      await this.repository.update(trx, id, {
        operatorNote: note === '' ? null : note,
      });
      await this.audit.append(trx, {
        action: 'connection-request.noted',
        entityType: 'connection-request',
        entityId: id,
      });
      return this.card(trx, id);
    });
  }

  /**
   * The port `ConnectionRequestLinker`: in the transaction of the creation of the network, the open request becomes
   * `connected` with it. 404 `connection_request_not_found`; 409 `request_already_decided`.
   */
  private async markConnected(
    trx: Transaction<DB>,
    requestId: string,
    tenantId: string,
  ): Promise<void> {
    const state = await this.open(trx, requestId);
    await this.repository.update(trx, requestId, {
      status: 'connected',
      tenantId,
      decidedAt: new Date(),
      decidedBy: requireOperator().operatorId,
    });
    await this.audit.append(trx, {
      action: 'connection-request.connected',
      tenantId,
      entityType: 'connection-request',
      entityId: requestId,
      details: { from: state.status },
    });
  }

  /** Locks a request that is still open (`new` or `in_progress`). */
  private async open(
    trx: Transaction<DB>,
    id: string,
  ): Promise<ConnectionRequestState> {
    const state = await this.repository.lock(trx, id);
    if (state === null) throw notFound();
    if (state.anonymized || !OPEN.includes(state.status)) throw decided();
    return state;
  }

  private async card(
    trx: Transaction<DB>,
    id: string,
  ): Promise<ConnectionRequest> {
    const row = await this.repository.card(trx, id);
    if (row === null) throw notFound();
    // the network created from the request is no warning
    const similarTenants = (
      await this.tenants.similar(trx, row.inn, row.phone)
    ).filter((tenant) => tenant.id !== row.tenantId);
    return { ...row, similarTenants };
  }
}
