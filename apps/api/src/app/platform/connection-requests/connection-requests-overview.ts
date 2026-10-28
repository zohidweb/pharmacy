import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';
import { ConnectionRequestsRepository } from './connection-requests.repository';

// What the notifications of the operators need of the connection requests (spec 2026-10-28-public-site-design, 7.4):
// the counter «Заявки» of the admin menu and the state `connection_requested` — the requests nobody has taken yet.
// Exported by ConnectionRequestsModule (`platform/connection-requests` → `platform/notifications`); runs in the platform
// transaction of the caller, like `BillingOverview`.
@Injectable()
export class ConnectionRequestsOverview {
  constructor(private readonly repository: ConnectionRequestsRepository) {}

  /** The number of `new` requests. */
  newCount(trx: Transaction<DB>): Promise<number> {
    return this.repository.countNew(trx);
  }

  /** The `new` requests, the oldest first. */
  newRequests(
    trx: Transaction<DB>,
  ): Promise<{ id: string; networkName: string }[]> {
    return this.repository.newRequests(trx);
  }
}
