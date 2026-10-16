import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  BillingSummary,
  GenerateInvoicesResponse,
  InvoiceDetails,
  InvoiceGenerationPreview,
  InvoiceListResponse,
  RecalculationPreview,
  TenantInvoiceItem,
} from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  InvoiceListQueryDto,
  PeriodDto,
  SummaryQueryDto,
} from './dto/invoices.dto';
import { InvoicesService } from './invoices.service';

const uuid = () => new ParseUUIDPipe();

// Invoices of networks (spec 2026-10-15-billing-services, 6.1): reading — tenants:view, generation
// and recalculation — tenants:manage (A15).
@Controller({ path: 'operator', version: '1' })
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @RequireOperatorPermission('tenants:view')
  @Get('billing/summary')
  summary(@Query() query: SummaryQueryDto): Promise<BillingSummary> {
    return this.invoices.summary(query.period);
  }

  @RequireOperatorPermission('tenants:view')
  @Get('invoices')
  list(@Query() query: InvoiceListQueryDto): Promise<InvoiceListResponse> {
    return this.invoices.list(query);
  }

  /** Refreshes the activity of the stores of every network for the period (B13). */
  @RequireOperatorPermission('tenants:manage')
  @Get('invoices/generation-preview')
  generationPreview(
    @Query() query: PeriodDto,
  ): Promise<InvoiceGenerationPreview> {
    return this.invoices.generationPreview(query.period);
  }

  /** 201 `{ created }`; 409 `period_not_closed`, `requisites_missing`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('invoices/generations')
  generate(@Body() body: PeriodDto): Promise<GenerateInvoicesResponse> {
    return this.invoices.generate(body.period);
  }

  /** 404. */
  @RequireOperatorPermission('tenants:view')
  @Get('invoices/:id')
  details(@Param('id', uuid()) id: string): Promise<InvoiceDetails> {
    return this.invoices.details(id);
  }

  /** 404, 409 `invoice_paid`. */
  @RequireOperatorPermission('tenants:manage')
  @Get('invoices/:id/recalculation-preview')
  recalculationPreview(
    @Param('id', uuid()) id: string,
  ): Promise<RecalculationPreview> {
    return this.invoices.recalculationPreview(id);
  }

  /** 201; 404, 409 `invoice_paid`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('invoices/:id/recalculation')
  recalculate(@Param('id', uuid()) id: string): Promise<InvoiceDetails> {
    return this.invoices.recalculate(id);
  }

  /** 404 for an unknown network. */
  @RequireOperatorPermission('tenants:view')
  @Get('tenants/:id/invoices')
  tenantInvoices(
    @Param('id', uuid()) id: string,
  ): Promise<TenantInvoiceItem[]> {
    return this.invoices.tenantInvoices(id);
  }
}
