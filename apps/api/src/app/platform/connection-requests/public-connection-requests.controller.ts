import { Body, Controller, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/guards/decorators';
import { CONNECTION_REQUEST_LIMIT } from '../../../common/throttling/public-limits';
import { ConnectionRequestsService } from './connection-requests.service';
import { SubmitConnectionRequestDto } from './dto/connection-requests.dto';

// The form «Подключить аптеку» of the public site (ADR-0023, spec 2026-10-28-public-site-design, 6.4, 7.3): no session,
// unsafe requests only from SITE_ORIGIN (CsrfGuard), 3 requests an hour from an address.
@Public()
@Throttle({ default: CONNECTION_REQUEST_LIMIT })
@Controller({ path: 'public/connection-requests', version: '1' })
export class PublicConnectionRequestsController {
  constructor(private readonly requests: ConnectionRequestsService) {}

  /**
   * 201 without a body — the same for a new request, spam and a repeat of the phone. 400 `validation_failed`; 409
   * `privacy_not_published`; 429 `too_many_requests` (3 an hour from an address; 200 a day in all).
   */
  @Post()
  async submit(
    @Body() body: SubmitConnectionRequestDto,
    @Ip() ip: string | undefined,
  ): Promise<void> {
    await this.requests.submit(body, ip === undefined || ip === '' ? null : ip);
  }
}
