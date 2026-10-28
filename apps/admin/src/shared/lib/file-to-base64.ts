/** The largest picture of the site library: the API answers 413 `media_too_large` above it (ADR-0023). */
export const SITE_MEDIA_MAX_BYTES = 2 * 1024 * 1024;

// A multiple of 3 close to 32 KiB: every chunk encodes to base64 without padding, so the pieces concatenate.
const CHUNK_BYTES = 32766;

/**
 * The file as base64 (the API takes JSON, not multipart). The bytes are read with `arrayBuffer()` and
 * encoded in chunks through `btoa`: no `FileReader`, no data URL prefix to cut off.
 */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoded = '';
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    let binary = '';
    for (const byte of bytes.subarray(start, start + CHUNK_BYTES)) {
      binary += String.fromCharCode(byte);
    }
    encoded += btoa(binary);
  }
  return encoded;
}
