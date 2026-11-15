/* Exercise media files (api/domain/exerciseMedia.ts): the clips and posters the workout player and the exercise guide
   show, served by this server with byte ranges (video players ask for parts), a strong ETag from the file's SHA-256 and
   a year's immutable caching (a changed file is a new name). Public, like uploaded images: the names come only from
   signed-in pages, and the clips are demonstrations, never anyone's records.

   Only a name the manifest lists is served, exactly as listed: no paths, no other files of the folder, nothing while
   EXERCISE_MEDIA=none. Responses are never compressed (video and JPEG are not text types, and a range is a range). */
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errors } from '../../lib/errors.js';
import { def, param } from '../route.js';
import { CACHE_IMMUTABLE } from '../static-delivery.js';
import * as exerciseMedia from '../../domain/exerciseMedia.js';

/** One byte range of a file of `size` bytes from a Range header: the range, 'unsatisfiable' (416), or null when the
 *  header is to be ignored and the whole file sent (another unit, or several ranges: RFC 9110 14.2 lets a server send
 *  the whole representation instead). A malformed bytes range is refused as unsatisfiable. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^\s*([A-Za-z]+)\s*=\s*(.*)$/.exec(header);
  if (!m || m[1]!.toLowerCase() !== 'bytes') return null;
  const specs = m[2]!.split(',').map((s) => s.trim()).filter(Boolean);
  if (specs.length !== 1) return specs.length ? null : 'unsatisfiable';
  const r = /^(\d*)-(\d*)$/.exec(specs[0]!);
  if (!r || (r[1] === '' && r[2] === '')) return 'unsatisfiable';
  if (r[1] === '') {
    // the last n bytes
    const n = Number(r[2]);
    if (!Number.isSafeInteger(n) || n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(r[1]);
  const end = r[2] === '' ? size - 1 : Math.min(Number(r[2]), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** Does an If-None-Match header name this ETag (or *)? Weak and strong forms compare equal, as RFC 9110 13.1.2 asks. */
function noneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === '*' || t === etag);
}

async function serve(req: FastifyRequest, reply: FastifyReply) {
  const file = exerciseMedia.resolveFile(req.ctx, param(req, 'file'));
  if (!file) throw errors.notFound('Exercise media file');
  reply.header('accept-ranges', 'bytes');
  reply.header('etag', file.etag);
  reply.header('cache-control', CACHE_IMMUTABLE);
  reply.header('x-content-type-options', 'nosniff');
  // the app's web build may run on another origin than the API; helmet's same-site default would block it there
  reply.header('cross-origin-resource-policy', 'cross-origin');
  reply.type(file.mime);
  if (noneMatch(req.headers['if-none-match'], file.etag)) return reply.code(304).send();
  // If-Range: a range only of the version the client already holds; otherwise the whole new one
  const ifRange = String(req.headers['if-range'] ?? '');
  const range = ifRange && ifRange !== file.etag ? null : byteRange(req.headers.range, file.bytes);
  if (range === 'unsatisfiable') {
    reply.header('content-range', `bytes */${file.bytes}`);
    reply.type('application/json; charset=utf-8');
    return reply.code(416).send({ error: { code: 'RANGE_NOT_SATISFIABLE', message: `The file has ${file.bytes} bytes; ask for a range inside it` } });
  }
  if (range) {
    reply.code(206);
    reply.header('content-range', `bytes ${range.start}-${range.end}/${file.bytes}`);
    reply.header('content-length', String(range.end - range.start + 1));
    return fs.createReadStream(file.path, { start: range.start, end: range.end });
  }
  reply.header('content-length', String(file.bytes));
  return fs.createReadStream(file.path); // returned, not reply.send(): Fastify sends it once and handles a client that leaves early
}

export function mediaRoutes(app: FastifyInstance): void {
  def(app, { method: 'GET', path: '/public/media/exercises/:file', summary: 'An exercise clip (MP4) or poster (JPEG) by the hashed name the exercise carries: byte ranges (206), ETag revalidation (304), immutable for a year; 404 for any name the media manifest does not list and while EXERCISE_MEDIA=none', tag: 'public', auth: 'none', rateLimit: { max: 1200, timeWindow: '1 minute' }, responses: { '206': 'The requested byte range', '304': 'Not modified (If-None-Match)', '404': 'Not a file of the exercise media manifest, or exercise media switched off', '416': 'The range lies outside the file' } }, serve);
}
