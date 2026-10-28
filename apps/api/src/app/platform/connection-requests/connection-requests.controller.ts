import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  ConnectionRequest,
  ConnectionRequestListItem,
  Page,
} from '@pharmacy/shared-dto';
import { DEFAULT_PAGE_LIMIT } from '../../../common/pagination';
import { RequireOperatorPermission } from '../auth/decorators';
import { ConnectionRequestsService } from './connection-requests.service';
import {
  ConnectionRequestListQueryDto,
  ConnectionRequestNoteDto,
  RejectConnectionRequestDto,
} from './dto/connection-requests.dto';

// The connection requests of the site (spec 2026-10-28-public-site-design, 7.2, 8; P5): «Сайт → Заявки» of the admin,
// read with `tenants:view`, decided with `tenants:manage`. The network is created by «Новая компания» with
// `connectionRequestId` (`platform/tenants`).
@Controller({ path: 'operator/connection-requests', version: '1' })
export class ConnectionRequestsController {
  constructor(private readonly requests: ConnectionRequestsService) {}

  /** The newest first; the open ones (`new`, `in_progress`) when no `status`; 400 `validation_failed`. */
  @RequireOperatorPermission('tenants:view')
  @Get()
  async list(
    @Query() query: ConnectionRequestListQueryDto,
  ): Promise<Page<ConnectionRequestListItem>> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.offset ?? 0;
    const page = await this.requests.list(
      { statuses: query.status, q: query.q },
      limit,
      offset,
    );
    return { ...page, limit, offset };
  }

  /** 404 `connection_request_not_found`. */
  @RequireOperatorPermission('tenants:view')
  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConnectionRequest> {
    return this.requests.get(id);
  }

  /** `new` or another operator's `in_progress` → `in_progress` of this operator. 404; 409 `request_already_decided`. */
  @RequireOperatorPermission('tenants:manage')
  @Post(':id/take')
  @HttpCode(200)
  take(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConnectionRequest> {
    return this.requests.take(id);
  }

  /** 400 `validation_failed`; 404; 409 `request_already_decided`. */
  @RequireOperatorPermission('tenants:manage')
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RejectConnectionRequestDto,
  ): Promise<ConnectionRequest> {
    return this.requests.reject(id, body.reason);
  }

  /** 404; 409 `request_already_decided`. */
  @RequireOperatorPermission('tenants:manage')
  @Post(':id/mark-spam')
  @HttpCode(200)
  markSpam(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConnectionRequest> {
    return this.requests.markSpam(id);
  }

  /** 400 `validation_failed`; 404; 409 `request_already_decided` (the data is anonymized). */
  @RequireOperatorPermission('tenants:manage')
  @Put(':id/note')
  note(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ConnectionRequestNoteDto,
  ): Promise<ConnectionRequest> {
    return this.requests.note(id, body.note);
  }
}
