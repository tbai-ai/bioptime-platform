"""Portal 3D and motion layer: does it run where it may, stand down where it must, and leave the portal usable either way?

    BASE=http://127.0.0.1:<scratch port> /Library/Developer/CommandLineTools/usr/bin/python3 -I tools/check_portal_motion.py

Runs headless Chrome (DevTools port 9495, or CDP_PORT) against a scratch server seeded with reset-demo, never the
demo itself (it signs in, which writes sessions): ports 3000, 3100 and 3101 are refused. Browser profiles, each a
fresh Chrome:

  motion    1440x900, mouse: the sign-in scenes and the member home band reach 'live'; the scene is painted under the
            sign-in form (with the layer made hit-testable, the card's own elements are still on top); section
            changes leave one page standing; the band's 3D canvas (never the scene layer, which the mark is placed
            against) trails a scroll and rests at the top of the page, and after a resize while scrolled (width, then
            height, as a phone's address bar does) the 3D mark is still over the flat mark's box within 1 px; list and
            table rows tip in with a section; a tab change glides the underline; nothing is left transformed
  reduced   prefers-reduced-motion: no scene layer, no three.js request, the flat mark fully visible (also at phone width)
  nowebgl   Chrome without WebGL (--disable-webgl --disable-3d-apis): the same, and sign-in and the home still work
  lowpower  navigator.deviceMemory 2 and hardwareConcurrency 2, then Save-Data: the same
  phone     touch phones at 390x844, 375x667 and 360x640: on the three sign-in pages and the member activation page the
            scene reaches 'live' (a smaller mark above the card where there is room, else the motes gathered in the
            margins around the card: data-scene "rim"), the scene is painted under the card, its mark never overlaps
            the card, nothing scrolls sideways, and pixel for pixel (two lossless screenshots, the scene shown and
            hidden) nothing on the card changes while the scene plainly lights the screen around it (LIT_MIN)
  phonelink the member sign-in page offers "Sign in with a phone code" only when /public/config features include
            phone_sign_in (the feature is added to the response in the browser for the positive case)

In every profile: signing in as the demo member works, the member home renders its cards, and no page throws.
Screenshots and report.json go to .local/portal-motion/ (or PORTAL_MOTION_OUT). PORTAL_MOTION_ONLY=phone,motion runs
only the named profiles (for iterating; a full run names none)."""
import json
import os
import sys
import time
import urllib.parse

PLATFORM = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(PLATFORM)), 'drive', 'tools'))
import check_site as cs  # noqa: E402  (the headless Chrome driver of the website checks)

OUT_ROOT = os.path.abspath(os.environ.get('PORTAL_MOTION_OUT') or os.path.join(PLATFORM, '.local', 'portal-motion'))
cs.OUT = OUT_ROOT
cs.PORT_CDP = int(os.environ.get('CDP_PORT') or 9495)
BASE = os.environ.get('BASE', '').rstrip('/')
ONLY = {x.strip() for x in (os.environ.get('PORTAL_MOTION_ONLY') or '').split(',') if x.strip()}  # e.g. phone,motion


def want(section):
    """every section runs unless PORTAL_MOTION_ONLY names some (for iterating on one part; a full run names none)"""
    return not ONLY or section in ONLY
MEMBER = ('priya.nair@demo.bioptime.test', 'Demo-Member-2026!')   # the seeded demo member (apps/api/src/seed/seed.ts)
results = []

SET_INPUT = '''(sel, v) => { const el = document.querySelector(sel); if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true })); return true; }'''
THREE_REQUESTED = "performance.getEntriesByType('resource').some(e => /three\\.module|brandScene/.test(e.name))"
FLAT_VISIBLE = "(() => { const f = document.querySelector('.authMark .brandMark3dFlat, .brandMark3d .brandMark3dFlat'); if (!f) return 'missing'; const r = f.getBoundingClientRect(); return r.width > 0 && parseFloat(getComputedStyle(f).opacity) > 0.9 ? 'visible' : 'hidden'; })()"
SCENE_MODE = "(document.querySelector('.bpScene') || {}).getAttribute ? document.querySelector('.bpScene').getAttribute('data-mode') : 'none'"
SCENE_LIVE = "!!document.querySelector('.bpScene[data-mode=live]')"
SCENE_KIND = "(document.querySelector('.bpScene') || { dataset: {} }).dataset.scene || 'none'"
# The scene layer takes no pointer events, so elementFromPoint never returns it however it is stacked. To test what is
# painted on top, the layer is made hit-testable for the moment of the probe: every probe point on the card (a grid
# over it, and the centre of each field, button and link in it) must still hit the card's own elements.
UNDER_CARD = r"""(() => {
  const layer = document.querySelector('.bpScene'), card = document.querySelector('.authCard, .auth .bp-card');
  if (!layer || !card) return 'missing ' + (!layer ? 'scene' : 'card');
  const saved = layer.style.pointerEvents, savedCanvas = layer.firstElementChild && layer.firstElementChild.style.pointerEvents;
  layer.style.pointerEvents = 'auto'; if (layer.firstElementChild) layer.firstElementChild.style.pointerEvents = 'auto';
  const pts = []; const r = card.getBoundingClientRect();
  for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) pts.push([r.left + r.width * i / 6, r.top + r.height * j / 6, 'grid']);
  card.querySelectorAll('input, button, a, select, textarea').forEach((el) => { const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0) pts.push([b.left + b.width / 2, b.top + b.height / 2, el.tagName.toLowerCase()]); });
  const bad = [];
  for (const [x, y, what] of pts) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const el = document.elementFromPoint(x, y);
    if (!el || !(el === card || card.contains(el))) bad.push(what + '@' + Math.round(x) + ',' + Math.round(y) + ':' + (el ? (el.className && el.className.baseVal === undefined ? el.className : el.tagName) : 'null'));
  }
  layer.style.pointerEvents = saved; if (layer.firstElementChild) layer.firstElementChild.style.pointerEvents = savedCanvas || '';
  return bad.length ? bad.slice(0, 4).join('; ') : 'under';
})()"""
# The mark's box as the scene reports it (host pixels, data-mark-box), against the card's box: no overlap, on screen
MARK_CLEAR = r"""(() => {
  const layer = document.querySelector('.bpScene'), card = document.querySelector('.authCard, .auth .bp-card');
  if (!layer || !card) return 'missing';
  const box = (layer.dataset.markBox || '').split(',').map(Number);
  if (box.length !== 4) return layer.dataset.scene === 'rim' ? 'no mark (motes in the margins around the card)' : layer.dataset.scene === 'motes' ? 'no mark (motes alone)' : 'no mark box';
  const h = layer.getBoundingClientRect(), c = card.getBoundingClientRect();
  const m = { left: h.left + box[0], top: h.top + box[1], right: h.left + box[0] + box[2], bottom: h.top + box[1] + box[3] };
  const overlap = m.left < c.right && m.right > c.left && m.top < c.bottom && m.bottom > c.top;
  if (overlap) return 'overlaps the card: mark ' + box.join(',') + ' card ' + [c.left, c.top, c.width, c.height].map(Math.round).join(',');
  if (m.left < -1 || m.top < -1 || m.right > innerWidth + 1) return 'off screen: ' + box.join(',');
  return 'clear (' + Math.round(box[2]) + 'x' + Math.round(box[3]) + ' px)';
})()"""


# What the scene adds to the screen, in device pixels: two PNG screenshots, one with the scene layer shown and one with
# it hidden for a moment (visibility only), decoded and compared in the page. Outside the card the pixels that change
# are the scene's light; inside the card none may change (the card is opaque and painted on top). The card's border and
# its rounded corners are left out of the inside count, where the page behind a corner legitimately shows.
PIXEL_DIFF = r"""(async (a, b) => {
  const load = async (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bm = await createImageBitmap(new Blob([u], { type: 'image/png' })); const c = new OffscreenCanvas(bm.width, bm.height);
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height); };
  const A = await load(a), B = await load(b);
  if (A.width !== B.width || A.height !== B.height) return { error: 'sizes differ' };
  const W = A.width, H = A.height, s = W / innerWidth;
  const card = document.querySelector('.authCard, .auth .bp-card'); if (!card) return { error: 'no card' };
  const r = card.getBoundingClientRect(); const rad = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
  const L = Math.floor(r.left * s), T = Math.floor(r.top * s), R = Math.ceil(r.right * s), Bt = Math.ceil(r.bottom * s), inset = Math.ceil(2 * s), cr = Math.ceil(rad * s);
  let inside = 0, insideN = 0, lit = 0, bright = 0, outsideN = 0, top = 0, sides = 0;
  const a1 = A.data, b1 = B.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const d = Math.max(Math.abs(a1[i] - b1[i]), Math.abs(a1[i + 1] - b1[i + 1]), Math.abs(a1[i + 2] - b1[i + 2]));
    if (x >= L && x < R && y >= T && y < Bt) {
      const core = x >= L + inset && x < R - inset && y >= T + inset && y < Bt - inset;
      const corner = (x < L + cr || x >= R - cr) && (y < T + cr || y >= Bt - cr);
      if (core && !corner) { insideN++; if (d > 4) inside++; }
    } else {
      outsideN++;
      if (d >= 40) { lit++; if (y < T) top++; else if (y < Bt) sides++; }
      if (d >= 90) bright++;
    }
  }
  return { size: [W, H], card: [L, T, R - L, Bt - T].map(v => Math.round(v / s)), inside, insideN, outsideN, lit, bright, top, sides };
})"""


def scene_pixels(b):
    """the scene's light on screen and what changes on the card (see PIXEL_DIFF), from two lossless screenshots"""
    shown = b.call('Page.captureScreenshot', format='png')['data']
    b.js("new Promise((ok) => { const l = document.querySelector('.bpScene'); if (l) l.style.visibility = 'hidden'; requestAnimationFrame(() => requestAnimationFrame(() => ok(true))); })")
    hidden = b.call('Page.captureScreenshot', format='png')['data']
    b.js("new Promise((ok) => { const l = document.querySelector('.bpScene'); if (l) l.style.removeProperty('visibility'); requestAnimationFrame(() => ok(true)); })")
    return b.js('(%s)(%s, %s)' % (PIXEL_DIFF, json.dumps(shown), json.dumps(hidden)))


# The header band's scene: the canvas offset the parallax gives it, the layer's own inline transform (always none), and
# where the scene draws the mark (data-mark-box, host pixels) against the flat mark's box it must cover: the distance
# between the two centres (x, y) in px.
BAND_CANVAS_TRANSFORM = "(() => { const c = document.querySelector('.heroBand > .bpScene-band > .bpSceneCanvas'); return c ? c.style.transform : 'no canvas'; })()"
BAND_CANVAS_OFFSET = "(() => { const c = document.querySelector('.heroBand > .bpScene-band > .bpSceneCanvas'); if (!c) return 'no canvas'; const m = /translate3d\\(0px, ([\\d.]+)px/.exec(c.style.transform); return m ? parseFloat(m[1]) : 'none: ' + c.style.transform; })()"
BAND_LAYER_TRANSFORM = "(() => { const l = document.querySelector('.heroBand > .bpScene-band'); return l ? l.style.transform : 'no layer'; })()"
MARK_VS_ANCHOR = r"""(() => {
  const l = document.querySelector('.heroBand > .bpScene-band'), a = document.querySelector('.heroBand [data-bp-scene-anchor]');
  if (!l || !a) return 'missing ' + (!l ? 'layer' : 'anchor');
  const box = (l.dataset.markBox || '').split(',').map(Number); if (box.length !== 4) return 'no mark box';
  const h = l.getBoundingClientRect(), r = a.getBoundingClientRect();
  return [h.left + box[0] + box[2] / 2 - (r.left + r.width / 2), h.top + box[1] + box[3] / 2 - (r.top + r.height / 2)].map(v => Math.round(Math.abs(v) * 10) / 10);
})()"""


# How much of the screen the scene must light around the card on a phone, in device pixels whose colour changes by at
# least 40 (lit) and 90 (bright) of 255 when the scene is shown: a mark above the card lights thousands; the motes in the
# margins around a card that fills the screen must light at least this many (the faint scattered motes they replaced lit
# 30 to 450, bright under 10).
LIT_MIN = {'mark': (3000, 2000), 'rim': (1200, 200)}


def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('  ok   ' if ok else '  FAIL ') + name + (' — ' + detail if detail else ''), flush=True)


def wait(b, expr, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if b.js(expr):
                return True
        except Exception:
            pass
        b.pump(0.2)
    return False


def done(b):
    b.close()
    try:
        b.proc.wait(timeout=20)
    except Exception:
        b.proc.kill()


def page_errors(b):
    return [e for e in b.errors if 'favicon' not in e and '401' not in e]


def browser(tag, extra_flags=(), init_script=None):
    """a fresh Chrome with its own profile (no cookie carries over between profiles) and its own screenshot folder"""
    cs.OUT = os.path.join(OUT_ROOT, tag)
    import shutil
    shutil.rmtree(os.path.join(cs.OUT, 'chrome-profile'), ignore_errors=True)
    os.makedirs(cs.OUT, exist_ok=True)
    original = cs.chrome_command
    cs.chrome_command = lambda profile, no_network=False: original(profile, no_network)[:-1] + list(extra_flags) + ['about:blank']
    try:
        b = cs.Browser()
    finally:
        cs.chrome_command = original
    if init_script:
        b.call('Page.addScriptToEvaluateOnNewDocument', source=init_script)
    return b


def sign_in_member(b, tag):
    b.open(BASE + '/login/client', settle=1.0)
    wait(b, "!!document.querySelector('input[type=email]')")
    b.js('(%s)(%s, %s)' % (SET_INPUT, json.dumps('input[type=email]'), json.dumps(MEMBER[0])))
    b.js('(%s)(%s, %s)' % (SET_INPUT, json.dumps('input[type=password]'), json.dumps(MEMBER[1])))
    b.js("document.querySelector('form').requestSubmit()")
    home = wait(b, "location.pathname.startsWith('/client') && /Hello/.test((document.querySelector('h1')||{}).textContent||'')", 15)
    check('%s: the member signs in and the home renders' % tag, home, str(b.js('location.pathname')))
    wait(b, "!document.querySelector('.bp-skel')", 8)
    cards = b.js("document.querySelectorAll('main .bp-card, #main .bp-card').length")
    check('%s: the member home shows its cards' % tag, (cards or 0) >= 6, '%s cards' % cards)
    return home


def standing_down(b, tag):
    """the sign-in page with the motion layer off: no scene layer, no three.js, the flat mark visible, the form usable"""
    b.open(BASE + '/login/client', settle=3.0)
    check('%s: no scene layer on the sign-in page' % tag, b.js(SCENE_MODE) == 'none', 'scene ' + str(b.js(SCENE_MODE)))
    check('%s: three.js and the scene were never requested' % tag, not b.js(THREE_REQUESTED))
    check('%s: the flat brand mark is fully visible' % tag, b.js(FLAT_VISIBLE) == 'visible', str(b.js(FLAT_VISIBLE)))
    check('%s: the sign-in form is there' % tag, b.js("!!document.querySelector('input[type=email]') && !!document.querySelector('input[type=password]')"))
    b.shot('%s-signin' % tag)
    sign_in_member(b, tag)
    b.shot('%s-home' % tag)
    check('%s: no page error' % tag, not page_errors(b), '; '.join(page_errors(b))[:300])


def section_motion():
    print('motion (1440x900, mouse)', flush=True)
    b = browser('motion')
    try:
        b.viewport(1440, 900)
        for ws in ('client', 'coach', 'admin'):
            b.open(BASE + '/login/' + ws, settle=1.0)
            live = wait(b, "document.querySelector('.bpScene') && document.querySelector('.bpScene').getAttribute('data-mode') === 'live'", 12)
            check('motion: /login/%s scene reaches live' % ws, live, 'scene ' + str(b.js(SCENE_MODE)))
            check('motion: /login/%s three.js and the scene were requested (control for the stand-down checks)' % ws, b.js(THREE_REQUESTED))
            b.pump(3.0)
            covered = b.js("(() => { const i = document.querySelector('input[type=email]'); if (!i) return 'no field'; const r = i.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === i ? 'field' : (el && el.className) || String(el); })()")
            check('motion: /login/%s the scene never covers the form' % ws, covered == 'field', str(covered))
            under = b.js(UNDER_CARD)
            check('motion: /login/%s the scene is painted under the card' % ws, under == 'under', str(under))
            b.shot('motion-signin-%s' % ws)
        sign_in_member(b, 'motion')
        band = wait(b, "!!document.querySelector('.heroBand .bpScene[data-mode=live], .heroBand .brandMark3d[data-mode=live]')", 12)
        check('motion: the member home band scene reaches live', band, str(b.js("Array.from(document.querySelectorAll('.heroBand [data-mode]')).map(e => e.className.split(' ')[0] + ':' + e.getAttribute('data-mode')).join(', ')")))
        b.pump(3.0)
        b.shot('motion-client-home')
        # header band parallax: the band's 3D canvas trails a scroll by a few pixels and is back where the page drew it at
        # the top. Only the canvas moves, never the layer (the scene's host, which the mark is placed against), so a
        # resize while scrolled (a phone's address bar showing or hiding) cannot move where the mark is drawn.
        b.js('window.scrollTo(0, 160)')
        b.pump(0.6)
        moved = b.js(BAND_CANVAS_OFFSET)
        check('motion: the band\'s 3D canvas trails a scroll (parallax, at most 14 px)', isinstance(moved, (int, float)) and 0 < moved <= 14, str(moved))
        check('motion: the band\'s scene layer itself never moves (only its canvas)', b.js(BAND_LAYER_TRANSFORM) == '', repr(b.js(BAND_LAYER_TRANSFORM)))
        off = b.js(MARK_VS_ANCHOR)
        check('motion: while scrolled the scene still places the mark over the flat mark\'s box (within 1 px)', isinstance(off, list) and max(off) <= 1.0, str(off))
        b.js('window.scrollTo(0, 0)')
        b.pump(0.6)
        rested = b.js(BAND_CANVAS_TRANSFORM)
        check('motion: at the top of the page the band canvas is where the page drew it', rested == '', repr(rested))
        for (vw, vh, why) in ((1430, 900, 'a width change'), (1430, 846, 'a height change, as when a phone\'s address bar shows')):
            b.js('window.scrollTo(0, 120)')
            b.pump(0.6)
            b.viewport(vw, vh)
            b.pump(1.0)
            b.js('window.scrollTo(0, 0)')
            b.pump(0.8)
            off = b.js(MARK_VS_ANCHOR)
            check('motion: after %s while scrolled, back at the top the 3D mark sits over the flat mark\'s box (within 1 px)' % why, isinstance(off, list) and max(off) <= 1.0, '%s; canvas %r' % (off, b.js(BAND_CANVAS_TRANSFORM)))
        b.viewport(1440, 900)
        b.pump(0.8)
        # record what the motion layer animates from here on (targets and keyframes only)
        b.js("window.__bpAnims = []; (() => { const o = Element.prototype.animate; Element.prototype.animate = function (k, opt) { window.__bpAnims.push({ tag: this.tagName, pseudo: (opt && opt.pseudoElement) || '', kf: JSON.stringify(k).slice(0, 160) }); return o.call(this, k, opt); }; })(); true")
        b.js("Array.from(document.querySelectorAll('nav.side a')).find(a => a.textContent.trim() === 'Habits').click()")
        arrived = wait(b, "location.pathname === '/client/habits' && document.querySelectorAll('h1').length === 1 && /Habit/.test(document.querySelector('h1').textContent)", 8)
        b.pump(1.5)
        check('motion: a section change leaves one page standing', arrived and b.js("document.querySelectorAll('h1').length") == 1, 'h1 count %s' % b.js("document.querySelectorAll('h1').length"))
        b.shot('motion-client-habits')
        rest = b.js("Array.from(document.querySelectorAll('#main .bp-card')).filter(c => c.style.transform && c.style.transform !== 'none').length")
        check('motion: no card is left transformed at rest', rest == 0, '%s transformed' % rest)
        # rows tip in with a section (the billing documents table, the programme's task list), and a tab change glides
        # the underline over
        for section, path in (('Billing', '/client/billing'), ('My program', '/client/program')):
            b.js("(Array.from(document.querySelectorAll('nav.side a')).find(a => a.textContent.trim() === %s) || { click() {} }).click()" % json.dumps(section))
            wait(b, "location.pathname === %s && !document.querySelector('.bp-skel')" % json.dumps(path), 8)
            b.pump(1.5)
        rows = b.js("window.__bpAnims.filter(a => (a.tag === 'TR' || a.tag === 'LI') && /rotateX/.test(a.kf)).length")
        check('motion: list and table rows tip in with a section', (rows or 0) > 0, '%s row animations' % rows)
        b.js("Array.from(document.querySelectorAll('nav.side a')).find(a => a.textContent.trim() === 'Profile').click()")
        wait(b, "location.pathname === '/client/profile' && document.querySelectorAll('[role=tab]').length > 1", 8)
        b.pump(1.5)
        b.js("document.querySelectorAll('[role=tab]')[1].click()")
        b.pump(0.15)
        glide = b.js("window.__bpAnims.filter(a => a.tag === 'BUTTON' && a.pseudo === '::after' && /translateX/.test(a.kf)).length")
        check('motion: a tab change glides the underline from the tab that was selected', (glide or 0) > 0, '%s underline animations' % glide)
        b.pump(1.5)
        left = b.js("[document.getAnimations().filter(a => a.playState === 'running').length, Array.from(document.querySelectorAll('#main *')).filter(e => e.style && e.style.transform && e.style.transform !== 'none').length]")
        check('motion: after the tab change nothing is moving or left transformed', left == [0, 0], str(left))
        check('motion: no page error', not page_errors(b), '; '.join(page_errors(b))[:300])
    finally:
        done(b)


def section_reduced():
    print('reduced motion', flush=True)
    b = browser('reduced')
    try:
        b.viewport(1440, 900)
        b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-reduced-motion', 'value': 'reduce'}])
        standing_down(b, 'reduced')
        b.viewport(390, 844, mobile=True)
        b.open(BASE + '/login/client', settle=3.0)
        check('reduced: no scene layer at phone width either', b.js(SCENE_MODE) == 'none', 'scene ' + str(b.js(SCENE_MODE)))
        check('reduced: no three.js at phone width either', not b.js(THREE_REQUESTED))
    finally:
        done(b)


def section_nowebgl():
    print('no WebGL', flush=True)
    b = browser('nowebgl', extra_flags=('--disable-webgl', '--disable-3d-apis'))
    try:
        b.viewport(1440, 900)
        check('nowebgl: the browser really has no WebGL', not b.js("(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); })()"))
        standing_down(b, 'nowebgl')
    finally:
        done(b)


def section_lowpower():
    print('low power', flush=True)
    b = browser('lowpower', init_script="Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2 }); Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 2 });")
    try:
        b.viewport(1440, 900)
        standing_down(b, 'lowpower')
    finally:
        done(b)
    b = browser('savedata', init_script="Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true, effectiveType: '4g', addEventListener() {}, removeEventListener() {} }) });")
    try:
        b.viewport(1440, 900)
        standing_down(b, 'savedata')
    finally:
        done(b)


def section_phone():
    for (w, h) in ((390, 844), (375, 667), (360, 640)):
        print('phone (%dx%d)' % (w, h), flush=True)
        b = browser('phone-%dx%d' % (w, h))
        try:
            b.viewport(w, h, mobile=True)
            b.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            b.ua('android')
            for path in ('/login/client', '/login/coach', '/login/admin', '/login/client/activate'):
                tag = 'phone %dx%d %s' % (w, h, path)
                b.open(BASE + path, settle=1.0)
                live = wait(b, SCENE_LIVE, 14)
                check('%s: the scene reaches live' % tag, live, 'scene %s, draws %s' % (b.js(SCENE_MODE), b.js(SCENE_KIND)))
                check('%s: three.js loaded only now, lazily (control)' % tag, b.js(THREE_REQUESTED))
                b.pump(2.5)
                if path != '/login/client/activate':
                    check('%s: the sign-in form is there' % tag, b.js("!!document.querySelector('input[type=email]') && !!document.querySelector('input[type=password]')"))
                under = b.js(UNDER_CARD)
                check('%s: the scene is painted under the card' % tag, under == 'under', str(under))
                clear = b.js(MARK_CLEAR)
                check('%s: the mark stays off the card' % tag, isinstance(clear, str) and (clear.startswith('clear') or clear.startswith('no mark (motes')), '%s; draws %s' % (clear, b.js(SCENE_KIND)))
                width = b.js('[document.documentElement.scrollWidth, window.innerWidth]')
                check('%s: no sideways scroll' % tag, width and width[0] <= width[1] and width[1] <= w + 1, str(width))
                # pixel for pixel: the scene adds plainly visible light around the card and changes nothing on it
                kind = b.js(SCENE_KIND)
                px = scene_pixels(b)
                ok_px = isinstance(px, dict) and 'error' not in px
                check('%s: with the scene shown nothing on the card changes (the form is not covered)' % tag, ok_px and px['inside'] == 0 and px['insideN'] > 50000, json.dumps(px))
                need = LIT_MIN.get(kind, LIT_MIN['mark'])
                check('%s: the 3D layer is plainly visible around the card' % tag, ok_px and px['lit'] >= need[0] and px['bright'] >= need[1],
                      'draws %s: %s device px lit, %s bright (need %s, %s); above the card %s, beside it %s' % (kind, px.get('lit') if ok_px else px, px.get('bright') if ok_px else '', need[0], need[1], px.get('top') if ok_px else '', px.get('sides') if ok_px else ''))
                b.shot('phone-%dx%d-%s' % (w, h, path.strip('/').replace('/', '-')))
            check('phone %dx%d: no page error' % (w, h), not page_errors(b), '; '.join(page_errors(b))[:300])
        finally:
            done(b)


def section_phonelink():
    print('phone sign-in link', flush=True)
    b = browser('phonelink')
    try:
        b.viewport(390, 844, mobile=True)
        b.open(BASE + '/login/client', settle=2.0)
        features = b.js("fetch('/api/public/config').then(r => r.json()).then(j => j.features || [])") or []
        link = b.js("!!Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') && a.getAttribute('href').startsWith('/login/client/phone'))")
        check('phonelink: the link follows the phone_sign_in feature', link == ('phone_sign_in' in features), 'feature %s, link %s' % ('phone_sign_in' in features, link))
        b.open(BASE + '/login/coach', settle=1.5)
        check('phonelink: the coach page never offers it', not b.js("!!document.querySelector('a[href^=\"/login/client/phone\"]')"))
    finally:
        done(b)
    b = browser('phonelink-on', init_script="""(() => { const of = window.fetch; window.fetch = async function (input, init) { const r = await of.call(this, input, init); const u = typeof input === 'string' ? input : (input && input.url) || ''; if (!/\\/api\\/public\\/config/.test(u)) return r; const j = await r.clone().json(); j.features = Array.from(new Set([...(j.features || []), 'phone_sign_in'])); return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } }); }; })();""")
    try:
        b.viewport(390, 844, mobile=True)
        b.open(BASE + '/login/client?next=%2Fclient%2Fhabits', settle=2.0)
        href = b.js("(Array.from(document.querySelectorAll('a')).find(a => /sign in with a phone code/i.test(a.textContent)) || {}).getAttribute ? Array.from(document.querySelectorAll('a')).find(a => /sign in with a phone code/i.test(a.textContent)).getAttribute('href') : null")
        check('phonelink: with phone_sign_in on, the member page links to /login/client/phone (keeping next)', href == '/login/client/phone?next=%2Fclient%2Fhabits', str(href))
        b.open(BASE + '/login/admin', settle=1.5)
        check('phonelink: with it on, the admin page still never offers it', not b.js("!!Array.from(document.querySelectorAll('a')).find(a => /sign in with a phone code/i.test(a.textContent))"))
    finally:
        done(b)


SECTIONS = (('motion', section_motion), ('reduced', section_reduced), ('nowebgl', section_nowebgl), ('lowpower', section_lowpower), ('phone', section_phone), ('phonelink', section_phonelink))


def main():
    if not BASE:
        sys.exit('BASE is required: a scratch server seeded with reset-demo')
    port = urllib.parse.urlsplit(BASE).port
    host = urllib.parse.urlsplit(BASE).hostname or ''
    if port in (3000, 3100, 3101) or host not in ('127.0.0.1', 'localhost') and not host.endswith('.localhost'):
        sys.exit('refusing %s: this check signs in and writes sessions; use a local scratch server' % BASE)
    os.makedirs(cs.OUT, exist_ok=True)

    for name, run in SECTIONS:
        if want(name):
            run()

    failed = [r for r in results if not r['ok']]
    report = {'base': BASE, 'checks': len(results), 'failed': len(failed), 'failures': [r['check'] for r in failed], 'out': OUT_ROOT}
    with open(os.path.join(OUT_ROOT, 'report.json'), 'w') as f:
        json.dump({**report, 'results': results}, f, indent=1)
    print(json.dumps(report, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
