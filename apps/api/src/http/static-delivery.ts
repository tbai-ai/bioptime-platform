/* How responses travel: the cache policy of the two static mounts and compression of text responses, with node's own
   zlib (no plugin). Production's Cloudflare edge does both for the website; this makes the local demo and the shared
   link behave the same way (web-7, cr-7, portal-3).

   Cache policy
   - /portal/assets/*: Vite names every file there after a hash of its content, so a changed file is a new URL. A year,
     immutable.
   - images, video, audio and fonts (website and portal): a day, revalidated afterwards by ETag (the website's own
     _headers asks the same for /assets/*, /brand/* and /lottie/*, which hold these files and the Lottie animations).
   - everything else (HTML, CSS, JavaScript that is not hashed, the web manifest): revalidated on every use, as before.

   Compression
   - only text types (HTML, CSS, JavaScript, JSON, SVG, the web manifest, plain text and XML) of at least 1 KB, for a
     client that accepts br or gzip; never images, video or fonts, a Range request or a 206, a HEAD request, or an
     answer that is already encoded or marked no-transform.
   - never a response that sets a cookie, nor the sign-in routes or a route that hands out a token: a secret in a
     compressed body next to text an attacker chose can be read off the length (BREACH).
   - Content-Length is recomputed for the compressed body (or dropped for a stream, which goes out chunked); the ETag is
     kept as a weak validator, as nginx does, so a revalidation still answers 304 whichever encoding the cache holds;
     Vary: Accept-Encoding tells caches the body depends on that header, and a 304 repeats it. A static file is
     compressed once per version (path and ETag) and kept in a small in-memory cache. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';

/* ---------- cache policy ---------- */

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_DAY = 'public, max-age=86400';
export const CACHE_REVALIDATE = 'public, max-age=0';

const MEDIA_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.ico', '.bmp', '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mp3', '.m4a', '.ogg', '.wav', '.woff2', '.woff', '.ttf', '.otf', '.eot']);
/** A Vite build file name: name-HASH.ext, the hash 8 characters of [A-Za-z0-9_-]. */
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/** Images, video, audio and fonts. */
export function isMediaFile(file: string): boolean { return MEDIA_EXT.has(path.extname(file).toLowerCase()); }

/** Cache-Control for a file of the portal build (rel: its path inside the build folder, with forward slashes). */
export function portalCacheControl(rel: string): string {
  if (rel.startsWith('assets/') && HASHED_NAME.test(rel)) return CACHE_IMMUTABLE;
  if (isMediaFile(rel)) return CACHE_DAY;
  return 'no-cache'; // index.html and anything else unhashed: always revalidated
}

/** Cache-Control for a file of the website (rel: its path inside the site folder, with forward slashes). */
export function siteCacheControl(rel: string): string {
  if (isMediaFile(rel)) return CACHE_DAY;
  if (rel.startsWith('lottie/') && rel.endsWith('.json')) return CACHE_DAY; // the animations, as the site's _headers asks
  return CACHE_REVALIDATE;
}

/* ---------- compression ---------- */

const COMPRESSIBLE = /^\s*(?:text\/(?:html|css|javascript|plain|xml|csv|calendar)|application\/(?:json|javascript|xml|manifest\+json|ld\+json|geo\+json)|image\/svg\+xml)\s*(?:;|$)/i;
const MIN_BYTES = 1024;
const STATIC_MAX_BYTES = 8 * 1024 * 1024; // larger text files stream through the compressor instead of the cache
const CACHE_MAX_BYTES = 48 * 1024 * 1024;

type Encoding = 'br' | 'gzip';
const gzipAsync = promisify(zlib.gzip) as (buf: Buffer, opts: zlib.ZlibOptions) => Promise<Buffer>;
const brotliAsync = promisify(zlib.brotliCompress) as (buf: Buffer, opts: zlib.BrotliOptions) => Promise<Buffer>;

/** The encoding to use for an Accept-Encoding header: br when it is accepted at least as strongly as gzip, else gzip. */
export function chooseEncoding(header: string | string[] | undefined): Encoding | null {
  const raw = Array.isArray(header) ? header.join(',') : header ?? '';
  if (!raw.trim()) return null;
  const q = new Map<string, number>();
  for (const part of raw.split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const value = qp ? Number(qp.slice(2)) : 1;
    q.set(name.trim(), Number.isFinite(value) ? value : 0);
  }
  const star = q.get('*');
  const br = q.get('br') ?? star ?? 0;
  const gzip = q.get('gzip') ?? q.get('x-gzip') ?? star ?? 0;
  if (br > 0 && br >= gzip) return 'br';
  if (gzip > 0) return 'gzip';
  return null;
}

function compress(buf: Buffer, enc: Encoding, strong: boolean): Promise<Buffer> {
  return enc === 'br'
    ? brotliAsync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: strong ? 9 : 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    : gzipAsync(buf, { level: strong ? 9 : 6 });
}

function compressStream(enc: Encoding): zlib.Gzip | zlib.BrotliCompress {
  return enc === 'br' ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.createGzip({ level: 6 });
}

/** Compressed static files, by path, version and encoding; the oldest go first past the size cap. */
const staticCache = new Map<string, Buffer>();
let staticCacheBytes = 0;
function remember(key: string, buf: Buffer): void {
  if (buf.length > CACHE_MAX_BYTES / 4) return;
  staticCache.set(key, buf);
  staticCacheBytes += buf.length;
  for (const [k, v] of staticCache) {
    if (staticCacheBytes <= CACHE_MAX_BYTES) break;
    staticCache.delete(k);
    staticCacheBytes -= v.length;
  }
}

function addVary(reply: FastifyReply, value: string): void {
  const current = reply.getHeader('vary');
  const list = (Array.isArray(current) ? current.join(',') : current === undefined ? '' : String(current)).split(',').map((v) => v.trim()).filter(Boolean);
  if (list.includes('*') || list.some((v) => v.toLowerCase() === value.toLowerCase())) return;
  reply.header('vary', [...list, value].join(', '));
}

type FileStream = NodeJS.ReadableStream & { path?: unknown; start?: unknown; end?: unknown; destroy?: () => void };

/** Extensions of the static files that go out as a compressible type. '' is a clean URL or a folder, which serve a
 *  page. A 304 carries no Content-Type, so its type is read off the path. */
const COMPRESSIBLE_EXT = new Set(['', '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.svg', '.webmanifest', '.xml', '.txt', '.csv', '.ics', '.jsonld', '.geojson']);
function compressiblePath(url: string): boolean {
  const pathname = url.split(/[?#]/, 1)[0] ?? '';
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* a malformed escape: judge the path as it is */ }
  return COMPRESSIBLE_EXT.has(path.posix.extname(decoded).toLowerCase());
}

/** onSend hook: compresses the payload when the rules above allow it. isStatic: the response comes from a static mount
 *  (its files may be cached compressed). */
export async function compressPayload(req: FastifyRequest, reply: FastifyReply, payload: unknown, isStatic: boolean): Promise<unknown> {
  const type = String(reply.getHeader('content-type') ?? '');
  const status = reply.statusCode;
  if (status === 304) {
    // a revalidation carries the Vary of the 200 it confirms (RFC 9110 15.4.5); send drops a 304's Content-Type
    if (type ? COMPRESSIBLE.test(type) : isStatic && compressiblePath(req.url)) addVary(reply, 'Accept-Encoding');
    return payload;
  }
  if (payload === null || payload === undefined) return payload;
  if (!COMPRESSIBLE.test(type)) return payload;
  if (status < 200 || status === 204 || status === 206) return payload;
  addVary(reply, 'Accept-Encoding'); // a compressible answer differs by Accept-Encoding even when this one goes out plain
  if (req.method === 'HEAD' || req.headers.range !== undefined) return payload;
  if (reply.getHeader('content-encoding') !== undefined || reply.getHeader('content-range') !== undefined) return payload;
  if (/no-transform/i.test(String(reply.getHeader('cache-control') ?? ''))) return payload;
  if (reply.getHeader('set-cookie') !== undefined) return payload;
  const route = req.routeOptions?.url ?? '';
  if (route.startsWith('/api/auth/') || /token/i.test(route)) return payload;
  const enc = chooseEncoding(req.headers['accept-encoding']);
  if (!enc) return payload;

  const encoded = (body: Buffer | NodeJS.ReadableStream) => {
    reply.header('content-encoding', enc);
    reply.removeHeader('content-length');
    reply.removeHeader('accept-ranges');
    const etag = reply.getHeader('etag');
    if (typeof etag === 'string' && !etag.startsWith('W/')) reply.header('etag', `W/${etag}`);
    return body;
  };

  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    const buf = typeof payload === 'string' ? Buffer.from(payload) : payload;
    if (buf.length < MIN_BYTES) return payload;
    return encoded(await compress(buf, enc, false));
  }

  const stream = payload as FileStream;
  if (typeof stream.pipe !== 'function') return payload;
  const declared = Number(reply.getHeader('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared < MIN_BYTES) return payload;
  // a whole static file: compress it once per version and serve the cached bytes
  const file = typeof stream.path === 'string' ? stream.path : null;
  if (isStatic && file && (stream.start === undefined || stream.start === 0) && Number.isFinite(declared) && declared <= STATIC_MAX_BYTES) {
    const key = `${file}\0${String(reply.getHeader('etag') ?? declared)}\0${enc}`;
    let out = staticCache.get(key);
    if (!out) {
      const buf = await fs.promises.readFile(file);
      out = await compress(buf, enc, true);
      remember(key, out);
    }
    stream.destroy?.();
    return encoded(out);
  }
  // anything else streams through the compressor; an error on either side ends both
  const z = compressStream(enc);
  pipeline(stream, z, () => { /* Fastify answers the client; a broken source or a closed connection needs nothing here */ });
  return encoded(z);
}
