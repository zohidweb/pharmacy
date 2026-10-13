import { Controller, Get } from '@nestjs/common';
import type { DeploymentInfo } from '@pharmacy/shared-dto';
import { Public } from '../../common/guards/decorators';

// Where this web build runs (spec 2026-10-13-pos-shift-sale, E20): the Service Worker of apps/web
// registers in the cloud only. The POS module is registered in the cloud only, so the answer is
// fixed; an offline store has no such route and registers no Service Worker.
@Public()
@Controller({ path: 'deployment', version: '1' })
export class DeploymentController {
  @Get()
  get(): DeploymentInfo {
    return { kind: 'cloud' };
  }
}
