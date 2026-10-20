import { Injectable } from '@nestjs/common';
import type { Announcement } from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { AnnouncementsRepository } from './announcements.repository';
import type { CreateAnnouncementDto } from './dto/announcements.dto';

// Announcements to networks (spec 2026-10-19-operator-notifications, N11–N13): an operator publishes and
// cancels them; the platform audit log records both.
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: AnnouncementsRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  list(): Promise<Announcement[]> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.current(trx),
    );
  }

  async create(body: CreateAnnouncementDto): Promise<Announcement> {
    const startsAt = Date.parse(body.startsAt);
    const endsAt = Date.parse(body.endsAt);
    if (endsAt <= startsAt) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'endsAt', code: 'before_start' },
      ]);
    }
    if (endsAt <= Date.now()) {
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'endsAt', code: 'past' },
      ]);
    }
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const announcement = await this.repository.insert(trx, {
        id: newId(),
        title: body.title,
        text: body.text,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        scope: body.scope,
        createdBy: actor.operatorId,
      });
      await this.audit.append(trx, {
        action: 'announcement.published',
        entityType: 'announcement',
        entityId: announcement.id,
        details: { scope: announcement.scope },
      });
      return announcement;
    });
  }

  /** 404 — unknown; 409 `not_active` — cancelled or ended (N12). */
  async cancel(id: string): Promise<Announcement> {
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const row = await this.repository.lock(trx, id);
      if (!row) throw new ProblemException(404, 'not_found');
      if (row.cancelledAt !== null || row.ended) {
        throw new ProblemException(409, 'not_active');
      }
      const announcement = await this.repository.cancel(
        trx,
        id,
        actor.operatorId,
      );
      await this.audit.append(trx, {
        action: 'announcement.cancelled',
        entityType: 'announcement',
        entityId: id,
        details: { scope: announcement.scope },
      });
      return announcement;
    });
  }
}
