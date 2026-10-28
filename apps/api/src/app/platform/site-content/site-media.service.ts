import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  SiteMedia,
  SiteMediaType,
  UploadSiteMediaRequest,
} from '@pharmacy/shared-dto';
import { requireOperator } from '../../../common/context/request-context';
import { FieldProblemException } from '../../../common/errors/validation-failed.exception';
import { ProblemException } from '../../../common/errors/problem.exception';
import { newId } from '../../../core/database';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';
import { sniffImage } from './media-signature';
import { SiteContentRepository } from './site-content.repository';

/** The biggest file (2 MiB), the biggest side of a picture (the check of the table). */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 20000;
// The base64 of the biggest file: three bytes make four characters, padded.
const MAX_BASE64_LENGTH = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;
// Canonical base64 of the standard alphabet only (Buffer.from would silently skip anything else).
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface MediaContent {
  contentType: SiteMediaType;
  bytes: Buffer;
}

// The pictures of the site (spec 2026-10-28-public-site-design, 6.3, 7.2; P3, P16): up to 2 MiB in the database, the type by
// the signature of the file, never by what the client declares. The same file twice is stored once (A3).
@Injectable()
export class SiteMediaService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly repository: SiteContentRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  private actor() {
    return {
      kind: 'operator' as const,
      operatorId: requireOperator().operatorId,
    };
  }

  /**
   * 400 `validation_failed` (not base64), 413 `media_too_large`, 400 `unsupported_media_type` (the signature is not
   * the declared type, not an image of an allowed type, or a side over 20 000). The stored one when the SHA-256 is
   * the same: no new row, no journal entry.
   */
  async upload(body: UploadSiteMediaRequest): Promise<SiteMedia> {
    if (body.dataBase64.length > MAX_BASE64_LENGTH)
      throw new ProblemException(413, 'media_too_large');
    if (!BASE64.test(body.dataBase64))
      throw new FieldProblemException(400, 'validation_failed', [
        { field: 'dataBase64', code: 'is_base64' },
      ]);
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.length > MAX_MEDIA_BYTES)
      throw new ProblemException(413, 'media_too_large');
    const image = sniffImage(bytes);
    if (
      image === null ||
      image.type !== body.contentType ||
      image.width > MAX_SIDE ||
      image.height > MAX_SIDE
    )
      throw new ProblemException(400, 'unsupported_media_type');
    const sha256 = createHash('sha256').update(bytes).digest();
    const actor = this.actor();
    return this.db.platformTransaction(actor, async (trx) => {
      const stored = await this.repository.mediaByHash(trx, sha256);
      if (stored !== null) return stored;
      const created = await this.repository.insertMedia(trx, {
        id: newId(),
        contentType: image.type,
        bytes,
        sha256,
        width: image.width,
        height: image.height,
        alt: body.alt,
        createdBy: actor.operatorId,
      });
      // The same file was stored by a request that ran at the same time.
      if (created === null)
        return (await this.repository.mediaByHash(trx, sha256)) as SiteMedia;
      await this.audit.append(trx, {
        action: 'site-media.uploaded',
        entityType: 'site_media',
        entityId: created.id,
        details: {
          contentType: created.contentType,
          byteSize: created.byteSize,
        },
      });
      return created;
    });
  }

  list(
    limit: number,
    offset: number,
  ): Promise<{ items: SiteMedia[]; total: number }> {
    return this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.listMedia(trx, limit, offset),
    );
  }

  /** The file for the admin; 404 `media_not_found`. */
  async content(id: string): Promise<MediaContent> {
    const found = await this.db.platformTransaction(this.actor(), (trx) =>
      this.repository.mediaContent(trx, id),
    );
    if (found === null) throw new ProblemException(404, 'media_not_found');
    return found;
  }

  /** The file for the site; no session: a system actor reads. 404 `media_not_found`. */
  async publicContent(id: string): Promise<MediaContent> {
    const found = await this.db.platformTransaction(
      { kind: 'system', job: 'site.public-read' },
      (trx) => this.repository.mediaContent(trx, id),
    );
    if (found === null) throw new ProblemException(404, 'media_not_found');
    return found;
  }
}
