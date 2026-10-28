import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../../core/database';

/** Marks a connection request `connected` with the new network, in the transaction of the creation. */
export type ConnectionRequestLink = (
  trx: Transaction<DB>,
  requestId: string,
  tenantId: string,
) => Promise<void>;

// The link of a new network to the connection request it came from (spec 2026-10-28-public-site-design, 7.2), filled by
// `platform/connection-requests`: the creation of a network marks the request in its own transaction without
// `tenants` depending on the requests module, which already depends on `tenants` (`TenantLookup`) — the port pattern
// of `PurchasePrices`. Throws 404 `connection_request_not_found` and 409 `request_already_decided`.
@Injectable()
export class ConnectionRequestLinker {
  private link: ConnectionRequestLink | null = null;

  register(link: ConnectionRequestLink): void {
    this.link = link;
  }

  markConnected(
    trx: Transaction<DB>,
    requestId: string,
    tenantId: string,
  ): Promise<void> {
    // both modules are cloud only; a missing link is a wiring error, not a request to ignore
    if (this.link === null)
      throw new Error('No connection request link is registered');
    return this.link(trx, requestId, tenantId);
  }
}
