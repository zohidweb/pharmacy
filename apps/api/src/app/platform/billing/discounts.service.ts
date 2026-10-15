import { Injectable } from '@nestjs/common';
import type { TenantDiscount } from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { type DB, newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import type { AddTenantDiscountDto } from './dto/discounts.dto';
import { monthOf } from './invoices.repository';

const notFound = () => new ProblemException(404, 'not_found');
const invoiced = () => new ProblemException(409, 'discount_invoiced');
const invalid = (code: string) =>
  new FieldProblemException(400, 'validation_failed', [
    { field: 'toMonth', code },
  ]);

interface DiscountRow {
  id: string;
  tenantId: string;
  percentBp: number;
  fromMonth: string;
  toMonth: string;
  invoicedThrough: string | null;
}

const toDiscount = (row: DiscountRow): TenantDiscount => ({
  id: row.id,
  percentBp: row.percentBp,
  fromMonth: row.fromMonth,
  toMonth: row.toMonth,
  invoicedThrough: row.invoicedThrough,
});

// `invoicedThrough` — the last month of the period that has an invoice of the network (A10).
const SELECT = sql`
  select d.id, d.tenant_id, d.percent_bp, to_char(d.from_month, 'YYYY-MM') as from_month,
         to_char(d.to_month, 'YYYY-MM') as to_month,
         (select to_char(max(i.period_month), 'YYYY-MM') from pharmacy.invoices i
          where i.tenant_id = d.tenant_id
            and i.period_month between d.from_month and d.to_month) as invoiced_through
  from pharmacy.tenant_discounts d`;

// Discounts of networks on the store tariff (spec 2026-10-15-billing-services, A10, B10, B18): periods
// of a network do not overlap, which is checked under the lock of the network's row. A discount is
// never deleted: a removed one carries removed_at and stops applying.
@Injectable()
export class DiscountsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  private async lockTenant(
    trx: Transaction<DB>,
    tenantId: string,
  ): Promise<boolean> {
    const { rows } = await sql`
      select id from pharmacy.tenants where id = ${tenantId} for update`.execute(
      trx,
    );
    return rows.length > 0;
  }

  private async one(
    trx: Transaction<DB>,
    id: string,
  ): Promise<DiscountRow | null> {
    const { rows } = await sql<DiscountRow>`
      ${SELECT} where d.id = ${id} and d.removed_at is null`.execute(trx);
    return rows[0] ?? null;
  }

  /** A discount after the lock of its network; 404 for an unknown or removed one. */
  private async locked(trx: Transaction<DB>, id: string): Promise<DiscountRow> {
    const probe = await this.one(trx, id);
    if (probe === null) throw notFound();
    await this.lockTenant(trx, probe.tenantId);
    const row = await this.one(trx, id);
    if (row === null) throw notFound();
    return row;
  }

  /** 404 for an unknown network. */
  list(tenantIdParam: string): Promise<TenantDiscount[]> {
    const tenantId = tenantIdParam.toLowerCase();
    return this.db.platformTransaction(this.actor(), async (trx) => {
      const tenant = await trx
        .selectFrom('tenants')
        .select('id')
        .where('id', '=', tenantId)
        .executeTakeFirst();
      if (tenant === undefined) throw notFound();
      const { rows } = await sql<DiscountRow>`
        ${SELECT} where d.tenant_id = ${tenantId} and d.removed_at is null
        order by d.from_month, d.id`.execute(trx);
      return rows.map(toDiscount);
    });
  }

  /** 201; 400 `order`, 404, 409 `discount_overlap`. */
  add(
    tenantIdParam: string,
    input: AddTenantDiscountDto,
  ): Promise<TenantDiscount> {
    const actor = this.actor();
    const tenantId = tenantIdParam.toLowerCase();
    if (input.toMonth < input.fromMonth) throw invalid('order');
    return this.db.platformTransaction(actor, async (trx) => {
      if (!(await this.lockTenant(trx, tenantId))) throw notFound();
      const { rows: overlap } = await sql`
        select 1 from pharmacy.tenant_discounts
        where tenant_id = ${tenantId} and removed_at is null
          and from_month <= ${monthOf(input.toMonth)}::date
          and to_month >= ${monthOf(input.fromMonth)}::date`.execute(trx);
      if (overlap.length > 0) {
        throw new ProblemException(409, 'discount_overlap');
      }
      const id = newId();
      await trx
        .insertInto('tenantDiscounts')
        .values({
          id,
          tenantId,
          percentBp: input.percentBp,
          fromMonth: monthOf(input.fromMonth),
          toMonth: monthOf(input.toMonth),
          createdBy: actor.operatorId,
        })
        .execute();
      await this.audit.append(trx, {
        action: 'tenant.discount-added',
        tenantId,
        entityType: 'tenant_discount',
        entityId: id,
        details: {
          percentBp: input.percentBp,
          fromMonth: input.fromMonth,
          toMonth: input.toMonth,
        },
      });
      const row = await this.one(trx, id);
      if (row === null) throw new Error('The discount is not readable');
      return toDiscount(row);
    });
  }

  /**
   * Shortens the period; a longer one is a new discount. 400 `order`, `not_shorter`; 404; 409
   * `discount_invoiced` before the last month with an invoice.
   */
  shorten(discountId: string, toMonth: string): Promise<TenantDiscount> {
    const actor = this.actor();
    const id = discountId.toLowerCase();
    return this.db.platformTransaction(actor, async (trx) => {
      const row = await this.locked(trx, id);
      if (toMonth < row.fromMonth) throw invalid('order');
      if (toMonth > row.toMonth) throw invalid('not_shorter');
      if (row.invoicedThrough !== null && toMonth < row.invoicedThrough) {
        throw invoiced();
      }
      if (toMonth === row.toMonth) return toDiscount(row);
      await trx
        .updateTable('tenantDiscounts')
        .set({ toMonth: monthOf(toMonth), updatedAt: sql`now()` })
        .where('id', '=', id)
        .execute();
      await this.audit.append(trx, {
        action: 'tenant.discount-shortened',
        tenantId: row.tenantId,
        entityType: 'tenant_discount',
        entityId: id,
        details: { previousToMonth: row.toMonth, toMonth },
      });
      const next = await this.one(trx, id);
      if (next === null) throw new Error('The discount is not readable');
      return toDiscount(next);
    });
  }

  /** 404; 409 `discount_invoiced` for a discount any invoice has taken. Removed, never deleted. */
  remove(discountId: string): Promise<void> {
    const actor = this.actor();
    const id = discountId.toLowerCase();
    return this.db.platformTransaction(actor, async (trx) => {
      const row = await this.locked(trx, id);
      if (row.invoicedThrough !== null) throw invoiced();
      await trx
        .updateTable('tenantDiscounts')
        .set({
          removedAt: sql`now()`,
          removedBy: actor.operatorId,
          updatedAt: sql`now()`,
        })
        .where('id', '=', id)
        .execute();
      await this.audit.append(trx, {
        action: 'tenant.discount-removed',
        tenantId: row.tenantId,
        entityType: 'tenant_discount',
        entityId: id,
        details: {
          percentBp: row.percentBp,
          fromMonth: row.fromMonth,
          toMonth: row.toMonth,
        },
      });
    });
  }
}
