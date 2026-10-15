import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  CreateOperatorResponse,
  IssueOperatorCodeResponse,
  PlatformOperator,
} from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../../common/guards/decorators';
import { RequireOperatorPermission } from '../auth/decorators';
import { CreateOperatorDto } from './dto/operator.dto';
import { OperatorsService } from './operators.service';

// The platform team (auth design 2026-10-02, section 9). Managing operators needs a step-up, as
// the owner's activation code does.
@Controller({ path: 'operator/operators', version: '1' })
export class OperatorsController {
  constructor(private readonly operators: OperatorsService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  list(): Promise<PlatformOperator[]> {
    return this.operators.list();
  }

  /** 201 `{ operator, activationCode }` — the code is shown once. 400, 409 `login_taken`. */
  @RequireOperatorPermission('operators:manage')
  @RequireFreshAuth()
  @Post()
  create(@Body() body: CreateOperatorDto): Promise<CreateOperatorResponse> {
    return this.operators.create(body);
  }

  /** 201 `{ activationCode }`. 404, 409 `cannot_issue_self`, 409 `operator_disabled`. */
  @RequireOperatorPermission('operators:manage')
  @RequireFreshAuth()
  @Post(':id/activation-codes')
  issueCode(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<IssueOperatorCodeResponse> {
    return this.operators.issueCode(id);
  }

  /** His sessions end at once. 404, 409 `cannot_disable_self`, 409 `already_disabled`. */
  @RequireOperatorPermission('operators:manage')
  @RequireFreshAuth()
  @Post(':id/deactivation')
  @HttpCode(HttpStatus.OK)
  disable(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PlatformOperator> {
    return this.operators.disable(id);
  }
}
