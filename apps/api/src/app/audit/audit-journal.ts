import { Injectable } from '@nestjs/common';
import {
  auditGroupOf,
  hasPermissions,
  type AuditGroup,
} from '@pharmacy/shared-domain';
import type { AuditListResponse, TenantAuditEntry } from '@pharmacy/shared-dto';
import {
  type EmployeePrincipal,
  requirePrincipal,
} from '../../common/context/request-context';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { ProblemException } from '../../common/errors/problem.exception';
import { TenantDatabase, type TenantTransaction } from '../../core/database';
import type { AuditJournalQueryDto } from './dto/audit-journal.dto';
import {
  AuditJournalRepository,
  type AuditJournalRow,
} from './audit-journal.repository';

const DEFAULT_DAYS = 30;

// the values of an event the journal shows (E7); ids, authors, before/after objects stay in the log
const NUMBER_PARAMS = [
  'totalMinor',
  'refundMinor',
  'amountMinor',
  'discrepancyMinor',
  'expectedMinor',
  'actualCashMinor',
  'priceMinor',
  'lines',
  'positions',
] as const;
// amounts of these groups are at cost: only with `finance:view-cost` (spec 2026-10-14, 6.4)
const COST_GROUPS: ReadonlySet<AuditGroup> = new Set([
  'goods_receipt',
  'write_off',
  'stock_count',
  'supplier_return',
  'transfer',
  'purchasing',
  'unpost',
]);
/** A code, not prose. */
const CODE = /^[a-z0-9_.:-]{1,64}$/;
/** The month of an expense, YYYY-MM. */
const MONTH = /^\d{4}-\d{2}$/;

/** The stores an employee reads the journal of: a PIN session — its terminal's store only. */
function scopeOf(principal: EmployeePrincipal): 'all' | readonly string[] {
  if (principal.auth === 'pin') {
    return principal.currentStoreId ? [principal.currentStoreId] : [];
  }
  return principal.storeScope;
}

function nameIn(names: unknown, locale: 'ru' | 'tg'): string | null {
  if (typeof names !== 'object' || names === null) return null;
  const map = names as Record<string, unknown>;
  for (const key of [locale === 'tg' ? 'tj' : 'ru', 'ru', 'tj']) {
    const value = map[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

const daysBefore = (date: string, days: number) => {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
};

// The tenant audit journal (spec 2026-10-14-owner-cabinet, E7, E8, 5.5): the screen builds the text
// from the code and the values; the server sends no sentence. Entries without a store are seen by
// the network scope only.
@Injectable()
export class AuditJournal {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: AuditJournalRepository,
  ) {}

  list(query: AuditJournalQueryDto): Promise<AuditListResponse> {
    const principal = requirePrincipal();
    const scope = scopeOf(principal);
    if (query.storeId && scope !== 'all' && !scope.includes(query.storeId)) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.db.tenantTransaction(async (trx) => {
      const { today, timezone } = await this.repository.calendar(
        trx,
        principal.tenantId,
      );
      const to = query.to ?? today;
      const from = query.from ?? daysBefore(to, DEFAULT_DAYS);
      if (from > to) {
        throw new FieldProblemException(422, 'validation_failed', [
          { field: 'from', code: 'range' },
        ]);
      }
      const { rows, total } = await this.repository.list(
        trx,
        principal.tenantId,
        {
          from,
          to,
          timezone,
          scope,
          employeeId: query.employeeId ?? null,
          storeId: query.storeId ?? null,
          group: query.action ?? null,
          excludeGroups: [],
          q: query.q?.trim() || null,
          limit,
          offset,
        },
      );
      return {
        items: rows.map((row) => this.project(row, principal)),
        total,
        limit,
        offset,
      };
    });
  }

  /** The last entries of the scope of the current employee, without the given groups (the home). */
  async recent(
    trx: TenantTransaction,
    limit: number,
    excludeGroups: readonly AuditGroup[],
  ): Promise<TenantAuditEntry[]> {
    const principal = requirePrincipal();
    const { today, timezone } = await this.repository.calendar(
      trx,
      principal.tenantId,
    );
    const { rows } = await this.repository.list(trx, principal.tenantId, {
      from: daysBefore(today, DEFAULT_DAYS),
      to: today,
      timezone,
      scope: scopeOf(principal),
      employeeId: null,
      storeId: null,
      group: null,
      excludeGroups,
      q: null,
      limit,
      offset: 0,
    });
    return rows.map((row) => this.project(row, principal));
  }

  private project(
    row: AuditJournalRow,
    principal: EmployeePrincipal,
  ): TenantAuditEntry {
    const details = row.details ?? {};
    const group = auditGroupOf(row.action, details);
    const canSeeCost = hasPermissions(
      principal.permissions,
      'finance:view-cost',
    );
    // the amounts of the other expenses (salaries, rent) — only with `expenses:view` (spec E16)
    const hideAmounts =
      (group !== null && COST_GROUPS.has(group) && !canSeeCost) ||
      (group === 'expense' &&
        !hasPermissions(principal.permissions, 'expenses:view'));
    const params: Record<string, string | number | null> = {};
    for (const key of NUMBER_PARAMS) {
      const value = details[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (hideAmounts && key.endsWith('Minor')) continue;
      params[key] = value;
    }
    const reason = details['reason'];
    if (typeof reason === 'string' && CODE.test(reason))
      params['reason'] = reason;
    const expenseKind = details['expenseKind'];
    if (typeof expenseKind === 'string' && CODE.test(expenseKind)) {
      params['expenseKind'] = expenseKind;
    }
    const month = details['month'];
    if (typeof month === 'string' && MONTH.test(month)) params['month'] = month;
    const receipt = details['receipt'];
    if (typeof receipt === 'string' && receipt.length <= 64) {
      params['receipt'] = receipt;
    }
    const documentDate = details['documentDate'];
    return {
      id: row.id,
      at: new Date(row.recordedAt).toISOString(),
      documentDate:
        typeof documentDate === 'string' && documentDate !== row.businessDate
          ? documentDate
          : null,
      employeeName: row.employeeName,
      storeName: row.storeName,
      action: group,
      event: row.action,
      object: row.objectText ?? nameIn(row.objectNames, principal.locale),
      params,
      byOperator: row.actingOperatorId !== null,
    };
  }
}
