import { Injectable } from '@nestjs/common';
import { discountRuleStatus, hasPermissions } from '@pharmacy/shared-domain';
import type { DiscountRuleDefinition, DiscountRuleInput } from '@pharmacy/shared-dto';
import { requirePrincipal } from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { FieldProblemException } from '../../common/errors/validation-failed.exception';
import { newId, TenantDatabase, type TenantTransaction } from '../../core/database';
import { AuditService } from '../audit/audit.service';
import { PricingRepository, type RuleRow, type RuleValues } from './pricing.repository';
import { scopeIds } from './prices.service';

const notFound = () => new ProblemException(404, 'not_found');
const invalid = (field: string, code: string) =>
  new FieldProblemException(400, 'validation_failed', [{ field, code }]);

function nameIn(name: unknown, locale: 'ru' | 'tg', fallback: 'ru' | 'tj'): string {
  const map = (typeof name === 'object' && name !== null ? name : {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof map[key] === 'string' && map[key] !== '' ? (map[key] as string) : null);
  return pick(locale === 'tg' ? 'tj' : 'ru') ?? pick(fallback) ?? pick('ru') ?? pick('tj') ?? '';
}

/** Today in the time zone of the network, YYYY-MM-DD (the business date). */
function businessDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Discount rules of the network (spec 2026-10-07-catalog-pricing, section 6): thresholds by the
// receipt subtotal; a rule of the whole network needs discounts:manage-network, a rule of stores
// discounts:manage-network or discounts:manage-store with every store in the scope. An edit needs
// the rights for the rule as it is and as it becomes.
@Injectable()
export class DiscountRulesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly repository: PricingRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DiscountRuleDefinition[]> {
    const { tenantId } = requirePrincipal();
    return this.db.tenantTransaction(async (trx) => {
      const rows = await this.repository.rules(trx, tenantId, null);
      return this.visible(trx, tenantId, rows);
    });
  }

  async create(input: DiscountRuleInput): Promise<DiscountRuleDefinition> {
    const { tenantId, employeeId } = requirePrincipal();
    const id = newId();
    return this.db.tenantTransaction(async (trx) => {
      const values = await this.values(trx, tenantId, input);
      this.authorize(values.storeIds);
      await this.repository.insertRule(trx, tenantId, id, employeeId, values);
      await this.audit.append(trx, {
        action: 'discount_rule.created',
        entityType: 'discount_rule',
        entityId: id,
        details: this.auditDetails(values),
      });
      return this.one(trx, tenantId, id);
    });
  }

  async update(id: string, input: DiscountRuleInput): Promise<DiscountRuleDefinition> {
    const { tenantId } = requirePrincipal();
    const ruleId = id.toLowerCase();
    return this.db.tenantTransaction(async (trx) => {
      if (!(await this.repository.lockRule(trx, tenantId, ruleId))) throw notFound();
      const [current] = await this.visible(
        trx,
        tenantId,
        await this.repository.rules(trx, tenantId, ruleId),
      );
      if (!current) throw notFound();
      this.authorize(current.storeIds);
      const values = await this.values(trx, tenantId, input);
      this.authorize(values.storeIds);
      await this.repository.updateRule(trx, tenantId, ruleId, values);
      await this.audit.append(trx, {
        action: 'discount_rule.updated',
        entityType: 'discount_rule',
        entityId: ruleId,
        details: this.auditDetails(values),
      });
      return this.one(trx, tenantId, ruleId);
    });
  }

  /** 403 unless the principal may manage a rule with these stores (null — the whole network). */
  private authorize(storeIds: readonly string[] | null): void {
    const { permissions, storeScope } = requirePrincipal();
    if (hasPermissions(permissions, 'discounts:manage-network')) return;
    if (!hasPermissions(permissions, 'discounts:manage-store') || storeIds === null) {
      throw new ProblemException(403, 'forbidden');
    }
    const scope = scopeIds(storeScope);
    if (scope !== null && storeIds.some((storeId) => !scope.includes(storeId))) {
      throw new ProblemException(403, 'store_not_in_scope');
    }
  }

  private async values(
    trx: TenantTransaction,
    tenantId: string,
    input: DiscountRuleInput,
  ): Promise<RuleValues> {
    const { language } = await this.repository.settings(trx, tenantId);
    const minimums = input.thresholds.map((threshold) => threshold.minSubtotalMinor);
    if (new Set(minimums).size !== minimums.length) throw invalid('thresholds', 'duplicate');
    const period = input.period ?? null;
    if (period !== null && period.to !== null && period.to < period.from) {
      throw invalid('period', 'invalid_range');
    }
    const storeIds = input.storeIds?.map((storeId) => storeId.toLowerCase()) ?? null;
    if (storeIds !== null) {
      const active = new Set(
        (await this.repository.activeStores(trx, tenantId, null)).map((store) => store.id),
      );
      if (storeIds.some((storeId) => !active.has(storeId))) throw notFound();
    }
    return {
      name: { [language]: input.name.trim() },
      storeIds,
      validFrom: period?.from ?? null,
      validTo: period?.to ?? null,
      tiers: [...input.thresholds]
        .sort((a, b) => a.minSubtotalMinor - b.minSubtotalMinor)
        .map((threshold) => ({
          minTotalDirams: threshold.minSubtotalMinor,
          percentBp: threshold.percent * 100,
        })),
    };
  }

  private auditDetails(values: RuleValues): Record<string, unknown> {
    return {
      name: values.name,
      storeIds: values.storeIds,
      period: values.validFrom === null ? null : { from: values.validFrom, to: values.validTo },
      thresholds: values.tiers.map((tier) => ({
        minSubtotalMinor: tier.minTotalDirams,
        percent: tier.percentBp / 100,
      })),
    };
  }

  private async one(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<DiscountRuleDefinition> {
    const [rule] = await this.visible(trx, tenantId, await this.repository.rules(trx, tenantId, id));
    if (!rule) throw new Error('The discount rule just written is not readable');
    return rule;
  }

  /** Rules of the whole network and rules with at least one store of the scope. */
  private async visible(
    trx: TenantTransaction,
    tenantId: string,
    rows: readonly RuleRow[],
  ): Promise<DiscountRuleDefinition[]> {
    const { locale, storeScope } = requirePrincipal();
    const { language, timezone } = await this.repository.settings(trx, tenantId);
    const ids = rows.map((row) => row.id);
    const storesOf = await this.repository.ruleStores(trx, tenantId, ids);
    const tiersOf = await this.repository.ruleTiers(trx, tenantId, ids);
    const names = new Map(
      (await this.repository.activeStores(trx, tenantId, null)).map((s) => [s.id, s.name]),
    );
    const scope = scopeIds(storeScope);
    const today = businessDate(timezone);
    return rows.flatMap((row) => {
      const storeIds = row.level === 'network' ? null : (storesOf.get(row.id) ?? []);
      if (storeIds !== null && scope !== null && !storeIds.some((id) => scope.includes(id))) {
        return [];
      }
      const period =
        row.validFrom === null ? null : { from: row.validFrom, to: row.validTo };
      return [
        {
          id: row.id,
          name: nameIn(row.name, locale, language),
          thresholds: (tiersOf.get(row.id) ?? []).map((tier) => ({
            minSubtotalMinor: Number(tier.minTotalDirams),
            percent: tier.percentBp / 100,
          })),
          storeIds,
          storeNames: (storeIds ?? []).map((id) => names.get(id) ?? '—'),
          period,
          author: {
            name: row.authorName,
            at: row.createdAt.toISOString(),
            role: nameIn(row.authorRole, locale, language),
          },
          status: discountRuleStatus(period, today),
        },
      ];
    });
  }
}
