import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  Page,
  PaymentListItem,
  TenantPaymentItem,
} from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  CancelPaymentDto,
  PaymentListQueryDto,
  RecordPaymentDto,
  UpdatePaymentDto,
} from './dto/payments.dto';
import { PaymentsService } from './payments.service';

const uuid = () => new ParseUUIDPipe();

// Payments of networks (spec 2026-10-15-billing-services, 6.1): reading — tenants:view, changes —
// tenants:manage without a recent sign-in (A15: frequent work, all in the journal).
@Controller({ path: 'operator', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequireOperatorPermission('tenants:view')
  @Get('payments')
  list(@Query() query: PaymentListQueryDto): Promise<Page<PaymentListItem>> {
    return this.payments.list(query);
  }

  /** 201; 400, 404, 409 `invoice_paid`, `idempotency_conflict`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('payments')
  record(@Body() body: RecordPaymentDto): Promise<PaymentListItem> {
    return this.payments.record(body);
  }

  /** 400, 404, 409 `payment_cancelled`. */
  @RequireOperatorPermission('tenants:manage')
  @Patch('payments/:id')
  update(
    @Param('id', uuid()) id: string,
    @Body() body: UpdatePaymentDto,
  ): Promise<PaymentListItem> {
    return this.payments.update(id, body);
  }

  /** 404, 409 `payment_cancelled`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('payments/:id/cancellation')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', uuid()) id: string,
    @Body() body: CancelPaymentDto,
  ): Promise<PaymentListItem> {
    return this.payments.cancel(id, body.reason);
  }

  /** 404 for an unknown network. */
  @RequireOperatorPermission('tenants:view')
  @Get('tenants/:id/payments')
  tenantPayments(
    @Param('id', uuid()) id: string,
  ): Promise<TenantPaymentItem[]> {
    return this.payments.tenantPayments(id);
  }
}
