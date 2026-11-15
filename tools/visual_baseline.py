#!/usr/bin/env python3
"""Visual-regression baselines for the Bioptime platform (Python 3.9, stdlib only, headless Google Chrome).

    python3 tools/visual_baseline.py capture --out ../docs/visual-baseline
    python3 tools/visual_baseline.py capture --out /tmp/vb-new --like ../docs/visual-baseline
    python3 tools/visual_baseline.py compare --base ../docs/visual-baseline --new /tmp/vb-new --out /tmp/vb-diff

capture   Screenshots every surface at 1440x900 (desktop), 768x1024 (tablet) and 390x844 (phone), device scale 1:
          the website on BASE (default http://localhost:3000), the three sign-in pages, the member workspace (demo
          member), the coach workspace (demo coach, incl. one client record and each of its tabs) and the admin
          workspace (demo owner, MFA code from GET /api/auth/demo/totp; the overview and every section in its nav).
          Pages that scroll are captured full length (in segments of SEGMENT px, stitched losslessly, capped at
          MAX_HEIGHT). Files are <out>/<surface>/<page>@<width>.png; <out>/index.json lists url, surface, page,
          width, height and sha256 for each, plus the clock used, the requests that were blocked and the data check.
compare   Decodes both PNG sets (zlib, all five PNG filters), compares RGBA per pixel with a per-channel
          tolerance and an anti-aliasing allowance, writes <out>/report.html (baseline, new and highlighted diff side
          by side), <out>/summary.json (changed-pixel ratio per image) and <out>/diff/**.png. Exit status 1 when any
          image differs by more than --max-ratio (default 0.002), or is missing on either side.

It reuses the headless Chrome driver of ~/Desktop/drive/tools/check_site.py (like tools/e2e_dashboard.py) on its
own DevTools port (9361, --cdp-port) with a fresh Chrome profile in .local/visual-baseline/ (--work DIR: the profile is
DIR/chrome-profile, deleted at the start of each capture, so two captures at once need two --work folders and ports).

    BASE=http://localhost:5860 python3 tools/visual_baseline.py capture --out /tmp/vb --like ../docs/visual-baseline \
        --only website --no-db --cdp-port 9462 --work /tmp/vb-work --offline
    python3 tools/visual_baseline.py compare --base ../docs/visual-baseline --new /tmp/vb --out /tmp/vb-diff --only website

--offline   no request leaves the machine: requests that go neither to BASE's host nor to a loopback host are refused,
            except Google Fonts, which are answered from the self-hosted copies in apps/dashboard/public/fonts (the
            stylesheet rebuilt by check_site.offline_fonts_css; an offline website capture compared with the online
            baseline: 30 of 33 identical, 3 within the threshold, the largest 6 px of gradient raster noise). Refused URLs
            are listed in index.json ("offline") and printed. Under reduced motion the website asks for nothing else.
            Chrome's own traffic (component updates, the variations seed, resource hints) does not pass through that
            guard, so Chrome is started with check_site's no_network_flags: background networking off, no proxy, and
            every host but loopback and BASE's host unresolvable. After the capture its profile is read for anything
            Chrome downloaded for itself (index.json "offline" -> "chrome_fetched"); any find is a capture problem.
compare --only   compares only the images whose surface or surface/page matches (the same globs as capture --only),
            so a website-only capture can be compared with the full baseline.

Stable frames: what capture does to every page, and why
  1. prefers-reduced-motion: reduce is emulated. The website's 3D hero/tour and the portal's 3D brand mark then
     show their flat SVG, smooth scrolling and counters stand down, and the auth-page orbs stop drifting.
  2. Fresh profile, HTTP cache disabled, cookies and storage cleared between accounts: every run starts equal.
  3. Each page is scrolled top to bottom once (lazy images switched to eager first) so scroll reveals and
     lazy images are in place, then back to the top; the capture waits for the load event, web fonts
     (document.fonts.ready), every image decoded, no skeletons (.bp-skel) and 600 ms without network traffic.
  4. Just before the screenshot: finite CSS/Web animations are finished and infinite ones cancelled, videos are
     paused at 0 s, the text caret is made transparent (an autofocused sign-in field blinks otherwise).
  5. The clock is frozen at the start of the baseline capture (--clock ISO to choose; --no-freeze turns 5 and 6 off):
     an init script shifts Date so that Date.now() == clock + time since navigation, and seeds Math.random. Without it
     the portal's relative times (relative() in apps/dashboard/src/lib/format.ts: "9 min ago" became "14 min ago",
     "6 h ago" became "7 h ago" between two test captures) and anything else computed from "now" change.
  6. What happened since the data cutoff (the moment the baseline capture began) is kept out of the pictures
     (stable_api): timestamps written since the cutoff read as the frozen clock, and the audit log answers leave
     out rows written since the cutoff, padded back to the length the page asked for. Every capture writes such
     rows: its three sign-ins (sessions, users.last_login_at, auth.login audit rows) and the access-log rows the API
     records when a member record is opened (member.record_viewed, health.viewed).
  Capture the comparison set with --like <baseline dir>: it reuses the baseline's clock and data cutoff.

Unstable pages found while building this (two captures 11 minutes apart with 5 and 6 switched off, 165 images):
135 identical, 27 within the threshold, 3 over it. Causes: admin/audit at every width (the list grows by each run's
own rows; up to 8% of the pixels), admin/analytics (a "generated at" time), admin/settings (the sessions' "last seen",
"6 h ago" -> "7 h ago"), and relative times ("9 min ago" -> "14 min ago") on admin/integrations-labstack,
admin/approvals, admin/assignments, admin/operations, coach/today, coach/profile and coach/client-record-notes;
website/programmes@390 differed below the tolerance only (raster noise).

Data safety: the browser runs with request interception. Every request other than GET/HEAD/OPTIONS is refused in the
browser (and listed in index.json) unless it is the sign-in or sign-out call, so no page can save, send, mark read or
book anything while it is captured. Sign-in uses the API directly (no form is submitted). With --db (default: the
demo database of the API on :3000, opened read-only) every table is snapshotted before and after the run and the
differences are reported; the only expected ones are the sessions and audit rows of the three sign-ins.

Accounts: the synthetic demo accounts of platform/README.md, valid only against the local demo API.
"""
import argparse
import base64
import datetime
import fnmatch
import hashlib
import html
import json
import os
import re
import select
import shutil
import sqlite3
import struct
import sys
import time
import urllib.parse
import zlib

sys.dont_write_bytecode = True   # importing check_site must not leave a cache file in the website's tools folder
HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.dirname(HERE)
DRIVE_TOOLS = os.path.join(os.path.dirname(os.path.dirname(PLATFORM)), 'drive', 'tools')

BASE = os.environ.get('BASE', 'http://localhost:3000').rstrip('/')
WORK = os.path.join(PLATFORM, '.local', 'visual-baseline')       # this tool's own folder: Chrome profile, run log (--work)
PORT_CDP = 9361                                                   # --cdp-port
FONTS_DIR = os.path.join(PLATFORM, 'apps', 'dashboard', 'public', 'fonts')   # self-hosted Montserrat / JetBrains Mono (--offline)
DB_DEFAULT = os.path.join(PLATFORM, 'apps', 'api', 'data', 'bioptime.sqlite')
VIEWPORTS = [(1440, 900, False), (768, 1024, True), (390, 844, True)]
SEGMENT = 8000          # px per screenshot segment (Chrome tiles repeat beyond ~16k px in one capture)
MAX_HEIGHT = 48000      # px; longer pages are cut here and flagged "truncated"

MEMBER = ('priya.nair@demo.bioptime.test', 'Demo-Member-2026!', 'client')
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!', 'coach')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!', 'admin')

WEBSITE = [('home', '/'), ('about', '/about'), ('programmes', '/programmes'), ('packages', '/packages'), ('coaching', '/coaching'),
           ('bloodwork', '/bloodwork'), ('how-it-works', '/how-it-works'), ('faq', '/faq'), ('contact', '/contact'), ('bespoke', '/bespoke'),
           ('login', '/login')]
SIGNIN = [('client', '/login/client'), ('coach', '/login/coach'), ('admin', '/login/admin')]
# sections each workspace must offer; the nav is read at run time and anything extra is captured too
EXPECT = {
    'client': ['home', 'program', 'bloodwork', 'appointments', 'progress', 'profile', 'bespoke', 'messages'],
    'coach': ['today', 'clients', 'calendar', 'bloodwork', 'messages', 'profile', 'settings'],
    'admin': ['overview', 'approvals', 'integrations-labstack', 'audit', 'content', 'theme', 'users', 'integrations', 'settings', 'analytics', 'operations'],
}
ROOT_NAME = {'client': 'home', 'coach': 'today', 'admin': 'overview'}

SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')
ALLOWED_WRITES = {('POST', '/api/auth/login'), ('POST', '/api/auth/logout')}

# --------------------------------------------------------------------------------------------- injected scripts
FREEZE_JS = r'''(() => {
  const FIXED = %d, SEED = 1234567;
  const RealDate = Date, t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const now = () => FIXED + Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  function FrozenDate(...a) {
    if (!new.target) return new RealDate(now()).toString();
    return a.length ? new RealDate(...a) : new RealDate(now());
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = now; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
  Object.defineProperty(FrozenDate, 'name', { value: 'Date' });
  window.Date = FrozenDate;
  let s = SEED >>> 0;
  Math.random = function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();'''

PREPARE_JS = r'''(() => { document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; }); return true; })()'''

READY_JS = r'''(async () => {
  if (document.fonts) await document.fonts.ready;
  const imgs = Array.from(document.images);
  const pending = imgs.filter((i) => !i.complete).length;
  if (!pending) await Promise.all(imgs.filter((i) => i.naturalWidth).map((i) => i.decode().catch(() => null)));
  return { pending, fonts: document.fonts ? document.fonts.status : 'n/a', skel: document.querySelectorAll('.bp-skel').length };
})()'''

STABILISE_JS = r'''(async () => {
  if (!document.getElementById('__visualBaseline')) {
    const s = document.createElement('style'); s.id = '__visualBaseline';
    s.textContent = '*, *::before, *::after { caret-color: transparent !important; } html { scroll-behavior: auto !important; }';
    (document.head || document.documentElement).appendChild(s);
  }
  for (const a of (document.getAnimations ? document.getAnimations() : [])) {
    try { const t = a.effect && a.effect.getComputedTiming(); if (t && isFinite(t.endTime)) a.finish(); else a.cancel(); } catch (e) { /* keep going */ }
  }
  for (const v of Array.from(document.querySelectorAll('video'))) {
    try {
      v.pause();
      if (v.readyState >= 1 && v.currentTime !== 0) { v.currentTime = 0; await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 1500); }); }
    } catch (e) { /* keep going */ }
  }
  if (document.fonts) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
})()'''

STATE_JS = r'''(() => ({
  path: location.pathname + location.search,
  h1: ((document.querySelector('h1') || {}).textContent || '').trim().slice(0, 80),
  alerts: Array.from(document.querySelectorAll('.bp-alert-error')).map((e) => e.textContent.trim().slice(0, 120)),
  notFound: /No such page/.test((document.querySelector('.bp-empty') || {}).textContent || ''),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}))()'''


def api_call_js(method, path, body=None):
    return ("fetch(%s, {method: %s, credentials: 'include', headers: {'content-type': 'application/json', 'x-bioptime-client': 'web'}%s})"
            ".then(async (r) => ({status: r.status, body: await r.text()}))") % (
        json.dumps(path), json.dumps(method), (', body: %s' % json.dumps(json.dumps(body))) if body is not None else '')


# --------------------------------------------------------------------------------------------- PNG (stdlib only)
PNG_SIG = b'\x89PNG\r\n\x1a\n'
_MASKS = {}


def _masks(n):
    m = _MASKS.get(n)
    if m is None:
        m = (int.from_bytes(b'\x7f' * n, 'little'), int.from_bytes(b'\x80' * n, 'little'), (1 << (8 * n)) - 1)
        _MASKS[n] = m
    return m


def _add(x, y):
    """bytewise (x + y) mod 256, carry-free on Python integers"""
    n = len(x)
    lo, hi, _ = _masks(n)
    a, b = int.from_bytes(x, 'little'), int.from_bytes(y, 'little')
    return (((a & lo) + (b & lo)) ^ ((a ^ b) & hi)).to_bytes(n, 'little')


def _sub(x, y):
    """bytewise (x - y) mod 256, borrow-free on Python integers"""
    n = len(x)
    lo, hi, _ = _masks(n)
    a, b = int.from_bytes(x, 'little'), int.from_bytes(y, 'little')
    return (((a | hi) - (b & lo)) ^ ((a ^ ~b) & hi)).to_bytes(n, 'little')


def _unsub(raw, bpp):
    """PNG Sub filter: a running sum with stride bpp, done as a doubling scan on one big integer"""
    n = len(raw)
    lo, hi, full = _masks(n)
    s, k = int.from_bytes(raw, 'little'), bpp
    while k < n:
        t = (s << (8 * k)) & full
        s = ((s & lo) + (t & lo)) ^ ((s ^ t) & hi)
        k <<= 1
    return s.to_bytes(n, 'little')


def _unavg(raw, prev, bpp):
    out = bytearray(raw)
    n = len(out)
    if prev is None:
        for i in range(bpp, n):
            out[i] = (out[i] + (out[i - bpp] >> 1)) & 255
    else:
        for i in range(bpp):
            out[i] = (out[i] + (prev[i] >> 1)) & 255
        for i in range(bpp, n):
            out[i] = (out[i] + ((out[i - bpp] + prev[i]) >> 1)) & 255
    return bytes(out)


def _unpaeth(raw, prev, bpp):
    out = bytearray(raw)
    n = len(out)
    for i in range(bpp):
        out[i] = (out[i] + prev[i]) & 255
    for i in range(bpp, n):
        a = out[i - bpp]
        b = prev[i]
        c = prev[i - bpp]
        pa = b - c
        pb = a - c
        pc = pa + pb
        if pa < 0:
            pa = -pa
        if pb < 0:
            pb = -pb
        if pc < 0:
            pc = -pc
        if pa <= pb and pa <= pc:
            p = a
        elif pb <= pc:
            p = b
        else:
            p = c
        out[i] = (out[i] + p) & 255
    return bytes(out)


def unfilter(ftype, raw, prev, bpp):
    if ftype == 0:
        return raw
    if ftype == 1:
        return _unsub(raw, bpp)
    if ftype == 2:
        return raw if prev is None else _add(raw, prev)
    if ftype == 3:
        return _unavg(raw, prev, bpp)
    if ftype == 4:
        return _unsub(raw, bpp) if prev is None else _unpaeth(raw, prev, bpp)
    raise ValueError('bad PNG filter type %r' % ftype)


def png_chunks(data):
    if data[:8] != PNG_SIG:
        raise ValueError('not a PNG file')
    pos = 8
    while pos + 8 <= len(data):
        n = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        yield typ, data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b'IEND':
            break


def png_chunk(typ, body):
    return struct.pack('>I', len(body)) + typ + body + struct.pack('>I', zlib.crc32(typ + body) & 0xffffffff)


class Png:
    CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}

    def __init__(self, data):
        self.idat, self.plte, self.trns = [], None, None
        for typ, body in png_chunks(data):
            if typ == b'IHDR':
                self.w, self.h, self.depth, self.ctype, _, _, self.interlace = struct.unpack('>IIBBBBB', body)
            elif typ == b'PLTE':
                self.plte = body
            elif typ == b'tRNS':
                self.trns = body
            elif typ == b'IDAT':
                self.idat.append(body)
        if self.interlace:
            raise ValueError('interlaced PNG is not supported')
        if self.depth not in (8, 16) or (self.ctype == 3 and self.depth != 8) or self.ctype not in self.CHANNELS:
            raise ValueError('PNG colour type %d at depth %d is not supported' % (self.ctype, self.depth))
        self.bpp = self.CHANNELS[self.ctype] * self.depth // 8
        self.stride = self.w * self.bpp
        self.fmt = (self.w, self.depth, self.ctype, self.plte, self.trns)
        self._opaque = b'\xff' * self.w
        if self.ctype == 3:
            pal = self.plte or b''
            ent = [pal[i * 3:i * 3 + 3] if i * 3 + 3 <= len(pal) else b'\x00\x00\x00' for i in range(256)]
            alpha = self.trns or b''
            self._pal = [bytes(e[c] for e in ent) for c in range(3)] + [bytes(alpha[i] if i < len(alpha) else 255 for i in range(256))]

    def filtered_rows(self):
        """the decompressed scanlines (filter byte + data), streamed so a tall image never sits in memory twice"""
        n = self.stride + 1
        d = zlib.decompressobj()
        pending = b''
        emitted = 0
        for chunk in self.idat:
            data = chunk
            while data:
                out = d.decompress(data, 1 << 20)
                data = d.unconsumed_tail
                if pending:
                    out = pending + out
                k = len(out) // n * n
                for i in range(0, k, n):
                    if emitted < self.h:
                        yield out[i:i + n]
                        emitted += 1
                pending = out[k:]
        out = pending + d.flush()
        for i in range(0, len(out) // n * n, n):
            if emitted < self.h:
                yield out[i:i + n]
                emitted += 1
        if emitted < self.h:
            raise ValueError('PNG data ends after %d of %d rows' % (emitted, self.h))

    def rgba(self, row):
        """one reconstructed scanline as RGBA bytes (8 bit)"""
        if self.depth == 16:
            row = row[0::2]
        ct, w = self.ctype, self.w
        if ct == 6:
            return bytes(row)
        out = bytearray(w * 4)
        if ct == 2:
            out[0::4], out[1::4], out[2::4], out[3::4] = row[0::3], row[1::3], row[2::3], self._opaque
        elif ct == 0:
            out[0::4] = out[1::4] = out[2::4] = row
            out[3::4] = self._opaque
        elif ct == 4:
            g = row[0::2]
            out[0::4] = out[1::4] = out[2::4] = g
            out[3::4] = row[1::2]
        else:
            r = bytes(row)
            out[0::4], out[1::4], out[2::4], out[3::4] = (r.translate(t) for t in self._pal)
        return bytes(out)


def png_size(data):
    for typ, body in png_chunks(data):
        if typ == b'IHDR':
            return struct.unpack('>II', body[:8])
    raise ValueError('PNG without IHDR')


def png_stitch(segments):
    """Join PNG segments of equal width vertically without decoding them in full: the scanlines are concatenated
    and only the first row of each later segment is rewritten so that it no longer refers to the row above it."""
    if len(segments) == 1:
        return segments[0]
    pngs = [Png(s) for s in segments]
    first = pngs[0]
    if any(p.fmt != first.fmt for p in pngs):
        raise ValueError('segments differ in width or format')
    co = zlib.compressobj(6)
    parts = []
    height = 0
    for k, p in enumerate(pngs):
        rows = p.filtered_rows()
        for j, row in enumerate(rows):
            if k > 0 and j == 0:
                ft = row[0]
                if ft == 3:                     # Average: rebuild against a zero row, store unfiltered
                    row = b'\x00' + _unavg(row[1:], None, p.bpp)
                elif ft == 2:                   # Up against zeros is the raw row
                    row = b'\x00' + row[1:]
                elif ft == 4:                   # Paeth against zeros predicts from the left: same bytes as Sub
                    row = b'\x01' + row[1:]
            parts.append(co.compress(row))
            height += 1
    parts.append(co.flush())
    ihdr = struct.pack('>IIBBBBB', first.w, height, first.depth, first.ctype, 0, 0, 0)
    out = PNG_SIG + png_chunk(b'IHDR', ihdr)
    if first.plte:
        out += png_chunk(b'PLTE', first.plte)
    if first.trns:
        out += png_chunk(b'tRNS', first.trns)
    return out + png_chunk(b'IDAT', b''.join(parts)) + png_chunk(b'IEND', b'')


class PngWriter:
    """RGB PNG written row by row (Up filter, which keeps flat UI screenshots small)"""

    def __init__(self, path, w, h):
        self.path, self.w, self.h = path, w, h
        self.co = zlib.compressobj(6)
        self.parts = []
        self.prev = None
        self.rows = 0

    def add(self, row):
        row = bytes(row)
        self.parts.append(self.co.compress((b'\x00' + row) if self.prev is None else (b'\x02' + _sub(row, self.prev))))
        self.prev = row
        self.rows += 1

    def close(self):
        if self.rows != self.h:
            raise ValueError('wrote %d of %d rows' % (self.rows, self.h))
        self.parts.append(self.co.flush())
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with open(self.path, 'wb') as f:
            f.write(PNG_SIG + png_chunk(b'IHDR', struct.pack('>IIBBBBB', self.w, self.h, 8, 2, 0, 0, 0))
                    + png_chunk(b'IDAT', b''.join(self.parts)) + png_chunk(b'IEND', b''))


# --------------------------------------------------------------------------------------------- pixel comparison
NONZERO = re.compile(rb'[^\x00]+')
_LANES = {}


def _lanes(n, tol):
    key = (n, tol)
    m = _LANES.get(key)
    if m is None:
        m = (int.from_bytes(b'\x00\x01' * n, 'little'), int.from_bytes(bytes([255 - tol, 0]) * n, 'little'), int.from_bytes(b'\x00\x02' * n, 'little'))
        _LANES[key] = m
    return m


def changed_pixels(ra, rb, tol):
    """bytes with one entry per pixel, non-zero where any RGBA channel differs by more than tol. Each byte is
    widened to a 16-bit lane of one big integer so the compare runs at C speed instead of pixel by pixel."""
    n = len(ra)
    A = bytearray(2 * n)
    A[0::2] = ra
    B = bytearray(2 * n)
    B[0::2] = rb
    a, b = int.from_bytes(A, 'little'), int.from_bytes(B, 'little')
    k, c, m = _lanes(n, tol)
    x = ((((a | k) - b) + c) | (((b | k) - a) + c)) & m
    ch = x.to_bytes(2 * n, 'little')[1::2]
    w = n // 4
    p = int.from_bytes(ch[0::4], 'little') | int.from_bytes(ch[1::4], 'little') | int.from_bytes(ch[2::4], 'little') | int.from_bytes(ch[3::4], 'little')
    return p.to_bytes(w, 'little')


def _matches_near(px, rows, x, w, tol):
    for r in rows:
        if r is None:
            continue
        for xx in (x - 1, x, x + 1):
            if 0 <= xx < w:
                j = 4 * xx
                if abs(px[0] - r[j]) <= tol and abs(px[1] - r[j + 1]) <= tol and abs(px[2] - r[j + 2]) <= tol and abs(px[3] - r[j + 3]) <= tol:
                    return True
    return False


FADE = bytes(255 - (255 - v) * 3 // 10 for v in range(256))
RED = b'\xe8\x1c\x3c'
YELLOW = b'\xf0\xc0\x00'


def paired_rows(A, B):
    """reconstructed rows of both images in lockstep; while both files carry the same scanlines over the same rows
    above, the row is decoded once and shared"""
    ra, rb = A.filtered_rows(), B.filtered_rows()
    same_fmt = A.fmt == B.fmt
    prev_a = prev_b = None
    synced = same_fmt
    for _ in range(min(A.h, B.h)):
        fa, fb = next(ra), next(rb)
        if synced and fa == fb:
            cur = unfilter(fa[0], fa[1:], prev_a, A.bpp)
            cur_a = cur_b = cur
        else:
            cur_a = unfilter(fa[0], fa[1:], prev_a, A.bpp)
            cur_b = unfilter(fb[0], fb[1:], prev_b, B.bpp)
            synced = same_fmt and cur_a == cur_b
        prev_a, prev_b = cur_a, cur_b
        if cur_a is cur_b:
            r = A.rgba(cur_a)
            yield r, r
        else:
            yield A.rgba(cur_a), B.rgba(cur_b)
    for img, rows, prev, first in ((A, ra, prev_a, True), (B, rb, prev_b, False)):
        for fr in rows:
            prev = unfilter(fr[0], fr[1:], prev, img.bpp)
            yield (img.rgba(prev), None) if first else (None, img.rgba(prev))


def compare_images(path_a, path_b, tol, aa, diff_path):
    with open(path_a, 'rb') as f:
        da = f.read()
    with open(path_b, 'rb') as f:
        db = f.read()
    A, B = Png(da), Png(db)
    W, H = max(A.w, B.w), max(A.h, B.h)
    total = W * H
    if hashlib.sha256(da).digest() == hashlib.sha256(db).digest():
        return {'changed_pixels': 0, 'aa_pixels': 0, 'total_pixels': total, 'ratio': 0.0, 'bbox': None, 'size_base': [A.w, A.h], 'size_new': [B.w, B.h], 'identical': True}
    mw = min(A.w, B.w)
    writer = PngWriter(diff_path, W, H)
    changed = aa_count = 0
    bbox = [W, H, -1, -1]
    window = []          # (rowA, rowB) for y-1, y, y+1

    def mark(x0, x1, y):
        if x0 < bbox[0]:
            bbox[0] = x0
        if x1 - 1 > bbox[2]:
            bbox[2] = x1 - 1
        if y < bbox[1]:
            bbox[1] = y
        if y > bbox[3]:
            bbox[3] = y

    def process(y, prev, cur, nxt):
        nonlocal changed, aa_count
        ra, rb = cur
        base = ra if ra is not None else rb
        rgb = bytearray(W * 3)
        bw = len(base) // 4
        rgb[0:bw * 3:3], rgb[1:bw * 3:3], rgb[2:bw * 3:3] = base[0::4], base[1::4], base[2::4]
        rgb = bytearray(bytes(rgb).translate(FADE))
        if ra is None or rb is None:                      # a row only one image has
            rgb[:] = RED * W
            changed += W
            mark(0, W, y)
            writer.add(rgb)
            return
        if ra is not rb and ra != rb:
            mask = changed_pixels(ra[:mw * 4], rb[:mw * 4], tol)
            n = mw - mask.count(0)
            if n:
                check_aa = aa and n <= max(8, mw // 4)
                for m in NONZERO.finditer(mask):
                    x0, x1 = m.span()
                    if not check_aa:
                        rgb[x0 * 3:x1 * 3] = RED * (x1 - x0)
                        changed += x1 - x0
                        mark(x0, x1, y)
                        continue
                    for x in range(x0, x1):
                        j = 4 * x
                        if _matches_near(ra[j:j + 4], (prev[1] if prev else None, rb, nxt[1] if nxt else None), x, mw, tol) and \
                           _matches_near(rb[j:j + 4], (prev[0] if prev else None, ra, nxt[0] if nxt else None), x, mw, tol):
                            rgb[x * 3:x * 3 + 3] = YELLOW
                            aa_count += 1
                        else:
                            rgb[x * 3:x * 3 + 3] = RED
                            changed += 1
                            mark(x, x + 1, y)
        if A.w != B.w:                                   # columns only one image has
            rgb[mw * 3:] = RED * (W - mw)
            changed += W - mw
            mark(mw, W, y)
        writer.add(rgb)

    y = 0
    for pair in paired_rows(A, B):
        window.append(pair)
        if len(window) == 2:
            process(0, None, window[0], window[1])
            y = 1
        elif len(window) == 3:
            process(y, window[0], window[1], window[2])
            window.pop(0)
            y += 1
    if len(window) == 1:
        process(0, None, window[0], None)
    elif window:
        process(y, window[-2], window[-1], None)
    writer.close()
    if not changed and not aa_count:
        os.remove(diff_path)
    return {'changed_pixels': changed, 'aa_pixels': aa_count, 'total_pixels': total, 'ratio': changed / total if total else 0.0,
            'bbox': bbox if bbox[2] >= 0 else None, 'size_base': [A.w, A.h], 'size_new': [B.w, B.h], 'identical': False,
            'diff': diff_path if (changed or aa_count) else None}


# --------------------------------------------------------------------------------------------- data check
def db_snapshot(path):
    if not path or not os.path.exists(path):
        return None
    con = sqlite3.connect('file:%s?mode=ro' % urllib.parse.quote(path), uri=True, timeout=10)
    try:
        snap = {}
        for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            cur = con.execute('SELECT * FROM "%s"' % name.replace('"', '""'))
            cols = [d[0] for d in cur.description]
            try:
                rows = {r[0]: r[1:] for r in con.execute('SELECT rowid, * FROM "%s"' % name.replace('"', '""'))}
            except sqlite3.OperationalError:              # WITHOUT ROWID table: key on the whole row
                rows = {r: r for r in cur.fetchall()}
            snap[name] = (cols, rows)
        return snap
    finally:
        con.close()


def db_diff(before, after):
    if before is None or after is None:
        return {'checked': False}
    out = {}
    for name in sorted(set(before) | set(after)):
        cb, rb = before.get(name, ([], {}))
        ca, ra = after.get(name, ([], {}))
        added = [k for k in ra if k not in rb]
        removed = [k for k in rb if k not in ra]
        updated = [k for k in ra if k in rb and ra[k] != rb[k]]
        if not (added or removed or updated):
            continue
        info = {'added': len(added), 'removed': len(removed), 'updated': len(updated)}
        if updated and ca == cb:
            info['updated_columns'] = sorted({ca[i] for k in updated for i in range(len(ca)) if i < len(ra[k]) and ra[k][i] != rb[k][i]})
        for col in ('action', 'type', 'kind', 'event', 'status'):
            if col in ca and added:
                i = ca.index(col)
                counts = {}
                for k in added:
                    v = str(ra[k][i])
                    counts[v] = counts.get(v, 0) + 1
                info['added_by_' + col] = counts
                break
        out[name] = info
    return {'checked': True, 'changed_tables': out}


# --------------------------------------------------------------------------------------------- browser
def load_driver():
    sys.path.insert(0, DRIVE_TOOLS)
    import check_site as cs   # noqa: E402  (the headless Chrome driver of the website checks)
    cs.OUT = WORK
    cs.PORT_CDP = PORT_CDP
    return cs


def make_browser(cs, clock_ms, rewrite=None, offline=False):
    # offline: Chrome's own background traffic is switched off and only loopback and BASE's host resolve
    cs.NO_NETWORK = bool(offline)
    cs.NO_NETWORK_HOSTS = ((urllib.parse.urlsplit(BASE).hostname or '').lower(),) if offline else ()

    class Capturer(cs.Browser):
        """check_site's Browser plus: a request guard, network-idle tracking, the load event, frozen time, and with
        offline the --offline answers. Commands sent from inside an event (continue or refuse a paused request) are
        fire-and-forget, so handling one event never blocks on another; pump() waits on the socket with select() and
        always reads whole messages."""

        def __init__(self):
            self.blocked, self.inflight, self.loaded, self.where = [], {}, False, ''
            self.awaiting, self.replies, self.n = set(), {}, 0
            self.last_net = time.time()
            self.api_rewrite = rewrite
            self.offline_log = {'answered': [], 'refused': []} if offline else None
            self.local_hosts = ((urllib.parse.urlsplit(BASE).hostname or '').lower(),)
            super().__init__()
            self.call('Network.setCacheDisabled', cacheDisabled=True)
            self.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-reduced-motion', 'value': 'reduce'}])
            if clock_ms is not None:
                self.call('Page.addScriptToEvaluateOnNewDocument', source=FREEZE_JS % clock_ms)
            patterns = [{'urlPattern': '*', 'requestStage': 'Request'}]
            if rewrite:
                patterns.append({'urlPattern': '*/api/*', 'requestStage': 'Response'})
            self.call('Fetch.enable', patterns=patterns)

        def send(self, method, **params):
            self.n += 1
            self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))

        def call(self, method, **params):
            """like check_site's call(), but safe to nest: a reply meant for an outer call that arrives while an
            inner call (made from an event handler) waits is kept for it instead of being dropped"""
            self.n += 1
            my_id = self.n
            self.awaiting.add(my_id)
            self.ws.send(json.dumps({'id': my_id, 'method': method, 'params': params}))
            old = self.ws.sock.gettimeout()
            self.ws.sock.settimeout(120)
            try:
                while my_id not in self.replies:
                    msg = json.loads(self.ws.recv())
                    if 'id' in msg:
                        if msg['id'] in self.awaiting:
                            self.replies[msg['id']] = msg
                    elif 'method' in msg:
                        self._event(msg)
            finally:
                self.ws.sock.settimeout(old)
                self.awaiting.discard(my_id)
            msg = self.replies.pop(my_id)
            if 'error' in msg:
                raise RuntimeError('%s: %s' % (method, msg['error']))
            return msg.get('result', {})

        def pump(self, seconds):
            end = time.time() + seconds
            self.ws.sock.settimeout(120)
            while True:
                if not self.ws.buf:
                    left = end - time.time()
                    if left <= 0 or not select.select([self.ws.sock], [], [], left)[0]:
                        return
                msg = json.loads(self.ws.recv())
                if 'method' in msg:
                    self._event(msg)

        def _event(self, msg):
            method = msg.get('method')
            p = msg.get('params', {})
            if method == 'Fetch.requestPaused':
                self._paused(p)
                return
            if method == 'Network.requestWillBeSent':
                if p.get('type') not in ('EventSource', 'WebSocket', 'Media') and not p['request']['url'].startswith('data:'):
                    self.inflight[p['requestId']] = p['request']['url']
                self.last_net = time.time()
            elif method in ('Network.loadingFinished', 'Network.loadingFailed'):
                self.inflight.pop(p.get('requestId'), None)
                self.last_net = time.time()
            elif method == 'Page.loadEventFired':
                self.loaded = True
            super()._event(msg)

        def _paused(self, p):
            rid, req = p['requestId'], p['request']
            path = urllib.parse.urlsplit(req['url']).path
            if 'responseErrorReason' in p:
                self.send('Fetch.continueRequest', requestId=rid)
                return
            if 'responseStatusCode' in p:            # response stage: /api/* answers only
                fn = self.api_rewrite.response(path, req['url']) if (self.api_rewrite and p.get('responseStatusCode') == 200) else None
                body = None
                if fn:
                    r = self.call('Fetch.getResponseBody', requestId=rid)
                    raw = base64.b64decode(r['body']) if r.get('base64Encoded') else r['body'].encode('utf-8')
                    body = fn(raw)
                if body is None:
                    self.send('Fetch.continueResponse', requestId=rid)
                else:
                    headers = [h for h in p.get('responseHeaders', []) if h['name'].lower() not in ('content-length', 'content-encoding')]
                    self.send('Fetch.fulfillRequest', requestId=rid, responseCode=p['responseStatusCode'], responseHeaders=headers, body=base64.b64encode(body).decode())
                return
            if self.offline_log is not None and req['url'].startswith(('http://', 'https://')) and not cs.is_local(req['url'], self.local_hosts):
                answer = cs.offline_answer(req['url'], fonts_dir=FONTS_DIR, scripts=False) if req['method'] == 'GET' else None
                if answer is None:
                    self.offline_log['refused'].append(req['url'])
                    self.send('Fetch.failRequest', requestId=rid, errorReason='BlockedByClient')
                else:
                    self.offline_log['answered'].append(req['url'])
                    self.send('Fetch.fulfillRequest', requestId=rid, responseCode=200, body=base64.b64encode(answer[0]).decode(),
                              responseHeaders=[{'name': 'Content-Type', 'value': answer[1]}, {'name': 'Access-Control-Allow-Origin', 'value': '*'}])
                return
            if req['method'] in SAFE_METHODS or (req['method'], path) in ALLOWED_WRITES:
                url = self.api_rewrite.request(path, req['url']) if (self.api_rewrite and req['method'] == 'GET') else None
                if url:
                    self.send('Fetch.continueRequest', requestId=rid, url=url)
                else:
                    self.send('Fetch.continueRequest', requestId=rid)
            else:
                self.blocked.append({'method': req['method'], 'url': req['url'], 'while': self.where})
                self.send('Fetch.failRequest', requestId=rid, errorReason='BlockedByClient')

        def metrics(self, w, h, mobile):
            self.call('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=mobile)
            self.w, self.h = w, h

        def goto(self, url, timeout=25):
            self.errors = []
            self.loaded = False
            self.call('Page.navigate', url=url)
            end = time.time() + timeout
            while time.time() < end and not self.loaded:
                self.pump(0.1)
            if not self.loaded:
                raise RuntimeError('no load event for ' + url)

        def wait(self, expr, seconds=15):
            end = time.time() + seconds
            while time.time() < end:
                try:
                    if self.js(expr):
                        return True
                except Exception:
                    pass
                self.pump(0.15)
            return False

        def idle(self, quiet=0.6, timeout=10):
            end = time.time() + timeout
            while time.time() < end:
                self.pump(0.1)
                if not self.inflight and time.time() - self.last_net >= quiet:
                    return True
            return False

        def scroll_through(self, step=0.8, pause=0.08):
            y = 0
            total = self.js('Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)') or 0
            while y < min(total, MAX_HEIGHT):
                self.js('window.scrollTo(0, %d)' % y)
                self.pump(pause)
                y += int(self.h * step)
                total = self.js('Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)') or total
            self.js('window.scrollTo(0, 0)')
            self.pump(0.3)

        def full_shot(self):
            h = self.js('Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)') or self.h
            if h <= self.h:
                r = self.call('Page.captureScreenshot', format='png')
                return base64.b64decode(r['data']), False, False
            truncated = h > MAX_HEIGHT
            h = min(h, MAX_HEIGHT)
            segs = []
            for y in range(0, h, SEGMENT):
                r = self.call('Page.captureScreenshot', format='png', captureBeyondViewport=True,
                              clip={'x': 0, 'y': y, 'width': self.w, 'height': min(SEGMENT, h - y), 'scale': 1})
                segs.append(base64.b64decode(r['data']))
            return png_stitch(segs), True, truncated

    return Capturer()


# --------------------------------------------------------------------------------------------- capture
ISO_TS = re.compile(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$')
TS_KEY = re.compile(r'(_at|At|^at|^ts|timestamp)$')
LOG_ENDPOINTS = {'/api/admin/audit': 1000, '/api/admin/audit/search': 500}   # append-only logs (path: the server's largest limit)


def parse_ts(v):
    try:
        d = datetime.datetime.fromisoformat(v.replace('Z', '+00:00').replace(' ', 'T', 1))
    except ValueError:
        return None
    if d.tzinfo is None:                        # SQLite style "2026-10-22 16:01:02" is UTC
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.timestamp() * 1000


def stable_api(cutoff_ms, clock_ms):
    """Stabiliser 6: keeps what happened since the cutoff (the start of the baseline capture) out of the pictures.
    Applied to JSON answers of /api/* only:
      - a timestamp field (key ending in _at / At, or at, ts, timestamp) whose value lies between the cutoff and now
        is replaced by the frozen clock: the session a capture opens, its last-seen time, a user's last sign-in, a
        report's "generated at" then read the same in every capture ("just now") instead of the real minute;
      - the audit log endpoints leave out rows written since the cutoff (each capture's own sign-ins, and the
        access-log rows that opening a member record writes). The request asks the server for its largest page and
        the answer is cut back to the limit the page asked for, so the list ends on the same row as at the cutoff.
    Records dated in the future (appointments, expiry times) are never touched: only values up to now count."""
    clock_dt = datetime.datetime.fromtimestamp(clock_ms / 1000, datetime.timezone.utc)
    asked = {}          # widened URL -> the limit the page asked for

    def fresh(v):
        if not isinstance(v, str) or not ISO_TS.match(v):
            return False
        t = parse_ts(v)
        return t is not None and cutoff_ms <= t <= time.time() * 1000 + 300000

    def clock_like(v):
        if 'T' in v:
            return clock_dt.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (clock_dt.microsecond // 1000)
        return clock_dt.strftime('%Y-%m-%d %H:%M:%S')

    def is_fresh_row(item):
        return isinstance(item, dict) and any(fresh(item.get(k)) for k in ('at', 'created_at', 'createdAt', 'ts', 'timestamp'))

    def pin(o):
        n = 0
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str):
                    if TS_KEY.search(k) and fresh(v):
                        o[k] = clock_like(v)
                        n += 1
                else:
                    n += pin(v)
        elif isinstance(o, list):
            for v in o:
                n += pin(v)
        return n

    class Rewrite:
        @staticmethod
        def request(path, url):
            top = LOG_ENDPOINTS.get(path)
            if not top:
                return None
            parts = urllib.parse.urlsplit(url)
            q = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            limit = next((v for k, v in q if k == 'limit'), None)
            want = int(limit) if limit and limit.isdigit() else 200
            wide = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode([(k, v) for k, v in q if k != 'limit'] + [('limit', str(top))])))
            asked[wide] = min(want, top)
            return wide

        @staticmethod
        def response(path, url):
            if not path.startswith('/api/') or path.startswith('/api/auth/demo/'):
                return None

            def fn(raw):
                try:
                    data = json.loads(raw.decode('utf-8'))
                except ValueError:
                    return None
                n = 0
                if path in LOG_ENDPOINTS and isinstance(data, dict) and isinstance(data.get('items'), list):
                    keep = [it for it in data['items'] if not is_fresh_row(it)][:asked.get(url, len(data['items']))]
                    n += 1 if len(keep) != len(data['items']) else 0
                    data['items'] = keep
                n += pin(data)
                return json.dumps(data).encode('utf-8') if n else None
            return fn
    return Rewrite


def matches_only(only, surface, page):
    """--only: comma-separated globs matched against the surface or surface/page"""
    if not only:
        return True
    key = '%s/%s' % (surface, page)
    return any(fnmatch.fnmatch(key, pat) or fnmatch.fnmatch(surface, pat) for pat in only)


class Run:
    def __init__(self, b, out, only):
        self.b, self.out, self.only = b, out, only
        self.images, self.problems = [], []

    def wanted(self, surface, page):
        return matches_only(self.only, surface, page)

    def shoot(self, surface, page, url, ready=None, widths=None):
        if not self.wanted(surface, page):
            return
        b = self.b
        for (w, h, mobile) in VIEWPORTS:
            if widths and w not in widths:
                continue
            b.where = '%s/%s@%d' % (surface, page, w)
            t0 = time.time()
            try:
                b.metrics(w, h, mobile)
                b.goto(url)
                if ready and not b.wait(ready, 20):
                    self.problems.append('%s: page did not become ready (%s)' % (b.where, ready))
                b.idle()
                b.js(PREPARE_JS)
                b.scroll_through()
                for _ in range(40):
                    st = b.js(READY_JS)
                    if not st['pending'] and not st['skel']:
                        break
                    b.pump(0.25)
                else:
                    self.problems.append('%s: still waiting for %s' % (b.where, st))
                b.idle()
                b.js(STABILISE_JS)
                state = b.js(STATE_JS)
                png, full, truncated = b.full_shot()
            except Exception as e:                               # one page failing must not end the run
                self.problems.append('%s: %s' % (b.where, str(e)[:300]))
                print('  FAIL %s %s' % (b.where, str(e)[:200]))
                continue
            rel = '%s/%s@%d.png' % (surface, page, w)
            path = os.path.join(self.out, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(png)
            iw, ih = png_size(png)
            entry = {'file': rel, 'url': url, 'surface': surface, 'page': page, 'width': iw, 'height': ih, 'viewport': [w, h],
                     'full_page': full, 'truncated': truncated, 'sha256': hashlib.sha256(png).hexdigest(),
                     'final_path': state['path'], 'h1': state['h1']}
            errs = [e for e in b.errors if 'BLOCKED_BY_CLIENT' not in e and 'favicon' not in e]
            if errs:
                entry['console'] = errs[:5]
            if state['alerts'] or state['notFound']:
                entry['alerts'] = state['alerts'] + (['No such page'] if state['notFound'] else [])
            if state['overflowX'] > 0:
                entry['overflow_x'] = state['overflowX']
            self.images.append(entry)
            print('  %-44s %5d px  %4.1fs%s' % (rel, ih, time.time() - t0, '  ALERT ' + '; '.join(entry['alerts']) if entry.get('alerts') else ''))


def clean_session(b):
    b.call('Network.clearBrowserCookies')
    try:
        b.call('Storage.clearDataForOrigin', origin=BASE, storageTypes='local_storage,session_storage,indexeddb,cache_storage,service_workers')
    except RuntimeError:
        pass


def sign_in(b, who):
    email, password, ws = who
    b.metrics(1440, 900, False)
    b.where = 'sign-in ' + email
    b.goto(BASE + '/login/' + ws)
    body = {'email': email, 'password': password, 'workspace': ws}
    for attempt in range(3):
        if ws == 'admin':
            totp = b.js(api_call_js('GET', '/api/auth/demo/totp?email=' + urllib.parse.quote(email)))
            body['mfaCode'] = json.loads(totp['body'])['code']
        r = b.js(api_call_js('POST', '/api/auth/login', body))
        if r['status'] == 200:
            return True
        print('  sign-in %s answered %s %s' % (email, r['status'], r['body'][:160]))
        if ws != 'admin' or r['status'] == 429:
            break
        time.sleep(31 - time.time() % 30)       # an MFA code is single use: wait for the next 30 s window
    return False


def sign_out(b):
    b.where = 'sign-out'
    try:
        b.js(api_call_js('POST', '/api/auth/logout', {}))
    finally:
        clean_session(b)


def nav_pages(b, ws):
    links = b.js("Array.from(document.querySelectorAll('nav.side a.bp-sideitem')).map(a => a.getAttribute('href'))") or []
    pages = []
    for href in links:
        rest = href[len('/' + ws):].strip('/')
        pages.append((rest.replace('/', '-') or ROOT_NAME[ws], href))
    return pages


SPA_READY = "!!document.querySelector('nav.side') && !!document.querySelector('h1') && !document.querySelector('.bp-skel')"


def workspace(run, who, surface):
    b = run.b
    if run.only and not any(fnmatch.fnmatch(surface, p.split('/')[0]) for p in run.only):
        return
    print(surface + ' workspace (' + who[0] + ')')
    if not sign_in(b, who):
        run.problems.append('%s: could not sign in as %s' % (surface, who[0]))
        return
    try:
        b.goto(BASE + '/' + surface)
        b.wait(SPA_READY, 20)
        pages = nav_pages(b, surface)
        names = [p for p, _ in pages]
        missing = [p for p in EXPECT[surface] if p not in names]
        if missing:
            run.problems.append('%s nav lacks %s (has %s)' % (surface, missing, names))
        record = None
        if surface == 'coach':
            b.goto(BASE + '/coach/clients')
            b.wait(SPA_READY + " && document.querySelectorAll('table tbody tr a').length > 0", 20)
            record = b.js('''(() => { const rows = Array.from(document.querySelectorAll('table tbody tr'));
              const pick = rows.find(r => /Priya Nair/.test(r.textContent)) || rows[0]; const a = pick && pick.querySelector('a[href*="/coach/clients/"]');
              return a ? a.getAttribute('href') : null; })()''')
            tabs = []
            if record:
                b.goto(BASE + record)
                b.wait(SPA_READY + " && document.querySelectorAll('[role=tab]').length > 0", 20)
                tabs = b.js("Array.from(document.querySelectorAll('[role=tab]')).map(t => t.id.replace(/^.*tab-/, ''))") or []
            else:
                run.problems.append('coach: no client record found in /coach/clients')
        for page, href in pages:
            run.shoot(surface, page, BASE + href, ready=SPA_READY)
        if record:
            run.shoot(surface, 'client-record', BASE + record, ready=SPA_READY)
            for t in tabs:
                if t and t != 'overview':
                    run.shoot(surface, 'client-record-' + t, BASE + record + '?tab=' + t, ready=SPA_READY + " && document.querySelector('[role=tab][aria-selected=true]') && document.querySelector('[role=tab][aria-selected=true]').id.endsWith(%s)" % json.dumps(t))
    finally:
        sign_out(b)


def resolve_frozen(args):
    """the clock pages see and the data cutoff of stabiliser 6: from --like DIR (a baseline), else both are now"""
    now = datetime.datetime.now().astimezone()
    clock_iso, cutoff_iso = None, now.isoformat(timespec='seconds')
    if args.like:
        with open(os.path.join(args.like, 'index.json'), encoding='utf-8') as f:
            ref = json.load(f)
        clock_iso, cutoff_iso = ref.get('clock'), ref.get('data_cutoff') or ref.get('captured_at')
        if not args.no_freeze and not clock_iso:
            raise SystemExit('%s/index.json has no clock' % args.like)
    if args.clock:
        clock_iso = args.clock
    if args.no_freeze:
        return None, None, cutoff_iso
    if not clock_iso:
        clock_iso = now.replace(second=0, microsecond=0).isoformat()
    dt = datetime.datetime.fromisoformat(clock_iso)
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return int(dt.timestamp() * 1000), dt.isoformat(), cutoff_iso


def capture(args):
    global WORK, PORT_CDP
    WORK, PORT_CDP = os.path.abspath(args.work), args.cdp_port
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    old = os.path.join(out, 'index.json')
    if os.path.exists(old) and not args.only:              # drop the files of the previous capture in this folder
        try:
            for e in json.load(open(old, encoding='utf-8')).get('images', []):
                p = os.path.join(out, e['file'])
                if os.path.exists(p):
                    os.remove(p)
        except (ValueError, KeyError):
            pass
    clock_ms, clock_iso, cutoff_iso = resolve_frozen(args)
    started = datetime.datetime.now().astimezone()
    rewrite = None
    if clock_ms is not None and not args.no_stabilise_api:
        rewrite = stable_api(datetime.datetime.fromisoformat(cutoff_iso).timestamp() * 1000, clock_ms)
    db_path = None if args.no_db else (args.db or DB_DEFAULT)
    before = db_snapshot(db_path) if db_path else None
    cs = load_driver()
    os.makedirs(WORK, exist_ok=True)
    shutil.rmtree(os.path.join(WORK, 'chrome-profile'), ignore_errors=True)
    b = make_browser(cs, clock_ms, rewrite, offline=args.offline)
    run = Run(b, out, [p.strip() for p in args.only.split(',')] if args.only else None)
    version = ''
    try:
        version = b.call('Browser.getVersion').get('product', '')
        b.metrics(1440, 900, False)
        b.goto(BASE + '/login/client')
        b.js(api_call_js('POST', '/api/auth/logout', {}))      # start signed out (a crashed run may have left a session)
        clean_session(b)
        print('website')
        for page, path in WEBSITE:
            run.shoot('website', page, BASE + path)
        print('sign-in pages')
        for page, path in SIGNIN:
            run.shoot('signin', page, BASE + path, ready="!!document.querySelector('input[type=email]')")
        workspace(run, MEMBER, 'client')
        workspace(run, COACH, 'coach')
        workspace(run, OWNER, 'admin')
    finally:
        cs.stop_chrome(b)
    fetched = None
    if b.offline_log is not None:            # read once Chrome has exited (it writes Local State on the way out)
        fetched = cs.chrome_fetched(b.profile)
        if fetched:
            run.problems.append('chrome: fetched for itself despite --offline: ' + '; '.join(fetched))
    after = db_snapshot(db_path) if db_path else None
    data = db_diff(before, after)
    index = {
        'tool': 'platform/tools/visual_baseline.py', 'base': BASE, 'captured_at': started.isoformat(timespec='seconds'),
        'finished_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'), 'chrome': version,
        'clock': clock_iso, 'data_cutoff': cutoff_iso, 'like': os.path.abspath(args.like) if args.like else None,
        'reduced_motion': True, 'device_scale_factor': 1,
        'viewports': [{'width': w, 'height': h, 'mobile': m} for (w, h, m) in VIEWPORTS],
        'stabilisers': {'freeze_clock': clock_iso is not None, 'api_rewrites': rewrite is not None},
        'accounts': {'client': MEMBER[0], 'coach': COACH[0], 'admin': OWNER[0]},
        'images': sorted(run.images, key=lambda e: e['file']),
        'blocked_requests': b.blocked, 'problems': run.problems, 'data_check': dict(data, database=db_path),
    }
    if b.offline_log is not None:
        index['offline'] = {'answered': len(b.offline_log['answered']), 'refused': sorted(set(b.offline_log['refused'])), 'fonts': FONTS_DIR,
                            'chrome_flags': cs.no_network_flags(cs.NO_NETWORK_HOSTS), 'chrome_fetched': fetched}
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=1)
    print(json.dumps({'images': len(run.images), 'blocked_requests': len(b.blocked), 'problems': run.problems,
                      'changed_tables': data.get('changed_tables')}, indent=1))
    if b.offline_log is not None:
        print('offline: %d answered from local copies, refused %s; Chrome fetched for itself: %s'
              % (len(b.offline_log['answered']), index['offline']['refused'], fetched or 'nothing'))
    return 1 if run.problems else 0


# --------------------------------------------------------------------------------------------- compare
def list_images(folder):
    idx = os.path.join(folder, 'index.json')
    if os.path.exists(idx):
        with open(idx, encoding='utf-8') as f:
            return {e['file']: e for e in json.load(f).get('images', [])}
    found = {}
    for root, _, files in os.walk(folder):
        for name in files:
            if name.endswith('.png'):
                rel = os.path.relpath(os.path.join(root, name), folder).replace(os.sep, '/')
                if rel.startswith('diff/'):
                    continue
                m = re.match(r'(?:(.+)/)?(.+)@(\d+)\.png$', rel)
                found[rel] = {'file': rel, 'surface': (m.group(1) if m else '') or '', 'page': m.group(2) if m else name, 'width': int(m.group(3)) if m else 0}
    return found


REPORT_CSS = '''
:root { --bg: #f6f7f9; --card: #fff; --ink: #141a26; --muted: #5b6475; --line: #dde1e8; --bad: #c8102e; --ok: #1d7a46; --warn: #a86b00; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d121c; --card: #151c29; --ink: #e8ecf3; --muted: #9aa4b5; --line: #263042; --bad: #ff5a6e; --ok: #4cc38a; --warn: #f0b84a; } }
* { box-sizing: border-box; } body { margin: 0; font: 14px/1.5 -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--ink); }
header { padding: 24px 24px 8px; } h1 { margin: 0 0 4px; font-size: 22px; } .muted { color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; } .stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.stat b { display: block; font-size: 18px; } .bad { color: var(--bad); } .ok { color: var(--ok); } .warn { color: var(--warn); }
.controls { padding: 0 24px 8px; } main { padding: 0 24px 40px; } .row { background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin: 12px 0; padding: 12px; }
.row h2 { font-size: 15px; margin: 0 0 6px; display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; } .row h2 code { font-size: 14px; }
.pill { font-size: 12px; border-radius: 999px; padding: 1px 8px; border: 1px solid currentColor; }
.cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; } .cols figure { margin: 0; } figcaption { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.frame { position: relative; border: 1px solid var(--line); background: repeating-conic-gradient(#8881 0 25%, transparent 0 50%) 0 0 / 16px 16px; }
.frame img { display: block; width: 100%; height: auto; } .box { position: absolute; outline: 2px solid var(--bad); outline-offset: 1px; pointer-events: none; }
.hide-same .same { display: none; } @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
'''


def compare(args):
    base, new, out = os.path.abspath(args.base), os.path.abspath(args.new), os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    A, B = list_images(base), list_images(new)
    if args.only:
        only = [p.strip() for p in args.only.split(',')]
        A = {k: e for k, e in A.items() if matches_only(only, e.get('surface') or '', e.get('page') or '')}
        B = {k: e for k, e in B.items() if matches_only(only, e.get('surface') or '', e.get('page') or '')}
    results = []
    t0 = time.time()
    for key in sorted(set(A) | set(B)):
        meta = A.get(key) or B.get(key)
        entry = {'file': key, 'surface': meta.get('surface'), 'page': meta.get('page'), 'width': meta.get('width')}
        pa, pb = os.path.join(base, key), os.path.join(new, key)
        if key not in B or not os.path.exists(pb):
            entry.update(status='missing_in_new', ratio=1.0)
        elif key not in A or not os.path.exists(pa):
            entry.update(status='added_in_new', ratio=1.0)
        else:
            r = compare_images(pa, pb, args.tolerance, not args.no_aa, os.path.join(out, 'diff', key))
            entry.update(r)
            entry['status'] = 'identical' if r['identical'] else ('changed' if r['ratio'] > args.max_ratio else 'within_threshold')
            if r.get('diff'):
                entry['diff'] = os.path.relpath(r['diff'], out).replace(os.sep, '/')
        entry.pop('identical', None)
        results.append(entry)
        if entry['status'] != 'identical':
            print('  %-15s %-44s ratio %.5f  changed %s  aa %s' % (entry['status'], key, entry['ratio'], entry.get('changed_pixels', '-'), entry.get('aa_pixels', '-')))
    failed = [r for r in results if r['status'] in ('changed', 'missing_in_new', 'added_in_new')]
    summary = {
        'base': base, 'new': new, 'max_ratio': args.max_ratio, 'tolerance': args.tolerance, 'anti_aliasing_allowance': not args.no_aa,
        **({'only': args.only} if args.only else {}),
        'compared': len(results), 'identical': sum(r['status'] == 'identical' for r in results),
        'within_threshold': sum(r['status'] == 'within_threshold' for r in results), 'over_threshold': sum(r['status'] == 'changed' for r in results),
        'missing_in_new': [r['file'] for r in results if r['status'] == 'missing_in_new'], 'added_in_new': [r['file'] for r in results if r['status'] == 'added_in_new'],
        'max_observed_ratio': max([r['ratio'] for r in results] or [0]), 'failed': bool(failed), 'seconds': round(time.time() - t0, 1),
        'images': sorted(results, key=lambda r: (-r['ratio'], r['file'])),
    }
    with open(os.path.join(out, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=1)
    write_report(summary, base, new, out)
    print(json.dumps({k: v for k, v in summary.items() if k != 'images'}, indent=1))
    print('report: ' + os.path.join(out, 'report.html'))
    if not results:
        print('nothing to compare: no images in %s or %s' % (base, new))
    return 1 if failed or not results else 0


def write_report(summary, base, new, out):
    def src(folder, key):
        return html.escape(urllib.parse.quote(os.path.relpath(os.path.join(folder, key), out).replace(os.sep, '/')))

    rows = []
    for r in summary['images']:
        st = r['status']
        cls = {'identical': 'ok', 'within_threshold': 'warn'}.get(st, 'bad')
        box = ''
        if r.get('bbox') and r.get('size_new'):
            x0, y0, x1, y1 = r['bbox']
            W = max(r['size_base'][0], r['size_new'][0])
            H = max(r['size_base'][1], r['size_new'][1])
            box = '<span class="box" style="left:%.3f%%;top:%.3f%%;width:%.3f%%;height:%.3f%%"></span>' % (
                100 * x0 / W, 100 * y0 / H, max(0.4, 100 * (x1 - x0 + 1) / W), max(0.2, 100 * (y1 - y0 + 1) / H))
        figs = []
        if st != 'added_in_new':
            figs.append('<figure><figcaption>Baseline %s</figcaption><div class="frame"><img loading="lazy" src="%s" alt=""></div></figure>' % ('%d×%d' % tuple(r['size_base']) if r.get('size_base') else '', src(base, r['file'])))
        if st != 'missing_in_new':
            figs.append('<figure><figcaption>New %s</figcaption><div class="frame"><img loading="lazy" src="%s" alt="">%s</div></figure>' % ('%d×%d' % tuple(r['size_new']) if r.get('size_new') else '', src(new, r['file']), box))
        if r.get('diff'):
            figs.append('<figure><figcaption>Diff: red changed, yellow anti-aliasing</figcaption><div class="frame"><img loading="lazy" src="%s" alt=""></div></figure>' % html.escape(urllib.parse.quote(r['diff'])))
        detail = 'ratio %.5f' % r['ratio']
        if 'changed_pixels' in r:
            detail += ' · %s changed px · %s anti-aliased px' % (format(r['changed_pixels'], ','), format(r.get('aa_pixels', 0), ','))
        rows.append('<section class="row %s"><h2><code>%s</code><span class="pill %s">%s</span><span class="muted">%s</span></h2><div class="cols">%s</div></section>' % (
            'same' if st == 'identical' else '', html.escape(r['file']), cls, st.replace('_', ' '), detail, ''.join(figs)))
    s = summary
    doc = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual diff report</title><style>%s</style></head><body class="hide-same"><header><h1>Visual diff report</h1>
<p class="muted">Baseline <code>%s</code><br>New <code>%s</code><br>Threshold %.4f of the pixels, channel tolerance %d, anti-aliasing allowance %s.</p>
<div class="stats"><div class="stat"><b>%d</b>compared</div><div class="stat"><b class="ok">%d</b>identical</div><div class="stat"><b class="warn">%d</b>within threshold</div>
<div class="stat"><b class="bad">%d</b>over threshold</div><div class="stat"><b class="bad">%d</b>missing or added</div><div class="stat"><b>%.5f</b>largest ratio</div></div></header>
<div class="controls"><label><input type="checkbox" id="all"> Show identical images too</label></div><main>%s</main>
<script>document.getElementById('all').addEventListener('change', function (e) { document.body.classList.toggle('hide-same', !e.target.checked); });</script></body></html>''' % (
        REPORT_CSS, html.escape(s['base']), html.escape(s['new']), s['max_ratio'], s['tolerance'], 'on' if s['anti_aliasing_allowance'] else 'off',
        s['compared'], s['identical'], s['within_threshold'], s['over_threshold'], len(s['missing_in_new']) + len(s['added_in_new']), s['max_observed_ratio'],
        ''.join(rows) or '<p>No images.</p>')
    with open(os.path.join(out, 'report.html'), 'w', encoding='utf-8') as f:
        f.write(doc)


# --------------------------------------------------------------------------------------------- main
def build_parser():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='mode', required=True)
    c = sub.add_parser('capture', help='screenshot every surface into a folder')
    c.add_argument('--out', required=True)
    c.add_argument('--only', help='comma-separated surface or surface/page globs, e.g. "website,admin/theme"')
    c.add_argument('--clock', help='ISO time the pages see as now (default: the start of this capture, or the --like baseline\'s clock)')
    c.add_argument('--like', metavar='DIR', help='capture under the frozen clock and data cutoff recorded in DIR/index.json (the baseline you will compare against)')
    c.add_argument('--no-freeze', action='store_true', help='let pages see the real time and Math.random (also turns the API rewrites off)')
    c.add_argument('--no-stabilise-api', action='store_true', help='keep the API answers as they are (no pinned timestamps, no hidden audit rows)')
    c.add_argument('--db', help='SQLite file to snapshot before and after (default: the demo API database)')
    c.add_argument('--no-db', action='store_true', help='skip the before/after data check')
    c.add_argument('--cdp-port', type=int, default=PORT_CDP, help="DevTools port of this capture's headless Chrome (default %(default)s)")
    c.add_argument('--work', default=WORK, help='folder for the Chrome profile, deleted and recreated at the start (default .local/visual-baseline)')
    c.add_argument('--offline', action='store_true', help='refuse requests to other hosts than BASE and loopback, answering Google Fonts from apps/dashboard/public/fonts')
    k = sub.add_parser('compare', help='pixel-compare two captures')
    k.add_argument('--base', required=True)
    k.add_argument('--new', required=True)
    k.add_argument('--out', required=True)
    k.add_argument('--only', help='compare only these comma-separated surface or surface/page globs, e.g. "website"')
    k.add_argument('--max-ratio', type=float, default=0.002, help='changed-pixel ratio above which an image fails (default 0.002)')
    k.add_argument('--tolerance', type=int, default=24, help='per-channel difference (0-255) treated as equal (default 24)')
    k.add_argument('--no-aa', action='store_true', help='count anti-aliasing differences as changes')
    return ap


def main():
    args = build_parser().parse_args()
    sys.exit(capture(args) if args.mode == 'capture' else compare(args))


if __name__ == '__main__':
    main()
