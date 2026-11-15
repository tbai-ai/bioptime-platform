/* Image assets uploaded by administrators for the website (hero and feature imagery, logos). Files live under
   ASSETS_DIR on disk, metadata in the assets table; the public route serves them by id with the stored content type.
   Only PNG, JPEG and WebP are accepted, checked by their magic bytes and not by the file name, capped at 3 MB; SVG is
   refused because it can carry scripts. Deleting an asset hides it; the file is kept until a later clean-up. An image
   in use (a website block, a course cover, a recipe, an exercise, a package's current version or a blood test) cannot
   be deleted until it is replaced there; a reference to an image deleted before that rule existed reads as "no image"
   (liveAsset), never as a broken link. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Ctx } from '../context.js';
import { errors } from '../lib/errors.js';
import { randomId } from '../lib/ids.js';
import { audit } from './audit.js';
import { CONTENT } from './content.js';

export const MAX_ASSET_BYTES = 3 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export type AssetRow = { id: string; filename: string; mime: string; bytes: number; sha256: string; alt: string; width: number | null; height: number | null; uploaded_by: string | null; created_at: string; deleted_at: string | null };

function sniff(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Width and height from the header where it is cheap to read (PNG, baseline JPEG and WebP); null otherwise. */
export function dimensions(buf: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/webp') {
      // the first chunk after RIFF....WEBP says which bitstream follows (cr-9)
      const chunk = buf.toString('ascii', 12, 16);
      // lossy: a VP8 key frame, its start code 9d 01 2a, then 14-bit width and height (the top 2 bits are scaling)
      if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      // lossless: signature 0x2f, then width - 1 and height - 1 in 14 bits each, little-endian
      if (chunk === 'VP8L' && buf[20] === 0x2f) { const bits = buf.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
      // extended (alpha, animation, metadata): canvas width - 1 and height - 1 in 24 bits each
      if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1]!; const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch { /* unreadable header: dimensions stay unknown */ }
  return { width: null, height: null };
}

export function present(a: AssetRow) {
  return { id: a.id, filename: a.filename, mime: a.mime, bytes: a.bytes, alt: a.alt, width: a.width, height: a.height, url: `/api/public/assets/${a.id}`, createdAt: a.created_at, deleted: !!a.deleted_at };
}

export function listAssets(ctx: Ctx) {
  return ctx.db.all<AssetRow>('SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY created_at DESC').map(present);
}

export function getAsset(ctx: Ctx, id: string): AssetRow | null {
  if (!/^[a-z0-9_-]{4,64}$/i.test(id)) return null;
  return ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [id]) ?? null;
}

export function filePath(ctx: Ctx, a: AssetRow): string { return path.join(ctx.config.assetsDir, `${a.id}.${EXT[a.mime] ?? 'bin'}`); }

/** What a course cover, a recipe image or an exercise picture shows for a stored asset id: the image while it is in the
 *  library, null when the id is empty or the image was deleted (the page then shows its no-image state, not a broken
 *  link: cr-6). */
export function liveAsset(ctx: Ctx, id: string | null | undefined): { assetId: string; url: string; width: number | null; height: number | null; alt: string } | null {
  if (!id) return null;
  const a = getAsset(ctx, id);
  return a ? { assetId: a.id, url: `/api/public/assets/${a.id}`, width: a.width, height: a.height, alt: a.alt } : null;
}

/** Everything that shows the image: website blocks (draft or published), course covers, recipes, exercises, and since
 *  0043 the current version of a package that is not archived (an earlier version is history; an archived package
 *  cannot be revised to free it) and the blood tests of the catalogue (hidden ones included: they can be shown again). */
export function assetUses(ctx: Ctx, id: string): { blocks: string[]; courses: Array<{ id: string; title: string }>; recipes: Array<{ id: string; title: string }>; exercises: Array<{ id: string; name: string }>; packages: Array<{ id: string; name: string }>; bloodworkTests: Array<{ id: string; name: string }> } {
  return {
    blocks: ctx.db.all<{ key: string }>('SELECT key FROM content_blocks WHERE (published LIKE ? OR draft LIKE ?) ORDER BY key', [`%${id}%`, `%${id}%`]).map((r) => r.key),
    courses: ctx.db.all<{ id: string; title: string }>('SELECT id, title FROM courses WHERE cover_asset_id = ? ORDER BY title', [id]),
    recipes: ctx.db.all<{ id: string; title: string }>('SELECT id, title FROM recipes WHERE image_asset_id = ? ORDER BY title', [id]),
    exercises: ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE media_asset_id = ? ORDER BY name', [id]),
    packages: ctx.db.all<{ id: string; name: string }>('SELECT p.id, p.name FROM package_versions v JOIN packages p ON p.id = v.package_id WHERE v.image_asset_id = ? AND v.effective_to IS NULL AND p.archived_at IS NULL ORDER BY p.name', [id]),
    bloodworkTests: ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM bloodwork_tests WHERE image_asset_id = ? AND active = 1 ORDER BY name', [id]),
  };
}

const blockName = (key: string) => (CONTENT.find((c) => c.key === key)?.label ?? key).replace(/\s*\(empty[^)]*\)\s*$/, '');

export function uploadAsset(ctx: Ctx, input: { filename: string; dataBase64: string; alt?: string }, reason?: string) {
  const buf = Buffer.from(input.dataBase64, 'base64');
  if (!buf.length) throw errors.badRequest('The file is empty', 'ASSET_EMPTY');
  if (buf.length > MAX_ASSET_BYTES) throw errors.badRequest('Images are limited to 3 MB; export a smaller or compressed file', 'ASSET_TOO_LARGE');
  const mime = sniff(buf);
  if (!mime) throw errors.badRequest('Only PNG, JPEG and WebP images are accepted (checked by content, not by name)', 'ASSET_TYPE');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const existing = ctx.db.get<AssetRow>('SELECT * FROM assets WHERE sha256 = ? AND deleted_at IS NULL', [sha256]);
  if (existing) { // the same image twice is one asset; one stored before its size could be read gets it now
    if (existing.width === null || existing.height === null) {
      const d = dimensions(buf, mime);
      if (d.width && d.height) { ctx.db.update('assets', existing.id, { width: d.width, height: d.height }); return present({ ...existing, ...d }); }
    }
    return present(existing);
  }
  const id = randomId('ast');
  const filename = input.filename.replace(/[^\w.-]+/g, '-').slice(0, 120) || `image.${EXT[mime]}`;
  const { width, height } = dimensions(buf, mime);
  fs.mkdirSync(ctx.config.assetsDir, { recursive: true });
  const row: AssetRow = { id, filename, mime, bytes: buf.length, sha256, alt: (input.alt ?? '').trim().slice(0, 200), width, height, uploaded_by: ctx.actor?.id ?? null, created_at: ctx.now(), deleted_at: null };
  fs.writeFileSync(filePath(ctx, row), buf, { mode: 0o640 });
  ctx.db.insert('assets', row);
  audit(ctx, 'asset.upload', { type: 'asset', id }, reason ?? null, { filename, mime, bytes: buf.length, width, height });
  return present(row);
}

export function updateAsset(ctx: Ctx, id: string, patch: { alt?: string }, reason?: string) {
  const a = getAsset(ctx, id); if (!a) throw errors.notFound('Asset');
  if (patch.alt !== undefined) ctx.db.update('assets', id, { alt: patch.alt.trim().slice(0, 200) });
  audit(ctx, 'asset.update', { type: 'asset', id }, reason ?? null, patch);
  return present(ctx.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [id])!);
}

export function deleteAsset(ctx: Ctx, id: string, reason: string) {
  const a = getAsset(ctx, id); if (!a) throw errors.notFound('Asset');
  const uses = assetUses(ctx, id);
  const named = [
    ...uses.blocks.map((k) => `the website’s “${blockName(k)}”`),
    ...uses.courses.map((c) => `the cover of the course “${c.title}”`),
    ...uses.recipes.map((r) => `the recipe “${r.title}”`),
    ...uses.exercises.map((e) => `the exercise “${e.name}”`),
    ...uses.packages.map((p) => `the package “${p.name}”`),
    ...uses.bloodworkTests.map((t) => `the blood test “${t.name}”`),
  ];
  if (named.length) {
    const list = named.length === 1 ? named[0]! : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
    throw errors.state(`This image is still in use: ${list}. Choose another image there (or remove it), then delete this one.`, { code: 'ASSET_IN_USE', keys: uses.blocks, courses: uses.courses, recipes: uses.recipes, exercises: uses.exercises, packages: uses.packages, bloodworkTests: uses.bloodworkTests });
  }
  ctx.db.update('assets', id, { deleted_at: ctx.now() });
  audit(ctx, 'asset.delete', { type: 'asset', id }, reason, { filename: a.filename });
}
