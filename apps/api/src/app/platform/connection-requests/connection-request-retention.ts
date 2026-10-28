import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { ConnectionRequestsRepository } from './connection-requests.repository';

// The term of the personal data of the connection requests (spec 2026-10-28-public-site-design, 7.4; P7): 180 days after
// a `rejected` decision, or after the decision or the creation of `spam`, the name, the phone, the e-mail, the call
// time, the comment, the IP and the note of the operator become null and `anonymized_at` is set; the row stays (the
// platform class has no DELETE). `connected` requests keep their data while the network exists. Called by the hourly
// pass of `platform/retention` in its own system transaction; the count only, never the data.
@Injectable()
export class ConnectionRequestRetention {
  constructor(private readonly repository: ConnectionRequestsRepository) {}

  anonymizeExpired(trx: Transaction<DB>): Promise<number> {
    return this.repository.anonymizeExpired(trx);
  }
}
