import type {
  SyncEnvelope,
  SyncHandshakeRequest,
  SyncOperation,
  SyncOperationType,
  SyncRunCompleteRequest,
} from '@pharmacy/shared-dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// The envelope and the handshake of the sync contour (ADR-0014 §6; spec 2026-10-16-offline-sync). The payload
// of an operation is checked by its applier, not here: a payload the cloud does not understand must reach the
// inbox and quarantine, not be refused as a whole batch.

/** POST /api/v1/sync/runs */
export class SyncHandshakeDto implements SyncHandshakeRequest {
  @IsUUID()
  storeId!: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  protocolVersion!: number;

  @IsString()
  @MaxLength(50)
  appVersion!: string;

  @IsString()
  @MaxLength(100)
  schemaVersion!: string;

  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  feedCursor!: number | null;

  @IsInt()
  @Min(0)
  outboxDepth!: number;

  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  oldestPendingAt!: string | null;

  @IsISO8601({ strict: true })
  storeTime!: string;
}

class SyncActorDto {
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  employeeId!: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  terminalId!: string | null;
}

export class SyncOperationDto implements SyncOperation {
  @IsUUID()
  operationId!: string;

  @IsInt()
  @Min(0)
  storeSeq!: number;

  // Any string of the known shape: an unknown type is quarantined by the service, not refused here.
  @IsString()
  @Matches(/^[a-z][a-z-]*\.[a-z][a-z-]*$/)
  @MaxLength(60)
  type!: SyncOperationType;

  @IsInt()
  @Min(1)
  typeVersion!: number;

  @Matches(/^[0-9a-f]{64}$/)
  payloadHash!: string;

  @IsString()
  @MaxLength(100)
  correlationId!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;

  @ValidateNested()
  @Type(() => SyncActorDto)
  actor!: SyncActorDto;

  @IsObject()
  payload!: unknown;
}

/** POST /api/v1/sync/operations */
export class SyncEnvelopeDto implements SyncEnvelope {
  @IsInt()
  @Min(0)
  protocolVersion!: number;

  @IsUUID()
  batchId!: string;

  @IsUUID()
  syncRunId!: string;

  @IsUUID()
  storeId!: string;

  // The 500 limit answers 413 batch_too_large in the service, so the array is only capped generously here.
  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations!: SyncOperationDto[];
}

/** POST /api/v1/sync/runs/{id}/complete */
export class SyncRunCompleteDto implements SyncRunCompleteRequest {
  @IsInt() @Min(0) operationsSent!: number;
  @IsInt() @Min(0) applied!: number;
  @IsInt() @Min(0) duplicate!: number;
  @IsInt() @Min(0) quarantined!: number;
  @IsInt() @Min(0) rejected!: number;
  @IsInt() @Min(0) pendingDependency!: number;
  @IsInt() @Min(0) changesReceived!: number;
  @IsInt() @Min(0) bytesSent!: number;
  @IsInt() @Min(0) durationMs!: number;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  clientErrors!: string[];
}

/** GET /api/v1/sync/changes — the feed after `cursor` (absent — the store must load the snapshots first). */
export class SyncChangesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
