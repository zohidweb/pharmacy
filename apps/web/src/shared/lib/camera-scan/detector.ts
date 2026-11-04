/*
 * The barcode reader of the camera window (ADR-0025): the browser's own BarcodeDetector when it reads all five formats
 * (Android, ChromeOS, macOS), otherwise the barcode-detector ponyfill on zxing-wasm — loaded by import() on first use
 * only, its .wasm from this origin (tools/scripts/zxing-wasm.mjs), never the jsDelivr default of the package.
 */
import type {
  BarcodeDetector as BarcodeDetectorClass,
  BarcodeFormat,
} from 'barcode-detector/ponyfill';

/** The codes of the products and the QR of a receipt (ADR-0022); one list everywhere, the handler of a field decides. */
export const CAMERA_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'code_128',
  'qr_code',
] as const satisfies readonly BarcodeFormat[];

export interface CodeDetector {
  /** The first code in the frame of the video, or null. */
  detect(video: HTMLVideoElement): Promise<string | null>;
}

type Detector = typeof BarcodeDetectorClass;

async function nativeDetector(): Promise<Detector | null> {
  const native = (globalThis as { BarcodeDetector?: Detector })
    .BarcodeDetector;
  if (!native) return null;
  try {
    const supported = await native.getSupportedFormats();
    return CAMERA_FORMATS.every((format) => supported.includes(format))
      ? native
      : null;
  } catch {
    return null;
  }
}

async function ponyfillDetector(): Promise<Detector> {
  const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } =
    await import('barcode-detector/ponyfill');
  // the wasm is fetched now, not at the first frame: a missing file is the error of opening the window
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm')
          ? `/vendor/zxing_reader-${ZXING_WASM_VERSION}.wasm`
          : prefix + path,
    },
    fireImmediately: true,
  });
  return BarcodeDetector;
}

let loading: Promise<CodeDetector> | null = null;

/** One reader per tab; a failed load (no chunk or wasm) is tried again on the next open. */
export function loadCodeDetector(): Promise<CodeDetector> {
  if (!loading) {
    loading = (async () => {
      const Native = await nativeDetector();
      const Reader = Native ?? (await ponyfillDetector());
      const detector = new Reader({ formats: [...CAMERA_FORMATS] });
      return {
        async detect(video) {
          const [found] = await detector.detect(video);
          const code = found?.rawValue.trim();
          if (!code) return null;
          // zxing-cpp reads a UPC-A as 13 digits with a leading 0, a USB scanner and the native reader send its 12
          // (the form of the catalog, ADR-0022): the same box is found on every device (plan 2026-11-04-pos-store-ideas-pr4)
          return (found.format === 'ean_13' || found.format === 'upc_a') &&
            /^0\d{12}$/.test(code)
            ? code.slice(1)
            : code;
        },
      };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
