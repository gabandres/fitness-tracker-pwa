/**
 * Client-side image downscale → JPEG Blob, for progress photos headed to
 * Firebase Storage. Kept separate from the meal-photo encoder in
 * `photo-capture.component.ts` (which emits a base64 dataURL at 1920px for
 * AI accuracy); progress photos are display-only and stored long-term, so
 * they target a smaller 1080px / 0.8 to keep Storage + download cost down
 * (see ADR-0010).
 *
 * Only {@link scaledDimensions} is pure/unit-tested; the canvas encode
 * needs a real DOM and is exercised in the browser smoke.
 */

/** Default long-edge for stored progress photos. */
export const PHOTO_MAX_DIM = 1080;
/** Default JPEG quality for stored progress photos. */
export const PHOTO_QUALITY = 0.8;

/**
 * Fit (width, height) inside a `maxDim` box, preserving aspect ratio.
 * Returns the input unchanged when it already fits. Never upscales.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDim) return { width, height };
  const scale = maxDim / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Decode `file`, downscale to fit `maxDim`, and re-encode as a JPEG Blob.
 * Rejects when the image can't be decoded or the canvas can't encode.
 */
export function resizeToJpegBlob(
  file: File,
  maxDim: number = PHOTO_MAX_DIM,
  quality: number = PHOTO_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, maxDim);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image encode failed'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image decode failed'));
    };
    img.src = url;
  });
}
