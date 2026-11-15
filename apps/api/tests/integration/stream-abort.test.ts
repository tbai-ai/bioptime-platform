/* Regression test (25 October 2026, app-1): a client that closes the connection part-way through a file download (an
   <img> cancelled when a screen unmounts, a CORP-blocked image, a visitor leaving a page) must never take the API
   process down. Both streaming routes are covered: the private file download and the public image route. The files
   are larger than one read chunk (64 KiB), the precondition the crash needed. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { makeApp, userId, DEMO } from '../helpers.js';
import * as assets from '../../src/domain/assets.js';
import * as files from '../../src/domain/files.js';

let h: Awaited<ReturnType<typeof makeApp>>;
let port = 0;
// what crashed the real server: an error thrown after the response had started, outside any handler. Under the test
// runner it surfaces as an unhandled rejection or exception instead of an exit, so the test records and asserts on it.
const escaped: string[] = [];
const onEscape = (e: unknown) => { escaped.push(String((e as Error)?.message ?? e)); };
before(async () => {
  process.on('unhandledRejection', onEscape);
  process.on('uncaughtException', onEscape);
  h = await makeApp();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  port = (h.app.server.address() as { port: number }).port;
});
after(async () => { await h.app.close(); h.db.close(); process.off('unhandledRejection', onEscape); process.off('uncaughtException', onEscape); });

/** A PNG signature and IHDR header followed by filler: enough for the content sniffer, far bigger than one read chunk. */
function bigPng(bytes: number): Buffer {
  const head = Buffer.from('89504e470d0a1a0a0000000d49484452000000400000002808060000000000000000', 'hex');
  return Buffer.concat([head, randomBytes(bytes - head.length)]);
}

/** Sends a GET over a raw socket, reads the first chunk of the answer, then drops the connection. */
function abortAfterFirstChunk(target: string, extraHeaders = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\n${extraHeaders}\r\n`));
    s.once('data', (d) => { s.destroy(); resolve(d.toString('latin1').split('\r\n')[0]!); });
    s.on('error', reject);
  });
}

async function health(): Promise<number> {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`);
  await r.arrayBuffer();
  return r.status;
}

test('a download the client abandons part-way leaves the API running (private file download and public image)', async () => {
  const image = assets.uploadAsset(h.ctx, { filename: 'big.png', dataBase64: bigPng(600 * 1024).toString('base64'), alt: 'Filler image for the abort test' });
  const memberId = userId(h.ctx, DEMO.member);
  const member = { ...h.ctx, actor: { id: memberId, role: 'member' as const, email: DEMO.member, name: 'Member' } };
  const saved = files.savePrivateFile(member, { ownerId: memberId, kind: 'abort_test', buffer: bigPng(900 * 1024), allowedMimes: ['image/png'], maxBytes: 2 * 1024 * 1024 }) as { id: string };
  const { url: download } = files.fileToken(member, saved.id);
  assert.equal(await health(), 200);
  for (const target of [download, image.url, download, image.url, download, image.url]) {
    const status = await abortAfterFirstChunk(target);
    assert.match(status, / 200 /, `${target.split('?')[0]} starts answering before the client leaves`);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(await health(), 200, `the API still answers after an abandoned ${target.split('?')[0]}`);
  }
  // a complete download still arrives whole, exactly once
  for (const [target, size] of [[download, 900 * 1024], [image.url, 600 * 1024]] as const) {
    const r = await fetch(`http://127.0.0.1:${port}${target}`);
    assert.equal(r.status, 200);
    assert.equal((await r.arrayBuffer()).byteLength, size, `${target.split('?')[0]} arrives whole`);
  }
  assert.equal(await health(), 200);
  // a generated JSON file (a data export) travels compressed through a stream: abandoning that one is safe too
  const rows = Array.from({ length: 20000 }, (_, i) => ({ i, note: `entry ${i} ${'x'.repeat(30)}` }));
  const exported = files.saveGeneratedPrivateFile(member, { ownerId: memberId, kind: 'abort_test_export', content: JSON.stringify(rows), mime: 'application/json', name: 'export' }) as { id: string };
  const { url: exportUrl } = files.fileToken(member, exported.id);
  for (let i = 0; i < 3; i++) {
    assert.match(await abortAfterFirstChunk(exportUrl, 'Accept-Encoding: gzip\r\n'), / 200 /);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(await health(), 200, 'the API still answers after an abandoned compressed download');
  }
  const whole = await fetch(`http://127.0.0.1:${port}${exportUrl}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(whole.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(JSON.parse(await whole.text()), rows, 'the compressed export decodes whole'); // fetch decodes gzip itself
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(escaped, [], 'no error escaped the request handlers');
});
