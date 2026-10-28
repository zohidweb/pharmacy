import { Controller, Get, Query } from '@nestjs/common';
import type { AuditListResponse } from '@pharmacy/shared-dto';
import { ExportPage } from '../../common/pagination';
import { RequirePermission } from '../auth/decorators';
import { AuditJournal } from './audit-journal';
import { AuditJournalQueryDto } from './dto/audit-journal.dto';

// The tenant audit journal, read only (spec 2026-10-14-owner-cabinet, 5.1, 5.5).
@Controller({ path: 'audit-log', version: '1' })
export class AuditJournalController {
  constructor(private readonly journal: AuditJournal) {}

  /** 403 `store_not_in_scope` for a store out of the scope; 422 `validation_failed` (`from` > `to`). */
  @RequirePermission('audit:view')
  @ExportPage()
  @Get()
  list(@Query() query: AuditJournalQueryDto): Promise<AuditListResponse> {
    return this.journal.list(query);
  }
}
