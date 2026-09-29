import { Module } from '@nestjs/common';

// Domain module boundary (ADR-0002). Other modules use only what is listed in `exports`.
@Module({})
export class PosModule {}
