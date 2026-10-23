import jsQR from 'jsqr';

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(src: ImageBitmapSource): Promise<DetectedBarcode[]> }
declare const BarcodeDetector: (new (o: { formats: string[] }) => BarcodeDetectorLike) | undefined;

/**
 * QR decoding runs entirely on-device, in two tiers:
 *  1. The browser's native BarcodeDetector (fast; Chromium on Android/macOS/ChromeOS).
 *  2. jsQR, a pure-JS decoder bundled with the app, so it works in Firefox, Safari and desktop Chrome too.
 */
let native: BarcodeDetectorLike | null | undefined;
function nativeDetector() {
  if (native === undefined) { try { native = typeof BarcodeDetector !== 'undefined' ? new BarcodeDetector({ formats: ['qr_code'] }) : null; } catch { native = null; } }
  return native;
}
export const decoderName = () => (nativeDetector() ? 'native + jsQR' : 'jsQR');

let scratch: HTMLCanvasElement | undefined;

/** Decode one frame. `maxSide` caps the working resolution (smaller = faster, for live video). */
export async function decodeFrame(src: HTMLVideoElement | ImageBitmap, maxSide = 720, thorough = false): Promise<string | null> {
  const w0 = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const h0 = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  if (!w0 || !h0) return null;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  scratch ??= document.createElement('canvas');
  scratch.width = w; scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const det = nativeDetector();
  if (det) { try { const r = await det.detect(scratch); if (r[0]?.rawValue) return r[0].rawValue; } catch { /* fall through to jsQR */ } }
  const img = ctx.getImageData(0, 0, w, h);
  return jsQR(img.data, w, h, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' })?.data ?? null;
}

/** Decode a QR from an image file / pasted screenshot. Tries full size, then smaller (helps with noisy screenshots). */
export async function decodeImage(blob: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(blob);
  try {
    for (const side of [2400, 1200, 600]) { const r = await decodeFrame(bmp, side, true); if (r) return r; }
    return null;
  } finally { bmp.close(); }
}
