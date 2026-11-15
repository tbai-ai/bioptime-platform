/* Regression tests for the fixes of 25 October 2026 (bug ids in each title): how the website and the portal are
   delivered (clean-URL redirects, cache policy, compression, source maps, the favicon), images in use and their sizes,
   alternative text on website images, the member's Today card, and dates on the member documents. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { totpCode } from '../../src/lib/crypto.js';
import { dateInZone, addDays, istWhen, istDayLabel, istLongDate, istLongDateTime } from '../../src/lib/time.js';
import * as assets from '../../src/domain/assets.js';
import * as orders from '../../src/domain/orders.js';
import { chooseEncoding, portalCacheControl, siteCacheControl } from '../../src/http/static-delivery.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const login = (c: ReturnType<typeof client>, email: string, password: string, workspace: string, mfa = false) => c.post('/api/auth/login', { email, password, workspace, ...(mfa ? { mfaCode: totpCode(DEMO_MFA_SECRET) } : {}) });
const detail = (r: { json: { error?: { code: string; details?: unknown } } }) => r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code;
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** A PNG of its own bytes each call (the library treats identical bytes as one asset). */
const uniquePng = () => Buffer.concat([PNG_1x1, randomBytes(16)]);
const text = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed} line ${i}: ${'x'.repeat(40)}`).join('\n');

/* ---------- a website and a portal build of the test's own ---------- */

function makeSite() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-delivery-'));
  const site = path.join(base, 'site'), dist = path.join(base, 'dist');
  const put = (root: string, rel: string, body: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  put(site, 'index.html', `<!doctype html><title>Home</title>${text(60, 'home')}`);
  put(site, 'about.html', '<!doctype html><title>About</title><link rel="stylesheet" href="css/style.css">');
  put(site, 'blog.html', '<!doctype html><title>Blog index</title>');
  put(site, 'blog/first-post.html', '<!doctype html><title>First post</title>');
  put(site, 'guide/index.html', '<!doctype html><title>Guide</title>');
  put(site, '404.html', '<!doctype html><title>Missing</title>');
  put(site, 'css/style.css', text(80, 'body{}'));
  put(site, 'js/main.js', text(80, '// script'));
  put(site, 'assets/img/photo.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(6000)]));
  put(site, 'assets/video/clip.mp4', randomBytes(9000));
  put(site, 'lottie/mark.json', JSON.stringify({ v: '5.7', frames: text(10, 'f') }));
  put(site, 'brand/kit/icons/favicon.ico', Buffer.concat([Buffer.from([0, 0, 1, 0]), randomBytes(500)]));
  put(dist, 'index.html', '<!doctype html><div id=root></div>');
  put(dist, 'assets/index-AbCd_9-z.js', text(200, 'export const a = 1;'));
  put(dist, 'assets/index-AbCd_9-z.js.map', JSON.stringify({ version: 3, sources: ['../../src/lib/api.ts'], sourcesContent: ['secret source'] }));
  put(dist, 'fonts/mono.woff2', randomBytes(3000));
  put(dist, 'favicon.ico', randomBytes(300));
  return { base, site, dist };
}

test('clean URLs: a trailing slash and /<folder>/index.html answer 301 to the clean URL with the query string (web-2, cr-4, cr-m1)', async () => {
  const s = makeSite();
  const app = await makeApp({ seed: false, env: { WEBSITE_DIR: s.site, DASHBOARD_DIR: s.dist } });
  try {
    const c = client(app.app);
    const moved = async (url: string, to: string, method: 'GET' | 'HEAD' = 'GET') => {
      const r = await app.app.inject({ method, url });
      assert.equal(r.statusCode, 301, `${method} ${url} is moved`);
      assert.equal(r.headers.location, to, `${url} -> ${to}`);
    };
    await moved('/about/', '/about');
    await moved('/about/?x=1&y=2', '/about?x=1&y=2');
    await moved('/about//', '/about');
    await moved('//about/', '/about'); // never a protocol-relative Location
    await moved('/blog/', '/blog');
    await moved('/blog/first-post/', '/blog/first-post');
    await moved('/blog/index.html', '/blog', 'GET');
    await moved('/blog/index.html?q=1', '/blog?q=1');
    await moved('/about/', '/about', 'HEAD');
    await moved('/guide/index.html', '/guide/'); // a folder with its own index keeps its slash
    await moved('/about.html?x=1', '/about?x=1');
    assert.equal((await c.get('/guide/')).status, 200);
    assert.match((await c.get('/about')).text, /<title>About<\/title>/);
    assert.match((await c.get('/blog')).text, /Blog index/);
    for (const p of ['/nope/', '/nope', '/blog/missing/']) assert.equal((await c.get(p)).status, 404, `${p} is not a page`);
  } finally { await app.app.close(); app.db.close(); fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('cache policy: hashed portal bundles for a year, website and portal media for a day with an ETag, pages, styles and scripts revalidated (web-7, cr-7, portal-3)', async () => {
  assert.equal(portalCacheControl('assets/index-BtUaCGCf.js'), 'public, max-age=31536000, immutable');
  assert.equal(portalCacheControl('assets/index-BoHkzK-1.js'), 'public, max-age=31536000, immutable');
  assert.equal(portalCacheControl('index.html'), 'no-cache');
  assert.equal(siteCacheControl('assets/workouts/posters/pullups.jpg'), 'public, max-age=86400');
  assert.equal(siteCacheControl('css/style.css'), 'public, max-age=0');
  const s = makeSite();
  const app = await makeApp({ seed: false, env: { WEBSITE_DIR: s.site, DASHBOARD_DIR: s.dist } });
  try {
    const get = (url: string) => app.app.inject({ method: 'GET', url });
    const cases: Array<[string, string]> = [
      ['/portal/assets/index-AbCd_9-z.js', 'public, max-age=31536000, immutable'],
      ['/portal/index.html', 'no-cache'],
      ['/client', 'no-cache'],
      ['/portal/fonts/mono.woff2', 'public, max-age=86400'],
      ['/assets/img/photo.jpg', 'public, max-age=86400'],
      ['/assets/video/clip.mp4', 'public, max-age=86400'],
      ['/lottie/mark.json', 'public, max-age=86400'],
      ['/', 'public, max-age=0'],
      ['/about', 'public, max-age=0'],
      ['/css/style.css', 'public, max-age=0'],
      ['/js/main.js', 'public, max-age=0'],
    ];
    for (const [url, policy] of cases) {
      const r = await get(url);
      assert.equal(r.statusCode, 200, url);
      assert.equal(r.headers['cache-control'], policy, `${url}: ${policy}`);
    }
    for (const url of ['/assets/img/photo.jpg', '/portal/assets/index-AbCd_9-z.js', '/css/style.css']) {
      const etag = String((await get(url)).headers.etag ?? '');
      assert.ok(etag, `${url} carries an ETag`);
      assert.equal((await app.app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } })).statusCode, 304, `${url} revalidates to 304`);
    }
  } finally { await app.app.close(); app.db.close(); fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('compression: text answers travel gzip or br with a correct length and a weak ETag; images, video, ranges and HEAD never (cr-7, portal-3)', async () => {
  assert.equal(chooseEncoding('gzip, deflate, br'), 'br');
  assert.equal(chooseEncoding('gzip'), 'gzip');
  assert.equal(chooseEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(chooseEncoding('identity'), null);
  assert.equal(chooseEncoding(undefined), null);
  const s = makeSite();
  const app = await makeApp({ env: { WEBSITE_DIR: s.site, DASHBOARD_DIR: s.dist } });
  try {
    const inject = (url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') => app.app.inject({ method, url, headers });
    for (const [url, file] of [['/portal/assets/index-AbCd_9-z.js', path.join(s.dist, 'assets/index-AbCd_9-z.js')], ['/css/style.css', path.join(s.site, 'css/style.css')], ['/', path.join(s.site, 'index.html')]] as const) {
      const plain = await inject(url);
      assert.equal(plain.headers['content-encoding'], undefined, `${url}: no encoding unasked`);
      assert.match(String(plain.headers.vary), /Accept-Encoding/, `${url}: Vary names Accept-Encoding`);
      for (const [enc, decode] of [['gzip', zlib.gunzipSync], ['br', zlib.brotliDecompressSync]] as const) {
        for (let round = 0; round < 2; round++) { // the second answer comes from the compressed-file cache
          const r = await inject(url, { 'accept-encoding': enc });
          assert.equal(r.statusCode, 200);
          assert.equal(r.headers['content-encoding'], enc, `${url} travels ${enc}`);
          assert.equal(Number(r.headers['content-length']), r.rawPayload.length, `${url}: Content-Length is the compressed length`);
          assert.ok(r.rawPayload.length < fs.statSync(file).size, `${url}: smaller than the file`);
          assert.deepEqual(decode(r.rawPayload), fs.readFileSync(file), `${url}: ${enc} decodes to the file`);
          assert.equal(r.headers.etag, plain.headers.etag, `${url}: the same weak ETag in both encodings`);
          assert.match(String(r.headers.etag), /^W\//);
          assert.equal(r.headers['accept-ranges'], undefined, 'no byte ranges over a compressed body');
        }
      }
      const etag = String(plain.headers.etag);
      const fresh = await inject(url, { 'accept-encoding': 'gzip', 'if-none-match': etag });
      assert.equal(fresh.statusCode, 304, `${url}: revalidates to 304 compressed as well`);
      assert.equal(fresh.headers.vary, plain.headers.vary, `${url}: the 304 carries the Vary of the 200 (Accept-Encoding included)`);
    }
    for (const url of ['/assets/img/photo.jpg', '/assets/video/clip.mp4', '/portal/fonts/mono.woff2', '/favicon.ico']) {
      const r = await inject(url, { 'accept-encoding': 'gzip, br' });
      assert.equal(r.statusCode, 200, url);
      assert.equal(r.headers['content-encoding'], undefined, `${url} is never compressed`);
      assert.doesNotMatch(String(r.headers.vary ?? ''), /Accept-Encoding/, `${url}: nothing varies by encoding`);
      const fresh = await inject(url, { 'accept-encoding': 'gzip, br', 'if-none-match': String(r.headers.etag) });
      assert.equal(fresh.statusCode, 304, `${url}: revalidates`);
      assert.equal(fresh.headers.vary, r.headers.vary, `${url}: the 304 carries the Vary of the 200 and no more`);
    }
    const ranged = await inject('/js/main.js', { 'accept-encoding': 'gzip, br', range: 'bytes=0-99' });
    assert.equal(ranged.statusCode, 206);
    assert.equal(ranged.headers['content-encoding'], undefined, 'a Range answer is never compressed');
    assert.equal(ranged.rawPayload.length, 100);
    const head = await inject('/js/main.js', { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(head.headers['content-encoding'], undefined, 'HEAD keeps the identity length');
    assert.equal(Number(head.headers['content-length']), fs.statSync(path.join(s.site, 'js/main.js')).size);
    // JSON from the API: compressed when it is worth it, never below 1 KB, never a sign-in answer
    const packages = await inject('/api/packages', { 'accept-encoding': 'gzip' });
    assert.equal(packages.headers['content-encoding'], 'gzip');
    assert.ok(Array.isArray(JSON.parse(zlib.gunzipSync(packages.rawPayload).toString('utf8')).items));
    const health = await inject('/api/health', { 'accept-encoding': 'gzip' });
    assert.equal(health.headers['content-encoding'], undefined, 'a small answer goes out as it is');
    const signIn = await app.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json', 'x-bioptime-client': 'web', 'accept-encoding': 'gzip, br' }, payload: JSON.stringify({ email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' }) });
    assert.equal(signIn.statusCode, 200);
    assert.equal(signIn.headers['content-encoding'], undefined, 'a sign-in answer (cookie, token) is never compressed');
  } finally { await app.app.close(); app.db.close(); fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('portal source maps are not served, by any spelling (portal-m3); /favicon.ico answers with the site favicon (portal-11)', async () => {
  const s = makeSite();
  const app = await makeApp({ seed: false, env: { WEBSITE_DIR: s.site, DASHBOARD_DIR: s.dist } });
  try {
    const c = client(app.app);
    assert.equal((await c.get('/portal/assets/index-AbCd_9-z.js')).status, 200, 'the bundle itself is served');
    for (const p of ['/portal/assets/index-AbCd_9-z.js.map', '/portal/assets/index-AbCd_9-z.js.m%61p', '/portal/assets/index-AbCd_9-z.js.MAP', '/portal//assets/index-AbCd_9-z.js.map']) {
      const r = await c.get(p);
      assert.equal(r.status, 404, `${p} answers 404`);
      assert.doesNotMatch(r.text, /secret source|sourcesContent/, `${p} leaks nothing`);
    }
    const icon = await app.app.inject({ method: 'GET', url: '/favicon.ico' });
    assert.equal(icon.statusCode, 200);
    assert.match(String(icon.headers['content-type']), /image\/x-icon/);
    assert.deepEqual(icon.rawPayload, fs.readFileSync(path.join(s.site, 'brand/kit/icons/favicon.ico')), 'the website’s own favicon, not a new image');
    assert.equal(icon.headers['cache-control'], 'public, max-age=86400');
    assert.equal((await app.app.inject({ method: 'GET', url: '/favicon.ico', headers: { 'if-none-match': String(icon.headers.etag) } })).statusCode, 304);
    assert.equal((await app.app.inject({ method: 'HEAD', url: '/favicon.ico' })).statusCode, 200);
  } finally { await app.app.close(); app.db.close(); fs.rmSync(s.base, { recursive: true, force: true }); }
});

test('an image used as a course cover, a recipe image or a website block cannot be deleted; a cover or recipe whose image is already gone reads as no image (cr-6)', async () => {
  const owner = client(h.app), anon = client(h.app), member = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await member.login(DEMO.member, DEMO_PASSWORDS.member);
  const up = await owner.post('/api/admin/assets', { filename: 'cover.png', dataBase64: uniquePng().toString('base64'), alt: 'A cover picture' });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const asset = up.json as { id: string; url: string };
  const course = h.db.get<{ id: string; title: string }>("SELECT id, title FROM courses WHERE slug = 'getting-started-with-learn'")!;
  const recipe = h.db.get<{ id: string; title: string }>('SELECT id, title FROM recipes ORDER BY title LIMIT 1')!;
  assert.ok(course && recipe, 'the demo has a course and a recipe');
  assert.equal((await owner.patch(`/api/admin/courses/${course.id}`, { coverAssetId: asset.id })).status, 200);
  assert.equal((await owner.patch(`/api/admin/recipes/${recipe.id}`, { imageAssetId: asset.id, reason: 'test: set the image' })).status, 200);
  assert.equal((await owner.put('/api/admin/content/coaching.hero.image', { value: { assetId: asset.id, alt: 'A coach and a member talking' } })).status, 200);
  const refused = await owner.del(`/api/admin/assets/${asset.id}?reason=test%3A+remove`);
  assert.equal(refused.status, 409);
  assert.equal(detail(refused), 'ASSET_IN_USE');
  const msg = String(refused.json.error?.message);
  assert.match(msg, new RegExp(`the cover of the course “${course.title}”`), msg);
  assert.match(msg, new RegExp(`the recipe “${recipe.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}”`), msg);
  assert.match(msg, /the website’s “Coaching page image”/, msg);
  assert.doesNotMatch(msg, /coaching\.hero\.image|ast_/, 'the message names things people know, not keys or ids');
  assert.equal((await anon.get(asset.url)).status, 200, 'still served');
  // replace it everywhere, then it can go
  assert.equal((await owner.patch(`/api/admin/courses/${course.id}`, { coverAssetId: null })).status, 200);
  assert.match(String((await owner.del(`/api/admin/assets/${asset.id}?reason=test%3A+remove`)).json.error?.message), /recipe/, 'still refused while the recipe uses it');
  assert.equal((await owner.patch(`/api/admin/recipes/${recipe.id}`, { imageAssetId: null, reason: 'test: clear the image' })).status, 200);
  assert.equal((await owner.post('/api/admin/content/coaching.hero.image/reset', { reason: 'test: clear the image' })).status, 200);
  assert.equal((await owner.del(`/api/admin/assets/${asset.id}?reason=test%3A+remove`)).status, 200);

  // a reference left from before the rule: the cover and the recipe image read as none, and the editors can still save
  const old = (await owner.post('/api/admin/assets', { filename: 'old.png', dataBase64: uniquePng().toString('base64'), alt: 'Old picture' })).json as { id: string };
  h.db.run('UPDATE courses SET cover_asset_id = ? WHERE id = ?', [old.id, course.id]);
  h.db.run('UPDATE recipes SET image_asset_id = ? WHERE id = ?', [old.id, recipe.id]);
  assert.equal(((await member.get(`/api/me/courses/${course.id}`)).json.cover as { url: string; width: number; height: number }).url, `/api/public/assets/${old.id}`, 'the live cover shows');
  h.db.run('UPDATE assets SET deleted_at = ? WHERE id = ?', [h.ctx.now(), old.id]);
  assert.equal((await member.get(`/api/me/courses/${course.id}`)).json.cover, null, 'the member sees no cover, not a broken image');
  const editor = await owner.get(`/api/admin/courses/${course.id}`);
  assert.equal(editor.json.cover, null);
  assert.equal(editor.json.coverAssetId, null, 'the editor offers no image it could not save');
  assert.equal((await owner.patch(`/api/admin/courses/${course.id}`, { summary: 'Edited after the image went' })).status, 200, 'the course still saves');
  const recipes = (await owner.get('/api/admin/recipes')).json.items as Array<{ id: string; imageUrl: string | null; imageAssetId: string | null }>;
  const r = recipes.find((x) => x.id === recipe.id)!;
  assert.equal(r.imageUrl, null);
  assert.equal(r.imageAssetId, null);
  h.db.run('UPDATE courses SET cover_asset_id = NULL WHERE id = ?', [course.id]);
  h.db.run('UPDATE recipes SET image_asset_id = NULL WHERE id = ?', [recipe.id]);
});

test('WebP uploads record their width and height (lossy, lossless and extended), and a re-upload fills in a size that was missing (cr-9)', async () => {
  const riff = (chunk: string, body: Buffer) => { const b = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(chunk), Buffer.alloc(4), body]); b.writeUInt32LE(b.length - 8, 4); b.writeUInt32LE(body.length, 16); return b; };
  // VP8: frame tag (3 bytes), start code 9d 01 2a, 14-bit width and height
  const vp8 = Buffer.alloc(30); vp8.set([0x9d, 0x01, 0x2a], 3); vp8.writeUInt16LE(960, 6); vp8.writeUInt16LE(600, 8);
  // VP8L: signature 0x2f, then (width - 1) and (height - 1) in 14 bits each
  const vp8l = Buffer.alloc(30); vp8l[0] = 0x2f; vp8l.writeUInt32LE((300 - 1) | ((200 - 1) << 14), 1);
  // VP8X: 4 bytes of flags, then (width - 1) and (height - 1) in 24 bits each
  const vp8x = Buffer.alloc(30); vp8x.writeUIntLE(1280 - 1, 4, 3); vp8x.writeUIntLE(720 - 1, 7, 3);
  for (const [chunk, body, w, hgt] of [['VP8 ', vp8, 960, 600], ['VP8L', vp8l, 300, 200], ['VP8X', vp8x, 1280, 720]] as const) {
    const file = Buffer.concat([riff(chunk, body), randomBytes(8)]);
    assert.deepEqual(assets.dimensions(file, 'image/webp'), { width: w, height: hgt }, chunk);
    const up = assets.uploadAsset(h.ctx, { filename: `x-${chunk.trim()}.webp`, dataBase64: file.toString('base64'), alt: 'Test picture' });
    assert.equal(up.mime, 'image/webp');
    assert.equal(up.width, w); assert.equal(up.height, hgt);
  }
  // an asset stored before WebP sizes were read gets them when the same bytes come again
  const file = Buffer.concat([riff('VP8 ', vp8), randomBytes(8)]);
  const first = assets.uploadAsset(h.ctx, { filename: 'again.webp', dataBase64: file.toString('base64'), alt: 'Test picture' });
  h.db.run('UPDATE assets SET width = NULL, height = NULL WHERE id = ?', [first.id]);
  const again = assets.uploadAsset(h.ctx, { filename: 'again.webp', dataBase64: file.toString('base64') });
  assert.equal(again.id, first.id);
  assert.deepEqual([again.width, again.height], [960, 600]);
  assert.deepEqual({ ...h.db.get<{ width: number; height: number }>('SELECT width, height FROM assets WHERE id = ?', [first.id]) }, { width: 960, height: 600 });
});

test('a website image cannot be saved or published without alternative text (staff-14)', async () => {
  const owner = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const blank = (await owner.post('/api/admin/assets', { filename: 'blank-alt.png', dataBase64: uniquePng().toString('base64'), alt: '' })).json as { id: string };
  for (const value of [{ assetId: blank.id, alt: '' }, { assetId: blank.id, alt: '   ' }, { assetId: blank.id }, { assetId: blank.id, alt: '<b></b>' }]) {
    const r = await owner.put('/api/admin/content/coaching.hero.image', { value });
    assert.equal(r.status, 400, JSON.stringify(value));
    assert.equal(r.json.error?.code, 'CONTENT_ALT_REQUIRED');
    assert.match(String(r.json.error?.message), /^Coaching page image: describe the image/);
  }
  assert.equal((await owner.put('/api/admin/content/coaching.hero.image', { value: { assetId: blank.id, alt: 'A coach reviewing a training plan with a member' } })).status, 200);
  // a draft saved before the rule, with no description, is not published
  h.db.run('UPDATE content_blocks SET draft = ? WHERE key = ?', [JSON.stringify({ assetId: blank.id, alt: '', url: `/api/public/assets/${blank.id}`, width: 1, height: 1 }), 'coaching.hero.image']);
  const pub = await owner.post('/api/admin/content/publish', { keys: ['coaching.hero.image'], reason: 'test: publish' });
  assert.equal(pub.status, 400, JSON.stringify(pub.json));
  assert.equal(pub.json.error?.code, 'CONTENT_ALT_REQUIRED');
  assert.equal(h.db.get<{ published: string | null }>('SELECT published FROM content_blocks WHERE key = ?', ['coaching.hero.image'])!.published, null, 'nothing was published');
  assert.equal((await owner.post('/api/admin/content/coaching.hero.image/reset', { reason: 'test: clear' })).status, 200);
});

test('Today card: tasks due today (India date) first, then overdue tasks newest first; each says whether it is overdue; the total counts them all (app-8, portal-m1)', async () => {
  const PRIYA = 'priya.nair@demo.bioptime.test'; // the member the reports were made with; the seed's showcase ticks off her past tasks, so the overdue ones below are the test's own
  const memberId = userId(h.ctx, PRIYA);
  const today = dateInZone(h.ctx.now());
  const pending = () => h.db.all<{ id: string; due_at: string | null }>("SELECT t.id, t.due_at FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE t.member_id = ? AND v.status = 'published' AND t.status = 'pending'", [memberId]);
  const template = h.db.get<Record<string, unknown>>("SELECT t.* FROM plan_tasks t JOIN coaching_plan_versions v ON v.id = t.plan_version_id WHERE t.member_id = ? AND v.status = 'published' LIMIT 1", [memberId]);
  assert.ok(template, 'the demo member has a published plan');
  // a task due at 01:30 India time today is stored on the previous UTC day: it is today's, not overdue
  const earlyToday = new Date(Date.parse(`${today}T01:30:00+05:30`)).toISOString();
  const lateYesterday = new Date(Date.parse(`${today}T00:00:00+05:30`) - 30 * 60_000).toISOString(); // 23:30 India time yesterday
  const daysAgo = (n: number) => new Date(Date.parse(`${today}T12:00:00+05:30`) - n * 86_400_000).toISOString();
  const extra = [['tsk_test_early_today', earlyToday], ['tsk_test_late_yesterday', lateYesterday], ['tsk_test_old_1', daysAgo(20)], ['tsk_test_old_2', daysAgo(19)], ['tsk_test_old_3', daysAgo(18)], ['tsk_test_old_4', daysAgo(17)], ['tsk_test_old_5', daysAgo(16)]] as const;
  for (const [id, due] of extra) h.db.insert('plan_tasks', { ...template, id, title: `Test ${id}`, due_at: due, status: 'pending', completed_at: null });
  try {
    const m = client(h.app);
    await m.login(PRIYA, DEMO_PASSWORDS.member);
    const me = (await m.get('/api/me')).json as { todaysActions: Array<{ id: string; due_at: string | null; overdue: boolean }>; todaysActionsTotal: number };
    const due = pending().filter((t) => !t.due_at || dateInZone(t.due_at) <= today);
    assert.equal(me.todaysActionsTotal, due.length, 'every pending task due today or earlier is counted');
    assert.ok(me.todaysActions.length <= 6, 'the list keeps its cap');
    assert.ok(me.todaysActionsTotal > me.todaysActions.length, 'the check can fail: more tasks are due than the card lists');
    for (const t of me.todaysActions) assert.equal(t.overdue, !!t.due_at && dateInZone(t.due_at) < today, `${t.id}: overdue flag`);
    const firstOverdue = me.todaysActions.findIndex((t) => t.overdue);
    const todays = due.filter((t) => !t.due_at || dateInZone(t.due_at) === today);
    assert.equal(firstOverdue === -1 ? me.todaysActions.length : firstOverdue, Math.min(6, todays.length), "today's tasks come first, all of them that fit");
    assert.ok(me.todaysActions.slice(0, firstOverdue).some((t) => t.id === 'tsk_test_early_today'), '01:30 India time today is today');
    const overdue = me.todaysActions.filter((t) => t.overdue);
    assert.ok(overdue.every((t, i) => i === 0 || Date.parse(overdue[i - 1]!.due_at!) >= Date.parse(t.due_at!)), 'overdue tasks newest first');
    assert.ok(me.todaysActions.every((t, i) => i < firstOverdue || firstOverdue === -1 || t.overdue), 'no today task after an overdue one');
    if (todays.length < 6) assert.equal(overdue[0]?.id, 'tsk_test_late_yesterday', 'the most recent overdue task leads the overdue ones');
    assert.ok(!me.todaysActions.some((t) => t.id === 'tsk_test_old_1') || todays.length + overdue.length <= 6, 'the oldest overdue task gives way first');
  } finally {
    for (const [id] of extra) h.db.run('DELETE FROM plan_tasks WHERE id = ?', [id]);
  }
});

test('member documents: India times and dates in words, no internal setting names, and a phone-width layout (portal-1, portal-2, portal-13, portal-m2, app-11)', async () => {
  assert.equal(istWhen('2026-10-30T13:30:00.000Z'), 'Fri 30 Oct 2026 at 19:00 IST');
  assert.equal(istDayLabel('2026-10-30T22:00:00.000Z'), 'Sat 31 Oct 2026', 'an early-morning India time is the next India day');
  assert.equal(istLongDate('2026-10-04T20:00:00.000Z'), '5 October 2026');
  assert.equal(istLongDateTime('2026-10-05T11:55:00.000Z'), '5 October 2026, 17:25 IST');
  const m = client(h.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member);
  const reports = (await m.get('/api/me/reports')).json.items as Array<{ id: string }>;
  assert.ok(reports.length, 'the demo member has a released report');
  const t = await m.post(`/api/reports/${reports[0]!.id}/file-token`);
  const page = await client(h.app).get(`/api/reports/file?token=${encodeURIComponent(String(t.json.token))}`);
  assert.equal(page.status, 200);
  const shown = page.text.replace(/<style[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(shown, /UTC/, 'no UTC times');
  assert.doesNotMatch(shown, /\d{4}-\d\d-\d\d/, 'no raw ISO dates');
  assert.match(shown, /<h1>Your \d{1,2} [A-Z][a-z]+ \d{4} results, explained\.<\/h1>/);
  assert.match(shown, /(Collection time|Sample collected)<\/span>\d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d IST/);
  assert.match(shown, /Generated \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d IST/);
  assert.match(page.text, /<div class="tableWrap"><table><thead><tr><th>Marker<\/th>/, 'the marker table scrolls inside its own box on a phone');
  assert.match(page.text, /@media screen and \(max-width:640px\)\{\.page\{margin:0;padding:6mm\}/, 'a small-screen rule (screen only: print is unchanged)');
  assert.match(page.text, /@media print\{body\{background:#fff\}\.page\{box-shadow:none;margin:0\}/, 'the print rule keeps its look');
});

test('the payment and package-end notices name the end date as an India day in words, never a date cut from UTC (portal-13)', async () => {
  const ISO = /\d{4}-\d\d-\d\d/;
  const DAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4}';
  // the demo's own paid orders
  const seeded = h.db.all<{ body: string }>("SELECT body FROM notifications WHERE title = 'Payment received'");
  assert.ok(seeded.length, 'the demo has paid orders');
  for (const n of seeded) assert.doesNotMatch(n.body, ISO, n.body);
  assert.ok(seeded.some((n) => new RegExp(`is active from today until ${DAY}\\. `).test(n.body)), 'a package with an end date names it in words');
  // a package bought at 01:30 India time: the UTC date is still the day before, the notice names the India day
  const memberId = userId(h.ctx, DEMO.memberIncomplete);
  const m = client(h.app);
  await m.login(DEMO.memberIncomplete, DEMO_PASSWORDS.member);
  const checkout = await m.post('/api/me/checkout', { packageId: 'core', idempotencyKey: 'portal-13-india-day' });
  assert.equal(checkout.status, 201);
  const orderId = (checkout.json.order as { id: string }).id;
  const boughtAt = new Date(Date.parse(`${dateInZone(h.ctx.now())}T01:30:00+05:30`)).toISOString();
  h.db.run("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?", [boughtAt, orderId]); // paid; activation below, on the 01:30 clock
  const { programmeId } = orders.activateOrder({ ...h.ctx, now: () => boughtAt }, orderId);
  const endAt = h.db.get<{ end_at: string }>('SELECT end_at FROM programmes WHERE id = ?', [programmeId])!.end_at;
  assert.notEqual(dateInZone(endAt), endAt.slice(0, 10), 'the check can fail: the India day and the UTC date differ');
  const paid = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND title = 'Payment received' AND json_extract(data, '$.orderId') = ?", [memberId, orderId])!;
  assert.match(paid.body, new RegExp(`^Core is active from today until ${istDayLabel(endAt)}\\. `));
  assert.doesNotMatch(paid.body, ISO);
  // the notice a week before the end, for an end at 01:30 India time three days from now
  const endsSoon = new Date(Date.parse(`${dateInZone(addDays(h.ctx.now(), 3))}T01:30:00+05:30`)).toISOString();
  h.db.run('UPDATE programmes SET end_at = ? WHERE id = ?', [endsSoon, programmeId]);
  assert.notEqual(dateInZone(endsSoon), endsSoon.slice(0, 10));
  orders.expireProgrammes(h.ctx);
  const notice = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND category = 'package_expiry' AND json_extract(data, '$.programmeId') = ? AND json_extract(data, '$.notice') = 1", [memberId, programmeId]);
  assert.ok(notice, 'the member is told the package ends soon');
  assert.match(notice.body, new RegExp(`^It ends on ${istDayLabel(endsSoon)}\\. Unused consultations`));
  assert.match(notice.body, new RegExp(`^It ends on ${DAY}\\.`));
  assert.doesNotMatch(notice.body, ISO);
});
