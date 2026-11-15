/* Private files: progress photos, message attachments, data exports, billing documents. They are stored under
   PRIVATE_FILES_DIR (default apps/api/data/private), outside every static mount, with their metadata in file_metadata.
   No URL ever points at one: whoever may open a file asks for a 5-minute token (POST /files/:id/token, audited) and
   redeems it at GET /files/download, the report pattern (api/domain/bloodwork.ts reportFileToken).

   Who may open a file is decided by the access resolver of its kind: the module that stores the kind declares it in its
   descriptor (ApiModule.fileAccess). A kind nobody declared opens for its owner only. The resolver runs when the token is
   issued and again when it is redeemed, so a consent withdrawn in between still closes the file.

   Types of uploads are read from the magic bytes (api/lib/sniff.ts), never from the name; sizes are capped by the
   caller. Files the server generates itself (a member's JSON data export) go through saveGeneratedPrivateFile, which
   applies the same storage rules to a type the caller declares. Images and PDF download inline; anything else downloads
   as an attachment. Local disk is the only storage so far: production refuses it for private files (STORAGE_PROVIDER). */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import type { Ctx } from '../context.js';
import type { Role } from '@bioptime/domain';
import { ids } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';
import { EXTENSION, SNIFFABLE_MIMES, sniffMime, typeList, type SniffedMime } from '../lib/sniff.js';
import { requireActor } from '../auth/permissions.js';
import { audit } from './audit.js';
import { MODULES, featureOf } from '../modules/index.js';

export type FileRow = {
  id: string; owner_id: string | null; kind: string; name: string; mime: string; size: number; storage_path: string;
  created_at: string; deleted_at: string | null; sha256: string | null; ref_type: string | null; ref_id: string | null;
};
/** True when ctx.actor may open the file. A resolver may also throw a specific refusal (for example NOT_SHARED). */
export type FileAccessResolver = (ctx: Ctx, file: FileRow) => boolean;

export const FILE_TOKEN_SECONDS = 300;

/* ---------- access resolvers ---------- */

const coreResolvers = new Map<string, FileAccessResolver>();
/** For kinds the core platform stores itself. Modules declare theirs in ApiModule.fileAccess instead. */
export function registerCoreFileAccess(kind: string, resolver: FileAccessResolver): void { coreResolvers.set(kind, resolver); }

const ownerOnly: FileAccessResolver = (ctx, file) => !!ctx.actor && !!file.owner_id && ctx.actor.id === file.owner_id;

/** The resolver for a kind: the module that declares it, then the core registry, then the owner alone. Read from the
 *  registry when a request arrives, so no module is imported before it is needed. */
export function resolverFor(kind: string): FileAccessResolver {
  for (const m of MODULES) { const r = m.fileAccess?.[kind]; if (r) return r; }
  return coreResolvers.get(kind) ?? ownerOnly;
}

/* ---------- storage readiness ---------- */

/** The missing requirement when private files cannot be stored in this mode, or null when they can. */
export function storageRequirement(ctx: Ctx): string | null {
  if (ctx.config.isProduction && ctx.config.STORAGE_PROVIDER === 'local') return 'Production object storage with encryption at rest: STORAGE_PROVIDER accepts only "local", and production refuses local disk for private files';
  return null;
}

/** Modules that store private files are those that declare an access resolver. */
export function storesPrivateFiles(feature: string): boolean {
  return MODULES.some((m) => featureOf(m) === feature && !!m.fileAccess && Object.keys(m.fileAccess).length > 0);
}

/** At start-up: production refuses local storage while any module that stores private files is enabled. */
export function assertStorageReady(ctx: Ctx): void {
  const missing = storageRequirement(ctx);
  if (!missing) return;
  const enabled = new Set(ctx.db.all<{ key: string }>('SELECT key FROM feature_flags WHERE enabled = 1').map((r) => r.key));
  const blocking = MODULES.filter((m) => enabled.has(featureOf(m)) && storesPrivateFiles(featureOf(m))).map((m) => m.key);
  if (blocking.length) throw new Error(`production refuses local storage for private files while ${blocking.join(', ')} ${blocking.length === 1 ? 'is' : 'are'} enabled. Missing: ${missing}`);
}

function root(ctx: Ctx): string { return path.resolve(ctx.config.privateFilesDir); }

function absolutePath(ctx: Ctx, file: FileRow): string {
  const base = root(ctx);
  const abs = path.resolve(base, file.storage_path);
  if (!abs.startsWith(base + path.sep)) throw errors.notFound('File');
  return abs;
}

/* ---------- save, read, delete ---------- */

export function presentFile(f: FileRow) {
  return { id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, sha256: f.sha256, refType: f.ref_type, refId: f.ref_id, createdAt: f.created_at };
}

export function getFile(ctx: Ctx, id: string): FileRow | null {
  if (!/^fil_[a-z0-9]{6,40}$/.test(id)) return null;
  return ctx.db.get<FileRow>('SELECT * FROM file_metadata WHERE id = ? AND deleted_at IS NULL', [id]) ?? null;
}

/** The rules every private file is written under, whoever produced it: storage ready, a known kind, not empty, within
 *  its cap, mode 600 in a 700 folder under PRIVATE_FILES_DIR at a relative storage path, a file_metadata row with the
 *  SHA-256, and a file.save audit row. The bytes are removed again if the row cannot be written. */
function writePrivate(ctx: Ctx, input: { ownerId: string | null; kind: string; buf: Buffer; mime: string; ext: string; maxBytes: number; ref?: { type: string; id: string }; name?: string }, check?: () => void) {
  const missing = storageRequirement(ctx);
  if (missing) throw new AppError('STORAGE_NOT_CONFIGURED', 503, 'Private files cannot be stored yet: storage is pending configuration', { missing });
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.kind)) throw new Error(`invalid file kind ${input.kind}`);
  const buf = input.buf;
  if (!buf.length) throw errors.badRequest('The file is empty', 'FILE_EMPTY');
  if (buf.length > input.maxBytes) throw errors.badRequest(`Files are limited to ${formatBytes(input.maxBytes)}`, 'FILE_TOO_LARGE');
  check?.();
  const id = ids.file();
  const storagePath = `${input.kind}/${id}.${input.ext}`;
  const name = safeFileName(input.name ?? '', input.kind, input.ext);
  const row: FileRow = {
    id, owner_id: input.ownerId, kind: input.kind, name, mime: input.mime, size: buf.length, storage_path: storagePath, created_at: ctx.now(), deleted_at: null,
    sha256: createHash('sha256').update(buf).digest('hex'), ref_type: input.ref?.type ?? null, ref_id: input.ref?.id ?? null,
  };
  const abs = absolutePath(ctx, row);
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  fs.writeFileSync(abs, buf, { mode: 0o600, flag: 'wx' });
  try {
    ctx.db.insert('file_metadata', row);
    audit(ctx, 'file.save', { type: 'file', id }, null, { kind: row.kind, mime: row.mime, bytes: row.size, refType: row.ref_type, refId: row.ref_id });
  } catch (e) {
    try { fs.unlinkSync(abs); } catch { /* already gone */ }
    throw e;
  }
  return presentFile(row);
}

/** A stored file name: letters, digits, dot, dash and underscore only, no leading dot or dash, at most 120 characters. */
function safeFileName(raw: string, kind: string, ext: string): string {
  return raw.replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '').slice(0, 120) || `${kind}.${ext}`;
}

/** Stores a private file after checking its size and its type by content. Returns the presented row. */
export function savePrivateFile(ctx: Ctx, input: { ownerId: string | null; kind: string; buffer: Buffer; allowedMimes: readonly SniffedMime[]; maxBytes: number; ref?: { type: string; id: string }; name?: string }) {
  const mime = input.buffer.length ? sniffMime(input.buffer) : null;
  return writePrivate(ctx, { ownerId: input.ownerId, kind: input.kind, buf: input.buffer, mime: mime ?? '', ext: mime ? EXTENSION[mime] : '', maxBytes: input.maxBytes, ref: input.ref, name: input.name }, () => {
    if (!mime || !input.allowedMimes.includes(mime)) throw errors.badRequest(`Only ${typeList(input.allowedMimes)} files are accepted`, 'FILE_TYPE');
  });
}

/** The types the server writes itself as private files. They are never accepted as uploads: an upload's type is read
 *  from its content and only PNG, JPEG, WebP and PDF qualify. */
export const GENERATED_TYPES = { 'application/json': 'json' } as const;
export type GeneratedMime = keyof typeof GENERATED_TYPES;
/** Generated files are capped too (a data export is far below this). */
export const GENERATED_MAX_BYTES = 50 * 1024 * 1024;

/** Stores a private file the server generated (for example a member's JSON data export) under the same rules as
 *  savePrivateFile: storage readiness, mode 600, relative storage path, file_metadata row with SHA-256, file.save audit.
 *  The caller declares the type, and the content must be what it says (JSON must parse). Returns the presented row. */
export function saveGeneratedPrivateFile(ctx: Ctx, input: { ownerId: string | null; kind: string; content: Buffer | string; mime: GeneratedMime; name: string; ref?: { type: string; id: string }; maxBytes?: number }) {
  if (!Object.prototype.hasOwnProperty.call(GENERATED_TYPES, input.mime)) throw new Error(`not a generated file type: ${String(input.mime)}`);
  const buf = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
  const ext = GENERATED_TYPES[input.mime];
  const name = input.name.toLowerCase().endsWith(`.${ext}`) ? input.name : `${input.name}.${ext}`;
  return writePrivate(ctx, { ownerId: input.ownerId, kind: input.kind, buf, mime: input.mime, ext, maxBytes: input.maxBytes ?? GENERATED_MAX_BYTES, ref: input.ref, name }, () => {
    if (input.mime === 'application/json') {
      try { JSON.parse(buf.toString('utf8')); } catch { throw new Error(`generated ${input.kind} file is not valid JSON`); }
    }
  });
}

/* ---------- download headers ---------- */

/** Images and PDF open in the browser; anything else (a JSON export) is always saved as a file. */
const INLINE_MIMES: ReadonlySet<string> = new Set<string>(SNIFFABLE_MIMES);

/** content-disposition for GET /files/download. Images and PDF: inline, as before. Anything else (a JSON export):
 *  attachment, with a file name made only of letters, digits, dot, dash and underscore that ends in the type's
 *  extension (data-export.json when nothing usable is left). */
export function downloadDisposition(file: Pick<FileRow, 'name' | 'mime' | 'kind'>): string {
  if (INLINE_MIMES.has(file.mime)) return `inline; filename="${file.name.replace(/[^\w.-]+/g, '-')}"`;
  const ext = (GENERATED_TYPES as Record<string, string>)[file.mime] ?? 'bin';
  let name = safeFileName(file.name, file.kind.replace(/[^a-z0-9]+/g, '-'), ext);
  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name.slice(0, 120 - ext.length - 1)}.${ext}`;
  return `attachment; filename="${name}"`;
}

/** Marks the file deleted and removes its bytes from disk. */
export function removePrivateFile(ctx: Ctx, id: string, reason: string): void {
  const f = getFile(ctx, id);
  if (!f) throw errors.notFound('File');
  ctx.db.update('file_metadata', id, { deleted_at: ctx.now() });
  try { fs.unlinkSync(absolutePath(ctx, f)); } catch { /* the bytes were already gone */ }
  audit(ctx, 'file.delete', { type: 'file', id }, reason, { kind: f.kind, refType: f.ref_type, refId: f.ref_id });
}

/* ---------- tokens ---------- */

type TokenPayload = { k: 'file'; f: string; u: string; exp: number };

function sign(secret: string, payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(`file:${body}`).digest('base64url')}`;
}

function verify(secret: string, token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || token.length > 2000) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!safeEqual(sig, createHmac('sha256', secret).update(`file:${body}`).digest('base64url'))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (p.k !== 'file' || typeof p.f !== 'string' || typeof p.u !== 'string' || typeof p.exp !== 'number') return null;
    return p as TokenPayload;
  } catch { return null; }
}

function seconds(iso: string): number { return Math.floor(Date.parse(iso) / 1000); }

/** A 5-minute token for one file, after the kind's access resolver admits the caller. Audited. */
export function fileToken(ctx: Ctx, fileId: string): { token: string; expiresInSeconds: number; url: string } {
  const actor = requireActor(ctx);
  const f = getFile(ctx, fileId);
  if (!f || !resolverFor(f.kind)(ctx, f)) throw errors.notFound('File');
  audit(ctx, 'file.token', { type: 'file', id: f.id }, null, { kind: f.kind, refType: f.ref_type, refId: f.ref_id, ownerId: f.owner_id, byRole: actor.role });
  const token = sign(ctx.config.TOKEN_SECRET, { k: 'file', f: f.id, u: actor.id, exp: seconds(ctx.now()) + FILE_TOKEN_SECONDS });
  return { token, expiresInSeconds: FILE_TOKEN_SECONDS, url: `/api/files/download?token=${encodeURIComponent(token)}` };
}

const expired = () => errors.forbidden('This link has expired. Open the file again to get a new one.', 'LINK_EXPIRED');

/** Redeems a token: checks signature and expiry, that its holder is still an active account, and runs the access
 *  resolver again as that person. Returns the file and where its bytes are. */
export function resolveFileToken(ctx: Ctx, token: string): { file: FileRow; absPath: string } {
  const p = verify(ctx.config.TOKEN_SECRET, token);
  if (!p || p.exp < seconds(ctx.now())) throw expired();
  const f = getFile(ctx, p.f);
  if (!f) throw errors.notFound('File');
  const u = ctx.db.get<{ id: string; role: Role; email: string; name: string; state: string }>('SELECT id, role, email, name, state FROM users WHERE id = ?', [p.u]);
  if (!u || u.state === 'suspended' || u.state === 'deactivated' || u.state === 'closed') throw expired();
  const as: Ctx = { ...ctx, actor: { id: u.id, role: u.role, email: u.email, name: u.name } };
  if (!resolverFor(f.kind)(as, f)) throw errors.notFound('File');
  const absPath = absolutePath(ctx, f);
  if (!fs.existsSync(absPath)) throw errors.notFound('File');
  return { file: f, absPath };
}

function formatBytes(n: number): string { return n >= 1024 * 1024 ? `${Math.round((n / (1024 * 1024)) * 10) / 10} MB` : `${Math.ceil(n / 1024)} KB`; }
