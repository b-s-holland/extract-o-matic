// lib/source-input.js
// Source sniffing only. This is intentionally separate from the extraction
// pipeline so accepting an image does not create a second processing path.

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function inferInputKind(inputBuffer, fileName, mimeType) {
  const type = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const name = String(fileName || '').toLowerCase();
  const head = inputBuffer ? inputBuffer.subarray(0, 12) : Buffer.alloc(0);

  if (type === 'application/pdf' || head.subarray(0, 5).toString('ascii') === '%PDF-' || name.endsWith('.pdf')) {
    return { sourceType: 'pdf', mimeType: 'application/pdf' };
  }

  let imageMime = ALLOWED_IMAGE_MIME.has(type) ? type : '';
  if (!imageMime && head.length >= 8 && head[0] === 0x89 && head.subarray(1, 4).toString('ascii') === 'PNG') imageMime = 'image/png';
  if (!imageMime && head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) imageMime = 'image/jpeg';
  if (!imageMime && head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') imageMime = 'image/webp';
  if (!imageMime && /\.png$/i.test(name)) imageMime = 'image/png';
  if (!imageMime && /\.jpe?g$/i.test(name)) imageMime = 'image/jpeg';
  if (!imageMime && /\.webp$/i.test(name)) imageMime = 'image/webp';

  if (imageMime) return { sourceType: 'image', mimeType: imageMime };
  throw new Error('Unsupported file type. Upload a PDF, PNG, JPG/JPEG, or WebP image.');
}

export function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
