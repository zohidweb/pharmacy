import type { Response } from 'express';
import type { MediaContent } from './site-media.service';

/**
 * Sends the file of a picture. The type comes from the record (checked by the signature at the upload), never from
 * the request; nosniff and the empty sandboxed CSP keep a browser from treating the bytes as anything but an image
 * (opened directly, the answer is a sandboxed document with no origin of its own). The
 * caching header is left to the caller: the global `no-store` stays unless the route sets its own.
 */
export function sendMedia(res: Response, media: MediaContent): void {
  res.status(200);
  res.setHeader('Content-Type', media.contentType);
  res.setHeader('Content-Length', media.bytes.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(media.bytes);
}
