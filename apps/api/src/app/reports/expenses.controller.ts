import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Expense, ExpenseListResponse } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { ExpenseBodyDto, ExpenseQueryDto } from './dto/expenses.dto';
import { ExpensesService } from './expenses.service';

// The other expenses of the owner cabinet (spec 2026-10-14-owner-cabinet, 5.1, 5.6, E16).
@Controller({ path: 'expenses', version: '1' })
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** The records of a month and its cash withdrawals «на расходы»; 403 `store_not_in_scope`. */
  @RequirePermission('expenses:view')
  @Get()
  list(@Query() query: ExpenseQueryDto): Promise<ExpenseListResponse> {
    return this.expenses.list(query);
  }

  /** 403 `store_not_in_scope`; 422 `validation_failed` (`month` later than the current month). */
  @RequirePermission('expenses:create')
  @Post()
  create(@Body() body: ExpenseBodyDto): Promise<Expense> {
    return this.expenses.create(body);
  }

  /** The whole record; 404 `not_found`, 403 `store_not_in_scope`, 422 as on create. */
  @RequirePermission('expenses:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ExpenseBodyDto,
  ): Promise<Expense> {
    return this.expenses.update(id, body);
  }

  /** 404 `not_found`, 403 `store_not_in_scope`. */
  @RequirePermission('expenses:delete')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.expenses.remove(id);
  }
}
