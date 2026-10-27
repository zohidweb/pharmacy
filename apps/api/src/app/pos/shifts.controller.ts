import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  Shift,
  ShiftDetails,
  ShiftListResponse,
  ZReport,
} from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { BufferedOperation } from './buffer-replay.interceptor';
import {
  CashMovementDto,
  CloseShiftDto,
  OpenShiftDto,
  ShiftListQueryDto,
} from './dto/pos.dto';
import { ShiftsService } from './shifts.service';

// Shifts of the terminals (spec 2026-10-13-pos-shift-sale, 4.1, 4.4). The operations of the buffer
// carry `Idempotency-Key` = the id of the body. A session without a terminal — 403
// `terminal_required`; 409 `wrong_terminal`, `idempotency_conflict`; 422 `author_not_allowed`.
@Controller({ path: 'shifts', version: '1' })
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  /** 404 `no_open_shift`. */
  @RequirePermission('shifts:view')
  @Get('current')
  current(): Promise<Shift> {
    return this.shifts.current();
  }

  /**
   * The shift history of the scope (plan 2026-10-27-shift-history, S1): a report, any session. 403
   * `store_not_in_scope`.
   */
  @RequirePermission('reports:view')
  @Get()
  list(@Query() query: ShiftListQueryDto): Promise<ShiftListResponse> {
    return this.shifts.list(query);
  }

  /** The card of a shift of the scope (S2); 404 `not_found` outside it. After `current`, which it would shadow. */
  @RequirePermission('reports:view')
  @Get(':id')
  details(@Param('id', new ParseUUIDPipe()) id: string): Promise<ShiftDetails> {
    return this.shifts.details(id);
  }

  /** 409 `shift_open`. */
  @RequirePermission('shifts:create')
  @BufferedOperation()
  @Post()
  open(
    @Body() body: OpenShiftDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-client-sent-at') sentAt?: string,
  ): Promise<Shift> {
    return this.shifts.open(body, key, sentAt);
  }

  /** 409 `no_open_shift` / `shift_closed`. */
  @RequirePermission('shifts:update')
  @BufferedOperation()
  @Post(':id/cash-movements')
  cashMovement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CashMovementDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-client-sent-at') sentAt?: string,
  ): Promise<Shift> {
    return this.shifts.cashMovement(id, body, key, sentAt);
  }

  /** Accepted as a fact (E24); 409 `no_open_shift` / `shift_closed`. */
  @RequirePermission('shifts:update')
  @BufferedOperation()
  @Post(':id/closure')
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CloseShiftDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-client-sent-at') sentAt?: string,
  ): Promise<ZReport> {
    return this.shifts.close(id, body, key, sentAt);
  }

  /** 404 `not_found` — not closed or not of the scope. */
  @RequirePermission('shifts:view')
  @Get(':id/z-report')
  zReport(@Param('id', new ParseUUIDPipe()) id: string): Promise<ZReport> {
    return this.shifts.zReport(id);
  }
}
