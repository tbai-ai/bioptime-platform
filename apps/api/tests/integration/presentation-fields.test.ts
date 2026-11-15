/* Presentation fields for the member app's Store and Tests (30 October 2026, 0043_presentation_fields.sql): a package
   version's picture, compare at price and accent colour, and a blood test's picture, tags and featured mark. Absent,
   they read as null (and no tags, not featured); each is checked when set (the picture must be in the asset library,
   the compare at price above the price, the accent one of three colours); a revision carries them on; and a picture in
   use by a package's current version or by a blood test cannot be deleted from the library. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, type Client } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { AppError } from '../../src/lib/errors.js';
import { uploadAsset } from '../../src/domain/assets.js';
import * as packages from '../../src/domain/packages.js';
import * as bloodwork from '../../src/domain/bloodwork.js';

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** The same picture with a few bytes after its end, so the library keeps it as an asset of its own (it keeps one asset
 *  per content hash). */
const png = (tail: string) => Buffer.concat([Buffer.from(PNG_1x1, 'base64'), Buffer.from(tail)]).toString('base64');

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const admin = async (): Promise<Client> => { const c = client(h.app); await c.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true); return c; };
const code = (fn: () => unknown): string => { try { fn(); } catch (e) { return e instanceof AppError ? ((e.details as { code?: string } | undefined)?.code ?? e.code) : String(e); } return 'no error'; };
const detail = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code ?? r.json.error?.code;
const version = { durationMonths: 3, durationLabel: '3 months', consultations: 3, bloodworkEntitlements: 1, priceInr: 9999, coaching: 'standard' as const, forSale: true };

type Presented = { slug: string; version: { priceInr: number; imageAssetId: string | null; imageUrl: string | null; compareAtPricePaise: number | null; compareAtPriceInr: number | null; accent: string | null } };

test('absent, the fields read as null on every package and blood test, and as no tags and not featured', async () => {
  const anon = client(h.app);
  const list = (await anon.get('/api/packages')).json.items as Presented[];
  assert.ok(list.length > 0);
  for (const p of list) assert.deepEqual([p.version.imageAssetId, p.version.imageUrl, p.version.compareAtPricePaise, p.version.compareAtPriceInr, p.version.accent], [null, null, null, null, null], p.slug);
  const one = (await anon.get(`/api/packages/${list[0]!.slug}`)).json as Presented;
  assert.equal(one.version.compareAtPriceInr, null);
  const m = client(h.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member);
  const tests = (await m.get('/api/me/bloodwork/tests')).json.items as Array<{ imageUrl: string | null; imageAssetId: string | null; tags: string[]; featured: boolean }>;
  assert.ok(tests.length > 0);
  for (const t of tests) assert.deepEqual([t.imageAssetId, t.imageUrl, t.tags, t.featured], [null, null, [], false]);
  assert.ok(((await anon.get('/api/bloodwork/tests')).json.items as Array<{ featured: boolean }>).every((t) => t.featured === false), 'the public catalogue too');
});

test('a package version takes a picture, a compare at price above the price and an accent; each is checked; a revision carries them on', async () => {
  const owner = as(DEMO.owner);
  const picture = uploadAsset(owner, { filename: 'store-card.png', dataBase64: PNG_1x1, alt: 'Store card' });
  const made = packages.createPackage(owner, { slug: 'test-presentation', name: 'Test presentation', kind: 'package', ...version, imageAssetId: picture.id, compareAtPricePaise: 1_299_900, accent: 'gold' }, 'test: presentation');
  assert.deepEqual([made.version!.imageAssetId, made.version!.imageUrl, made.version!.compareAtPricePaise, made.version!.compareAtPriceInr, made.version!.accent], [picture.id, `/api/public/assets/${picture.id}`, 1_299_900, 12_999, 'gold']);
  const anon = client(h.app);
  const listed = ((await anon.get('/api/packages')).json.items as Presented[]).find((p) => p.slug === 'test-presentation')!;
  assert.deepEqual([listed.version.imageUrl, listed.version.compareAtPriceInr, listed.version.accent, listed.version.priceInr], [picture.url, 12_999, 'gold', 9999]);
  assert.equal((await anon.get(listed.version.imageUrl!)).status, 200, 'the picture is served');

  const create = (extra: Record<string, unknown>, slug: string) => code(() => packages.createPackage(owner, { slug, name: 'Test refused', kind: 'package', ...version, ...extra } as Parameters<typeof packages.createPackage>[1], 'test'));
  assert.equal(create({ imageAssetId: 'ast_missing' }, 'test-r1'), 'ASSET_UNKNOWN');
  assert.equal(create({ compareAtPricePaise: 999_900 }, 'test-r2'), 'COMPARE_AT_NOT_ABOVE_PRICE', 'equal to the price');
  assert.equal(create({ compareAtPricePaise: 500_000 }, 'test-r3'), 'COMPARE_AT_NOT_ABOVE_PRICE', 'below the price');
  assert.equal(create({ priceInr: null, forSale: false, compareAtPricePaise: 500_000 }, 'test-r4'), 'COMPARE_AT_NOT_ABOVE_PRICE', 'without a price');
  assert.equal(create({ compareAtPricePaise: 1_000_000.5 }, 'test-r5'), 'COMPARE_AT_INVALID');
  assert.equal(create({ accent: 'green' }, 'test-r6'), 'ACCENT_INVALID');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM packages WHERE slug LIKE 'test-r%'")!.n, 0, 'nothing refused was stored');
  const pkgId = made.id;
  assert.throws(() => h.db.run('UPDATE package_versions SET accent = ? WHERE package_id = ?', ['green', pkgId]), /CHECK/, 'the database holds the same rule');
  assert.throws(() => h.db.run('UPDATE package_versions SET compare_at_price_paise = 50 WHERE package_id = ?', [pkgId]), /CHECK/);

  // a revision of other terms keeps them; raising the price to the compare at price is refused until it changes too
  const revised = packages.revisePackage(owner, pkgId, { consultations: 4 }, 'test: one more consultation');
  assert.deepEqual([revised.version!.version, revised.version!.imageAssetId, revised.version!.compareAtPricePaise, revised.version!.accent], [2, picture.id, 1_299_900, 'gold']);
  assert.equal(code(() => packages.revisePackage(owner, pkgId, { priceInr: 12_999 }, 'test: price up')), 'COMPARE_AT_NOT_ABOVE_PRICE');
  const cleared = packages.revisePackage(owner, pkgId, { priceInr: 12_999, compareAtPricePaise: null, accent: null }, 'test: price up, no struck price');
  assert.deepEqual([cleared.version!.priceInr, cleared.version!.compareAtPriceInr, cleared.version!.accent, cleared.version!.imageAssetId], [12_999, null, null, picture.id]);
  const audit = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'package.revise' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [pkgId])!;
  assert.deepEqual(JSON.parse(audit.data).changes, { priceInr: 12_999, compareAtPricePaise: null, accent: null }, 'the revision is audited with what changed');
});

test('a picture in use by a package’s current version or by a blood test cannot be deleted; once replaced (or only in history) it can', async () => {
  const owner = as(DEMO.owner);
  const a = await admin();
  const first = uploadAsset(owner, { filename: 'package-first.png', dataBase64: png('first'), alt: 'First' });
  const second = uploadAsset(owner, { filename: 'package-second.png', dataBase64: png('second'), alt: 'Second' });
  const pkg = packages.createPackage(owner, { slug: 'test-picture-in-use', name: 'Test picture in use', kind: 'package', ...version, imageAssetId: first.id }, 'test: picture');
  const refused = await a.del(`/api/admin/assets/${first.id}?reason=test%3A+remove`);
  assert.equal(detail(refused), 'ASSET_IN_USE');
  assert.match(refused.json.error!.message, /the package “Test picture in use”/);
  assert.deepEqual((refused.json.error!.details as { packages: Array<{ id: string }> }).packages.map((p) => p.id), [pkg.id]);

  // a new version with another picture: the first is only in history now, so it can go
  packages.revisePackage(owner, pkg.id, { imageAssetId: second.id }, 'test: new picture');
  assert.equal((await a.del(`/api/admin/assets/${first.id}?reason=test%3A+remove`)).status, 200);
  // an archived package cannot be revised to free its picture, so it does not hold it
  packages.archivePackage(owner, pkg.id, 'test: archive');
  assert.equal((await a.del(`/api/admin/assets/${second.id}?reason=test%3A+remove`)).status, 200);
  assert.equal(code(() => packages.revisePackage(owner, packages.listPackages(owner)[0]!.id, { imageAssetId: second.id }, 'test: a deleted picture')), 'ASSET_UNKNOWN', 'a deleted picture cannot be chosen');

  // a blood test: a picture, tags and the featured mark, on the member's and the public catalogue
  const test0 = bloodwork.listTests(owner)[0]!;
  const third = uploadAsset(owner, { filename: 'test-card.png', dataBase64: png('third'), alt: 'Card' });
  const set = bloodwork.setTestPresentation(owner, String(test0.id), { imageAssetId: third.id, tags: [' Fasting ', 'Heart', 'fasting', 'Morning'], featured: true }, 'test: card');
  assert.deepEqual([set.imageUrl, set.tags, set.featured], [third.url, ['Fasting', 'Heart', 'Morning'], true], 'tags trimmed, the first spelling of a repeated one kept');
  const m = client(h.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member);
  const mine = ((await m.get('/api/me/bloodwork/tests')).json.items as Array<{ id: string; imageUrl: string | null; tags: string[]; featured: boolean }>).find((t) => t.id === test0.id)!;
  assert.deepEqual([mine.imageUrl, mine.tags, mine.featured], [third.url, ['Fasting', 'Heart', 'Morning'], true]);
  assert.equal(((await client(h.app).get('/api/bloodwork/tests')).json.items as Array<{ id: string; featured: boolean }>).find((t) => t.id === test0.id)!.featured, true);
  const kept = bloodwork.setTestPresentation(owner, String(test0.id), { featured: false }, 'test: not featured');
  assert.deepEqual([kept.imageUrl, kept.tags, kept.featured], [third.url, ['Fasting', 'Heart', 'Morning'], false], 'omitted fields stay as they are');
  assert.equal(code(() => bloodwork.setTestPresentation(owner, String(test0.id), { tags: Array.from({ length: 13 }, (_, i) => `tag ${i}`) })), 'TAGS_INVALID');
  assert.equal(code(() => bloodwork.setTestPresentation(owner, String(test0.id), { tags: ['x'.repeat(41)] })), 'TAGS_INVALID');
  assert.equal(code(() => bloodwork.setTestPresentation(owner, String(test0.id), { imageAssetId: 'ast_missing' })), 'ASSET_UNKNOWN');
  assert.equal(code(() => bloodwork.setTestPresentation(owner, 'tst_missing', { featured: true })), 'NOT_FOUND');
  const blocked = await a.del(`/api/admin/assets/${third.id}?reason=test%3A+remove`);
  assert.equal(detail(blocked), 'ASSET_IN_USE');
  assert.ok(blocked.json.error!.message.includes(`the blood test “${String(test0.name)}”`), blocked.json.error!.message);
  bloodwork.setTestPresentation(owner, String(test0.id), { imageAssetId: null }, 'test: no picture');
  assert.equal((await a.del(`/api/admin/assets/${third.id}?reason=test%3A+remove`)).status, 200);
  const audit = h.db.all<{ data: string }>("SELECT data FROM audit_events WHERE action = 'bloodwork.test_presentation'").map((r) => r.data).join(' ');
  assert.ok(!audit.includes('Heart'), 'the audit records how many tags, not the tags');
});
