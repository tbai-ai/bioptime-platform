/* A folder of exercise clips and posters for the tests (api/domain/exerciseMedia.ts): minimal MP4 files (ftyp, moov
   with mvhd and one video tkhd, mdat) and JPEG files, with the folder's manifest.json, in temporary folders that are
   removed when the process exits. They stand in for the transcoded clips; nothing here is a real video. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

/** An MP4 of the given size and length; moovLast puts the index after the media data (not network-optimised). */
export function mp4(width: number, height: number, seconds: number, opts: { seed?: number; moovLast?: boolean } = {}): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16); // duration
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const ftyp = box('ftyp', Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomavc1'));
  const moov = box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd)));
  const data = Buffer.alloc(3000);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (opts.seed ?? 1) * 7) & 0xff;
  const mdat = box('mdat', data);
  return Buffer.concat(opts.moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

export const jpeg = (seed: number): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, seed), Buffer.from([0xff, 0xd9])]);

export const RIGHTS = 'owner-confirmed-2026-10-30';

const roots: string[] = [];
let cleanup = false;
/** A new empty temporary folder, removed when the process exits. */
export function tempDir(name: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bioptime-media-${name}-`));
  roots.push(d);
  if (!cleanup) { cleanup = true; process.once('exit', () => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* gone */ } } }); }
  return d;
}

/** A source folder with clips and posters for the given keys (default squats and plank) and its manifest.json. */
export function sourceFolder(keys: string[] = ['squats', 'plank']): { dir: string; files: Record<string, { video: Buffer; poster: Buffer }> } {
  const dir = tempDir('src');
  const files: Record<string, { video: Buffer; poster: Buffer }> = {};
  keys.forEach((key, i) => {
    files[key] = { video: mp4(1280, 720, 5 + i * 0.5, { seed: i + 1 }), poster: jpeg(i + 3) };
    fs.writeFileSync(path.join(dir, `${key}.mp4`), files[key]!.video);
    fs.writeFileSync(path.join(dir, `${key}.jpg`), files[key]!.poster);
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ items: keys.map((key) => ({ key, video: `${key}.mp4`, poster: `${key}.jpg`, rights: RIGHTS, source: `earlier app, videos/${key}.mp4` })) }));
  return { dir, files };
}
