import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { ConnectionRequestsRepository } from './connection-requests.repository';

// The term of the personal data of the connection requests (spec 2026-10-28-public-site-design, 7.4; P7): 180 days after
// a `rejected` decision, or after the decision or the creation of `spam`, the name, the phone, the e-mail, the call
// time, the comment, the IP, the note of the operator and the reason of the refusal become null and `anonymized_at` is
// set; the row stays (the platform class has no DELETE). `connected` requests keep their data while the network
// exists. Called by the hourly pass of `platform/retention` in its own system transaction; a pass that anonymized
// something leaves one journal entry with the count, never the data (like `controlled.prescriptions-purged`).
@Injectable()
export class ConnectionRequestRetention {
  constructor(
    private readonly repository: ConnectionRequestsRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async anonymizeExpired(trx: Transaction<DB>): Promise<number> {
    const count = await this.repository.anonymizeExpired(trx);
    if (count > 0)
      await this.audit.append(trx, {
        action: 'connection-requests.anonymized',
        entityType: 'connection_request',
        details: { count },
      });
    return count;
  }
}
