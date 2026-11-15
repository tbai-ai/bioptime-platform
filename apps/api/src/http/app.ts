/* The Fastify application: security plugins, session resolution, the error shape, the API routes, and the static
   surfaces (website at /, dashboard at /dashboard) so one local origin serves everything. */
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type HTTPMethods } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from '../config.js';
import type { Db } from '../db/db.js';
import type { Ctx } from '../context.js';
import type { Services } from '../services.js';
import { AppError, errors } from '../lib/errors.js';
import { resolveSession } from '../auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { memberRoutes } from './routes/member.js';
import { coachRoutes } from './routes/coach.js';
import { adminRoutes } from './routes/admin.js';
import { cmsRoutes } from './routes/cms.js';
import { sharedRoutes } from './routes/shared.js';
import { webhookRoutes } from './routes/webhooks.js';
import { platformRoutes } from './routes/platform.js';
import { mediaRoutes } from './routes/media.js';
import { buildOpenApi, routes as registeredRoutes } from './openapi.js';
import { MODULES } from '../modules/index.js';
import type { ApiModule } from '../modules/types.js';
import { assertStorageReady } from '../domain/files.js';
import { madeByDef } from './route.js';
import { OPEN_PREVIEW_RESTRICTED, endOpenPreviewSessions } from '../auth/openPreview.js';
import { compressPayload, portalCacheControl, siteCacheControl, CACHE_DAY, CACHE_REVALIDATE } from './static-delivery.js';

export const API_VERSION = '0.1.0';
export const SESSION_COOKIE = 'bp_session';

declare module 'fastify' {
  interface FastifyInstance { services: Services; config: Config; db: Db }
}

/** modules: the module registry to mount (default MODULES); tests pass their own list to prove the start-up checks. */
export type AppOptions = { config: Config; db: Db; services: Services; logger?: boolean; logStream?: { write(msg: string): void }; modules?: ApiModule[] };

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { config, db, services } = opts;
  // production refuses local disk for private files while a module that stores them is enabled
  assertStorageReady({ db, config, actor: null, now: () => new Date().toISOString() });
  // Only a configured proxy may set the client address; otherwise X-Forwarded-For is attacker-chosen and defeats per-IP limits.
  const trustProxy = config.TRUST_PROXY === 'true' ? true : config.TRUST_PROXY ? config.TRUST_PROXY : false;
  // request logs never carry a sign-in token: ?token= values (activation and invitation pages) are redacted
  const logger = opts.logger ? { serializers: { req: (r: { method: string; url: string; hostname?: string; ip?: string }) => ({ method: r.method, url: redactTokens(r.url), host: r.hostname, remoteAddress: r.ip }) }, ...(opts.logStream ? { stream: opts.logStream } : {}) } : false;
  const app = Fastify({ logger, trustProxy, bodyLimit: 1024 * 1024 });
  // "is this an API request": decided on the routed path, never on the raw URL (percent-encoding could dodge a prefix test)
  const isApi = (req: { routeOptions?: { url?: string }; url: string }) => (req.routeOptions?.url ?? '').startsWith('/api/') || (req.routeOptions?.url ?? '') === '/api';
  app.decorate('services', services);
  app.decorate('config', config);
  app.decorate('db', db);
  app.decorateRequest('ctx', null as unknown as Ctx);
  app.decorateRequest('rawBody', undefined as unknown as string);

  // keep the raw JSON for webhook signature checks
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body || (body as string).length === 0) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch { done(new AppError('BAD_JSON', 400, 'The request body is not valid JSON'), undefined); }
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || origin === config.PUBLIC_ORIGIN || config.corsOrigins.includes(origin)), credentials: true, allowedHeaders: ['content-type', 'authorization', 'x-bioptime-client', 'x-signature', config.LABSTACK_WEBHOOK_HEADER], methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  // the website's contact form can post without JavaScript (application/x-www-form-urlencoded)
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (e) { done(e as Error); }
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', allowList: (req) => config.RATE_LIMITS === 'off' || !isApi(req) });

  const csp = readCsp(config.websiteDir);
  const portalPolicy = portalCsp(csp);
  app.addHook('onSend', async (req, reply, payload) => {
    if (!isApi(req)) {
      // the portal self-hosts its fonts, so its pages get the site's policy minus the Google Fonts hosts
      reply.header('content-security-policy', isPortalPath(req.url.split('?')[0]!) ? portalPolicy : csp);
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    }
    reply.header('x-bioptime-mode', config.BIOPTIME_MODE);
    return payload;
  });
  // text responses travel compressed (node's zlib; rules and exclusions in static-delivery.ts)
  app.addHook('onSend', async (req, reply, payload) => compressPayload(req, reply, payload, !isApi(req)));

  // who is calling: cookie (web) or bearer (mobile); state-changing cookie requests must carry the client header (CSRF)
  app.addHook('onRequest', async (req) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const cookieToken = req.cookies[SESSION_COOKIE] ?? null;
    const base: Ctx = { db, config, actor: null, ip: req.ip, now: () => new Date().toISOString() };
    const token = bearer ?? cookieToken;
    const actor = resolveSession(base, token);
    req.ctx = { ...base, actor };
    if (actor && !bearer && cookieToken && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && isApi(req) && !req.headers['x-bioptime-client']) {
      // A plain HTML form post (the website's no-JavaScript contact form) carries no client header; it runs as a signed-out
      // visitor rather than with the cookie session, so it can never change the member's state. Everything else is refused.
      if ((req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) { req.ctx = { ...base, actor: null }; return; }
      throw new AppError('CSRF', 403, 'Missing X-Bioptime-Client header');
    }
  });

  // clean URLs for the website, as Cloudflare's html_handling does in production: /about.html -> /about, /x/index.html -> /x/
  // (or -> /x when the folder has no index of its own and x.html is the page, as blog/ beside blog.html: cr-m1)
  // and the portal's entry points: /account -> the client portal, the old /dashboard/login -> the coach sign-in (/login is the website's chooser)
  app.addHook('onRequest', async (req, reply) => {
    if (isApi(req)) return;
    const p = req.url.split('?')[0]!;
    if (p === '/login/') return reply.redirect('/login', 302);
    if (p === '/account' || p === '/account/') return reply.redirect('/client', 302);
    if (p === '/dashboard/login') return reply.redirect('/login/coach', 302);
    if (isPortalPath(p)) return;
    const m = /^\/((?:[\w.-]+\/)*)([\w-]+)\.html(\?.*)?$/.exec(req.url);
    if (!m) return;
    const folder = m[1] ?? '';
    if (m[2] === 'index' && folder && !siteFile(`/${folder}index.html`) && siteFile(`/${folder.slice(0, -1)}.html`)) return reply.redirect(`/${folder.slice(0, -1)}${m[3] ?? ''}`, 301);
    return reply.redirect(`/${folder}${m[2] === 'index' ? '' : m[2]}${m[3] ?? ''}`, 301);
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as Partial<AppError> & { statusCode?: number; validation?: unknown; code?: string };
    if (err instanceof AppError) return reply.code(err.status).send(err.toJSON());
    if (e.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again in a minute.' } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: (err as Error).message } });
    req.log.error(err as Error);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. It has been logged.' } });
  });

  // api
  await app.register(async (api) => {
    api.get('/health', async () => ({ ok: true, mode: config.BIOPTIME_MODE, version: API_VERSION, time: new Date().toISOString(), demo: config.isDemo })); // integration detail is for signed-in administrators (/admin/settings)
    api.get('/openapi.json', async (req) => { if (config.isProduction && (!['admin', 'owner'].includes(req.ctx.actor?.role ?? '') || req.ctx.actor?.mfaEnrolled !== true)) throw errors.unauthorised('The API reference is for signed-in administrators in production'); return buildOpenApi(config.PUBLIC_ORIGIN, API_VERSION); });
    authRoutes(api);
    publicRoutes(api);
    mediaRoutes(api); // exercise clips and posters (api/domain/exerciseMedia.ts)
    memberRoutes(api);
    coachRoutes(api);
    adminRoutes(api);
    cmsRoutes(api);
    sharedRoutes(api);
    webhookRoutes(api);
    platformRoutes(api);
    // the modules (api/modules/index.ts): every route a module registers must declare its feature flag, unless the
    // module lists it as ungated (reachable while the module is off, such as deleting one's own data). Each module
    // registers inside its own scope (same /api prefix), whose onRoute hook refuses at start-up any route that def()
    // did not create: app.get(), app.route() or a plugin of the module's own would skip auth, permission and the flag.
    for (const m of opts.modules ?? MODULES) {
      const before = registeredRoutes().length;
      await api.register(async (scope) => {
        scope.addHook('onRoute', (r) => {
          if (!madeByDef(r)) throw new Error(`module ${m.key}: ${String(r.method)} ${r.url} was registered without def() (register module routes only through def() in api/http/route.ts, which applies auth, permission and the feature flag)`);
        });
        m.routes(scope);
      });
      const ungated = new Set(m.ungated ?? []);
      const missing = registeredRoutes().slice(before).filter((r) => !r.feature && !ungated.has(`${r.method} ${r.path}`));
      if (missing.length) throw new Error(`module ${m.key}: ${missing.map((r) => `${r.method} ${r.path}`).join(', ')} declare${missing.length === 1 ? 's' : ''} no feature flag (set feature in def(), or list the route in ungated)`);
    }
    api.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}` } }));
  }, { prefix: '/api' });
  // with the open preview off, the sessions it opened (if it was ever on with this database) are signed out
  if (!config.openPreview) endOpenPreviewSessions({ db, config, actor: null, now: () => new Date().toISOString() });
  // the open preview switches routes off by their declared method and path (api/auth/openPreview.ts): one renamed without
  // its entry would silently stop being refused, so the server does not start with an entry that names no route
  if (config.openPreview) {
    const missing = Object.keys(OPEN_PREVIEW_RESTRICTED).filter((k) => { const [method, p] = k.split(' ') as [HTTPMethods, string]; return !app.hasRoute({ method, url: `/api${p}` }); });
    if (missing.length) throw new Error(`OPEN_PREVIEW=1: the open preview's restricted list names routes that do not exist (${missing.join(', ')}); update api/auth/openPreview.ts`);
  }

  // static surfaces: the portal (client, coach and admin workspaces and the three sign-in pages) is one single-page app
  // whose assets live under /portal/; the website is everything else.
  const portalIndex = path.join(config.dashboardDir, 'index.html');
  let deniedResolved: (p: string) => boolean = () => true;
  let siteFile: (urlPath: string) => string | null = () => null;
  const portalRoot = path.resolve(config.dashboardDir);
  const relTo = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');
  if (fs.existsSync(config.dashboardDir)) {
    // hashed build files are cached for a year, the rest revalidated (static-delivery.ts). Source maps are not served:
    // they would publish the portal's whole source (portal-m3)
    await app.register(fastifyStatic, {
      root: config.dashboardDir, prefix: '/portal/', decorateReply: true, index: ['index.html'], wildcard: true,
      cacheControl: false, setHeaders: (res, file) => { res.setHeader('cache-control', portalCacheControl(relTo(portalRoot, file))); },
      allowedPath: (p) => !isSourceMap(p),
    });
  }
  if (fs.existsSync(config.websiteDir)) {
    const denied = readIgnore(config.websiteDir);
    const siteRoot = fs.realpathSync.native(config.websiteDir);
    // a URL can reach a file by another spelling: a clean URL or a directory (about → about.html, brand/book/ →
    // brand/book/index.html) and, on a case-insensitive disk (macOS), another letter case (/BRAND/Book/). Every file the
    // path could resolve to is checked under its real on-disk name, and a spelling that differs from that name is refused,
    // as it is on the case-sensitive production hosts
    deniedResolved = (p: string) => {
      let rel: string;
      try { rel = decodeURIComponent(p); } catch { return true; }
      if (rel.includes('\0') || rel.includes('\\')) return true; // NUL bytes and backslashes are never part of a page path
      if (rel.split('/').includes('..')) return true; // no climbing, even where normalising would hide it
      rel = path.posix.normalize(rel).replace(/^\/+/, '');
      if (rel.split('/').some((seg) => seg.startsWith('.'))) return true; // dotfiles and dot folders are never pages
      const candidates = [rel];
      if (rel === '' || rel.endsWith('/')) candidates.push(rel + 'index.html');
      else if (!path.posix.extname(rel)) candidates.push(rel + '.html', rel + '/index.html');
      for (const c of candidates) {
        if (denied('/' + c)) return true;
        const want = c.replace(/\/+$/, '');
        let real: string;
        try { real = fs.realpathSync.native(path.join(siteRoot, want)); } catch { continue; } // does not exist: nothing to serve
        if (real !== siteRoot && !real.startsWith(siteRoot + path.sep)) return true;
        const canon = path.relative(siteRoot, real).split(path.sep).join('/');
        if (canon !== want) return true; // another letter case (or a link) of an existing file
        if (canon === '_headers' || canon === '_redirects' || denied('/' + canon)) return true;
      }
      return false;
    };
    // the one file a URL path may serve from the site: decoded, no dot or '..' segments, inside the site folder, under its
    // real on-disk name and not in the ignore list; null otherwise. The not-found fallback serves only what this returns.
    siteFile = (urlPath: string) => {
      let rel: string;
      try { rel = decodeURIComponent(urlPath); } catch { return null; }
      if (rel.includes('\0') || rel.includes('\\')) return null;
      if (rel.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) return null;
      rel = path.posix.normalize(rel).replace(/^\/+/, '');
      if (!rel || denied('/' + rel)) return null;
      let real: string;
      try { real = fs.realpathSync.native(path.join(siteRoot, rel)); } catch { return null; }
      if (!real.startsWith(siteRoot + path.sep)) return null;
      const canon = path.relative(siteRoot, real).split(path.sep).join('/');
      if (canon !== rel || canon === '_headers' || canon === '_redirects' || denied('/' + canon)) return null;
      return fs.statSync(real).isFile() ? real : null;
    };
    // deployment metadata is never a page: dotfiles (.assetsignore, .DS_Store) and Cloudflare's _headers answer 404
    // images, video and fonts are cached for a day, pages, styles and scripts revalidated (static-delivery.ts)
    const siteDirResolved = path.resolve(config.websiteDir);
    await app.register(fastifyStatic, { root: config.websiteDir, prefix: '/', decorateReply: !fs.existsSync(config.dashboardDir), index: ['index.html'], extensions: ['html'], wildcard: true, dotfiles: 'ignore', cacheControl: false, setHeaders: (res, file) => { res.setHeader('cache-control', siteCacheControl(relTo(siteDirResolved, file))); }, allowedPath: (p) => !deniedResolved(p) && p !== '/api' && !p.startsWith('/api/') });
  }
  // the browser asks every origin for /favicon.ico (a photo or document opened in its own tab does too): the site's own
  // favicon answers it (portal-11)
  const favicon = [path.join(config.websiteDir, 'favicon.ico'), path.join(config.websiteDir, 'brand', 'kit', 'icons', 'favicon.ico'), path.join(config.dashboardDir, 'favicon.ico')].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (favicon) {
    app.get('/favicon.ico', async (req, reply) => {
      const st = fs.statSync(favicon);
      const etag = `W/"${st.size.toString(16)}-${st.mtime.getTime().toString(16)}"`;
      reply.type('image/x-icon').header('cache-control', CACHE_DAY).header('etag', etag).header('last-modified', st.mtime.toUTCString());
      const inm = String(req.headers['if-none-match'] ?? '');
      if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag.slice(2))) return reply.code(304).send();
      return fs.readFileSync(favicon);
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const p = req.url.split(/[?#]/)[0]!; // the router also stops at '#': a raw request line may carry one
    const qi = req.url.search(/[?#]/);
    const query = qi >= 0 && req.url[qi] === '?' ? req.url.slice(qi).split('#')[0]! : '';
    if (p === '/api' || p.startsWith('/api/')) return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'No such API route' } });
    if (p.startsWith('/portal/') && isSourceMap(p)) return reply.code(404).type('text/plain').send('Not found'); // never the portal's source (portal-m3)
    if (p.startsWith('/portal/')) {
      // a build that appeared after start-up is not mounted by the static plugin: serve its files from disk
      let rel = '';
      try { rel = decodeURIComponent(p.slice('/portal/'.length)).replace(/^\/+/, ''); } catch { rel = ''; }
      const file = path.resolve(config.dashboardDir, rel);
      const root = fs.existsSync(config.dashboardDir) ? fs.realpathSync(config.dashboardDir) : path.resolve(config.dashboardDir);
      const real = fs.existsSync(file) ? fs.realpathSync(file) : file;
      if (rel && real.startsWith(root + path.sep) && fs.existsSync(real) && fs.statSync(real).isFile()) {
        return reply.type(STATIC_TYPES[path.extname(real)] ?? 'application/octet-stream').header('cache-control', portalCacheControl(relTo(root, real))).send(fs.readFileSync(real));
      }
    }
    // a hashed asset that is not in this build (an old tab after a rebuild) is missing, not the app: answering with the
    // index would hand the browser HTML where it expects a module
    if (p.startsWith('/portal/assets/')) return reply.code(404).type('text/plain').send('Not found');
    if (isPortalPath(p)) {
      if (fs.existsSync(portalIndex)) return reply.type('text/html').header('cache-control', 'no-cache').send(fs.readFileSync(portalIndex));
      return reply.code(503).type('text/plain').send('The portal is not built yet: run `npm run dashboard:build` in platform/, or use the Vite dev server on :5173.');
    }
    // a clean URL whose name is also a folder without an index (/blog with blog/ beside blog.html) serves the page, as
    // Cloudflare's html_handling does. The same URL with a trailing slash (/blog/, /about/, /about//) answers 301 to the
    // clean URL with its query string (auto-trailing-slash): served at the slashed URL, every relative stylesheet, script
    // and image of the page would resolve one folder too deep and fail (web-2, cr-4)
    if (fs.existsSync(config.websiteDir) && (req.method === 'GET' || req.method === 'HEAD')) {
      const bare = p.replace(/\/+$/, '');
      const file = bare && !path.posix.extname(bare) && !deniedResolved(bare + '.html') ? siteFile(bare + '.html') : null;
      if (file && bare !== p) return reply.redirect('/' + path.posix.normalize(bare).replace(/^\/+/, '') + query, 301); // one leading slash: never a protocol-relative Location
      if (file) return reply.type('text/html; charset=utf-8').header('cache-control', CACHE_REVALIDATE).send(fs.readFileSync(file));
    }
    const notFound = path.join(config.websiteDir, '404.html');
    if (fs.existsSync(notFound)) return reply.code(404).type('text/html').send(fs.readFileSync(notFound));
    return reply.code(404).type('text/plain').send('Not found');
  });

  return app;
}

/** Removes sign-in tokens from a URL before it is logged. */
export function redactTokens(url: string): string { return url.replace(/([?&](?:token|code|key|id_token|pendingToken)=)[^&#]*/gi, '$1[redacted]'); }

/** A source map (.map), checked on the decoded path so a percent-encoded spelling is caught too. */
function isSourceMap(p: string): boolean {
  let d = p;
  try { d = decodeURIComponent(p); } catch { /* undecodable: test the raw path */ }
  return /\.map$/i.test(d.replace(/[\/\s]+$/, ''));
}

/** Paths the portal single-page app owns: its assets, the three sign-in pages, the three workspaces and the old /dashboard entry. */
export function isPortalPath(p: string): boolean {
  if (p.startsWith('/login/')) return true; // the three doors; /login itself is the website's chooser
  return ['/portal', '/client', '/coach', '/admin', '/dashboard'].some((ns) => p === ns || p.startsWith(`${ns}/`));
}

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function readCsp(websiteDir: string): string {
  try {
    const headers = fs.readFileSync(path.join(websiteDir, '_headers'), 'utf8');
    const line = headers.split('\n').find((l) => l.trim().toLowerCase().startsWith('content-security-policy:'));
    if (line) return line.split(':').slice(1).join(':').trim();
  } catch { /* no site headers */ }
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
}

/** The portal's policy: the website's, with fonts allowed from this origin only (apps/dashboard/public/fonts) and no Google Fonts hosts. */
export function portalCsp(siteCsp: string): string {
  const google = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/;
  const directives = siteCsp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name = '', ...values] = d.split(/\s+/);
    if (name === 'font-src') return "font-src 'self'";
    if (name === 'style-src') return [name, ...values.filter((v) => !google.test(v))].join(' ');
    return d;
  });
  if (!directives.some((d) => d.startsWith('font-src'))) directives.push("font-src 'self'");
  return directives.join('; ');
}

/** The website's .assetsignore, honoured so localhost matches production. */
function readIgnore(websiteDir: string): (p: string) => boolean {
  let patterns: string[] = [];
  try { patterns = fs.readFileSync(path.join(websiteDir, '.assetsignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch { /* none */ }
  patterns = patterns.map((s) => s.toLowerCase()); // a second layer under the real-name check: compare without case
  return (p: string) => {
    const rel = p.replace(/^\/+/, '').toLowerCase();
    for (const pat of patterns) {
      if (pat.endsWith('/')) { if (rel.startsWith(pat) || rel.includes('/' + pat)) return true; continue; }
      if (pat.startsWith('*.')) { if (rel.endsWith(pat.slice(1))) return true; continue; }
      if (pat.includes('*')) { const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); if (re.test(rel)) return true; continue; }
      if (rel === pat || rel.split('/').pop() === pat) return true;
    }
    return false;
  };
}
