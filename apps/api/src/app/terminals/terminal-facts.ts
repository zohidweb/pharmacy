import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  SyncOperationType,
  TerminalBoundPayload,
  TerminalRevokedPayload,
} from '@pharmacy/shared-dto';
import type { TenantTransaction } from '../../core/database';
import {
  type AppliedOperation,
  type FactApplier,
  requireEmployees,
  sameStore,
  SyncApplyError,
  SyncAppliers,
} from '../../core/sync';
import { AuditService } from '../audit/audit.service';

// The terminals of an offline store applied in the cloud (ADR-0014 §4; spec 2026-10-16-offline-sync, 4.2): the
// cloud keeps them for the shifts and receipts that refer to them. The device credential never leaves the store,
// so a terminal of the store gets a random hash here and can never sign in to the cloud.
@Injectable()
export class TerminalFacts implements FactApplier {
  readonly types: readonly SyncOperationType[] = [
    'terminal.bound',
    'terminal.revoked',
  ];

  constructor(
    appliers: SyncAppliers,
    private readonly audit: AuditService,
  ) {
    appliers.register(this);
  }

  async apply(
    trx: TenantTransaction,
    operation: AppliedOperation,
  ): Promise<void> {
    if (operation.type === 'terminal.bound') {
      return this.bound(
        trx,
        operation as AppliedOperation<TerminalBoundPayload>,
      );
    }
    if (operation.type === 'terminal.revoked') {
      return this.revoked(
        trx,
        operation as AppliedOperation<TerminalRevokedPayload>,
      );
    }
    throw new SyncApplyError('unsupported_type');
  }

  private async bound(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<TerminalBoundPayload>,
  ): Promise<void> {
    const { terminal, revokedTerminalId } = payload;
    sameStore(terminal.storeId, storeId);
    await requireEmployees(trx, tenantId, [terminal.boundBy]);
    // binding a device again revokes its previous terminal of the same store (as in the cloud)
    if (revokedTerminalId !== null) {
      await this.revoke(
        trx,
        tenantId,
        storeId,
        revokedTerminalId,
        terminal.boundAt,
        terminal.boundBy,
      );
    }
    await trx
      .insertInto('terminals')
      .values({
        tenantId,
        id: terminal.id,
        storeId,
        name: terminal.name,
        credentialHash: randomBytes(32),
        boundBy: terminal.boundBy,
        boundAt: terminal.boundAt,
      })
      .execute();
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  private async revoked(
    trx: TenantTransaction,
    { tenantId, storeId, payload }: AppliedOperation<TerminalRevokedPayload>,
  ): Promise<void> {
    await requireEmployees(trx, tenantId, [payload.revokedBy]);
    await this.revoke(
      trx,
      tenantId,
      storeId,
      payload.terminalId,
      payload.revokedAt,
      payload.revokedBy,
    );
    await this.appendAudit(trx, tenantId, storeId, payload.audit);
  }

  /** Revokes a terminal of the store once; a terminal not here yet is waited for. */
  private async revoke(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    terminalId: string,
    at: string,
    by: string,
  ): Promise<void> {
    const terminal = await trx
      .selectFrom('terminals')
      .select('revokedAt')
      .where('tenantId', '=', tenantId)
      .where('storeId', '=', storeId)
      .where('id', '=', terminalId)
      .forUpdate()
      .executeTakeFirst();
    if (!terminal) throw new SyncApplyError('terminal', 'dependency');
    if (terminal.revokedAt !== null) return;
    await trx
      .updateTable('terminals')
      .set({ revokedAt: at, revokedBy: by })
      .where('tenantId', '=', tenantId)
      .where('id', '=', terminalId)
      .execute();
  }

  private async appendAudit(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    rows: TerminalBoundPayload['audit'],
  ): Promise<void> {
    for (const row of rows) {
      if (row.storeId !== null) sameStore(row.storeId, storeId);
      await this.audit.appendFact(trx, tenantId, row, storeId);
    }
  }
}
