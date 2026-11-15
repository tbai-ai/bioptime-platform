/* What a file is, read from its first bytes and never from its name: PNG, JPEG, WebP and PDF. Anything else (SVG,
   HTML, scripts, office files) is unknown and refused by the callers. api/domain/assets.ts keeps its own copy for
   website images; private files (api/domain/files.ts) use this one. */

export type SniffedMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export const SNIFFABLE_MIMES: readonly SniffedMime[] = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export const EXTENSION: Record<SniffedMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** How each type is named to people (the same wording the routes' summaries use). */
export const TYPE_LABEL: Record<SniffedMime, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'application/pdf': 'PDF' };

/** "PNG, JPEG, WebP or PDF": the accepted types in their usual order, joined for a sentence. */
export function typeList(mimes: readonly SniffedMime[]): string {
  const names = SNIFFABLE_MIMES.filter((m) => mimes.includes(m)).map((m) => TYPE_LABEL[m]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** The content type from the magic bytes, or null when the bytes match none of the four. */
export function sniffMime(buf: Buffer): SniffedMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // WebP: "RIFF" <size> "WEBP"
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  // PDF: "%PDF-"
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
