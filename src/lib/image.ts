import type { Part } from 'firebase/ai';

/**
 * Downscales a photo to a JPEG (max 1024px on the long side) so it fits the
 * on-device token budget and becomes an inline-data Part. Nano accepts JPEG and PNG only.
 */
export async function photoToPart(file: Blob, maxSide = 1024): Promise<{ part: Part; previewUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const previewUrl = canvas.toDataURL('image/jpeg', 0.85);
  const data = previewUrl.split(',')[1];
  return { part: { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data } }, previewUrl };
}
