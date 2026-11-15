#!/usr/bin/env python3
"""End-to-end check of the coach workspace screens of group coach-core-b in the app (apps/mobile): Calendar (the
portal's Appointments, with Confirm, Complete, Move, Cancel, No-show, the join link, the calendar file and the
consultation summary), /coach/appointments (a link to Calendar), Messages and a thread (text, files picked with the
document and image pickers, a file opened through its 5-minute token, the Coach AI panel), Bloodwork, a report (the
review form, the document, the lab next steps), My profile, Settings and Notifications (the bell). Runs the Expo web
build in headless Chrome at 390x844 (Python 3.9, stdlib, Google Chrome) on the shared harness tools/app_harness.py.

    BASE=http://127.0.0.1:4351 python3 -I tools/e2e_app_coach_core_b.py            against a scratch API; Expo web on APP_PORT
    BASE=… APP_URL=http://localhost:9351 E2E_APP_ONLY=calendar,messages python3 -I tools/e2e_app_coach_core_b.py

BASE is the scratch API (required), started with CORS_ORIGINS=http://localhost:<APP_PORT> after `cli.ts reset-demo`
(the usual recipe). The check starts `npx expo start --web --port <APP_PORT> --clear` for apps/mobile with
EXPO_PUBLIC_API_BASE=<BASE> in its own process group and stops it at the end (APP_PORT default 9351; APP_URL drives a
server that is already running instead). As the other e2e scripts: the live demo's ports (3000, 3100, 3101 and the Expo
default 8081) are refused for BASE and APP_PORT, BASE must be an explicit port on 127.0.0.1, localhost, *.localhost or
*.test, and E2E_OUT (screenshots, report.json, the Expo log and the Chrome profile; default
.local/e2e/app-coach-core-b/) and E2E_CDP_PORT (default 9751) keep parallel runs apart.

One sign-in in the app per run: Asha (the seeded coach) through the coach sign-in; every screen is then reached in-app.
Before that, the script prepares two things the seed does not hold, through the API of the scratch server (never the
app): a check-in that Ananya requests outside Asha's working hours (so there is something to Confirm), and a new blood
test for Priya that the laboratory stand-in delivers (POST /labstack/standin/step, a demo-only route, as an
administrator with the preview authenticator code of GET /auth/demo/totp) so there is a report to review. That is three
more sign-ins (Ananya, Priya, the administrator); E2E_PREPARE=0 skips them, and the checks that need them are skipped.
The sign-in limit is about 20 per 10 minutes per scratch server. Files are attached through the real pickers: the
script presses the buttons with real mouse events and answers Chrome's intercepted file chooser with two small files it
writes into E2E_OUT. Nothing here is a credential of a real account: the seeded accounts are the demo seed's.

Toasts are checked where the coach sees them: inside the viewport (toast_seen), not only somewhere in the document, for
the actions pressed far down a screen (Calendar's Confirm and No-show, the report's release and Next steps, a refused
file in a long thread). The thread is also checked to fetch a reply that arrives while it is open, once through pull to
refresh (its RefreshControl's onRefresh, called as the gesture would) and once on the badges tick (up to a minute);
Ananya's API session from the preparation writes those replies, so no extra sign-in is needed.

Exit status 1 if anything fails; the JSON summary is the last line."""
import datetime
import json
import os
import re
import struct
import sys
import time
import traceback
import urllib.request
import zlib

sys.dont_write_bytecode = True
os.environ['APP_STAFF'] = '1'   # coach and administrator screens exist only in the staff build: the harness starts Expo with EXPO_PUBLIC_STAFF_APP=1
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_harness as ah  # noqa: E402
from app_harness import check, skip  # noqa: E402

BASE = os.environ.get('BASE', '').rstrip('/')
APP_PORT = os.environ.get('APP_PORT') or '9351'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-coach-core-b')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9751'
PREPARE = os.environ.get('E2E_PREPARE', '1') != '0'
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
ANANYA_LOGIN = ('ananya.rao@demo.bioptime.test', 'Demo-Member-2026!')
PRIYA_LOGIN = ('priya.nair@demo.bioptime.test', 'Demo-Member-2026!')
ADMIN_LOGIN = ('admin@demo.bioptime.test', 'Demo-Admin-2026!')
SECTION_NAMES = ('notifications', 'calendar', 'messages', 'bloodwork', 'report', 'profile', 'settings', 'refusals', 'open-client')
ANANYA = 'Ananya Rao'
PRIYA = 'Priya Nair'
REQUEST_NOTE = 'E2E: a weekend check-in, if you can'
PREP = {}   # what the preparation made: ids and times the sections look for


def rx(s):
    return re.escape(s)


def plain(app, name, *sentences):
    for s in sentences:
        check('%s shows %r' % (name, s), app.has_text(rx(s)), app.text()[:160])


def no_labels(app, name):
    hit = app.label_hit()
    check('%s carries no demo or sample label' % name, not hit, hit)


def no_contact_details(app, name):
    check('%s shows no member email or phone number' % name, not app.has_text(r'(ananya|priya|rahul|meera|deepa|dev|vikram|sunita)[a-z.]*@demo\.bioptime\.test|\+91\s?\d'), app.text()[:120])


def ist_label(iso):
    """lib/format.ts fmtDateTime: '1 Nov, 10:00 IST'."""
    d = datetime.datetime.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S') + datetime.timedelta(hours=5, minutes=30)
    return '%d %s, %s IST' % (d.day, d.strftime('%b'), d.strftime('%H:%M'))


def ist_today():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)


def next_weekday(weekday, days_ahead=2):
    """A date (IST) at least `days_ahead` days out on `weekday` (Monday 0 … Sunday 6)."""
    d = ist_today() + datetime.timedelta(days=days_ahead)
    while d.weekday() != weekday:
        d += datetime.timedelta(days=1)
    return d


def next_working_day(days_ahead=3):
    d = ist_today() + datetime.timedelta(days=days_ahead)
    while d.weekday() > 4:
        d += datetime.timedelta(days=1)
    return d.strftime('%Y-%m-%d')


def errors_except(app, *allowed):
    """Console errors since the screen opened, without the failed requests a check provoked on purpose (a 401 for a
    wrong current password, a 403 for another coach's record): `allowed` are substrings of those lines."""
    return [e for e in app.errors_since() if not any(a in e for a in allowed)]


TOAST_SEEN = r'''(rx) => { const norm = (s) => (s || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
  const re = new RegExp(rx); const H = window.innerHeight, W = window.innerWidth;
  const els = Array.from(document.querySelectorAll('div[dir=auto],span')).filter((e) => re.test(norm(e.innerText)) && !e.closest('[aria-hidden="true"]'));
  const at = els.map((e) => { const q = e.getBoundingClientRect(); return { top: Math.round(q.top), bottom: Math.round(q.bottom), w: Math.round(q.width), live: !!e.closest('[aria-live]') }; });
  return { seen: at.some((q) => q.w > 0 && q.top >= 0 && q.bottom <= H), at, H, W }; }'''


def toast_seen(app, rx, seconds=20):
    """Whether a toast whose words match `rx` (case-sensitive) is drawn inside the viewport, not merely present in the
    document (a toast at the top of a long scrolled page is off-screen). Returns (ok, detail with the positions)."""
    expr = '(%s)(%s)' % (TOAST_SEEN, json.dumps(rx))
    end = time.monotonic() + seconds
    last = None
    while time.monotonic() < end:
        try:
            last = app.js(expr)
            if last and last.get('seen'):
                return True, json.dumps(last)[:300]
        except Exception:  # noqa: BLE001
            pass
        app.b.pump(0.2)
    return False, json.dumps(last)[:300]


def check_toast(app, name, rx, seconds=20, shot=None):
    ok, detail = toast_seen(app, rx, seconds)
    if ok and shot:
        app.screenshot(shot)
    check(name, ok, detail if not ok else '')
    return ok


SCROLL_TOP = r'''(anchor) => { const norm = (s) => (s || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim();
  const el = Array.from(document.querySelectorAll('div[dir=auto],[role=button]')).find((e) => norm(e.innerText) === anchor && e.getBoundingClientRect().width > 0 && !e.closest('[aria-hidden="true"]'));
  for (let p = el ? el.parentElement : null; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 4) return Math.round(p.scrollTop); }
  return -1; }'''


def scroll_top(app, anchor):
    """How far the scroll view holding the words `anchor` (text on the screen) is scrolled, in px (-1 when it is not
    found or does not scroll): proof that an action was pressed far down a long screen."""
    v = app.js('(%s)(%s)' % (SCROLL_TOP, json.dumps(anchor)))
    return v if isinstance(v, (int, float)) else -1


PULL_TO_REFRESH = r'''(anchor) => { const norm = (s) => (s || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
  const el = Array.from(document.querySelectorAll('[role=button]')).find((e) => norm(e.innerText) === anchor && !e.closest('[aria-hidden="true"]'));
  if (!el) return 'no anchor';
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$')); let f = key ? el[key] : null;
  while (f && !(f.memoizedProps && typeof f.memoizedProps.onRefresh === 'function')) f = f.return;
  if (!f) return 'no RefreshControl above the anchor';
  f.memoizedProps.onRefresh(); return 'pulled'; }'''


def pull_to_refresh(app, anchor):
    """The pull-to-refresh gesture of the scroll view holding the control `anchor`: react-native-web draws no pull, so
    the RefreshControl's onRefresh (what the gesture calls on a phone) is called through the React tree."""
    return app.js('(%s)(%s)' % (PULL_TO_REFRESH, json.dumps(anchor)))


def in_view(app, words):
    """Where the elements reading exactly `words` are drawn; `seen` when one of them is inside the viewport."""
    return app.js("""(() => { const at = Array.from(document.querySelectorAll('div[dir=auto]')).filter((x) => (x.innerText||'').trim() === %s).map((e) => { const q = e.getBoundingClientRect(); return [Math.round(q.top), Math.round(q.bottom), Math.round(q.width), !!e.closest('[aria-hidden="true"]')]; });
      return { seen: at.some((q) => q[2] > 0 && q[0] >= 0 && q[1] <= innerHeight), at, H: innerHeight }; })()""" % json.dumps(words)) or {}


def in_thread(app, words, seconds):
    """Wait until a bubble reading exactly `words` is drawn (a list row reads '<words> · <time>', so it does not count)."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if any(q[2] > 0 for q in in_view(app, words).get('at', [])):
            return True
        app.b.pump(0.3)
    return False


def member_read(conversation, body, token):
    """As the member: whether her message with `body` is marked read by the coach."""
    status, j, _ = ah.api(BASE, 'GET', '/conversations/%s/messages?limit=100' % conversation, token=token)
    if status != 200:
        return False
    return any(m.get('body') == body and m.get('readAt') for m in j.get('items', []))


# ---------------------------------------------------------------- pressing things inside one card
CARD_CLICK = r'''(needles, label) => { const norm = (s) => (s || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim();
  const dates = (t) => ((t || '').match(/\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} IST/g) || []).length;
  const ctrls = Array.from(document.querySelectorAll('[role=button],[role=link]')).filter((e) => norm(e.innerText) === label && !e.closest('[aria-hidden="true"]'));
  for (const c of ctrls) { let el = c.parentElement; while (el && !needles.every((n) => (el.innerText || '').includes(n))) el = el.parentElement;
    if (el && dates(el.innerText) === 1) { c.scrollIntoView({ block: 'center' }); c.click(); return true; } }
  return false; }'''


CARD_HAS = CARD_CLICK.replace("c.scrollIntoView({ block: 'center' }); c.click(); return true;", "return true;")


def card_has(app, needles, label):
    """Whether the appointment card holding every string of `needles` has a control reading `label`."""
    return bool(app.js("(%s)(%s, %s)" % (CARD_HAS, json.dumps(list(needles)), json.dumps(label))))


def card_click(app, needles, label, seconds=10):
    """Press the control reading `label` inside the appointment card whose text holds every string of `needles`: the
    nearest ancestor of the control holding them all, provided it holds one appointment time (one card, not the list)."""
    expr = "(%s)(%s, %s)" % (CARD_CLICK, json.dumps(list(needles)), json.dumps(label))
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if app.js(expr):
            return True
        app.b.pump(0.3)
    return False


def click_last(app, text):
    """Press the last control reading `text` (a sheet's footer button under a card button of the same name)."""
    return bool(app.js("(() => { const els = Array.from(document.querySelectorAll('[role=button]')).filter((e) => (e.innerText||'').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g,' ').trim() === %s); const el = els.pop(); if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()" % json.dumps(text)))


def real_click(app, text):
    """A press with real mouse events (Input.dispatchMouseEvent): the file pickers open only after a user gesture."""
    pos = app.js("(() => { const el = (%s)(%s, true); if (!el) return null; el.scrollIntoView({block: 'center'}); const q = el.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()" % (ah.FIND_CLICKABLE, json.dumps(text)))
    if not pos:
        return False
    for kind in ('mousePressed', 'mouseReleased'):
        app.b.call('Input.dispatchMouseEvent', type=kind, x=pos[0], y=pos[1], button='left', clickCount=1)
    return True


def watch_fetches(app):
    """Record every fetch the page makes (URL, status, content type) in window.__e2eFetches, and replace window.open
    (what expo-web-browser calls on the web) with a recorder, so a file opened through its token is not a new tab."""
    app.js("""(() => { window.__e2eFetches = window.__e2eFetches || []; window.__e2eOpened = window.__e2eOpened || [];
      if (!window.__e2eWrapped) { const of = window.fetch; window.fetch = async (...a) => { const r = await of(...a);
        try { window.__e2eFetches.push([String(a[0] && a[0].url ? a[0].url : a[0]), r.status, r.headers.get('content-type') || '']); } catch (e) {} return r; };
        window.__e2eWrapped = true; }
      window.open = (u) => { window.__e2eOpened.push(String(u)); return null; }; return true; })()""")


def fetches(app, pattern):
    return [f for f in (app.js('window.__e2eFetches || []') or []) if re.search(pattern, f[0])]


def opened(app):
    return app.js('window.__e2eOpened || []') or []


def fetch_url(url):
    """GET a token URL (no auth header: the token is the authority), returns (status, content type)."""
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            r.read()
            return r.status, r.headers.get('Content-Type', '')
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type', '')
    except Exception as e:  # noqa: BLE001
        return 0, repr(e)


class Chooser:
    """Chrome's file chooser, intercepted (Page.setInterceptFileChooserDialog): the next one opened gets `files`."""

    def __init__(self, app):
        self.app = app
        self.opened = []
        inner = app.b._event

        def event(msg):
            if msg.get('method') == 'Page.fileChooserOpened':
                self.opened.append(msg.get('params', {}))
                return
            inner(msg)
        app.b._event = event
        app.b.call('Page.setInterceptFileChooserDialog', enabled=True)

    def answer(self, files, seconds=10):
        end = time.monotonic() + seconds
        while time.monotonic() < end and not self.opened:
            self.app.b.pump(0.3)
        if not self.opened:
            return False
        node = self.opened.pop(0).get('backendNodeId')
        self.app.b.call('DOM.setFileInputFiles', files=files, backendNodeId=node)
        return True


def write_files(out):
    """A 16x16 PNG and a one-page PDF, made here (no download, no copy of anyone's file)."""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes([238, 51, 36]) * 16 for _ in range(16))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 16, 16, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    pdf = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
           b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
           b"0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n")
    os.makedirs(out, exist_ok=True)
    paths = {'png': os.path.join(out, 'e2e-sleep-log.png'), 'pdf': os.path.join(out, 'e2e-meal-plan.pdf')}
    with open(paths['png'], 'wb') as f:
        f.write(png)
    with open(paths['pdf'], 'wb') as f:
        f.write(pdf)
    return paths


# ---------------------------------------------------------------- preparation through the API (not the app)
def prepare():
    print('prepare: a requested check-in and a delivered report, through the scratch API')
    try:
        ananya = ah.ApiSession(BASE).login(*ANANYA_LOGIN, workspace='member')
        sunday = next_weekday(6, 2).replace(hour=10, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=5, minutes=30)
        start = sunday.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        status, j, _ = ah.api(BASE, 'POST', '/me/appointments', {'startAt': start, 'kind': 'check_in', 'note': REQUEST_NOTE}, token=ananya.token)
        ok = status == 201 and isinstance(j, dict) and j.get('status') == 'requested'
        check('prepare: Ananya requests a check-in outside the working hours (status requested)', ok, '%s %s' % (status, json.dumps(j)[:200]))
        if ok:
            PREP['requested'] = {'id': j['id'], 'when': ist_label(j['startAt'])}
        PREP['ananya'] = ananya   # kept for the replies the thread must fetch while open; signed out at the end
    except Exception as e:  # noqa: BLE001
        check('prepare: the requested check-in', False, repr(e)[:200])
    try:
        priya = ah.ApiSession(BASE).login(*PRIYA_LOGIN, workspace='member')
        day = (ist_today() + datetime.timedelta(days=3)).strftime('%Y-%m-%d')
        slots = priya.get('/me/bloodwork/slots?date=%s&pincode=560001' % day).get('slots', [])
        tests = priya.get('/me/bloodwork/tests').get('items', [])
        cbc = next((t for t in tests if 'Blood Count' in t.get('name', '')), tests[0] if tests else None)
        if not slots or not cbc:
            raise RuntimeError('no slot or test to book')
        slot = slots[min(6, len(slots) - 1)]
        status, j, _ = ah.api(BASE, 'POST', '/me/bloodwork/bookings', {'testId': cbc['id'], 'slotAt': slot['startAt'], 'labId': slot['labId'], 'pincode': '560001', 'address': '12 Test Street, Indiranagar', 'city': 'Bengaluru', 'state': 'Karnataka'}, token=priya.token)
        priya.logout()
        if status != 201:
            skip('prepare: a new report for Priya', 'the booking was refused (%s %s); run against a fresh reset-demo' % (status, json.dumps(j)[:160]))
            return
        booking = j['id']
        admin = ah.ApiSession(BASE).login(*ADMIN_LOGIN, workspace='admin', mfa_code=ah.demo_totp(BASE, ADMIN_LOGIN[0]))
        state = None
        for _ in range(8):
            status, k, _ = ah.api(BASE, 'POST', '/labstack/standin/step', {'bookingId': booking}, token=admin.token)
            if status != 200:
                break
            state = k['booking']['status']
            if state in ('results_ready', 'completed'):
                break
        reports = admin.get('/admin/reports').get('items', [])
        PREP['report'] = next((r['id'] for r in reports if r.get('bookingId') == booking or r.get('reference') == j.get('reference')), None)
        # another coach's report and conversation, for the refusals section
        PREP['other_report'] = next((r['id'] for r in reports if r.get('memberName') not in (ANANYA, PRIYA)), None)
        convs = admin.get('/conversations').get('items', [])
        PREP['other_conversation'] = next((c['id'] for c in convs if c.get('coachName') != 'Asha Menon'), None)
        admin.logout()
        check('prepare: the stand-in laboratory delivers Priya\'s new report', state in ('results_ready', 'completed') and bool(PREP.get('report')), '%s %s' % (state, PREP.get('report')))
    except Exception as e:  # noqa: BLE001
        check('prepare: the delivered report', False, repr(e)[:200])


# ---------------------------------------------------------------- sections
def notifications_section(app):
    print('notifications: the bell opens the coach\'s screen')
    app.open_route('/(coach)', r'^Today', 40)
    label = app.js("(document.querySelector('[aria-label^=\"Notifications\"]') || {}).getAttribute ? document.querySelector('[aria-label^=\"Notifications\"]').getAttribute('aria-label') : ''") or ''
    check('the bell is in the header with the unread count', label.startswith('Notifications'), label)
    app.js("document.querySelector('[aria-label^=\"Notifications\"]').click(); true")
    arrived = app.wait_text(r'^Notifications$', 30)
    app.settled(20)
    check('the bell opens /coach/notifications', arrived and app.path() == '/coach/notifications', app.path())
    app.wait_text(r'Report to review|New message|^Nothing yet\.$', 20)
    app.page_ok('Notifications screen', r'^Mark all read$')
    check('the seeded notifications are listed (title, body, time)', app.has_text(r'^Report to review$') and app.has_text(r'ago$|^just now$'), app.text()[:200])
    check('no wording of the screen\'s own about what a notification carries', not app.has_text('Health detail never appears here'))
    no_labels(app, 'Notifications')
    app.screenshot('coach-b-notifications')
    unread_before = app.js("document.querySelectorAll('[aria-label^=\"Unread: \"]').length")
    app.click_text('Mark all read')
    check('Mark all read: no unread item is left', app.wait_js("document.querySelectorAll('[aria-label^=\"Unread: \"]').length === 0", 15), 'before: %s' % unread_before)
    check('the bell shows no unread count afterwards', app.wait_js("!/, \\d+ unread/.test(document.querySelector('[aria-label^=\"Notifications\"]').getAttribute('aria-label'))", 15))


def calendar_section(app):
    print('calendar: Appointments with every action')
    watch_fetches(app)
    app.open_route('/(coach)/calendar', r'^Appointments$', 40)
    app.wait_text(ANANYA, 20)
    app.page_ok('Calendar', r'^Appointments$')
    plain(app, 'Calendar', "Requested appointments need your confirmation; completed consultations consume the member's entitlement.", 'Upcoming', 'Past', 'All', ANANYA, PRIYA, 'uses entitlement')
    check('cards carry the actions of their status', app.has_text(r'^Complete$') and app.has_text(r'^Move$') and app.has_text(r'^Cancel$') and app.has_text(r'^No-show$'))
    check('sessions on: "Add how to join" under scheduled times', app.has_text('Add how to join'))
    no_labels(app, 'Calendar')
    no_contact_details(app, 'Calendar')
    app.screenshot('coach-b-calendar')
    req = PREP.get('requested')
    if req:
        check('the requested check-in shows with its note, REQUESTED and Confirm (no Complete yet)', app.has_text(rx(REQUEST_NOTE)) and card_has(app, [REQUEST_NOTE, 'REQUESTED'], 'Confirm') and not card_has(app, [REQUEST_NOTE], 'Complete'), app.text()[:400])
        card_click(app, [REQUEST_NOTE], 'Confirm')
        check_toast(app, 'Confirm → toast "Confirmed", inside the viewport (list scrolled %dpx)' % scroll_top(app, 'Appointments'), r'^Confirmed$')
        check('the check-in is now scheduled: its card offers Complete', app.wait_js("(%s)(%s, 'Complete')" % (CARD_HAS, json.dumps([REQUEST_NOTE, 'SCHEDULED'])), 15), app.text()[:400])
    else:
        skip('Confirm', 'no requested appointment was prepared')
    # how to join, the calendar file, the link saved
    seeded = [ANANYA, 'Booked by your coach']
    if card_click(app, seeded, 'Add how to join'):
        check('"How to join" sheet with the portal\'s notes', app.wait_text(r'^How to join$', 10) and app.has_text('No video provider is connected, so Bioptime creates no meeting.') and app.has_text('The https link you will use for this consultation.'))
        app.click_text('Add this consultation to your calendar')
        app.b.pump(2)
        ics = fetches(app, r'/api/coach/appointments/[^/]+/ics$')
        check('the calendar file is fetched with the session (200, text/calendar)', bool(ics) and ics[-1][1] == 200 and 'calendar' in ics[-1][2], str(ics[-1:] or 'no request'))
        app.type_into('Meeting link', 'https://meet.example.test/e2e-asha')
        click_last(app, 'Save')
        check_toast(app, 'Save → toast "Join details saved", inside the viewport', r'^Join details saved$')
        check('the card now offers "Edit join link"', app.wait_text(r'^Edit join link$', 15))
    else:
        check('"Add how to join" on Ananya\'s seeded check-in', False, app.text()[:300])
    # move
    if card_click(app, seeded, 'Move'):
        check('"Move the appointment" sheet with Keep', app.wait_text(r'^Move the appointment$', 10) and app.find_clickable('Keep'))
        app.type_into('Date', next_working_day(3))
        if app.wait_text(r'free slots in your working hours', 20):
            app.click_text('Slot')
            app.b.pump(0.6)
            app.js("(() => { const rows = Array.from(document.querySelectorAll('[role=button]')).filter((e) => /^\\d{2}:\\d{2}$/.test((e.innerText||'').replace(/[\\ue000-\\uf8ff]/g, '').trim())); if (rows.length) rows[0].click(); return rows.length; })()")
            app.b.pump(0.4)
            click_last(app, 'Move')
            check_toast(app, 'Move → toast "Moved", inside the viewport', r'^Moved$')
        else:
            app.click_text('Keep')
            skip('Move', 'no free slot on %s' % next_working_day(3))
    # complete Priya's consultation
    if card_click(app, [PRIYA, 'Consultation'], 'Complete'):
        check('"Mark the consultation completed" sheet', app.wait_text(r'^Mark the consultation completed$', 10) and app.has_text(rx("Completing a consultation consumes one of the member's consultations.")) and app.find_clickable('Not yet'))
        app.type_into('What was covered (internal, optional)', 'E2E: sleep routine and the next block.')
        click_last(app, 'Complete')
        check_toast(app, 'Complete → toast "Completed", inside the viewport', r'^Completed$')
    else:
        check('Complete on Priya\'s consultation', False, app.text()[:300])
    # no-show on Ananya's seeded check-in, cancel the requested one
    # a short screen (390x480), so the card is pressed with the list scrolled, as on a phone with a longer list
    app.b.viewport(390, 480, mobile=True)
    app.b.pump(0.8)
    pressed = card_click(app, seeded, 'No-show')
    if pressed:
        at = scroll_top(app, 'Appointments')
        check('No-show is pressed with the list scrolled (%dpx on a 480px-high screen)' % at, at > 0)
        check_toast(app, 'No-show → toast "Marked no-show", inside the viewport', r'^Marked no-show$', shot='coach-b-calendar-noshow-toast')
    app.b.viewport(390, 844, mobile=True)
    app.b.pump(0.8)
    if not pressed:
        check('No-show on Ananya\'s seeded check-in', False, app.text()[:300])
    if req and card_click(app, [REQUEST_NOTE], 'Cancel'):
        check('"Cancel this appointment?" asks for a reason in the portal\'s words (Reason (recorded in the audit log), Keep as is)', app.wait_text(r'^Cancel this appointment\?$', 10) and app.has_text('The member is notified and any reserved consultation is given back.') and app.has_text(r'^Reason \(recorded in the audit log\)$') and app.has_input('What you know, and why this is right') and app.find_clickable('Keep as is'), app.text()[-400:])
        check('no second "Cancel" beside "Cancel appointment" in the sheet', not app.js("Array.from(document.querySelectorAll('[role=button]')).some((e) => (e.innerText||'').trim() === 'Cancel' && e.closest('[aria-modal=\"true\"],[role=dialog]'))"))
        app.click_text('Cancel appointment')
        check('"Cancel appointment" without a reason: "Say why, in a few words."', app.wait_text(r'^Say why, in a few words\.$', 10), app.text()[-300:])
        app.type_into('Reason (recorded in the audit log)', 'E2E: away that weekend')
        app.click_text('Cancel appointment')
        check_toast(app, 'Cancel → toast "Cancelled", inside the viewport', r'^Cancelled$')
    elif req:
        check('Cancel on the requested check-in', False, app.text()[:300])
    # the summary of the completed consultation
    app.click_text('Past')
    if app.wait_text(r'^Write summary$', 20):
        card_click(app, [PRIYA], 'Write summary')
        check('"Write the consultation summary" sheet', app.wait_text(r'Follow-ups for you', 15) and app.has_text('Write the consultation summary') and app.has_text('One summary per consultation.'))
        check('"Send to the member" disabled under 10 characters', app.is_disabled('Send to the member'))
        app.type_into('Summary for the member', 'E2E: we went through your sleep routine and agreed to keep the earlier dinner for two more weeks.')
        app.type_into('Private note (optional)', 'E2E: ask about work hours next time.')
        app.click_text('Add a follow-up')
        app.type_into('What to follow up', 'E2E: check the sleep log on Thursday')
        app.screenshot('coach-b-calendar-summary-form')
        app.click_text('Send to the member')
        check_toast(app, 'Send → toast "Summary sent to the member", inside the viewport', r'^Summary sent to the member$')
        check('the card now reads "Summary"', app.wait_text(r'^Summary$', 15))
        card_click(app, [PRIYA], 'Summary')
        check('the written summary opens read-only with the private note and the follow-up', app.wait_text(r'^Consultation summary$', 10) and app.has_text(r'^Sent to the member, ', ) and app.has_text('E2E: ask about work hours next time.') and app.has_text('E2E: check the sleep log on Thursday'))
        app.screenshot('coach-b-calendar-summary')
        click_last(app, 'Close')
    else:
        check('Past lists the completed consultation with "Write summary"', False, app.text()[:300])
    app.click_text('All')
    check('All lists the cancelled and the no-show appointments', app.wait_text(r'^CANCELLED$|^Cancelled$', 20) and app.has_text(r'^NO SHOW$|^No show$'), app.text()[:400])
    app.screenshot('coach-b-calendar-all')
    check('no console error on Calendar', not errors_except(app), '; '.join(app.errors_since()[:3]))
    print('appointments: /coach/appointments is the same page')
    app.open_route('/coach/appointments', None, 30)
    check('/coach/appointments opens Calendar (Appointments)', app.wait_text(r'^Appointments$', 20) and app.path() in ('/calendar', '/(coach)/calendar'), app.path())


def messages_section(app):
    print('messages: the list, a thread, files and the Coach AI panel')
    watch_fetches(app)
    app.open_route('/(coach)/messages', r'^Messages$', 40)
    app.wait_text(ANANYA, 20)
    app.page_ok('Messages list', r'^Messages$')
    plain(app, 'Messages', 'Your conversations with assigned clients. Keep health detail in the app, not in notifications.', ANANYA, PRIYA, 'No messages yet')
    no_labels(app, 'Messages')
    no_contact_details(app, 'Messages')
    app.screenshot('coach-b-messages')
    ananya = PREP.get('ananya')
    if ananya and ananya.token:
        # a thread longer than the screen, so the toast and scrolling checks below mean something
        convs = ah.api(BASE, 'GET', '/conversations', token=ananya.token)[1].get('items', [])
        if convs:
            for n in range(1, 9):
                ah.api(BASE, 'POST', '/conversations/%s/messages' % convs[0]['id'], {'body': 'E2E: note %d of 8 from Ananya, so the thread is longer than the screen.' % n}, token=ananya.token)
    app.click_text(ANANYA, exact=False)
    check('the thread opens', app.wait_text(r'Slept 7 hours for the third night running', 40) and app.path().startswith('/coach/messages/cnv_'), app.path())
    app.settled(10)
    plain(app, 'Thread', 'Open client', 'Never diagnose; point to a doctor when a result needs one.', 'Add a file', 'PNG, JPEG, WebP or PDF, up to 5 MB each.', 'Draft a reply')
    check('the thread is marked read: no unread count on the Messages tab', app.wait_js("!Array.from(document.querySelectorAll('[role=tab]')).some((e) => /^\\d+ Messages/.test((e.innerText||'').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g, ' ').trim()))", 15), str(app.tab_badges()))
    check('Send disabled with nothing to send', app.is_disabled('Send'))
    no_labels(app, 'Thread')
    # files through the real pickers
    files = write_files(OUT)
    chooser = Chooser(app)
    real_click(app, 'Add a file')
    check('"Add a file" offers the photo library and a document', app.wait_text(r'^Photo or image$', 10) and app.has_text(r'^Document$'))
    app.b.pump(0.8)
    real_click(app, 'Document')
    picked = chooser.answer([files['pdf']])
    ok = picked and app.wait_text(r'e2e-meal-plan\.pdf', 15) and any(f[1] == 201 for f in fetches(app, r'/attachments$'))
    if not ok:
        app.screenshot('coach-b-thread-pdf-not-picked')
    check('the document picker takes a PDF; it is uploaded (201) and waits as a chip', ok, 'chooser opened: %s; %s' % (picked, str(fetches(app, r'/attachments')[-2:])))
    real_click(app, 'Add a file')
    app.wait_text(r'^Photo or image$', 10)
    app.b.pump(0.8)
    real_click(app, 'Photo or image')
    picked = chooser.answer([files['png']])
    check('the image picker takes a PNG; it is uploaded and waits as a chip', picked and app.wait_text(r'e2e-sleep-log\.png', 15), app.text()[-300:])
    app.screenshot('coach-b-thread-pending')
    check('a waiting file can be removed', app.click_text('Remove e2e-sleep-log.png') and app.wait_js("!/e2e-sleep-log\\.png/.test(document.body.innerText)", 15))
    # a file the server refuses (plain text named .png), picked in a thread longer than the screen: the toast is seen
    errs_before = app.errors_since()
    bad = os.path.join(OUT, 'e2e-not-an-image.png')
    with open(bad, 'wb') as f:
        f.write(b'This is plain text, not an image.\n' * 4)
    real_click(app, 'Add a file')
    app.wait_text(r'^Photo or image$', 10)
    app.b.pump(0.8)
    real_click(app, 'Document')
    picked = chooser.answer([bad])
    app.b.pump(0.3)
    check('the thread is longer than the screen and scrolled down to its newest messages', scroll_top(app, 'Open client') > 0, str(scroll_top(app, 'Open client')))
    check_toast(app, 'a refused file: the toast "e2e-not-an-image.png: <the server\'s reason>" is inside the viewport (thread scrolled %dpx)' % scroll_top(app, 'Open client'), r'^e2e-not-an-image\.png: \S', 20, shot='coach-b-thread-file-error') if picked else check('the document picker takes the refused file', False)
    check('… and the refused file does not wait as a chip', not app.has_text(r'IMG · e2e-not-an-image\.png'))
    app.b.pump(1.0)
    app.err_mark = len(app.b.errors)   # the refused upload's 4xx is the point of the check above
    app.type_into('Write to the member. Plain, warm, candid about limits.', 'E2E: here is the meal plan we discussed; have a look before Thursday.')
    app.click_text('Send')
    check('the message is sent with its file', app.wait_text(r'E2E: here is the meal plan we discussed', 20) and app.wait_text(r'^PDF · e2e-meal-plan\.pdf', 10), app.text()[-400:])
    app.b.pump(0.6)
    before = len(opened(app))
    app.click_text('PDF · e2e-meal-plan.pdf · 1 KB', exact=False)
    app.wait_js('(window.__e2eOpened || []).length > %d' % before, 10)
    urls = opened(app)[before:]
    status, ctype = fetch_url(urls[-1]) if urls else (0, 'nothing opened')
    check('the file opens through a 5-minute token (POST /attachments/:id/file-token, then the PDF)', bool(urls) and status == 200 and 'pdf' in ctype, '%s %s %s' % (urls[-1:] if urls else '', status, ctype))
    # Coach AI in place
    app.click_text('Open', seconds=5)
    check('the "Draft a reply" panel opens (its status, or the ask card)', app.wait_text(r'Coach AI is not configured|Ask for a draft', 20), app.text()[-400:])
    app.screenshot('coach-b-thread')
    # a reply that arrives while the thread is open: pull to refresh, then the badges tick
    ananya = PREP.get('ananya')
    conv = app.path().rsplit('/', 1)[-1]
    if ananya and ananya.token and conv.startswith('cnv_'):
        stamp = time.strftime('%H:%M:%S')   # words of this run only: a scratch database may hold an earlier run's replies
        pulled = 'E2E: a reply while the thread is open (pull to refresh, %s)' % stamp
        loads = len(fetches(app, r'/conversations/%s/messages\?' % conv))
        status, j, _ = ah.api(BASE, 'POST', '/conversations/%s/messages' % conv, {'body': pulled}, token=ananya.token)
        check('Ananya replies through the API while the thread is open', status in (200, 201), '%s %s' % (status, json.dumps(j)[:160]))
        app.b.pump(0.5)
        before = '%s (thread loads since the reply: %d)' % (bool(in_view(app, pulled).get('seen')), len(fetches(app, r'/conversations/%s/messages\?' % conv)) - loads)
        how = pull_to_refresh(app, 'Open client')
        check('pull to refresh: the thread fetches the reply that arrived while it was open', how == 'pulled' and in_thread(app, pulled, 15), '%s; in view before the pull: %s' % (how, before))
        end = time.monotonic() + 15
        while time.monotonic() < end and not member_read(conv, pulled, ananya.token):
            app.b.pump(0.5)
        check('… and marks it read again (Ananya sees her reply read)', member_read(conv, pulled, ananya.token))
        end = time.monotonic() + 10
        while time.monotonic() < end and not in_view(app, pulled).get('seen'):
            app.b.pump(0.3)
        seen = in_view(app, pulled)
        check('… the newest message is in view (the thread scrolled to it)', seen.get('seen'), json.dumps(seen)[:300])
        app.screenshot('coach-b-thread-pulled')
        ticked = 'E2E: a reply that arrives on the badges tick (%s)' % stamp
        status, j, _ = ah.api(BASE, 'POST', '/conversations/%s/messages' % conv, {'body': ticked}, token=ananya.token)
        t0 = time.monotonic()
        ok = status in (200, 201) and in_thread(app, ticked, 75)
        check('the badges tick (GET /coach/home once a minute) brings a new reply into the open thread without a pull (%.0fs)' % (time.monotonic() - t0), ok, '%s %s' % (status, json.dumps(j)[:120]))
        end = time.monotonic() + 15
        while ok and time.monotonic() < end and not member_read(conv, ticked, ananya.token):
            app.b.pump(0.5)
        check('… and marks it read', ok and member_read(conv, ticked, ananya.token))
    else:
        skip('a reply while the thread is open (pull to refresh, the badges tick)', 'no member session from the preparation (E2E_PREPARE=0)')
    errs = errs_before + errors_except(app)
    check('no console error in the thread (apart from the refused file)', not errs, '; '.join(errs[:3]))


def bloodwork_section(app):
    print('bloodwork: reports and bookings')
    app.open_route('/coach/bloodwork', r'^Bloodwork$', 40)
    app.wait_text(r'Full Body Checkup, Advanced', 20)
    app.page_ok('Bloodwork', r'^Bloodwork$')
    plain(app, 'Bloodwork', 'Reports to review for your clients, and their bookings. Reviewing a report releases it to the member and completes the booking.', 'Reports', 'Bookings', ANANYA, 'BIO-24001', 'Full Body Checkup, Advanced', 'Delivered ')
    check('the reviewed report reads "{reviewer} · {date}" and offers Open', app.has_text(r'^Asha Menon · \d') and app.find_clickable('Open'))
    if PREP.get('report'):
        check('Priya\'s new report waits: "Awaiting review" and Review', app.has_text(r'^AWAITING REVIEW$|^Awaiting review$') and app.find_clickable('Review'))
    check('flags from the laboratory as pills', app.has_text(r'VITAMIN D|Vitamin D'))
    check('no Catalogue tab for a coach', not app.has_text(r'^Catalogue$'))
    no_labels(app, 'Bloodwork')
    no_contact_details(app, 'Bloodwork')
    app.screenshot('coach-b-bloodwork')
    app.click_text('Bookings')
    check('bookings: reference, member, test and slot, the laboratory line with "stand-in"', app.wait_text(r'^BIO-24006$', 15) and app.has_text(r'Laboratory LS-\d+ · [A-Z_]+ · stand-in') and app.has_text(PRIYA), app.text()[:400])
    app.screenshot('coach-b-bookings')
    app.click_text('Reports')


def report_section(app):
    print('report: the review form, the document and the lab next steps')
    watch_fetches(app)
    app.open_route('/coach/bloodwork', r'^Bloodwork$', 40)
    app.wait_text(r'Full Body Checkup, Advanced', 20)
    # the reviewed report first: the commentary and the flags
    app.click_text('Open')
    check('the reviewed report opens', app.wait_text(r'Results as reported by the laboratory', 40) and app.path().startswith('/coach/reports/rpt_'), app.path())
    app.page_ok('Report (reviewed)', r'^Coach commentary$')
    plain(app, 'Report', '← Client', 'Open report document', 'Section 1', 'Section 2', 'Section 3', 'Limits', 'A single test is a snapshot.', 'Laboratory range', 'Released to member', 'Released ')
    check('values outside the range carry "▲ Outside range (…)"', app.has_text(r'Outside range \('))
    check('the simulated note when the record says so', app.has_text(rx('Practice laboratory: this result is simulated and no sample is collected.')))
    no_labels(app, 'Report')
    no_contact_details(app, 'Report')
    app.screenshot('coach-b-report-reviewed')
    if not PREP.get('report'):
        skip('the review form', 'no unreviewed report was prepared (E2E_PREPARE=0, or the booking was refused)')
        return
    app.open_route('/coach/reports/%s' % PREP['report'], r'Results as reported by the laboratory', 40)
    app.page_ok('Report (to review)', r'^Mark reviewed and release$')
    plain(app, 'Review form', 'Note for the member', 'Plain language: what is in range, what is outside, what is urgent (usually nothing), what changes. Point to a doctor for decisions about medicines or tests.', 'Releasing completes the booking and notifies the member. It is recorded with your name.', 'Not released', 'awaiting review', 'Next steps are added once the report is reviewed and released.')
    before = len(opened(app))
    app.click_text('Open report document')
    app.wait_js('(window.__e2eOpened || []).length > %d' % before, 10)
    urls = opened(app)[before:]
    status, ctype = fetch_url(urls[-1]) if urls else (0, 'nothing opened')
    check('"Open report document": a 5-minute token, then the HTML report (no auth header)', bool(urls) and '/api/reports/file?token=' in urls[-1] and status == 200 and 'html' in ctype, '%s %s' % (status, ctype))
    check('"Mark reviewed and release" disabled under 5 characters', app.is_disabled('Mark reviewed and release'))
    app.type_into('Note for the member', 'E2E: all three counts are inside the laboratory ranges. Nothing here is urgent; keep the plan as it is.')
    app.click_text('Mark reviewed and release')
    pressed_at = scroll_top(app, 'Results as reported by the laboratory')
    check('the release is pressed far down the report (page scrolled %dpx), where a toast at the top would be off-screen' % pressed_at, pressed_at > 0)
    check_toast(app, 'toast "Report reviewed and released to the member", inside the viewport', r'^Report reviewed and released to the member$', shot='coach-b-report-release-toast')
    check('the report now reads "Released to member" and "reviewed by Asha Menon"', app.wait_text(r'^RELEASED TO MEMBER$|^Released to member$', 15) and app.has_text('reviewed by Asha Menon'))
    check('Next steps: the form once released', app.wait_text(r'^Add next step$', 20) and app.has_text('No next steps on this report yet.') and app.has_text('The member sees open and done next steps with the report.'), app.text()[-400:])
    app.click_text('Kind')
    app.b.pump(0.6)
    app.click_text('Retest')
    app.b.pump(0.4)
    check('the Retest kind shows its hint and the Booking link', app.has_text(rx('Agreed with the member (and their doctor where it matters); link the booking once it is made.')) and app.has_text(r'^Booking \(optional\)$'))
    app.click_text('Add next step')
    check('an empty next step is refused in the portal\'s words', app.wait_text(r'^Write the next step in a few words\.$', 10))
    app.type_into('Next step', 'E2E: repeat the blood count in three months; book it from Tests.')
    app.type_into('Due date (optional)', (ist_today() + datetime.timedelta(days=90)).strftime('%Y-%m-%d'))
    app.click_text('Add next step')
    check_toast(app, 'toast "Next step added; the member is notified without the detail", inside the viewport', r'^Next step added; the member is notified without the detail$', shot='coach-b-report-next-step-toast')
    check('the step is listed: kind, words, due date, the coach, Open', app.wait_text(r'^Retest · E2E: repeat the blood count', 15) and app.has_text(r'^Due \d+ [A-Z][a-z]{2} \d{4} · Coach Asha Menon') and app.has_text(r'^OPEN$|^Open$'), app.text()[-600:])
    app.screenshot('coach-b-report-next-step')
    app.click_text('Mark done')
    check_toast(app, 'Mark done → toast "Marked done", inside the viewport', r'^Marked done$', 15)
    app.click_text('Reopen')
    check('Reopen asks for a reason', app.wait_text(r'^Reopen this next step$', 10) and app.has_text('It returns to the open list, for you and the member.'))
    app.type_into('Reason', 'E2E: the retest date moved; still to do.')
    click_last(app, 'Reopen')
    check_toast(app, 'Reopen → toast "Reopened", inside the viewport', r'^Reopened$', 15)
    check('no console error on the report', not errors_except(app), '; '.join(app.errors_since()[:3]))


def profile_section(app):
    print('profile: the coach\'s own record')
    app.open_route('/coach/profile', r'^Coach profile$', 40)
    app.wait_text(r'^Professional record$', 20)
    app.page_ok('My profile', r'^Coach profile$')
    plain(app, 'Profile', 'Coach ID BPC-0001', 'account Active', 'last sign-in', 'Work email', 'asha.menon@demo.bioptime.test', 'Caseload', 'of 25 clients', 'Upcoming consultations', 'Unread', 'Coaching since', 'What members see', 'Designation, qualifications and scope are set by Bioptime', 'Professional record', 'off (optional for coaches)', 'These change through the administration workflow; ask the Bioptime team.', 'Working hours, status, blocks', 'Password and MFA')
    check('the identity pills', (app.has_text(r'^AVAILABLE$') or app.has_text(r'^AWAY')) and app.has_text(r'^PROFILE COMPLETE$|^PROFILE INCOMPLETE$'))
    no_labels(app, 'Profile')
    no_contact_details(app, 'Profile')
    app.screenshot('coach-b-profile')
    app.type_into('Bio', 'Strength and nutrition coach; ten years in studio and online coaching.')
    app.js("Array.from(document.querySelectorAll('[role=button]')).filter((e) => (e.innerText||'').trim() === 'Save')[0].click(); true")
    check('Save → toast "Profile saved"', app.wait_text(r'^Profile saved$', 20), app.text()[:300])


def settings_section(app):
    print('settings: security, sessions, the profile form, availability')
    app.open_route('/coach/settings', r'^Settings$', 40)
    app.wait_text(r'^Active sessions$', 20)
    app.wait_text(r'this one', 20)
    app.page_ok('Settings', r'^Settings$')
    plain(app, 'Settings', 'Your profile as members see it, your working hours, availability and security.', 'Password and MFA', 'Current password', 'New password', 'At least 10 characters.', 'Active sessions', 'this one', 'What members see', 'Working hours, status, blocks', 'Add window', 'Save hours', 'Mark me away', 'Add block', 'Away pauses your assignments; your members are told their plan and bookings stay and messages wait for you, and Bioptime can reassign them if needed.', 'Qualifications and scope are set by an administrator and shown to members only once verified.')
    check('the MFA pill', app.has_text(r'^MFA OFF$|^MFA ON$|^MFA off$|^MFA on$'))
    check('no MFA set-up for a coach (the portal and the API keep it to administrators and owners)', not app.has_text('Set up authenticator'))
    check('"Change password" disabled until both fields are filled', app.is_disabled('Change password'))
    no_labels(app, 'Settings')
    app.screenshot('coach-b-settings')
    if app.find_clickable('Sign out'):
        app.click_text('Sign out')
        check('another session signed out → toast "Session signed out"', app.wait_text(r'^Session signed out$', 15))
    else:
        skip('Sign out another session', 'only this session is active')
    app.click_text('Save hours')
    check('Save hours → toast "Working hours saved"', app.wait_text(r'^Working hours saved$', 20), app.text()[-300:])
    count = "Array.from(document.querySelectorAll('[role=button]')).filter((e) => (e.innerText||'').trim() === 'Remove window').length"
    before = app.js(count)
    app.click_text('Add window')
    check('Add window adds a working window (Mon, 09:00 to 12:00, 30 min)', app.wait_js('%s === %d' % (count, before + 1), 5) and app.input_value('Start') is not None, 'before %s' % before)
    click_last(app, 'Remove window')
    check('Remove window takes it away again (nothing saved until "Save hours")', app.wait_js('%s === %d' % (count, before), 5))
    app.type_into('Block from', '2026-12-24')
    app.type_into('From time (IST)', '09:00')
    app.type_into('to', '2026-12-24')
    app.type_into('To time (IST)', '12:00')
    app.type_into('Block reason', 'E2E leave')
    app.click_text('Add block')
    check('Add block → toast "Blocked"', app.wait_text(r'^Blocked$', 20), app.text()[-300:])
    check('the block is listed', app.wait_text(r'Blocked 24 Dec, 09:00 IST → 24 Dec, 12:00 IST · E2E leave', 15), app.text()[-300:])
    app.click_text('Remove')
    check('the block is removed', app.wait_js("!/24 Dec, 09:00 IST/.test(document.body.innerText)", 15))
    check('"Mark me away" disabled without a reason', app.is_disabled('Mark me away'))
    app.type_into('Reason', 'E2E travel')
    app.click_text('Mark me away')
    check('Mark me away → toast "Marked away; your assignments are paused"', app.wait_text(rx('Marked away; your assignments are paused'), 20), app.text()[-300:])
    check('the pill reads Away', app.wait_text(r'^AWAY$|^Away$', 15))
    app.type_into('Reason', 'E2E back')
    app.click_text('Mark me available')
    check('Mark me available → toast "You are available"', app.wait_text(r'^You are available$', 20), app.text()[-300:])
    app.err_mark = len(app.b.errors)
    app.type_into('Current password', 'not-the-password-1')
    app.type_into('New password', 'E2E-new-password-1')
    app.click_text('Change password')
    check('a wrong current password shows the API\'s sentence and keeps the session', app.wait_text(r'current password is not right|not right', 20) and app.has_text('Password and MFA'), app.text()[:300])
    check('no console error on Settings beyond the refused password', not errors_except(app, '/api/auth/password/change'), '; '.join(app.errors_since()[:3]))
    app.screenshot('coach-b-settings-security')


def refusals_section(app):
    print('refusals: another coach\'s report and thread in plain words')
    if PREP.get('other_report'):
        app.open_route('/coach/reports/%s' % PREP['other_report'], None, 30)
        check('another coach\'s report: the server\'s sentence, no "Something went wrong"', app.wait_text(r'You do not have access to this|not shared', 20) and not app.has_text(r'^Something went wrong$'), app.text()[:200])
        check('… and no review form', not app.has_text('Mark reviewed and release'))
        app.screenshot('coach-b-report-refused')
    else:
        skip('another coach\'s report', 'not prepared')
    if PREP.get('other_conversation'):
        app.open_route('/coach/messages/%s' % PREP['other_conversation'], None, 30)
        check('another coach\'s thread: "Not your conversation", no composer', app.wait_text(r'^Not your conversation$', 20) and not app.has_text(r'^Add a file$') and not app.find_clickable('Send'), app.text()[:200])
        app.screenshot('coach-b-thread-refused')
    else:
        skip('another coach\'s thread', 'not prepared')


def open_client_section(app):
    """Last, because the client record is another group's screen: only that "Open client" goes there."""
    print('open client: the thread\'s link to the client record')
    app.open_route('/(coach)/messages', r'^Messages$', 40)
    app.click_text(ANANYA, exact=False)
    app.wait_text(r'^Open client$', 30)
    app.click_text('Open client')
    end = time.monotonic() + 20
    while time.monotonic() < end and not app.path().startswith('/coach/clients/usr_'):
        app.b.pump(0.3)
    check('"Open client" opens /coach/clients/<the member>', app.path().startswith('/coach/clients/usr_'), app.path())


SECTIONS = {'notifications': notifications_section, 'calendar': calendar_section, 'messages': messages_section, 'bloodwork': bloodwork_section, 'report': report_section, 'profile': profile_section, 'settings': settings_section, 'refusals': refusals_section, 'open-client': open_client_section}


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4351 (never the live demo).')
    why = ah.live_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server (BASE=http://127.0.0.1:<port>).' % (BASE, why))
    why = ah.port_refusal(APP_PORT) if not APP_URL else ah.live_refusal(APP_URL)
    if why:
        sys.exit('Refusing the app server %s: %s.' % (APP_URL or APP_PORT, why))
    only = [s.strip() for s in os.environ.get('E2E_APP_ONLY', '').split(',') if s.strip()] or list(SECTION_NAMES)
    unknown = [s for s in only if s not in SECTIONS]
    if unknown:
        sys.exit('E2E_APP_ONLY names unknown sections %s; the sections are %s' % (unknown, ', '.join(SECTION_NAMES)))
    only = [s for s in SECTION_NAMES if s in only]
    why = ah.cdp_refusal(CDP_PORT)
    if why:
        sys.exit('Refusing E2E_CDP_PORT %s: %s.' % (CDP_PORT, why))
    if not APP_URL and ah.port_in_use(APP_PORT):
        sys.exit('APP_PORT %s is already in use: choose another, or pass APP_URL=http://localhost:%s to drive the server that runs there.' % (APP_PORT, APP_PORT))
    ah.configure(OUT, CDP_PORT)
    app_url = APP_URL or 'http://localhost:%s' % int(APP_PORT)
    if not ah.cors_allows(BASE, app_url):
        sys.exit('The API at %s does not allow the browser origin %s: start the scratch API with CORS_ORIGINS=%s.' % (BASE, app_url, app_url))
    t0 = time.monotonic()
    timings = {}
    expo = b = app = None
    try:
        if PREPARE:
            prepare()
        else:
            skip('prepare', 'E2E_PREPARE=0')
        if not APP_URL:
            expo = ah.ExpoWeb(APP_PORT, BASE, APP_DIR)
            expo.start()
            timings['expo start'] = round(expo.started_in, 1)
            print('expo web answering on %s after %.0fs (log: %s)' % (expo.url, expo.started_in, expo.log_path))
        b = ah.start_browser()
        b.viewport(390, 844, mobile=True)
        app = ah.App(b, BASE, app_url)
        took = app.boot()
        timings['first screen'] = round(took, 1)
        check('the app draws its first screen (the chooser or a sign-in)', app.has_text(ah.SIGN_IN_SCREEN), '%.1fs, at %s' % (took, app.path()))
        r = app.sign_in('coach', *COACH)
        check('Asha signs in through the coach sign-in (the one sign-in in the app)', r['ok'], r['detail'])
        if r['ok']:
            for name in only:
                t1 = time.monotonic()
                try:
                    SECTIONS[name](app)
                except Exception as e:  # noqa: BLE001
                    traceback.print_exc()
                    check('section %s completed without an unexpected error' % name, False, repr(e)[:300])
                timings[name] = round(time.monotonic() - t1, 1)
                print('  (%s took %.0fs)' % (name, timings[name]))
            ok, d = app.sign_out()
            check('the coach signs out and lands on a sign-in screen', ok, d)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        check('the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        if app:
            try:
                app.screenshot('last-screen')
            except Exception:  # noqa: BLE001
                pass
        if b:
            try:
                b.close()
            except Exception:  # noqa: BLE001
                pass
        if expo:
            expo.stop()
        if PREP.get('ananya'):
            try:
                PREP['ananya'].logout()
            except Exception:  # noqa: BLE001
                pass
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'sections': only, 'prepared': sorted(k for k in PREP if k != 'ananya'), 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
