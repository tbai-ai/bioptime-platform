/* Exercise media served by the Bioptime server (30 October 2026; api/domain/exerciseMedia.ts): importing a folder of
   clips and posters (hashed names, the manifest, refusals, merge and pruning, the command line), verifying them, the
   status the library and the player show, and GET /public/media/exercises/:file: the whole file, byte ranges (206),
   unsatisfiable ranges (416), ETag revalidation (304), HEAD, exact headers, never compressed, and 404 for every name
   the manifest does not list, for paths, and while EXERCISE_MEDIA=none. Minimal MP4 and JPEG files
   (tests/exerciseMediaFixture.ts) stand in for the transcoded clips. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeApp } from '../helpers.js';
import { RIGHTS, jpeg, mp4, tempDir } from '../exerciseMediaFixture.js';
import { API_ROOT } from '../../src/config.js';
import * as media from '../../src/domain/exerciseMedia.js';
import { byteRange } from '../../src/http/routes/media.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A source folder with two clips, two posters and its manifest. */
function sourceFolder(): { dir: string; squats: Buffer; plank: Buffer; squatsPoster: Buffer } {
  const dir = tempDir('src');
  const squats = mp4(1280, 720, 5.5, { seed: 1 }), plank = mp4(1280, 720, 6, { seed: 2 }), squatsPoster = jpeg(3);
  fs.writeFileSync(path.join(dir, 'squats.mp4'), squats);
  fs.writeFileSync(path.join(dir, 'squats.jpg'), squatsPoster);
  fs.writeFileSync(path.join(dir, 'plank.mp4'), plank);
  fs.writeFileSync(path.join(dir, 'plank.jpg'), jpeg(4));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ items: [
    { key: 'squats', video: 'squats.mp4', poster: 'squats.jpg', width: 1280, height: 720, rights: RIGHTS, source: 'earlier app, videos/squats.mp4' },
    { key: 'plank', video: 'plank.mp4', poster: 'plank.jpg', rights: RIGHTS, source: 'earlier app, videos/plank.mp4' },
  ] }));
  return { dir, squats, plank, squatsPoster };
}

let h: Awaited<ReturnType<typeof makeApp>>;
let off: Awaited<ReturnType<typeof makeApp>>;
let mediaDir: string;
let src: ReturnType<typeof sourceFolder>;
before(async () => {
  mediaDir = tempDir('served');
  src = sourceFolder();
  h = await makeApp({ seed: false, env: { EXERCISE_MEDIA_DIR: mediaDir } });
  off = await makeApp({ seed: false, env: { EXERCISE_MEDIA_DIR: mediaDir, EXERCISE_MEDIA: 'none' } });
});
after(async () => {
  for (const x of [h, off]) { await x.app.close(); x.db.close(); }
});

const get = (url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET', app = h.app) => app.inject({ method, url, headers });
const url = (name: string) => `/api/public/media/exercises/${name}`;
const item = (key: string) => media.manifestItems(h.config).find((i) => i.key === key)!;

test('before anything is imported the media are pending and name the missing manifest; nothing is served', async () => {
  const s = media.status(h.ctx);
  assert.equal(s.status, 'pending_configuration');
  assert.match(s.missing[0]!, /exercise media manifest .*manifest\.json was not found/);
  assert.equal(s.note, media.TEXT_ONLY_NOTE);
  assert.equal(media.mediaFor(h.ctx, 'squats'), null);
  assert.equal(media.has(h.ctx, 'squats'), false);
  assert.equal((await get(url('squats.00000000.mp4'))).statusCode, 404);
});

test('import: hashed names, sizes and lengths read from the files, the manifest; again changes nothing; then the media are available', () => {
  const r = media.importExercises(h.config, src.dir);
  assert.equal(r.version, 1);
  assert.equal(r.items, 2);
  assert.equal(r.written.length, 4);
  assert.deepEqual(r.warnings, []);
  const sq = item('squats');
  assert.equal(sq.video, `squats.${sha(src.squats).slice(0, 8)}.mp4`);
  assert.equal(sq.poster, `squats.${sha(src.squatsPoster).slice(0, 8)}.jpg`);
  assert.deepEqual({ bytes: sq.bytes, sha256: sq.sha256, width: sq.width, height: sq.height, durationSeconds: sq.durationSeconds, rights: sq.rights }, { bytes: src.squats.length, sha256: sha(src.squats), width: 1280, height: 720, durationSeconds: 5.5, rights: RIGHTS });
  assert.equal(item('plank').durationSeconds, 6, 'read from the clip when the folder does not say');
  assert.deepEqual(fs.readdirSync(mediaDir).sort(), [item('plank').poster, item('plank').video, 'manifest.json', sq.poster, sq.video].sort());
  assert.deepEqual(fs.readFileSync(path.join(mediaDir, sq.video)), src.squats);

  const again = media.importExercises(h.config, src.dir);
  assert.equal(again.version, 2);
  assert.deepEqual(again.written, [], 'identical files are not written again');
  assert.deepEqual(again.pruned, []);

  const s = media.status(h.ctx);
  assert.deepEqual(s, { status: 'available', missing: [], note: media.AVAILABLE_NOTE });
  assert.doesNotMatch(s.note, /fitterify/i, 'the note names no earlier brand');
  assert.match(s.note, /generated video, not filmed/);
  assert.ok(media.has(h.ctx, 'squats'));
  assert.deepEqual(media.mediaFor(h.ctx, 'squats'), { videoUrl: `/api/public/media/exercises/${sq.video}`, posterUrl: `/api/public/media/exercises/${sq.poster}`, width: 1280, height: 720, durationSeconds: 5.5 });
  assert.equal(media.mediaFor(h.ctx, 'kettlebell-swings'), null, 'a key the manifest does not list has no media');
  assert.equal(media.mediaFor(h.ctx, null), null);
  assert.equal(media.mediaFor(off.ctx, 'squats'), null, 'nothing while EXERCISE_MEDIA=none');
  assert.ok(media.has(off.ctx, 'squats'), 'an administrator may still map a listed clip while they are off');
  assert.deepEqual(media.status(off.ctx), { status: 'pending_configuration', missing: ['Exercise media is switched off (EXERCISE_MEDIA=none)'], note: media.TEXT_ONLY_NOTE });
  assert.deepEqual(media.verifyExercises(h.config), { ok: true, items: 2, bytes: [...media.manifestItems(h.config)].reduce((n, i) => n + i.bytes + i.posterBytes, 0), problems: [] });
});

test('GET: the whole file with exact headers, never compressed', async () => {
  const sq = item('squats');
  const r = await get(url(sq.video), { 'accept-encoding': 'gzip, br' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.rawPayload, src.squats);
  assert.equal(r.headers['content-type'], 'video/mp4');
  assert.equal(r.headers['content-length'], String(src.squats.length));
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.headers.etag, `"sha256-${sha(src.squats).slice(0, 16)}"`);
  assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-encoding'], undefined);
  const p = await get(url(sq.poster));
  assert.equal(p.statusCode, 200);
  assert.equal(p.headers['content-type'], 'image/jpeg');
  assert.deepEqual(p.rawPayload, src.squatsPoster);
  assert.equal(p.headers.etag, `"sha256-${sha(src.squatsPoster).slice(0, 16)}"`);
});

test('ranges: 206 with Content-Range and Content-Length (first bytes, open end, suffix, clamped end); 416 outside the file; several ranges or another unit send the whole file', async () => {
  const sq = item('squats');
  const size = src.squats.length;
  const part = async (range: string, start: number, end: number) => {
    const r = await get(url(sq.video), { range, 'accept-encoding': 'gzip' });
    assert.equal(r.statusCode, 206, range);
    assert.equal(r.headers['content-range'], `bytes ${start}-${end}/${size}`, range);
    assert.equal(r.headers['content-length'], String(end - start + 1), range);
    assert.deepEqual(r.rawPayload, src.squats.subarray(start, end + 1), range);
    assert.equal(r.headers.etag, `"sha256-${sha(src.squats).slice(0, 16)}"`);
    assert.equal(r.headers['content-encoding'], undefined);
  };
  await part('bytes=0-99', 0, 99);
  await part('bytes=100-', 100, size - 1);
  await part('bytes=-50', size - 50, size - 1);
  await part(`bytes=10-${size + 500}`, 10, size - 1);
  await part('bytes=0-0', 0, 0);
  for (const range of [`bytes=${size}-`, `bytes=${size + 10}-${size + 20}`, 'bytes=50-10', 'bytes=abc', 'bytes=-0', 'bytes=']) {
    const r = await get(url(sq.video), { range });
    assert.equal(r.statusCode, 416, range);
    assert.equal(r.headers['content-range'], `bytes */${size}`, range);
    assert.equal(r.json().error.code, 'RANGE_NOT_SATISFIABLE');
  }
  for (const range of ['bytes=0-10, 20-30', 'items=0-10']) {
    const r = await get(url(sq.video), { range });
    assert.equal(r.statusCode, 200, range);
    assert.equal(r.rawPayload.length, size);
  }
  assert.deepEqual(byteRange(undefined, 10), null);
  assert.deepEqual(byteRange('bytes=-20', 10), { start: 0, end: 9 }, 'a suffix longer than the file is the whole file');
});

test('revalidation: If-None-Match answers 304 (strong or weak, or *); If-Range of another version sends the whole file', async () => {
  const sq = item('squats');
  const etag = `"sha256-${sha(src.squats).slice(0, 16)}"`;
  for (const inm of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
    const r = await get(url(sq.video), { 'if-none-match': inm });
    assert.equal(r.statusCode, 304, inm);
    assert.equal(r.rawPayload.length, 0);
    assert.equal(r.headers.etag, etag);
  }
  assert.equal((await get(url(sq.video), { 'if-none-match': '"sha256-0000000000000000"' })).statusCode, 200);
  assert.equal((await get(url(sq.video), { range: 'bytes=0-9', 'if-range': etag })).statusCode, 206);
  const stale = await get(url(sq.video), { range: 'bytes=0-9', 'if-range': '"sha256-0000000000000000"' });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.rawPayload.length, src.squats.length);
});

test('HEAD answers with the headers and no body', async () => {
  const sq = item('squats');
  const r = await get(url(sq.video), {}, 'HEAD');
  assert.equal(r.statusCode, 200);
  assert.equal(r.rawPayload.length, 0);
  assert.equal(r.headers['content-length'], String(src.squats.length));
  assert.equal(r.headers['accept-ranges'], 'bytes');
  const ranged = await get(url(sq.video), { range: 'bytes=0-9' }, 'HEAD');
  assert.equal(ranged.statusCode, 206);
  assert.equal(ranged.rawPayload.length, 0);
});

test('404 for every name the manifest does not list, for paths and encoded paths, and while EXERCISE_MEDIA=none', async () => {
  const sq = item('squats');
  // a file of the hashed form in the folder that the manifest does not name
  const stray = `stray.${'a'.repeat(8)}.mp4`;
  fs.writeFileSync(path.join(mediaDir, stray), mp4(16, 16, 1));
  try {
    for (const name of [stray, 'manifest.json', 'squats.mp4', `squats.${'0'.repeat(8)}.mp4`, '..%2Fmanifest.json', '%2E%2E%2F%2E%2E%2Fpackage.json', `..%2F${path.basename(mediaDir)}%2F${sq.video}`, sq.video.toUpperCase(), `${sq.video}%00`]) {
      const r = await get(url(name));
      assert.equal(r.statusCode, 404, name);
    }
    // (a URL whose dot segments resolve back to the same name is the same URL: clients normalise it before sending)
    for (const raw of [`/api/public/media/exercises/%2E%2E/${sq.video}`, `/api/public/media/exercises/sub/${sq.video}`]) {
      const r = await get(raw);
      assert.ok(r.statusCode === 404 || r.headers['content-type'] !== 'video/mp4', `${raw} never reaches a file through a path`);
    }
  } finally { fs.rmSync(path.join(mediaDir, stray)); }
  const r = await get(url(sq.video), {}, 'GET', off.app);
  assert.equal(r.statusCode, 404, 'switched off');
  assert.equal(r.json().error.code, 'NOT_FOUND');
});

test('a missing or changed file makes the media pending, naming the file; media:verify finds a changed file by its hash', async () => {
  const pl = item('plank');
  const file = path.join(mediaDir, pl.poster);
  const bytes = fs.readFileSync(file);
  fs.renameSync(file, `${file}.away`);
  try {
    const s = media.status(h.ctx);
    assert.equal(s.status, 'pending_configuration');
    assert.ok(s.missing.some((m) => m.includes(pl.poster) && m.includes('missing')), JSON.stringify(s.missing));
    assert.equal(media.mediaFor(h.ctx, 'squats'), null, 'no URLs while the set is incomplete');
    assert.equal((await get(url(pl.poster))).statusCode, 404);
    assert.equal((await get(url(item('squats').video))).statusCode, 200, 'files that are there are still served');
  } finally { fs.renameSync(`${file}.away`, file); }
  // same size, other bytes: only the full hash sees it
  const changed = Buffer.from(bytes);
  changed[100] = changed[100]! ^ 0xff;
  fs.writeFileSync(file, changed);
  try {
    const v = media.verifyExercises(h.config);
    assert.equal(v.ok, false);
    assert.ok(v.problems.some((p) => p.includes(pl.poster) && /SHA-256/.test(p)), JSON.stringify(v.problems));
  } finally { fs.writeFileSync(file, bytes); }
  assert.equal(media.verifyExercises(h.config).ok, true);
  assert.equal(media.status(h.ctx).status, 'available');
});

test('import refuses a wrong folder before writing anything, merges on request and prunes files no longer named', () => {
  const before = fs.readFileSync(path.join(mediaDir, 'manifest.json'), 'utf8');
  const refuse = (mutate: (dir: string) => void, why: RegExp) => {
    const f = sourceFolder();
    mutate(f.dir);
    assert.throws(() => media.importExercises(h.config, f.dir), why);
    assert.equal(fs.readFileSync(path.join(mediaDir, 'manifest.json'), 'utf8'), before, 'nothing written');
  };
  refuse((d) => fs.writeFileSync(path.join(d, 'plank.mp4'), jpeg(9)), /plank\.mp4 \(plank\) is not an MP4 with a video track/);
  refuse((d) => fs.writeFileSync(path.join(d, 'squats.jpg'), mp4(10, 10, 1)), /squats\.jpg \(squats\) is not a JPEG/);
  refuse((d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.items[0].width = 1920; fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); }, /is 1280×720, not 1920×720/);
  refuse((d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.items[1].key = 'Plank Hold'; fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); }, /key/);
  refuse((d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.items[1].key = 'squats'; fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); }, /squats appears twice/);
  refuse((d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); m.items[0].video = '../squats.mp4'; fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); }, /video/);
  refuse((d) => { const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); delete m.items[0].rights; fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(m)); }, /rights/);

  // a clip whose index comes after its data is accepted with a warning
  const late = tempDir('late');
  fs.writeFileSync(path.join(late, 'lunges.mp4'), mp4(1280, 720, 5, { seed: 5, moovLast: true }));
  fs.writeFileSync(path.join(late, 'lunges.jpg'), jpeg(6));
  fs.writeFileSync(path.join(late, 'manifest.json'), JSON.stringify({ items: [{ key: 'lunges', video: 'lunges.mp4', poster: 'lunges.jpg', rights: RIGHTS, source: 'earlier app, videos/lunges.mp4' }] }));
  const merged = media.importExercises(h.config, late, { merge: true });
  assert.equal(merged.items, 3, 'merge keeps squats and plank');
  assert.equal(merged.warnings.length, 1);
  assert.match(merged.warnings[0]!, /network-optimised/);
  assert.ok(media.has(h.ctx, 'lunges') && media.has(h.ctx, 'squats'));

  // without merge the folder is the whole set: lunges goes, and so do its files
  const lunges = item('lunges');
  const whole = media.importExercises(h.config, src.dir);
  assert.equal(whole.items, 2);
  assert.deepEqual(whole.pruned.sort(), [lunges.poster, lunges.video].sort());
  assert.ok(!fs.existsSync(path.join(mediaDir, lunges.video)));
  assert.equal(media.has(h.ctx, 'lunges'), false);
});

test('the command line: media:import-exercises and media:verify (files only, no database)', () => {
  const dir = tempDir('cli');
  const f = sourceFolder();
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', path.join(API_ROOT, 'src', 'cli.ts'), ...args], { cwd: API_ROOT, env: { ...process.env, EXERCISE_MEDIA_DIR: dir, BIOPTIME_MODE: 'demo', DATABASE_PATH: path.join(dir, 'never.sqlite') }, encoding: 'utf8', timeout: 90_000 });
  const imp = run('media:import-exercises', '--from', f.dir);
  assert.equal(imp.status, 0, imp.stderr);
  assert.match(imp.stdout, /manifest version 1: 2 exercises, .* 4 files written, 0 old files removed/);
  const ok = run('media:verify');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^ok: 2 exercises/m);
  const usage = run('media:import-exercises');
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /usage: media:import-exercises --from <folder>/);
  const video = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).items[0].video as string;
  fs.appendFileSync(path.join(dir, video), Buffer.from([0]));
  const bad = run('media:verify');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /does not match the manifest/);
  assert.ok(!fs.existsSync(path.join(dir, 'never.sqlite')), 'no database was opened');
});
