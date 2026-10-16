// Constants of the offline-store sync protocol (ADR-0014 §5–6; spec 2026-10-16-offline-sync, E7).

/** Version of the protocol this API speaks. */
export const SYNC_PROTOCOL_VERSION = 1;

/** Limits of one batch: operations and bytes of JSON after gzip is inflated. */
export const SYNC_BATCH_LIMITS = Object.freeze({
  maxOperations: 500,
  maxBytes: 2_097_152,
});

/** The body-parser limit of the sync contour, the same 2 MB. */
export const SYNC_BODY_LIMIT = '2mb';
