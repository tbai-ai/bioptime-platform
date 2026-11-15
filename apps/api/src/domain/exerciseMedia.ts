/* Exercise demonstration media, served by the Bioptime server itself (owner decision of 30 October 2026: the clips of
   the owner's earlier app are kept for the workout player, after a review of each one).

   - Where: one folder shipped with the API (EXERCISE_MEDIA_DIR, default apps/api/media/exercises), holding a
     manifest.json and, per exercise key, one H.264 clip and one JPEG poster. Every file name carries the first eight hex
     digits of its SHA-256 (squats.1a2b3c4d.mp4), so a URL never changes meaning and is cached for a year.
   - The switch: EXERCISE_MEDIA=server serves them; none switches them off (every exercise is then text only). It is
     separate from VIDEO_PROVIDER, which is the course video host (api/domain/learning.ts) and stays untouched.
   - What reaches people: status() for the library and the player ("available", or "pending configuration" naming what
     is missing), mediaFor() for one exercise's media_ref (URLs only while everything is available), resolveFile() for
     GET /public/media/exercises/:file (only a name the manifest lists, never a path).
   - How files arrive: importExercises() (npx tsx src/cli.ts media:import-exercises --from <dir>) copies a folder of
     transcoded clips and posters, hashes them and writes the manifest; verifyExercises() (media:verify) hashes them
     again. Nothing here edits an exercise: an administrator maps media_ref (api/domain/workouts.ts checks has()).

   Credit, as the owner decided: the clips come from the owner's earlier app and are generated video, not filmed; the
   owner confirmed the rights on 30 October 2026; they are to be replaced with filmed clips. A clip that failed the
   review (wrong or unsafe form, artefacts of generated video, or a mismatch with its name) is never imported or
   mapped, so its exercise stays text only. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { API_ROOT, type Config } from '../config.js';
import { sniffMime } from '../lib/sniff.js';

export const MANIFEST_FILE = 'manifest.json';
/** Where the files are served (GET /public/media/exercises/:file inside /api). */
export const MEDIA_URL_PREFIX = '/api/public/media/exercises/';
/** The note shown with the library and the player while the media are served. */
export const AVAILABLE_NOTE = 'Exercise videos are served by Bioptime. The clips come from the owner’s earlier app and are generated video, not filmed; the owner confirmed the rights on 30 October 2026, and they will be replaced with filmed clips.';
/** The note while they are not: the same words the library used before media existed. */
export const TEXT_ONLY_NOTE = 'Exercises are text only for now: no images or video.';

/** An exercise key: lower-case words joined by hyphens (squats, box-jumps). */
export const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A served file name: <key>.<first 8 hex digits of its SHA-256>.<mp4|jpg>. */
export const SERVED_NAME_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([0-9a-f]{8})\.(mp4|jpg)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** A file name in an import folder: no folders, no hidden files. */
const PLAIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const itemSchema = z.object({
  key: z.string().regex(KEY_RE),
  video: z.string().regex(SERVED_NAME_RE),
  poster: z.string().regex(SERVED_NAME_RE),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_RE),
  posterBytes: z.number().int().positive(),
  posterSha256: z.string().regex(SHA256_RE),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  rights: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(300),
});
export type ExerciseMediaItem = z.infer<typeof itemSchema>;

const manifestSchema = z.object({
  version: z.number().int().min(1),
  generatedAt: z.string().optional(),
  items: z.array(itemSchema).max(500),
}).superRefine((m, ctx) => {
  const keys = new Set<string>(), names = new Set<string>();
  m.items.forEach((it, i) => {
    if (keys.has(it.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'key'], message: `${it.key} appears twice` });
    keys.add(it.key);
    for (const [field, name, ext, sha] of [['video', it.video, 'mp4', it.sha256], ['poster', it.poster, 'jpg', it.posterSha256]] as const) {
      const p = SERVED_NAME_RE.exec(name)!;
      if (p[1] !== it.key || p[3] !== ext || p[2] !== sha.slice(0, 8)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, field], message: `${name} is not named <key>.<first 8 of its sha256>.${ext}` });
      if (names.has(name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, field], message: `${name} appears twice` });
      names.add(name);
    }
  });
});
export type ExerciseMediaManifest = z.infer<typeof manifestSchema>;

export type ExerciseMediaStatus = { status: 'available' | 'pending_configuration'; missing: string[]; note: string };
/** What an exercise carries when its clip is served. URLs are relative to the API's origin, as asset URLs are. */
export type ExerciseMedia = { videoUrl: string; posterUrl: string; width: number; height: number; durationSeconds: number };

/* ---------- the manifest, read once per change ---------- */

type Loaded =
  | { ok: true; manifest: ExerciseMediaManifest; byKey: Map<string, ExerciseMediaItem>; byFile: Map<string, { item: ExerciseMediaItem; kind: 'video' | 'poster' }>; problems: string[] }
  | { ok: false; problems: string[] };

const cache = new Map<string, { stamp: string; loaded: Loaded }>();

/** The folder as people are told about it: relative to apps/api when it is inside, otherwise the variable's name. */
function shown(config: Config, file?: string): string {
  const rel = path.relative(API_ROOT, config.exerciseMediaDir);
  const dir = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : 'EXERCISE_MEDIA_DIR';
  return file ? `${dir}/${file}` : dir;
}

function load(config: Config): Loaded {
  const dir = config.exerciseMediaDir;
  const file = path.join(dir, MANIFEST_FILE);
  let stamp: string;
  try {
    // the manifest's own change and the folder's (a file added or removed) decide when it is read again
    const m = fs.statSync(file), d = fs.statSync(dir);
    stamp = `${m.mtimeMs}:${m.size}:${d.mtimeMs}`;
  } catch {
    return { ok: false, problems: [`The exercise media manifest ${shown(config, MANIFEST_FILE)} was not found: import the clips with media:import-exercises`] };
  }
  const hit = cache.get(dir);
  if (hit && hit.stamp === stamp) return hit.loaded;
  let loaded: Loaded;
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      loaded = { ok: false, problems: [`The exercise media manifest ${shown(config, MANIFEST_FILE)} is not valid (${issue.path.join('.')}: ${issue.message})`] };
    } else {
      const manifest = parsed.data;
      const byKey = new Map(manifest.items.map((it) => [it.key, it]));
      const byFile = new Map<string, { item: ExerciseMediaItem; kind: 'video' | 'poster' }>();
      const problems: string[] = [];
      for (const it of manifest.items) {
        for (const [kind, name, bytes] of [['video', it.video, it.bytes], ['poster', it.poster, it.posterBytes]] as const) {
          byFile.set(name, { item: it, kind });
          // a size check on every change; the full hash is media:verify's
          let size = -1;
          try { const st = fs.statSync(path.join(dir, name)); if (st.isFile()) size = st.size; } catch { /* missing */ }
          if (size < 0) problems.push(`An exercise media file is missing: ${shown(config, name)}`);
          else if (size !== bytes) problems.push(`An exercise media file does not match the manifest: ${shown(config, name)} (${size} bytes, the manifest says ${bytes})`);
        }
      }
      loaded = { ok: true, manifest, byKey, byFile, problems };
    }
  } catch (e) {
    loaded = { ok: false, problems: [`The exercise media manifest ${shown(config, MANIFEST_FILE)} could not be read (${(e as Error).message.split('\n')[0]})`] };
  }
  cache.set(dir, { stamp, loaded });
  return loaded;
}

/* ---------- what the library, the player and the route ask ---------- */

/** Whether exercise media are served, and if not, exactly what is missing. */
export function status(ctx: Ctx): ExerciseMediaStatus {
  if (ctx.config.EXERCISE_MEDIA === 'none') return { status: 'pending_configuration', missing: ['Exercise media is switched off (EXERCISE_MEDIA=none)'], note: TEXT_ONLY_NOTE };
  const l = load(ctx.config);
  if (!l.ok || l.problems.length) return { status: 'pending_configuration', missing: l.problems, note: TEXT_ONLY_NOTE };
  return { status: 'available', missing: [], note: AVAILABLE_NOTE };
}

/** Does the manifest list this key? (Whether the switch is on or not: an administrator may map a clip in advance.) */
export function has(ctx: Ctx, key: string): boolean {
  const l = load(ctx.config);
  return l.ok && l.byKey.has(key);
}

/** One exercise's media: null unless the media are available and the manifest lists its key. */
export function mediaFor(ctx: Ctx, ref: string | null | undefined): ExerciseMedia | null {
  if (!ref || status(ctx).status !== 'available') return null;
  const l = load(ctx.config);
  const it = l.ok ? l.byKey.get(ref) : undefined;
  if (!it) return null;
  return { videoUrl: MEDIA_URL_PREFIX + it.video, posterUrl: MEDIA_URL_PREFIX + it.poster, width: it.width, height: it.height, durationSeconds: it.durationSeconds };
}

export type ServedFile = { path: string; mime: 'video/mp4' | 'image/jpeg'; bytes: number; etag: string };

/** The file behind GET /public/media/exercises/:file: only a name the manifest lists, exactly, read from the media
 *  folder itself (never through a link that leaves it); null otherwise, and always while the switch is off. */
export function resolveFile(ctx: Ctx, name: string): ServedFile | null {
  if (ctx.config.EXERCISE_MEDIA === 'none' || !SERVED_NAME_RE.test(name)) return null;
  const l = load(ctx.config);
  const hit = l.ok ? l.byFile.get(name) : undefined;
  if (!hit) return null;
  const dir = ctx.config.exerciseMediaDir;
  let real: string, root: string;
  try { real = fs.realpathSync(path.join(dir, name)); root = fs.realpathSync(dir); } catch { return null; }
  if (path.dirname(real) !== root) return null;
  const st = fs.statSync(real);
  const bytes = hit.kind === 'video' ? hit.item.bytes : hit.item.posterBytes;
  if (!st.isFile() || st.size !== bytes) return null;
  const sha = hit.kind === 'video' ? hit.item.sha256 : hit.item.posterSha256;
  return { path: real, mime: hit.kind === 'video' ? 'video/mp4' : 'image/jpeg', bytes, etag: `"sha256-${sha.slice(0, 16)}"` };
}

/** The manifest's items (for the command line and the tests); empty when it cannot be read. */
export function manifestItems(config: Config): ExerciseMediaItem[] {
  const l = load(config);
  return l.ok ? l.manifest.items : [];
}

/* ---------- MP4: the few header boxes that say a clip's size and length ---------- */

export type Mp4Info = { width: number; height: number; durationSeconds: number; faststart: boolean };

/** Width and height of the first video track (tkhd), the length (mvhd), and whether the index (moov) comes before the
 *  media data (mdat), which lets playback start before the whole file has arrived. Null when the bytes are not an MP4
 *  with a video track. */
export function mp4Info(buf: Buffer): Mp4Info | null {
  if (buf.length < 16 || buf.toString('ascii', 4, 8) !== 'ftyp') return null;
  type Box = { type: string; start: number; end: number };
  const boxes = (from: number, to: number): Box[] => {
    const out: Box[] = [];
    for (let at = from; at + 8 <= to;) {
      let size = buf.readUInt32BE(at);
      const type = buf.toString('latin1', at + 4, at + 8);
      let header = 8;
      if (size === 1) { if (at + 16 > to) break; size = Number(buf.readBigUInt64BE(at + 8)); header = 16; }
      else if (size === 0) size = to - at;
      if (size < header || at + size > to) break;
      out.push({ type, start: at + header, end: at + size });
      at += size;
    }
    return out;
  };
  const top = boxes(0, buf.length);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return null;
  const mdatAt = top.findIndex((b) => b.type === 'mdat');
  const faststart = mdatAt === -1 || top.indexOf(moov) < mdatAt;
  const inMoov = boxes(moov.start, moov.end);
  const mvhd = inMoov.find((b) => b.type === 'mvhd');
  if (!mvhd || mvhd.end - mvhd.start < 32) return null;
  const v = buf[mvhd.start]!;
  const timescale = buf.readUInt32BE(mvhd.start + (v === 1 ? 20 : 12));
  const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
  if (!timescale) return null;
  for (const trak of inMoov.filter((b) => b.type === 'trak')) {
    const tkhd = boxes(trak.start, trak.end).find((b) => b.type === 'tkhd');
    if (!tkhd) continue;
    const tv = buf[tkhd.start]!;
    // version, flags, two times, track id, reserved, duration, reserved, layer, group, volume, reserved, matrix; then 16.16 sizes
    const sizeAt = tkhd.start + (tv === 1 ? 88 : 76);
    if (sizeAt + 8 > tkhd.end) continue;
    const width = Math.round(buf.readUInt32BE(sizeAt) / 65536), height = Math.round(buf.readUInt32BE(sizeAt + 4) / 65536);
    if (width > 0 && height > 0) return { width, height, durationSeconds: Math.round((duration / timescale) * 100) / 100, faststart };
  }
  return null;
}

/* ---------- import and verify (the command line: api/cli.ts) ---------- */

const importItemSchema = z.object({
  key: z.string().regex(KEY_RE, 'lower-case words joined by hyphens'),
  video: z.string().regex(PLAIN_NAME_RE, 'a file name in the folder'),
  poster: z.string().regex(PLAIN_NAME_RE, 'a file name in the folder'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  rights: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(300),
});
const importSchema = z.object({ items: z.array(importItemSchema).min(1).max(500) });

export type ImportResult = { version: number; items: number; bytes: number; written: string[]; pruned: string[]; warnings: string[] };

const sha256Of = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** Writes a file so that a reader sees either the old one or the whole new one. */
function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** Copies the clips and posters a folder's manifest lists (by default <from>/manifest.json: { items: [{ key, video,
 *  poster, rights, source, width?, height?, durationSeconds? }] }) into the media folder under their hashed names and
 *  writes the media manifest. Each clip must be an MP4 with a video track (its size and length are read from the file;
 *  values given in the folder's manifest must agree) and each poster a JPEG. With merge, keys already imported and not
 *  in this folder stay; otherwise the folder is the whole set. Files of the hashed form that the new manifest no longer
 *  names are removed (prune: false keeps them). Refuses everything if any one item is wrong, before writing anything. */
export function importExercises(config: Config, fromDir: string, opts: { manifest?: string; merge?: boolean; prune?: boolean } = {}): ImportResult {
  const from = path.resolve(fromDir);
  const inputFile = path.resolve(opts.manifest ?? path.join(from, MANIFEST_FILE));
  const parsed = importSchema.safeParse(JSON.parse(fs.readFileSync(inputFile, 'utf8')));
  if (!parsed.success) { const i = parsed.error.issues[0]!; throw new Error(`${inputFile}: ${i.path.join('.')}: ${i.message}`); }
  const seen = new Set<string>();
  const warnings: string[] = [];
  const prepared = parsed.data.items.map((it) => {
    if (seen.has(it.key)) throw new Error(`${it.key} appears twice in ${inputFile}`);
    seen.add(it.key);
    const video = fs.readFileSync(path.join(from, it.video));
    const poster = fs.readFileSync(path.join(from, it.poster));
    const info = mp4Info(video);
    if (!info) throw new Error(`${it.video} (${it.key}) is not an MP4 with a video track`);
    if (sniffMime(poster) !== 'image/jpeg') throw new Error(`${it.poster} (${it.key}) is not a JPEG`);
    if ((it.width && it.width !== info.width) || (it.height && it.height !== info.height)) throw new Error(`${it.video} (${it.key}) is ${info.width}×${info.height}, not ${it.width}×${it.height} as the folder's manifest says`);
    if (it.durationSeconds && Math.abs(it.durationSeconds - info.durationSeconds) > 0.5) throw new Error(`${it.video} (${it.key}) lasts ${info.durationSeconds} s, not ${it.durationSeconds} s as the folder's manifest says`);
    if (!info.faststart) warnings.push(`${it.video} (${it.key}): the index comes after the media data, so playback waits for the whole file; transcode it network-optimised`);
    const sha = sha256Of(video), posterSha = sha256Of(poster);
    const item: ExerciseMediaItem = {
      key: it.key, video: `${it.key}.${sha.slice(0, 8)}.mp4`, poster: `${it.key}.${posterSha.slice(0, 8)}.jpg`,
      bytes: video.length, sha256: sha, posterBytes: poster.length, posterSha256: posterSha,
      width: info.width, height: info.height, durationSeconds: info.durationSeconds, rights: it.rights, source: it.source,
    };
    return { item, video, poster };
  });

  const dir = config.exerciseMediaDir;
  fs.mkdirSync(dir, { recursive: true });
  const previous = manifestItems(config);
  const previousVersion = (() => { try { return (JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')) as { version?: number }).version ?? 0; } catch { return 0; } })();
  const kept = opts.merge ? previous.filter((p) => !seen.has(p.key)) : [];
  const written: string[] = [];
  for (const p of prepared) {
    for (const [name, data] of [[p.item.video, p.video], [p.item.poster, p.poster]] as const) {
      const target = path.join(dir, name);
      if (fs.existsSync(target) && fs.statSync(target).size === data.length && sha256Of(fs.readFileSync(target)) === sha256Of(data)) continue;
      writeAtomic(target, data);
      written.push(name);
    }
  }
  const items = [...kept, ...prepared.map((p) => p.item)].sort((a, b) => a.key.localeCompare(b.key));
  const manifest: ExerciseMediaManifest = { version: previousVersion + 1, generatedAt: new Date().toISOString(), items };
  manifestSchema.parse(manifest);
  writeAtomic(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n');
  const named = new Set(items.flatMap((it) => [it.video, it.poster]));
  const pruned: string[] = [];
  if (opts.prune !== false) {
    for (const f of fs.readdirSync(dir)) {
      if (!SERVED_NAME_RE.test(f) || named.has(f)) continue;
      fs.unlinkSync(path.join(dir, f));
      pruned.push(f);
    }
  }
  cache.delete(dir);
  return { version: manifest.version, items: items.length, bytes: items.reduce((n, it) => n + it.bytes + it.posterBytes, 0), written, pruned, warnings };
}

export type VerifyResult = { ok: boolean; items: number; bytes: number; problems: string[] };

/** Hashes every file the manifest names again and compares it with the manifest. */
export function verifyExercises(config: Config): VerifyResult {
  cache.delete(config.exerciseMediaDir);
  const l = load(config);
  if (!l.ok) return { ok: false, items: 0, bytes: 0, problems: l.problems };
  const problems = [...l.problems];
  let bytes = 0;
  for (const it of l.manifest.items) {
    for (const [name, sha] of [[it.video, it.sha256], [it.poster, it.posterSha256]] as const) {
      const file = path.join(config.exerciseMediaDir, name);
      if (!fs.existsSync(file)) continue; // already named by the size check
      const buf = fs.readFileSync(file);
      bytes += buf.length;
      if (sha256Of(buf) !== sha) problems.push(`${shown(config, name)}: its SHA-256 does not match the manifest`);
    }
    const video = path.join(config.exerciseMediaDir, it.video);
    if (fs.existsSync(video)) {
      const info = mp4Info(fs.readFileSync(video));
      if (!info) problems.push(`${shown(config, it.video)}: not an MP4 with a video track`);
      else if (info.width !== it.width || info.height !== it.height) problems.push(`${shown(config, it.video)}: ${info.width}×${info.height}, the manifest says ${it.width}×${it.height}`);
    }
  }
  return { ok: problems.length === 0, items: l.manifest.items.length, bytes, problems };
}
