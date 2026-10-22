import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { runWithContext } from '../../../common/context/request-context';
import { PlatformDatabase } from '../../../core/database/platform';
import { PrescriptionRetention } from '../../pos/prescription-retention';
import { InboxRetention } from '../../sync/inbox-retention';
import { RetentionRepository } from './retention.repository';

const FIRST_PASS_MS = 60_000;
const PASS_INTERVAL_MS = 60 * 60_000;

const errorCode = (error: unknown): string =>
  (error as { code?: unknown })?.code !== undefined
    ? String((error as { code: unknown }).code)
    : error instanceof Error
      ? error.name
      : typeof error;

// The first periodic task of the cloud (ADR-0013, amendment 2026-10-21; spec 2026-10-21-pos-offline-limits, P3, P5):
// once an hour, «per tenant in a loop», the prescription data past the retention term of each network is purged —
// the ПКУ records by `pos`, the envelopes of offline stores by `sync`. A timer of the API process, no scheduler
// library and no job queue; several API instances do not clash (a try-lock per network, an idempotent update). A
// failure of one network is logged with its code and the loop goes on; no prescription data is ever logged.
@Injectable()
export class PrescriptionPurgeScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PrescriptionPurgeScheduler.name);
  private first?: NodeJS.Timeout;
  private every?: NodeJS.Timeout;
  private pass: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly platform: PlatformDatabase,
    private readonly repository: RetentionRepository,
    private readonly prescriptions: PrescriptionRetention,
    private readonly inbox: InboxRetention,
  ) {}

  onApplicationBootstrap(): void {
    // the timers never keep the process alive
    this.first = setTimeout(() => void this.run(), FIRST_PASS_MS);
    this.first.unref();
    this.every = setInterval(() => void this.run(), PASS_INTERVAL_MS);
    this.every.unref();
  }

  // before the database modules close their pools (this module depends on them, so it is destroyed first): no new
  // pass, and the running one stops after its current network
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.first);
    clearInterval(this.every);
    await this.pass;
  }

  /** One pass over every network; a pass still running makes the next one wait for the next hour. */
  run(): Promise<void> {
    if (this.pass !== null || this.stopping)
      return this.pass ?? Promise.resolve();
    this.pass = this.purgeAll().finally(() => {
      this.pass = null;
    });
    return this.pass;
  }

  private async purgeAll(): Promise<void> {
    const correlationId = randomUUID();
    try {
      await runWithContext({ correlationId, principal: null }, async () => {
        const tenants = await this.platform.platformTransaction(
          { kind: 'system', job: 'prescription-purge' },
          (trx) => this.repository.tenantIds(trx),
        );
        let records = 0;
        let envelopes = 0;
        for (const tenantId of tenants) {
          if (this.stopping) break;
          try {
            const purged = await this.prescriptions.purgeExpired(tenantId);
            if (purged === null) continue;
            // each step writes its own event in its transaction: a failed envelope step keeps the trace of the
            // records already purged
            records += purged.purged;
            const cleared = await this.inbox.purgeExpired(
              tenantId,
              purged.retentionDays,
            );
            envelopes += cleared;
            // the counts of a network (spec §4.5), never its data
            if (purged.purged + cleared > 0) {
              this.logger.log(
                `Prescription data of a network purged: ${purged.purged} records, ${cleared} envelopes [tenantId=${tenantId}] [correlationId=${correlationId}]`,
              );
            }
          } catch (error) {
            this.logger.warn(
              `Prescription data of a network not purged (${errorCode(error)}) [tenantId=${tenantId}] [correlationId=${correlationId}]`,
            );
          }
        }
        if (records + envelopes > 0) {
          this.logger.log(
            `Prescription data purged: ${records} records, ${envelopes} envelopes [correlationId=${correlationId}]`,
          );
        }
      });
    } catch (error) {
      this.logger.warn(
        `The prescription purge pass failed (${errorCode(error)}) [correlationId=${correlationId}]`,
      );
    }
  }
}
