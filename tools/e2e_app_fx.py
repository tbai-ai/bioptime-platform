#!/usr/bin/env python3
"""The client app's acceptance check after its redesign (30 October 2026: the earlier app's look and feel with the
Bioptime mark), through its Expo web build in headless Chrome (Python 3.9, stdlib, Google Chrome). BUILD_PLAN §8.4 and
AMENDED_PLAN_NOTES §8, and the owner's list: sign in, find your way, see your workouts, log them, get your coach's
changes, read your wellness information, survive a lost connection, on every screen size, with and without motion.

    BASE=http://127.0.0.1:3984 APP_URL=http://localhost:9624 python3 -I tools/e2e_app_fx.py
    BASE=… APP_PORT=9624 E2E_FX_ONLY=login,nav python3 -I tools/e2e_app_fx.py      only the named sections
    BASE=… API_STOP='…' API_START='…' python3 -I tools/e2e_app_fx.py              the offline section stops the real API

BASE, APP_PORT / APP_URL, APP_DIR, E2E_OUT and E2E_CDP_PORT work as in tools/e2e_app.py (the same refusals: never the
live demo's ports, BASE an explicit local port; E2E_OUT default .local/e2e/app-fx/). The scratch API must be freshly
reset with the demo seed (reset-demo, BIOPTIME_MODE=demo) and allow the app's origin (CORS_ORIGINS). Run it twice:
against an API without OPEN_PREVIEW (the login section then checks that no "Continue without signing in" card shows)
and with OPEN_PREVIEW=1 (the card's one tap). API_STOP and API_START are commands (split like a shell line, no shell)
that stop and start that same scratch API on the same database; without them the offline section takes the API away
inside Chrome instead (every request to BASE fails as a refused connection) and says so in its check names.

Sections (E2E_FX_ONLY; default all, in this order) and the check ids of BUILD_PLAN §8.4:
  login       email and password (Priya), the phone code through the sign-in's Phone segment, and the open preview's
              one-tap card: shown, nothing sent until the tap, exactly one POST /auth/open-preview on it (only against
              an OPEN_PREVIEW server; otherwise: no card)
  nav         N1 the nine tabs by label in order, aria-selected follows each tap, the halo sits on the chosen tab, a
              drag on the page follows the pointer and a swipe moves one tab; N4 every old address lands on its new
              place with the right segment, section or sub-tab first
  wellness    Bio's metrics, Life's latest report and its markers, Tests' bookings and a report overlay show what the
              API holds for Priya
  train       the coach's sessions of this week (GET /me/workouts) are on Train; V1 the clips are served with byte
              ranges, the player shows the poster and plays after a tap, an exercise without a clip shows the text-only
              sentence; "Log session" with no set ticked asks first; S2 every set ticked, effort 7, Log session ⇒ the
              session is completed in the API, with its sets, and the coach sees it completed
  sync        S1 as Asha (the API, coach workspace): a new version of Priya's programme with a new title, published;
              the app's Train shows the title and "Version n" within 45 s (polling and focus, no push), and the Home
              bell lists "Your workout programme was updated"
  ai          AI1 the assistant is off on the server (GET /me/assistant on:false, POST 409 ASSISTANT_OFF) and the Coach
              tab draws no Assistant segment
  motion      M1 reduced motion: Home at rest 300 ms after it draws (the score at its value, nothing moving after that,
              the brief complete); the splash goes on sooner than with full motion; M2 full motion: a tab change is
              done within 700 ms; then the motion v2 checks (FINAL_PLAN §10, filmed with an in-page frame sampler, touch
              input where a finger is meant): MV1 Home's 'Wellness' label passes through 0.2-0.95 opacity on >= 3
              frames after "Continue without signing in" (the email sign-in without an open preview); MV8 idle on
              Home 3 s, a touch drag to Train: Train's first card shows >= 3 mid-opacity frames; MV4 a touch swipe on
              Home's "This week" shelf scrolls it >= 150 px and stays on Home; MV5 a tab tapped 120 ms after a touch
              swipe is where the pager ends (3 of 3); MV6 Home → Store → Profile within 120 ms: every frame has a page
              covering the screen; MV3 Profile Overview → Achievements: no text drawn over 1.2x its height; MV2 the
              Bio Weight sheet keeps its height (±2 px) for >= 5 frames of its close; MV7 a reduced-motion tab change
              fades over >= 4 frames with no page moved sideways; then the wave-2 gate's rows: MW3 (M53) Email ↔ Phone
              on the sign-in: the new field above 0.3 opacity by +200 ms after the finger lifts, no blank frame, the
              block below gliding over >= 8 frames at <= 20 px a frame, the leaving inputs aria-hidden; MW1 (M52) the
              sign-in → Home exit: nothing moves > 2 px before it starts, it starts <= 650 ms after open-preview answers
              and is drawn over >= 6 frames; MW2 (M61) Home's Wellness centre keeps one layout and never shows "—" for a
              member with a score; MW4 (M77) the message just sent stays inside the visible thread on every frame from
              +333 ms; MW5 (M75) Train This week → Plan with no spinner frame; MW9 the tier-C pass (bp.fx.motionTier
              "C") and the reduced-motion pass: a tour of the nine tabs with no hard cut (no two frames running with
              no page drawn, no page arriving whole in one frame) and no "Loading" placeholder still drawn 3.5 s after
              a tap, and the Home inbox sheet showing its list, not a loader, from 1.5 s after it opens
  layout      L1 at 360x740 (DPR 3, a phone's user agent and touch), 390x844, 430x932 and 820x1180 (E2E_FX_SIZES picks
              some of them), under reduced
              motion: every tab scrolled page by page, the main overlays and the tabs' sheets: no sideways scroll, no
              text over text, no text cut without an ellipsis, controls at least 24x24 (tabs, Close and Back 44x44), the
              last content of a tab clear of the pill, no console error; L2 at 820: the content column at most 520 and
              centred, the pill showing all nine tabs with no chevron
  offline     O1 the API stopped: the screens say "No connection" with the honest sentence and "Try again"; started
              again: "Try again" (or coming back to a tab) brings the data back
  onboarding  F2 a new member: registration, the email code, consent, the slides, the nine quiz steps, Home with no
              number made up (score "—" with its sentence, no steps target, no kcal), the nine tabs drawing; then the
              wave-2 gate's rows with three more new members at 390x844, 360x740 and 820x1180: MW6 (M54) the quiz CTA
              at one y on all nine steps and the consent CTA still when its box is ticked (no clipped text at 360);
              MW7 (M58) a quiz step change never shows a frame without answers; MW8 (M59) a short drag on a slide
              springs back <= 300 ms, a 220 pt drag moves the title on >= 20 frames and turns the slide, and at
              820x1180 the quiz's threshold is the column's (100 pt stays, 130 pt goes back)

Accounts are the seeded demo ones; no code or secret is written here (the phone code comes from the demo server's own
preview helper). Exit status 1 if anything fails; the JSON summary is the last line."""
import json
import os
import re
import shlex
import subprocess
import sys
import time
import traceback
import urllib.request

sys.dont_write_bytecode = True   # no tools/__pycache__ from importing the harness (python -I does not prevent it)
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_harness as ah  # noqa: E402
from app_harness import check, skip  # noqa: E402
import e2e_app as ea  # noqa: E402  (shared helpers: on_home, screen_ok, the open preview's card, the phone code)

BASE = os.environ.get('BASE', '').rstrip('/')
APP_PORT = os.environ.get('APP_PORT') or '8122'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-fx')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9581'
API_STOP = os.environ.get('API_STOP', '').strip()
API_START = os.environ.get('API_START', '').strip()
SECTION_NAMES = ('login', 'nav', 'wellness', 'train', 'sync', 'ai', 'motion', 'layout', 'offline', 'onboarding')
PREVIEW = False

MEMBER = ea.MEMBER
COACH = ea.COACH
GREETING = ea.GREETING
SIZES = [(360, 740, 3, 'android'), (390, 844, 2, None), (430, 932, 3, None), (820, 1180, 2, None)]
# E2E_FX_SIZES=390x844,820x1180 limits the layout section to those sizes (default: all four)
_only_sizes = [x.strip() for x in os.environ.get('E2E_FX_SIZES', '').split(',') if x.strip()]
if _only_sizes:
    SIZES = [z for z in SIZES if '%dx%d' % (z[0], z[1]) in _only_sizes]
PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'


_SESSIONS = {}


class _Kept:
    """An ApiSession kept for the whole run: POST /auth/login is limited to 20 per 10 minutes per address (the app's
    own sign-ins count too), so Python signs in once per account and reuses the token; logout() here is a no-op."""

    def __init__(self, s):
        self.s, self.token, self.user, self.base = s, s.token, s.user, s.base

    def get(self, path):
        return self.s.get(path)

    def post(self, path, body=None):
        return self.s.post(path, body)

    def logout(self):
        pass


def api_session(who=MEMBER, workspace='member'):
    key = (who[0], workspace)
    if key not in _SESSIONS:
        _SESSIONS[key] = _Kept(ah.ApiSession(BASE).login(who[0], who[1], workspace))
    return _SESSIONS[key]


def end_sessions():
    for k in list(_SESSIONS):
        try:
            _SESSIONS.pop(k).s.logout()
        except Exception:
            pass


def wait_until(cond, app, seconds, step=0.3):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if cond():
                return True
        except Exception:
            pass
        app.b.pump(step)
    try:
        return bool(cond())
    except Exception:
        return False


def ensure_priya(app):
    """Priya signed in (email and password) and on Home."""
    if app.workspace == 'member':
        app.open_route('/(tabs)', None, 30)
        if ea.on_home(app, 'Priya', 15):
            return True
    if app.workspace:
        app.sign_out()
    r = app.sign_in('member', *MEMBER)
    return bool(r['ok']) and ea.on_home(app)


def click_label(app, prefix, exact=False):
    """Press the control whose aria-label is (or starts with) `prefix`, on the visible screen."""
    return bool(app.js("""(() => { const p = %s, exact = %s;
      const el = Array.from(document.querySelectorAll('[aria-label]')).find((e) => !e.closest('[aria-hidden="true"]') && (exact ? e.getAttribute('aria-label') === p : e.getAttribute('aria-label').startsWith(p)));
      if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()""" % (json.dumps(prefix), 'true' if exact else 'false')))


CLOSE_COUNT_JS = "Array.from(document.querySelectorAll('[aria-label=\"Close\"]')).filter((e) => !e.closest('[aria-hidden=\"true\"]')).length"


def close_sheet(app):
    """Close the open sheet with its Close control (not the Escape key: see the escape check in the onboarding section)."""
    if not app.js(CLOSE_COUNT_JS):
        return True
    app.click_text('Close', seconds=3)
    return wait_until(lambda: not app.js(CLOSE_COUNT_JS), app, 6)


def first_lines(app, n=30):
    return app.visible_text().split('\n')[:n]


def after(lines, line, n):
    """The n lines after the first one that reads `line` (Train's segment row ends with "History")."""
    return lines[lines.index(line) + 1:lines.index(line) + 1 + n] if line in lines else []


# ---------------------------------------------------------------- login
def login_section(app):
    print('login: email and password, the phone code, the open preview\'s one tap')
    if app.workspace:
        app.sign_out()
    app.open_route('/(auth)/sign-in', None, 30)
    mark = len(app.request_log)
    drawn = app.wait_visible(r'^Sign in$', 30) and app.has_input('Email') and ea.password_fields(app) == 1
    app.b.pump(1.0)
    if PREVIEW:
        check('login: the sign-in draws its form with the "Continue without signing in" card, and nothing is sent by itself', drawn and ea.sign_in_with_card(app) and not ea.preview_posts(app, mark), app.visible_text()[:200])
    else:
        check('login: the sign-in draws its form and, with no open preview on the server, no "Continue without signing in" card', drawn and not app.find_clickable(ea.PREVIEW_CARD) and not ea.preview_posts(app, mark), app.visible_text()[:200])
    app.screenshot('login-sign-in')
    r = app.sign_in('member', *MEMBER)
    home = r['ok'] and ea.on_home(app)
    check('login: Priya signs in with her email and password and lands on Home (greeting and first name)', home, r['detail'])
    if home:
        ok, d = app.sign_out()
        check('login: Sign out (Profile › Settings) leads back to the sign-in', ok and d.startswith('through'), d)
    ea.phone_sign_in(app, 'segment')
    if PREVIEW:
        app.open_route('/(auth)/sign-in', None, 30)
        home, posts = ea.tap_card(app)
        check('login: the open preview\'s card opens Home as Priya with exactly one POST /auth/open-preview', home and posts == 1, 'home %s, posts %d' % (home, posts))
        if home:
            mark = len(app.request_log)
            ok, d = app.sign_out()
            app.b.pump(2.0)
            check('login: signing out of the preview returns to the form with the card and sends nothing', ok and ea.sign_in_with_card(app) and not ea.preview_posts(app, mark), d)
    else:
        skip('login: the open preview\'s one tap', 'the server at BASE is not in the open preview (run again against an API with OPEN_PREVIEW=1)')
    check('login: Priya signed in again for the sections that follow', ensure_priya(app))


# ---------------------------------------------------------------- navigation
HALO_JS = r"""(() => { const tab = (l) => Array.from(document.querySelectorAll('[role=tab][aria-label]')).find((e) => e.getAttribute('aria-label').split(', ')[0] === l && !e.closest('[aria-hidden="true"]'));
  const home = tab('Home'); if (!home) return null; const list = home.closest('[role=tablist]');
  const halo = Array.from(list.querySelectorAll('div')).find((d) => getComputedStyle(d).backgroundColor === 'rgba(238, 51, 36, 0.12)' && d.getBoundingClientRect().width > 40);
  const sel = list.querySelector('[role=tab][aria-selected="true"]'); if (!halo || !sel) return null;
  return { halo: Math.round(halo.getBoundingClientRect().left), tab: Math.round(sel.getBoundingClientRect().left), label: sel.getAttribute('aria-label').split(', ')[0] }; })()"""
TITLE_LEFT_JS = r"""((rx) => { const r = new RegExp(rx, 'i'); const el = Array.from(document.querySelectorAll('h1,h2,h3,div,span')).find((e) => !e.closest('[aria-hidden="true"]') && Array.from(e.childNodes).some((n) => n.nodeType === 3 && r.test(n.textContent.trim())));
  return el ? Math.round(el.getBoundingClientRect().left) : null; })"""


def drag(app, x0, x1, y, steps=14, hold=0.0, release=True):
    """A pointer drag on the page (mouse events; React Native Web's gestures take them as pointer events). With `hold`,
    the pointer then rests where it is (moves on the spot) for that long, so the release carries no speed."""
    app.b.call('Input.dispatchMouseEvent', type='mousePressed', x=x0, y=y, button='left', clickCount=1)
    for i in range(1, steps + 1):
        app.b.call('Input.dispatchMouseEvent', type='mouseMoved', x=x0 + (x1 - x0) * i / steps, y=y, button='left', buttons=1)
        time.sleep(0.02)
    end = time.monotonic() + hold
    while time.monotonic() < end:
        app.b.call('Input.dispatchMouseEvent', type='mouseMoved', x=x1, y=y, button='left', buttons=1)
        time.sleep(0.05)
    if release:
        app.b.call('Input.dispatchMouseEvent', type='mouseReleased', x=x1, y=y, button='left', clickCount=1)


def nav_section(app):
    print('nav: N1 the pill, the halo and the swipe; N4 old addresses')
    if not ensure_priya(app):
        check('nav: Priya is signed in', False)
        return
    tabs = app.member_tabs()
    check('N1: the pill lists the nine tabs by label in order (Home … Profile)', [t for t, _ in tabs] == ea.MEMBER_TABS, str(tabs))
    for label, route, path, expect in [('Home', '/(tabs)', '/', GREETING)] + ea.TAB_WALK:
        app.err_mark = len(app.b.errors)
        pressed = app.click_tab(label)
        arrived = app.wait_js("location.pathname === %s" % json.dumps(path), 15) and app.wait_visible(expect, 30)
        settled = wait_until(lambda: (app.js(HALO_JS) or {}).get('label') == label and abs((app.js(HALO_JS) or {}).get('halo', -99) - (app.js(HALO_JS) or {}).get('tab', 99)) <= 3, app, 5, 0.2)
        sel = [t for t, s in app.member_tabs() if s]
        check('N1: %s: aria-selected follows the tap and the halo sits on it' % label, pressed and arrived and sel == [label] and settled, 'at %s; selected %s; halo %s' % (app.path(), sel, app.js(HALO_JS)))
    # the swipe: a drag on the page follows the pointer; let go past the threshold, it moves exactly one tab
    app.click_tab('Train')
    app.wait_js("location.pathname === '/train'", 15)
    app.wait_visible(r'^Train$', 20)
    app.b.pump(1.0)
    w, h = app.b.w, app.b.h
    y = int(h * 0.5)
    x_before = app.js('(%s)(%s)' % (TITLE_LEFT_JS, json.dumps(r'^Train$')))
    drag(app, int(w * 0.8), int(w * 0.8) - 90, y, steps=24, hold=0.5, release=False)
    x_during = app.js('(%s)(%s)' % (TITLE_LEFT_JS, json.dumps(r'^Train$')))
    drag_moved = None if x_before is None or x_during is None else x_during - x_before
    app.b.call('Input.dispatchMouseEvent', type='mouseReleased', x=int(w * 0.8) - 90, y=y, button='left', clickCount=1)
    app.b.pump(1.2)
    x_after = app.js('(%s)(%s)' % (TITLE_LEFT_JS, json.dumps(r'^Train$')))
    # the pages lean with the finger (PREMIUM §1.3A: a fraction of the drag, never more than it)
    check('N1: a drag on the page follows the pointer (the page leaned %s pt with a 90 pt drag) and a short, slow one springs back to Train' % drag_moved,
          drag_moved is not None and -90 <= drag_moved <= -6 and app.path() == '/train' and x_after == x_before, 'before %s, during %s, after %s, at %s' % (x_before, x_during, x_after, app.path()))
    if app.path() != '/train':
        app.click_tab('Train')
        app.wait_js("location.pathname === '/train'", 10)
        app.b.pump(1.0)
    drag(app, int(w * 0.85), int(w * 0.1), y, steps=16)
    moved = app.wait_js("location.pathname === '/bio'", 5)
    app.b.pump(0.8)
    check('N1: a swipe to the left moves exactly one tab (Train → Bio) and the halo follows', moved and [t for t, s in app.member_tabs() if s] == ['Bio'] and (app.js(HALO_JS) or {}).get('label') == 'Bio', 'at %s; %s' % (app.path(), app.js(HALO_JS)))
    drag(app, int(w * 0.1), int(w * 0.85), y, steps=16)
    check('N1: a swipe to the right moves one tab back (Bio → Train)', app.wait_js("location.pathname === '/train'", 5), app.path())
    # N4: old addresses and links with a parameter, each on the right segment, section or sub-tab
    redirects = [
        # "This week" is the segment's own label; the week view's header reads THIS WEEK (upper-cased by CSS)
        ('/(tabs)/plan', '/train', lambda L: any(re.match(r'^Week \d+$', l) for l in L) and after(L, 'History', 1)[:1] != ['All'] and (after(L, 'History', 1) or [''])[0].startswith('VERSION'), 'the Plan segment first (the coach\'s plan in weeks)'),
        ('/workouts', '/train', lambda L: after(L, 'History', 1) == ['All'] and 'THIS WEEK' in after(L, 'History', 12), 'the This week segment'),
        ('/workout-history', '/train', lambda L: 'COMPLETED' in after(L, 'History', 3), 'the History segment (completed, partly done, skipped)'),
        ('/sessions', '/train', lambda L: 'Live classes' in L[:16], 'Live classes first'),
        ('/progress', '/bio', lambda L: any(re.match(r'^Bio$', l) for l in L[:3]), 'Bio'),
        ('/lab-follow-ups', '/life', lambda L: any(re.match(r'^Next steps from your reports$', l) for l in L[:6]), 'Next steps first'),
        ('/nutrition', '/fuel', lambda L: any(re.match(r'^Nutrition$', l) for l in L[:3]), 'Nutrition'),
        ('/messages', '/coach', lambda L: any(re.match(r'^Asha Menon$', l) for l in L[:6]), 'the coach'),
        ('/packages', '/store', lambda L: any(re.match(r'^Programmes$', l) for l in L[:4]), 'Programmes'),
        ('/learn', '/store', lambda L: any(re.match(r'^Learn$', l) for l in L[:6]), 'Learn first'),
        ('/milestones', '/profile', lambda L: app.js("Array.from(document.querySelectorAll('[role=tab]')).some((e) => !e.closest('[aria-hidden=\"true\"]') && (e.innerText || '').trim() === 'Achievements' && e.getAttribute('aria-selected') === 'true')"), 'the Achievements sub-tab selected'),
        ('/(tabs)/me', '/profile', lambda L: any(re.match(r'^Priya Nair$', l) for l in L[:6]), 'Profile'),
    ]
    for route, path, ok_fn, what in redirects:
        app.open_route(route, None, 30)
        landed = app.wait_js("location.pathname === %s" % json.dumps(path), 20)
        good = landed and wait_until(lambda: ok_fn(first_lines(app, 40)), app, 15, 0.4)
        check('N4: %s lands on %s with %s' % (route, path, what), good, 'at %s; %s' % (app.path(), ' | '.join(first_lines(app, 14))[:240]))
    app.open_route('/(tabs)/train', None, 30)
    app.b.pump(0.5)
    segs = app.js("Array.from(document.querySelectorAll('[role=tablist] [role=tab]')).filter((e) => !e.closest('[aria-hidden=\"true\"]') && /^(This week|Plan|History)$/.test((e.innerText || '').trim())).map((e) => e.getAttribute('aria-selected'))") or []
    # the kit's Segmented writes aria-selected beside accessibilityState (React Native Web reads no accessibilityState)
    check('N4: Train\'s segment row says which segment is selected (aria-selected)', len(segs) == 3 and segs.count('true') == 1 and segs.count('false') == 2, str(segs))


# ---------------------------------------------------------------- wellness
def wellness_section(app):
    print('wellness: Bio, Life, Tests and a report show what the API holds')
    if not ensure_priya(app):
        check('wellness: Priya is signed in', False)
        return
    s = api_session()
    try:
        summary = s.get('/me/progress/summary')
        reports = s.get('/me/reports').get('items', [])
        bookings = s.get('/me/bloodwork/bookings').get('items', [])
    finally:
        s.logout()
    weight = next((m for m in summary.get('metrics', []) if m.get('metric') == 'weight_kg'), None)
    app.click_tab('Bio')
    app.wait_visible(r'^Bio$', 30)
    if weight and weight.get('latest'):
        v = weight['latest']['value']
        shown = app.wait_js("Array.from(document.querySelectorAll('[aria-label]')).some((e) => !e.closest('[aria-hidden=\"true\"]') && e.getAttribute('aria-label').startsWith('Weight: ' + %s + ' kg'))" % json.dumps(('%g' % v)), 20)
        check('wellness: Bio shows the latest weight the API holds (%g kg) on its tile' % v, shown, app.visible_text()[:200])
    else:
        skip('wellness: Bio weight tile', 'no weight for Priya in GET /me/progress/summary')
    ea.screen_ok(app, 'wellness: Bio draws without an error', r'^Bio$', '/bio')
    app.click_tab('Life')
    app.wait_visible(r'^Longevity$', 30)
    if reports:
        latest = reports[0]
        name = (latest.get('test') or {}).get('name') or latest.get('testName') or ''
        shown = app.wait_visible(re.escape(name), 20) if name else False
        check('wellness: Life shows the latest report (%s)' % name, shown, app.visible_text()[:200])
        markers = app.js("Array.from(document.querySelectorAll('[aria-label]')).filter((e) => !e.closest('[aria-hidden=\"true\"]') && /laboratory range/.test(e.getAttribute('aria-label'))).length") or 0
        check('wellness: Life lists the report\'s markers against the laboratory range (%d)' % markers, markers >= 3)
        app.open_route('/report/%s' % latest['id'], None, 30)
        drawn = app.wait_visible(re.escape(name), 30) if name else False
        check('wellness: the report overlay shows the report and its "Simulated result" pill', drawn and (not latest.get('simulated') or app.has_visible(r'^Simulated result$')), app.visible_text()[:200])
        ea.screen_ok(app, 'wellness: the report overlay draws without an error', None)
    else:
        skip('wellness: Life and the report overlay', 'Priya has no report in GET /me/reports')
    app.open_route('/(tabs)/tests', None, 30)
    app.wait_visible(r'blood tests? left|^No blood tests included yet$', 30)
    check('wellness: Tests shows the blood tests left in the package and the simulated-laboratory note', app.has_visible(r'blood tests? left') and app.has_visible(r'^Simulated laboratory$'), app.visible_text()[:200])
    open_ones = [b for b in bookings if b.get('status') not in ('cancelled', 'completed', 'results_ready')]
    if open_ones:
        ref = open_ones[0].get('reference') or ''
        check('wellness: Tests lists the booked collection (%s)' % ref, app.wait_visible(re.escape(ref), 15) or app.has_visible(r'booked'), app.visible_text()[:300])
    ea.screen_ok(app, 'wellness: Tests draws without an error', None, '/tests')


# ---------------------------------------------------------------- train
def media_range_check(clip_url):
    req = urllib.request.Request(clip_url, headers={'Range': 'bytes=0-1023'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, dict(r.headers), len(r.read())
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), 0


def train_section(app):
    print('train: the coach\'s sessions on Train, the player, the clips, logging every set')
    if not ensure_priya(app):
        check('train: Priya is signed in', False)
        return
    s = api_session()
    try:
        week = s.get('/me/workouts')
    finally:
        s.logout()
    items = week.get('items', [])
    app.click_tab('Train')
    app.wait_visible(r'^Train$', 30)
    app.b.pump(1.0)
    labels = app.js("Array.from(document.querySelectorAll('[aria-label]')).filter((e) => !e.closest('[aria-hidden=\"true\"]')).map((e) => e.getAttribute('aria-label'))") or []
    missing = [w['title'] for w in items if not any(l.startswith('Open %s in the player' % w['title']) or l.startswith('%s:' % w['title']) for l in labels)]
    check('train: every session of this week the coach assigned (%d, GET /me/workouts) is on Train' % len(items), items and not missing, 'missing %s' % missing)
    target = next((w for w in items if w.get('status') == 'scheduled'), None)
    if not target:
        skip('train: the player and logging', 'no scheduled session this week')
        return
    # the MARK sheet (a quick log without the player, AMENDED §1): it opens from the card, is laid out cleanly, closes
    if app.click_text('This week', seconds=3):
        app.b.pump(0.6)
    app.err_mark = len(app.b.errors)
    if click_label(app, 'Mark %s as done' % target['title'], exact=True) and wait_until(lambda: app.js(CLOSE_COUNT_JS), app, 8):
        app.b.pump(0.8)
        a = app.layout_audit()
        issues = a.get('overlaps', []) + a.get('cut', []) + a.get('small', []) + a.get('smallKey', [])
        check('train: "Mark %s as done" opens its sheet, laid out cleanly at %dx%d, no console error' % (target['title'], app.b.w, app.b.h), not issues and a.get('sw') == app.b.w and not app.errors_since(), '; '.join(issues[:6] + app.errors_since()[:2]))
        app.screenshot('train-mark-sheet')
        check('train: the MARK sheet closes with its Close control', close_sheet(app))
    else:
        check('train: "Mark %s as done" opens its sheet' % target['title'], False, app.visible_text()[:160])
    # "Log session" with no set ticked asks first ("Tick my sets first" leaves it as it was)
    app.err_mark = len(app.b.errors)
    click_label(app, 'Open %s in the player' % target['title'], exact=True)
    opened = app.wait_js("location.pathname === %s" % json.dumps('/workout/' + target['id']), 20) and app.wait_clickable('Log session', 30)
    check('train: "Open %s in the player" opens the player at /workout/<id>' % target['title'], opened, app.path())
    if not opened:
        return
    app.screenshot('train-player')
    # V1: the clips are the server's, with byte ranges; the poster shows; a tap plays; no clip ⇒ the text-only sentence
    s = api_session()
    try:
        detail = s.get('/me/workouts/%s' % target['id'])
    finally:
        s.logout()
    media = detail.get('media') or {}
    clip = None
    for it in detail.get('items', []):
        m = it.get('media') or media.get(it.get('exerciseId')) or {}
        if isinstance(m, dict) and (m.get('video') or m.get('videoUrl')):
            clip = (it, m)
            break
    if clip:
        url = clip[1].get('videoUrl') or clip[1].get('video')
        url = url if url.startswith('http') else BASE + (url if url.startswith('/') else '/' + url)
        status, hdrs, n = media_range_check(url)
        h = {k.lower(): v for k, v in hdrs.items()}
        check('V1: the clip of %s is served with a byte range (206, Content-Range, Accept-Ranges, 1024 bytes)' % clip[0]['exerciseName'],
              status == 206 and h.get('content-range', '').startswith('bytes 0-1023/') and h.get('accept-ranges') == 'bytes' and n == 1024, '%s %s' % (status, {k: h.get(k) for k in ('content-range', 'accept-ranges', 'content-type')}))
        poster = app.js("Array.from(document.querySelectorAll('img,video')).filter((e) => !e.closest('[aria-hidden=\"true\"]')).some((e) => /\\/api\\/public\\/media\\/exercises\\//.test(e.currentSrc || e.src || e.poster || ''))")
        check('V1: the player shows the clip\'s poster from the server', bool(poster))
        played = click_label(app, 'Play %s video' % clip[0]['exerciseName'], exact=True)
        advanced = played and wait_until(lambda: (app.js("(() => { const v = Array.from(document.querySelectorAll('video')).find((e) => !e.closest('[aria-hidden=\"true\"]')); return v ? v.currentTime : 0; })()") or 0) > 0.2, app, 12, 0.4)
        videos = app.js("Array.from(document.querySelectorAll('video')).map((v) => ({ t: +v.currentTime.toFixed(2), paused: v.paused, ready: v.readyState, hidden: !!v.closest('[aria-hidden=\"true\"]'), src: (v.currentSrc || '').slice(-32) }))")
        check('V1: a tap on "Play %s video" plays it (the video\'s time advances)' % clip[0]['exerciseName'], advanced, 'pressed %s; videos %s; console %s' % (played, videos, app.errors_since()[:2]))
    else:
        skip('V1: a clip in the player', 'no exercise of this session has a clip')
    no_clip = next((it for it in detail.get('items', []) if not (it.get('media') or media.get(it.get('exerciseId')))), None)
    if no_clip:
        click_label(app, '%s: show it in the player' % no_clip['exerciseName'], exact=True)
        check('V1: %s, which has no clip, shows the text-only sentence' % no_clip['exerciseName'], app.wait_visible(r'^(Exercises are|This exercise is) described in text only; demonstration media is not available yet\.$', 15), app.visible_text()[:200])
    app.click_text('Log session')
    asked = app.wait_visible(r'^Log it as completed without any sets\?$', 10) and app.has_visible(r'^No sets ticked$')
    if asked:
        app.click_text('Tick my sets first')
        wait_until(lambda: not app.has_visible(r'^Log it as completed without any sets\?$'), app, 8)
    app.b.pump(0.8)
    s = api_session()
    try:
        still = s.get('/me/workouts/%s' % target['id']).get('status')
    finally:
        s.logout()
    check('train: "Log session" with no set ticked asks first ("No sets ticked": "Log it as completed without any sets?"); "Tick my sets first" logs nothing',
          asked and still == 'scheduled' and app.wait_clickable('Log session', 10), 'asked %s; status %s; %s' % (asked, still, app.visible_text()[:160]))
    # S2: every set ticked, effort 7, Log session
    total = app.js("Array.from(document.querySelectorAll('[role=checkbox][aria-label]')).filter((e) => !e.closest('[aria-hidden=\"true\"]') && /^Set \\d+ of \\d+$/.test(e.getAttribute('aria-label'))).length") or 0
    for _ in range(3):
        app.js("Array.from(document.querySelectorAll('[role=checkbox][aria-label]')).filter((e) => !e.closest('[aria-hidden=\"true\"]') && /^Set \\d+ of \\d+$/.test(e.getAttribute('aria-label')) && e.getAttribute('aria-checked') !== 'true').forEach((e) => e.click()); true")
        app.b.pump(0.6)
    ticked = app.js("Array.from(document.querySelectorAll('[role=checkbox][aria-label]')).filter((e) => !e.closest('[aria-hidden=\"true\"]') && /^Set \\d+ of \\d+/.test(e.getAttribute('aria-label')) && e.getAttribute('aria-checked') === 'true').length") or 0
    check('train: every set of the session can be ticked (%d of %d)' % (ticked, total), total > 0 and ticked == total)
    app.click_text('7')
    app.b.pump(0.3)
    app.click_text('Log session')
    done = wait_until(lambda: not app.path().startswith('/workout/') or app.has_visible(r'^Logged|^Session logged|^Done$'), app, 20)
    app.b.pump(1.5)
    s = api_session()
    try:
        after = s.get('/me/workouts/%s' % target['id'])
    finally:
        s.logout()
    check('S2: the session is logged in the API: completed, every set done, effort 7', after.get('status') == 'completed' and after.get('setsDone') == after.get('setsPrescribed') and after.get('rpe') == 7,
          'status %s, sets %s/%s, rpe %s; app at %s' % (after.get('status'), after.get('setsDone'), after.get('setsPrescribed'), after.get('rpe'), app.path()))
    app.screenshot('train-after-log')
    c = api_session(COACH, 'coach')
    try:
        mine = c.get('/coach/clients/%s/workouts' % after.get('memberId'))
    finally:
        c.logout()
    seen = next((x for x in mine.get('sessions', []) if x.get('id') == target['id']), None)
    check('S2: Asha sees the session completed (GET /coach/clients/:id/workouts)', bool(seen) and seen.get('status') == 'completed', str(seen)[:200])
    app.open_route('/(tabs)/train', None, 30)
    check('S2: Train shows the session done', app.wait_js("Array.from(document.querySelectorAll('[aria-label]')).some((e) => !e.closest('[aria-hidden=\"true\"]') && e.getAttribute('aria-label').startsWith(%s))" % json.dumps('%s: Done' % target['title']), 30), app.visible_text()[:200])
    ea.screen_ok(app, 'train: Train draws without an error after logging', r'^Train$', '/train')


# ---------------------------------------------------------------- coach → client
def unread_count(app):
    label = app.js("(() => { const e = Array.from(document.querySelectorAll('[aria-label^=\"Notifications\"]')).find((x) => !x.closest('[aria-hidden=\"true\"]')); return e ? e.getAttribute('aria-label') : null; })()") or ''
    m = re.search(r'(\d+) unread', label)
    return int(m.group(1)) if m else 0


def sync_section(app):
    print('sync: S1 Asha publishes a new version of Priya\'s programme; the app shows it')
    if not ensure_priya(app):
        check('sync: Priya is signed in', False)
        return
    app.open_route('/(tabs)', None, 30)
    ea.on_home(app)
    app.b.pump(1.5)
    unread_before = unread_count(app)
    app.click_tab('Train')
    app.wait_visible(r'^Train$', 30)
    c = api_session(COACH, 'coach')
    try:
        progs = [p for p in c.get('/coach/workout-programs').get('items', []) if p.get('memberName') == 'Priya Nair' and p.get('status') == 'published']
        if not progs:
            check('S1: Priya has a published programme from Asha', False)
            return
        prog = progs[0]
        title = 'Strength and sleep, E2E %d' % int(time.time())
        st, j, _ = ah.api(BASE, 'PATCH', '/coach/workout-programs/%s' % prog['id'], {'title': title}, token=c.token)
        st2, j2, _ = ah.api(BASE, 'POST', '/coach/workout-programs/%s/publish' % prog['id'], {}, token=c.token)
    finally:
        c.logout()
    version = (j2 or {}).get('currentVersion') if isinstance(j2, dict) else None
    check('S1: Asha edits the title (a new draft) and publishes it as version %s (the API)' % version, st == 200 and st2 == 200 and version == prog.get('currentVersion', 0) + 1, '%s %s' % (st, st2))
    t0 = time.monotonic()
    shown = wait_until(lambda: app.has_visible(re.escape(title)) and app.has_visible(r'^Version %d\b' % version), app, 45, 0.5)
    took = time.monotonic() - t0
    check('S1: the app\'s Train shows the new title and "Version %s" within 45 s (it took %.0f s), without a reload' % (version, took), shown, app.visible_text()[:300])
    app.screenshot('sync-train')
    app.click_tab('Home')
    ea.on_home(app)
    rose = wait_until(lambda: unread_count(app) > unread_before, app, 30, 0.5)
    unread_after = unread_count(app)
    click_label(app, 'Notifications')
    listed = app.wait_visible(r'^Your workout programme was updated$', 15)
    check('S1: the Home bell counts it (%d → %d unread) and lists "Your workout programme was updated"' % (unread_before, unread_after), rose and listed, app.visible_text()[:300])
    app.screenshot('sync-inbox')
    close_sheet(app)


# ---------------------------------------------------------------- the assistant
def ai_section(app):
    print('ai: AI1 the member assistant is off; the Coach tab is the human coach')
    if not ensure_priya(app):
        check('ai: Priya is signed in', False)
        return
    s = api_session()
    try:
        st = s.get('/me/assistant')
        code, j, _ = ah.api(BASE, 'POST', '/me/assistant/messages', {'body': 'Hello'}, token=s.token)
    finally:
        s.logout()
    check('AI1: GET /me/assistant says on:false (offer:false); POST /me/assistant/messages is refused with 409 ASSISTANT_OFF', st.get('on') is False and st.get('offer') is False and code == 409 and ((j or {}).get('error') or {}).get('code') == 'ASSISTANT_OFF', '%s %s' % (code, json.dumps(j)[:120]))
    app.click_tab('Coach')
    app.wait_visible(r'^Asha Menon$', 30)
    app.b.pump(1.0)
    seg = app.js("Array.from(document.querySelectorAll('[role=tab]')).some((e) => !e.closest('[aria-hidden=\"true\"]') && /^Assistant$/.test((e.innerText || '').trim()))")
    check('AI1: the Coach tab is the human coach: the thread with Asha, and no Assistant segment', not seg and app.has_visible(r'Messages stay in the app; nothing here is medical advice\.'), app.visible_text()[:200])


# ---------------------------------------------------------------- motion
SNAPSHOT_JS = r"""(() => { const out = [];
  const hidden = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return true; } return false; };
  for (const e of document.querySelectorAll('#root *')) { if (e.closest('[role=tablist]')) continue;
    const r = e.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || !r.width) continue;
    const c = getComputedStyle(e); if (c.transform === 'none' && c.opacity === '1') continue; if (hidden(e)) continue;
    out.push(c.transform + '|' + c.opacity + '|' + Math.round(r.left) + ',' + Math.round(r.top)); }
  return out; })()"""


def motion_section(app):
    print('motion: M1 reduced motion, M2 full motion')
    s = api_session()
    try:
        score = (s.get('/me').get('member') or {}).get('wellnessScore')
    finally:
        s.logout()
    app.reduced_motion(True)
    try:
        if app.workspace:
            app.sign_out()
        r = app.sign_in('member', *MEMBER)
        home = r['ok'] and ea.on_home(app)
        app.b.pump(0.3)
        first = app.js(SNAPSHOT_JS) or []
        brief = after(first_lines(app, 80), "TODAY'S BRIEF", 1)
        at_value = score is None or app.has_text(r'^%d$' % score)   # the ring's number is drawn (its label says it to screen readers)
        app.b.pump(1.2)
        later = app.js(SNAPSHOT_JS) or []
        brief2 = after(first_lines(app, 80), "TODAY'S BRIEF", 1)
        moved = sorted(set(first) ^ set(later))
        check('M1: with reduced motion Home is at rest 300 ms after it draws: the score at its value (%s), nothing moves after that, the brief complete' % score,
              home and at_value and not moved and brief and brief == brief2, 'home %s; score shown %s; changed %s; brief %s → %s' % (home, at_value, moved[:6], brief, brief2))
        app.screenshot('motion-reduced-home')
        timings = {}
        for mode in ('reduce', 'full'):
            app.reduced_motion(mode == 'reduce')
            app.js("localStorage.removeItem('bp.fx.splashAt'); true")   # a cold start, not a second launch within 10 minutes (the short sting)
            t0 = time.monotonic()
            app.b.call('Page.navigate', url=app.app_url + '/')
            drawn = wait_until(lambda: app.has_text(r'Forgotten your password\?') and app.path() == '/sign-in', app, 30, 0.05)
            timings[mode] = round(time.monotonic() - t0, 2) if drawn else None
        app.workspace = None
        app.err_mark = 0
        check('M1: the splash goes on to the sign-in sooner with reduced motion (%.2f s) than with full motion (%.2f s) after a cold start' % (timings.get('reduce') or -1, timings.get('full') or -1),
              # the sting is 3.5 s, 0.9 s with reduced motion; both times include the bundle's own start, which varies,
              # so a clear second between them is the test
              timings.get('reduce') and timings.get('full') and timings['full'] - timings['reduce'] >= 1.0, str(timings))
    finally:
        app.reduced_motion(False)
    if not ensure_priya(app):
        return
    app.b.pump(1.0)
    worst = 0.0
    for label, path in (('Train', '/train'), ('Bio', '/bio'), ('Home', '/')):
        t0 = time.monotonic()
        app.click_tab(label)
        done = wait_until(lambda: app.path() == path and (app.js(HALO_JS) or {}).get('label') == label and abs((app.js(HALO_JS) or {}).get('halo', -99) - (app.js(HALO_JS) or {}).get('tab', 99)) <= 2, app, 3, 0.03)
        took = time.monotonic() - t0
        worst = max(worst, took if done else 99)
        app.b.pump(0.6)
    check('M2: with full motion a tab change is done (address, selection and halo) within 700 ms (slowest %.0f ms)' % (worst * 1000), worst <= 0.7)
    ea.screen_ok(app, 'M2: no console error with full motion', None)
    for part in (motion_v2, motion_w2, motion_w2_calm):   # the wave-1 checks, then the wave-2 ones (each runs even if another broke)
        try:
            part(app)
        except Exception as e:
            traceback.print_exc()
            check('motion: %s ran to its end without an unexpected error' % part.__name__, False, repr(e)[:300])
            try:
                app.screenshot('error-' + part.__name__)
            except Exception:
                pass
        finally:
            mv_touch(app, False)
            app.reduced_motion(False)


# ---------------------------------------------------------------- motion v2 (FINAL_PLAN §10, wave-1 gate)
# An in-page sampler: `probe` (the source of a JS function) runs on every animation frame for `ms`; each frame is kept as
# [ms since the start, what the probe returned]. window.__mv.mark(name) notes the time of an action in the same clock.
MV_SAMPLER_JS = r"""((probeSrc, ms) => { if (window.__mv) window.__mv.run = false;
  const probe = new Function('return (' + probeSrc + ')')();
  const S = window.__mv = { frames: [], marks: {}, run: true, t0: performance.now() };
  S.mark = (n) => { S.marks[n] = Math.round(performance.now() - S.t0); };
  const until = S.t0 + ms;
  const tick = () => { if (!S.run) return; const now = performance.now(); let v = null;
    try { v = probe(); } catch (e) { v = { err: String(e).slice(0, 80) }; }
    S.frames.push([Math.round(now - S.t0), v]); if (now < until) requestAnimationFrame(tick); else S.run = false; };
  requestAnimationFrame(tick); return true; })"""
MV_STOP_JS = "(() => { const S = window.__mv; if (!S) return null; S.run = false; return { frames: S.frames, marks: S.marks }; })()"
# shared page helpers for the probes: the element whose own text matches, its opacity as drawn (to the body, or to the
# pager page it sits in), the pager's slot (the parent of the absolutely placed full-size pages) and its pages
MV_HELPERS_JS = r"""(() => { window.__mvh = {
  own: (rx, root) => { const re = new RegExp(rx, 'i'); return Array.from((root || document).querySelectorAll('div,span,h1,h2,h3,p')).find((e) => !e.closest('[aria-hidden="true"]') && Array.from(e.childNodes).some((n) => n.nodeType === 3 && re.test(n.textContent.trim()))) || null; },
  ownAny: (rx, root) => { const re = new RegExp(rx, 'i'); return Array.from((root || document).querySelectorAll('div,span,h1,h2,h3,p')).find((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && re.test(n.textContent.trim()))) || null; },
  eff: (el, stop) => { let o = 1; for (let e = el; e && e !== document.body && e !== stop; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; },
  slot: () => { let s = window.__mvSlot; if (s && s.isConnected) return s; const W = innerWidth, H = innerHeight; const n = new Map();
    for (const d of document.querySelectorAll('#root div')) { if (!d.style || d.style.zIndex === '' || getComputedStyle(d).position !== 'absolute') continue; const r = d.getBoundingClientRect();
      if (Math.abs(r.width - W) < 2 && r.height > H * 0.7) n.set(d.parentElement, (n.get(d.parentElement) || 0) + 1); }
    let best = 0; s = null; for (const [p, k] of n) if (k > best) { best = k; s = p; } window.__mvSlot = s; return s; },
  pageOf: (el) => { const s = window.__mvh.slot(); for (let e = el; e && e.parentElement; e = e.parentElement) if (e.parentElement === s) return e; return null; },
  pages: () => { const s = window.__mvh.slot(); if (!s) return null; const W = innerWidth, H = innerHeight;
    return Array.from(s.children).map((c) => { const cs = getComputedStyle(c); const r = c.getBoundingClientRect();
      return { l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, w: Math.round(r.width), o: cs.display === 'none' || cs.visibility === 'hidden' ? 0 : Math.round(parseFloat(cs.opacity) * 1000) / 1000,
               k: c.childElementCount, mid: r.top < H / 2 && r.bottom > H / 2 }; }); },
}; return true; })()"""


def mv_sample(app, probe, ms):
    app.js(MV_HELPERS_JS)
    return app.js('(%s)(%s, %d)' % (MV_SAMPLER_JS, json.dumps(probe), int(ms)))


def mv_stop(app):
    return app.js(MV_STOP_JS) or {'frames': [], 'marks': {}}


def mv_touch(app, on):
    """Touch emulation (a coarse pointer and touch events) for the checks a finger is meant for; off again after them.
    The app decides its motion tier at load, so this does not change the tier of the running app."""
    try:
        app.b.call('Emulation.setTouchEmulationEnabled', enabled=bool(on), maxTouchPoints=5 if on else 1)
    except Exception:
        pass


def mv_touch_drag(app, x0, x1, y, steps=14, dt=0.016):
    app.b.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x0, 'y': y, 'id': 1}])
    for i in range(1, steps + 1):
        app.b.call('Input.dispatchTouchEvent', type='touchMove', touchPoints=[{'x': x0 + (x1 - x0) * i / steps, 'y': y, 'id': 1}])
        app.b.pump(dt)
    app.b.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])


def mv_tap(app, x, y):
    app.b.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y, 'id': 1}])
    app.b.pump(0.04)
    app.b.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])


TAB_RECT_JS = r"""((l) => { const el = Array.from(document.querySelectorAll('[role=tab][aria-label]')).find((e) => e.getAttribute('aria-label').split(', ')[0] === l && !e.closest('[aria-hidden="true"]'));
  if (!el) return null; const r = el.getBoundingClientRect(); const list = el.closest('[role=tablist]'); let p = list; for (let i = 0; i < 4 && p && p.parentElement; i++) p = p.parentElement;
  const v = (p || list).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, inside: r.left >= v.left + 8 && r.right <= v.right - 8 && r.left >= 0 && r.right <= innerWidth }; })"""
TAB_PATHS = dict([('Home', '/')] + [(t[0], t[2]) for t in ea.TAB_WALK])


def mv_tab(app, label, settle=1.0):
    app.click_tab(label)
    ok = app.wait_js("location.pathname === %s" % json.dumps(TAB_PATHS[label]), 15)
    app.b.pump(settle)
    return ok


def mv_runs(seq):
    """[(ms, value)] → the values in order with repeats collapsed (for a check's detail)."""
    out = []
    for t, v in seq:
        if not out or out[-1][1] != v:
            out.append((t, v))
    return out


def motion_v2(app):
    print('motion v2: MV1-MV8 (FINAL_PLAN §10)')
    w, h = app.b.w, app.b.h
    # ---- MV1: Home's first entrance after "Continue without signing in" (the email sign-in without an open preview)
    if app.workspace:
        app.sign_out()
    app.open_route('/(auth)/sign-in', None, 30)
    via = 'Continue without signing in' if PREVIEW else 'the email sign-in (no open preview on this server)'
    ready = ea.sign_in_with_card(app) if PREVIEW else (app.wait_visible(r'^Sign in$', 30) and app.has_input('Email'))
    app.b.pump(0.6)
    mv_sample(app, "() => { const e = window.__mvh.own('^Wellness$'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(window.__mvh.eff(e) * 1000) / 1000, Math.round(r.top)]; }", 14000)
    if PREVIEW:
        home, _ = ea.tap_card(app)
    else:
        r = app.sign_in('member', *MEMBER)
        home = r['ok'] and ea.on_home(app)
    app.b.pump(2.5)
    d = mv_stop(app)
    rows = [(t, v) for t, v in d['frames'] if isinstance(v, list)]
    mids = [(t, v[0]) for t, v in rows if 0.2 < v[0] < 0.95]
    first = rows[0][0] if rows else None
    rest = next((t for t, v in reversed(rows) if v[0] < 0.995), None)
    check('MV1: after %s Home\'s "Wellness" label enters through %d mid-opacity frames (0.2-0.95, at least 3)' % (via, len(mids)),
          bool(ready and home and len(mids) >= 3), 'home %s; first drawn at %s ms, last frame below 1 at %s ms; mid %s; opacity runs %s' % (home, first, rest, mids[:8], mv_runs([(t, v[0]) for t, v in rows])[:12]))
    if not home:
        ensure_priya(app)
    # ---- MV8: idle on Home 3 s, then a touch drag to Train: Train's first card enters (this session has not shown Train yet)
    mv_touch(app, True)
    app.b.pump(3.0)
    shelf = app.js("(() => { const e = document.querySelector('[aria-label=\"This week\\'s sessions\"]'); if (!e || e.closest('[aria-hidden=\"true\"]')) return null; const r = e.getBoundingClientRect(); return [r.top, r.bottom]; })()")
    y = 640 if h >= 800 else int(h * 0.75)
    if shelf and shelf[0] - 20 <= y <= shelf[1] + 20:   # a drag that starts on the shelf scrolls the shelf, not the pager
        y = int(shelf[0] - 40) if shelf[0] - 40 > 160 else int(min(h - 140, shelf[1] + 40))
    premounted = bool(app.js("!!window.__mvh && !!window.__mvh.ownAny(\"^Your Coach's Plan$\")"))
    mv_sample(app, r"""() => { const H = window.__mvh; const h0 = H.ownAny("^Your Coach's Plan$");
        let card = null; if (h0) { let row = h0.parentElement; while (row && row.parentElement && row.parentElement.children.length < 4) row = row.parentElement; card = row && row.nextElementSibling; }
        const title = H.ownAny('^Train$'); const pg = H.pageOf(card || title);
        return { c: card ? Math.round(H.eff(card, pg) * 1000) / 1000 : null, t: title ? Math.round(H.eff(title, pg) * 1000) / 1000 : null, p: location.pathname }; }""", 3200)
    mv_touch_drag(app, int(w * 0.85), 20, y, steps=20, dt=0.016)
    app.b.pump(2.8)
    d = mv_stop(app)
    rows = [(t, v) for t, v in d['frames'] if isinstance(v, dict) and 'p' in v]
    on_card = any(v.get('c') is not None for _, v in rows)
    key = 'c' if on_card else 't'
    mids = [(t, v[key]) for t, v in rows if v.get(key) is not None and 0.2 < v[key] < 0.95]
    at_train = app.path() == '/train'
    check('MV8: idle on Home 3 s, then a touch drag to Train: Train\'s %s shows %d mid-opacity frames (at least 3)' % ('first card' if on_card else 'title (no plan card found)', len(mids)),
          at_train and len(mids) >= 3, 'at %s; drag at y %d; Train pre-mounted before the drag %s; mid %s; runs %s' % (app.path(), y, premounted, mids[:8], mv_runs([(t, v.get(key)) for t, v in rows])[:12]))
    # ---- MV4: a touch swipe on Home's "This week" shelf scrolls the shelf and leaves the pager alone
    mv_tab(app, 'Home', 1.0)
    SEL = "document.querySelector('[aria-label=\"This week\\'s sessions\"]')"
    found = app.js("(() => { const e = %s; if (!e) return false; e.scrollIntoView({ block: 'center' }); e.scrollLeft = 0; return true; })()" % SEL)
    app.b.pump(1.2)
    r = app.js("(() => { const e = %s; if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height, e.scrollWidth - e.clientWidth]; })()" % SEL) if found else None
    if r:
        mv_sample(app, "() => { const e = %s; return [e ? Math.round(e.scrollLeft) : null, location.pathname]; }" % SEL, 2000)
        sy = r[1] + r[3] / 2
        mv_touch_drag(app, min(w - 60, 300), 80, sy, steps=14, dt=0.016)
        app.b.pump(1.6)
        d = mv_stop(app)
        rows = [v for _, v in d['frames'] if isinstance(v, list)]
        top = max([v[0] for v in rows if v[0] is not None] or [0])
        paths = sorted(set(v[1] for v in rows))
        check('MV4: a touch swipe on Home\'s "This week" shelf scrolls it (by %d px, at least 150) and the page stays Home' % top,
              top >= 150 and paths == ['/'] and app.path() == '/', 'scrollable %s px; paths seen %s; at %s; scrollLeft (ms, px) %s' % (r[4], paths, app.path(), mv_runs([(t, v[0]) for t, v in d['frames'] if isinstance(v, list)])[:16]))
    else:
        check('MV4: a touch swipe on Home\'s "This week" shelf scrolls it and the page stays Home', False, 'the shelf (aria-label "This week\'s sessions") is not on Home')
    # ---- MV5: a tab tapped 120 ms after a touch swipe is where the pager ends (before: the swipe's tab, 0 of 3)
    results = []
    for trial in range(3):
        mv_tab(app, 'Bio', 1.5)
        # the path, and whether the pager moved (a page in view off its place): the swipe has to have been taken
        mv_sample(app, "() => { const ps = window.__mvh.pages() || []; return [location.pathname, ps.some((p) => p.o > 0.02 && Math.abs(p.l) > 4 && Math.abs(p.l) < innerWidth - 4) ? 1 : 0]; }", 4000)
        mv_touch_drag(app, int(w * 0.85), int(w * 0.1), int(h * 0.5), steps=12, dt=0.016)
        t_end = time.monotonic()
        while time.monotonic() - t_end < 0.12:
            time.sleep(0.005)
        target = 'Train'
        tr = app.js('(%s)(%s)' % (TAB_RECT_JS, json.dumps('Train')))
        if not tr or not tr['inside']:
            target = 'Home'
            tr = app.js('(%s)(%s)' % (TAB_RECT_JS, json.dumps('Home')))
        late = round((time.monotonic() - t_end) * 1000)
        if tr:
            mv_tap(app, tr['x'], tr['y'])
        landed = app.wait_js("location.pathname === %s" % json.dumps(TAB_PATHS[target]), 4)
        app.b.pump(1.0)
        stayed = app.path() == TAB_PATHS[target]
        d = mv_stop(app)
        rows = [v for _, v in d['frames'] if isinstance(v, list)]
        swiped = any(v[1] for v in rows) or any(v[0] == '/life' for v in rows)
        results.append((bool(tr) and swiped and landed and stayed, '%s tapped %d ms after the swipe (pager moved %s); paths %s; at %s' % (target, late, swiped, [p for _, p in mv_runs([(t, v[0]) for t, v in d['frames'] if isinstance(v, list)])], app.path())))
    ok_n = sum(1 for ok, _ in results if ok)
    check('MV5: a tab tapped 120 ms after a touch swipe (Bio → Life) is where the pager ends (%d of 3)' % ok_n, ok_n == 3, ' | '.join(x for _, x in results))
    # ---- MV6: Home → Store → Profile within 120 ms: every frame has a page covering the screen
    mv_tab(app, 'Home', 2.0)
    mv_sample(app, r"""() => { const ps = window.__mvh.pages(); if (!ps) return null; const W = innerWidth;
        const iv = ps.filter((p) => p.o >= 0.5 && p.k > 0 && p.mid && p.r - p.l > 1).map((p) => [Math.max(0, p.l), Math.min(W, p.r)]).filter((p) => p[1] - p[0] > 1).sort((a, b) => a[0] - b[0]);
        let x = 0; for (const [a, b] of iv) { if (a > x + 2) break; x = Math.max(x, b); }
        return [x >= W - 2 ? 1 : 0, Math.round(x), iv.length, location.pathname]; }""", 2200)
    app.js("""(() => { const tab = (l) => Array.from(document.querySelectorAll('[role=tab][aria-label]')).find((e) => e.getAttribute('aria-label').split(', ')[0] === l && !e.closest('[aria-hidden="true"]'));
      window.__mv.mark('store'); tab('Store').click(); setTimeout(() => { window.__mv.mark('profile'); tab('Profile').click(); }, 120); return true; })()""")
    app.wait_js("location.pathname === '/profile'", 6)
    app.b.pump(1.4)
    d = mv_stop(app)
    rows = [(t, v) for t, v in d['frames'] if isinstance(v, list)]
    bare = [(t, v[1]) for t, v in rows if not v[0]]
    check('MV6: Home → Store → Profile within 120 ms (taps %s): a page covers the screen on every frame (%d frames, %d without)' % (d['marks'], len(rows), len(bare)),
          len(rows) >= 20 and not bare and app.path() == '/profile', 'at %s; uncovered (ms, covered to x) %s; paths %s' % (app.path(), bare[:10], [p for _, p in mv_runs([(t, v[3]) for t, v in rows])]))
    # ---- MV3: Profile Overview → Achievements: no text drawn taller than 1.2x its laid-out height
    if not app.wait_visible(r'^Priya Nair$', 15):
        mv_tab(app, 'Profile', 1.0)
    SUBTAB = "Array.from(document.querySelectorAll('[role=tab]')).find((e) => !e.closest('[aria-hidden=\"true\"]') && (e.innerText || '').trim() === %s)"
    if not app.js("(() => { const e = %s; return !!e && e.getAttribute('aria-selected') === 'true'; })()" % (SUBTAB % json.dumps('Overview'))):
        app.js("(() => { const e = %s; if (e) e.click(); return true; })()" % (SUBTAB % json.dumps('Overview')))
    app.b.pump(1.5)
    mv_sample(app, r"""() => { const ws = Array.from(document.querySelectorAll('[data-testid=fx-switch-view]')).filter((v) => v.getBoundingClientRect().width > 0 && !v.closest('[aria-hidden="true"]'));
        const roots = ws.length ? ws : [document.getElementById('root')]; let k = 1, worst = '';
        for (const w of roots) for (const e of w.querySelectorAll('div,span')) { if (e.childElementCount || !e.textContent.trim() || !e.offsetHeight) continue; const r = e.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue;
          const q = r.height / e.offsetHeight; if (q > k) { k = q; worst = e.textContent.trim().slice(0, 24); } }
        return [Math.round(k * 1000) / 1000, worst, ws.length]; }""", 1600)
    clicked = app.js("(() => { const e = %s; if (!e) return false; window.__mv.mark('tap'); e.click(); return true; })()" % (SUBTAB % json.dumps('Achievements')))
    app.b.pump(1.8)
    d = mv_stop(app)
    rows = [v for _, v in d['frames'] if isinstance(v, list)]
    worst = max(rows, key=lambda v: v[0]) if rows else [None, '', 0]
    selected = app.js("(() => { const e = %s; return !!e && e.getAttribute('aria-selected') === 'true'; })()" % (SUBTAB % json.dumps('Achievements')))
    check('MV3: Profile Overview → Achievements: no text drawn over 1.2x its height (worst %sx, %d frames)' % (worst[0], len(rows)),
          bool(clicked and selected and rows and worst[0] <= 1.2 and len(rows) >= 10), 'worst text %r; switch views on screen %s; Achievements selected %s' % (worst[1], worst[2], selected))
    # ---- MV2: the Bio Weight sheet keeps its height for its whole close
    mv_tab(app, 'Bio', 1.5)
    opened = click_label(app, 'Weight: ')
    app.wait_js("document.querySelectorAll('[aria-modal=\"true\"]').length > 0", 8)
    app.b.pump(1.5)
    PANEL = "(() => { const a = Array.from(document.querySelectorAll('[aria-modal=\"true\"]')); const p = a[a.length - 1]; if (!p) return null; const r = p.getBoundingClientRect(); return [Math.round(r.top * 10) / 10, Math.round(r.height * 10) / 10]; })"
    rest = app.js(PANEL + '()')
    if opened and rest:
        mv_sample(app, PANEL, 1600)
        app.js("""(() => { const c = Array.from(document.querySelectorAll('[aria-label="Close"]')).filter((e) => !e.closest('[aria-hidden="true"]'));
          const own = c.find((e) => e.getBoundingClientRect().width < innerWidth - 1) || c[0]; window.__mv.mark('close'); if (own) own.click(); return !!own; })()""")
        app.b.pump(1.7)
        d = mv_stop(app)
        t_close = d['marks'].get('close', 0)
        travel = [(t, v) for t, v in d['frames'] if t >= t_close and isinstance(v, list) and v[0] > rest[0] + 1 and v[0] < h]
        off = [(t, v[1]) for t, v in travel if abs(v[1] - rest[1]) > 2]
        gone = app.js("document.querySelectorAll('[aria-modal=\"true\"]').length") == 0
        check('MV2: the Bio Weight sheet keeps its height (%s px ±2) on every frame of its close (%d travel frames, at least 5)' % (rest[1], len(travel)),
              len(travel) >= 5 and not off and gone, 'frames off height %s; travel (ms, top) %s; closed %s' % (off[:6], [(t, v[0]) for t, v in travel][:14], gone))
    else:
        check('MV2: the Bio Weight sheet keeps its height on every frame of its close', False, 'the Weight sheet did not open (control found %s, panel %s)' % (opened, rest))
        close_sheet(app)
    # ---- MV7: with reduced motion a tab change fades (>= 4 intermediate frames) and moves no page sideways
    mv_tab(app, 'Home', 1.2)
    app.reduced_motion(True)
    app.b.pump(0.8)
    mv_sample(app, "() => window.__mvh.pages()", 1600)
    app.js("(() => { window.__mv.mark('tap'); return true; })()")
    app.click_tab('Train')
    app.wait_js("location.pathname === '/train'", 6)
    app.b.pump(1.4)
    d = mv_stop(app)
    app.reduced_motion(False)
    rows = [(t, [p for p in v if p['o'] > 0.02 and p['r'] > 1 and p['l'] < w - 1]) for t, v in d['frames'] if isinstance(v, list)]
    mid = [(t, [p['o'] for p in v if 0.05 < p['o'] < 0.95]) for t, v in rows]
    mid = [(t, o) for t, o in mid if o]
    moved = [(t, [p['l'] for p in v if abs(p['l']) > 1]) for t, v in rows]
    moved = [(t, x) for t, x in moved if x]
    check('MV7: with reduced motion a tab change (Home → Train) fades over %d intermediate frames (at least 4) and moves no page sideways' % len(mid),
          len(mid) >= 4 and not moved and app.path() == '/train', 'at %s; mid (ms, opacities) %s; moved (ms, left) %s' % (app.path(), mid[:8], moved[:6]))
    mv_touch(app, False)
    ensure_priya(app)


# ---------------------------------------------------------------- motion v2, wave 2 (FINAL_PLAN §10, wave-2 gate)
# The wave-2 acceptance rows a headless web run can film without writing into anything but this run's own member
# data: MW1 (M52/M56) the sign-in → Home exit, MW2 (M61) the Wellness centre and its number, MW3 (M53) the Email ↔
# Phone swap, MW4 (M77) the sent message kept in view, MW5 (M75) This week → Plan with no spinner frame; and, in the
# onboarding section (new members), MW6 (M54) the fixed CTAs at 390x844, 360x740 and 820x1180, MW7 (M58) the quiz
# deck never blank, MW8 (M59) the slides follow a finger and the quiz's threshold at 820x1180 uses the column.
MW_FETCH_JS = r"""((parts) => { if (!window.__mwFetch) { const of = window.fetch; window.__mwFetch = of;
    window.fetch = function (u) { const p = of.apply(this, arguments); const url = String(u && u.url ? u.url : u);
      if (window.__mwWatch && window.__mwWatch.some((w) => url.includes(w))) p.then(() => { if (window.__mv && window.__mv.marks.answered === undefined) window.__mv.mark('answered'); }, () => {}); return p; }; }
  window.__mwWatch = parts; return true; })"""
MW_OWN_JS = r"""window.__mwOwn = (rx, root, notIn) => { const re = new RegExp(rx); return Array.from((root || document).querySelectorAll('div,span,h1,h2,h3,p')).find((e) => !e.closest('[aria-hidden="true"]') && !(notIn && e.closest(notIn)) && Array.from(e.childNodes).some((n) => n.nodeType === 3 && re.test(n.textContent.trim()))) || null; }; true"""


# The same sampler, but each frame is read after that frame's rendering (a task posted from requestAnimationFrame runs
# after style, layout, ResizeObserver callbacks and paint): what the frame drew, not the layout before a ResizeObserver
# corrected it (the sign-in's FLIP glide sets its translate from a ResizeObserver, after requestAnimationFrame).
MW_POST_SAMPLER_JS = r"""((probeSrc, ms) => { if (window.__mv) window.__mv.run = false;
  const probe = new Function('return (' + probeSrc + ')')();
  const S = window.__mv = { frames: [], marks: {}, run: true, t0: performance.now() };
  S.mark = (n) => { S.marks[n] = Math.round(performance.now() - S.t0); };
  const until = S.t0 + ms; const ch = new MessageChannel();
  ch.port1.onmessage = (ev) => { if (!S.run) return; let v = null; try { v = probe(); } catch (e) { v = { err: String(e).slice(0, 80) }; } S.frames.push([ev.data, v]); };
  const tick = () => { if (!S.run) return; const now = performance.now(); ch.port2.postMessage(Math.round(now - S.t0)); if (now < until) requestAnimationFrame(tick); else S.run = false; };
  requestAnimationFrame(tick); return true; })"""


def mw_sample_post(app, probe, ms):
    app.js(MV_HELPERS_JS)
    return app.js('(%s)(%s, %d)' % (MW_POST_SAMPLER_JS, json.dumps(probe), int(ms)))


def mw_center(app, js):
    return app.js("(() => { const e = %s; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()" % js)


def mw_touch_tap(app, x, y, hold=0.06):
    """A finger tap; the page's sampler gets the mark 'up' just before the finger lifts."""
    app.b.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y, 'id': 1}])
    app.b.pump(hold)
    app.js("window.__mv && window.__mv.mark('up'); true")
    app.b.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])


def mw_paced_drag(app, x0, x1, y, secs, hold_end=0.0):
    """A finger drag from x0 to x1 over `secs` (paced in real time), optionally held still at the end; mark 'up'."""
    n = max(2, int(secs / 0.016))
    app.b.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x0, 'y': y, 'id': 1}])
    t0 = time.monotonic()
    for i in range(1, n + 1):
        app.b.call('Input.dispatchTouchEvent', type='touchMove', touchPoints=[{'x': x0 + (x1 - x0) * i / n, 'y': y, 'id': 1}])
        while time.monotonic() < t0 + secs * i / n:
            app.b.pump(0.004)
    end = time.monotonic() + hold_end
    while time.monotonic() < end:
        app.b.call('Input.dispatchTouchEvent', type='touchMove', touchPoints=[{'x': x1, 'y': y, 'id': 1}])
        app.b.pump(0.03)
    app.js("window.__mv && window.__mv.mark('up'); true")
    app.b.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])


SEG_JS = "Array.from(document.querySelectorAll('[role=tab]')).find((e) => !e.closest('[aria-hidden=\"true\"]') && (e.innerText || '').replace(/[\\ue000-\\uf8ff]/g, '').trim() === %s)"


def motion_w2(app):
    print('motion v2, wave 2: MW1-MW5 (FINAL_PLAN §10)')
    mv_touch(app, True)
    s = api_session()
    score = (s.get('/me').get('member') or {}).get('wellnessScore')
    # ---- MW3 (M53): Email ↔ Phone on the sign-in: the new fields by +200 ms, nothing blank, the block below glides
    if app.workspace:
        app.sign_out()
    app.open_route('/(auth)/sign-in', None, 30)
    drawn = app.wait_visible(r'^Sign in$', 30) and app.has_input('Email')
    app.b.pump(1.5)
    probe = r"""() => { const H = window.__mvh; const inp = (ph) => Array.from(document.querySelectorAll('input')).find((e) => e.placeholder === ph) || null;
        const em = inp('you@example.com'), ph = inp('000 000 0000'); const dv = H.ownAny('^Or continue with$') || H.ownAny('^New to Bioptime\\?');
        const o = (e) => e ? Math.round(H.eff(e) * 1000) / 1000 : null; const hid = (e) => e ? !!e.closest('[aria-hidden="true"]') : null;
        let tr = ''; for (let m = dv, i = 0; m && i < 6; m = m.parentElement, i++) if (m.style && m.style.transform) { tr = m.style.transform; break; }
        const ty = /translateY\((-?[\d.e-]+)px\)/.exec(tr);
        return { e: o(em), p: o(ph), eh: hid(em), ph: hid(ph), d: dv ? Math.round(dv.getBoundingClientRect().top * 10) / 10 : null, ty: ty ? parseFloat(ty[1]) : 0 }; }"""
    for frm, to, new_key, old_key in (('Email', 'Phone', 'p', 'e'), ('Phone', 'Email', 'e', 'p')):
        c = mw_center(app, SEG_JS % json.dumps(to)) if drawn else None
        if not c:
            check('MW3 (M53): %s → %s on the sign-in' % (frm, to), False, 'the sign-in or its %s segment is not there (drawn %s)' % (to, drawn))
            break
        mw_sample_post(app, probe, 1800)
        app.b.pump(0.15)
        mw_touch_tap(app, c[0], c[1])
        app.b.pump(1.6)
        d = mv_stop(app)
        up = d['marks'].get('up', 0)
        rows = [(t, v) for t, v in d['frames'] if isinstance(v, dict) and 'e' in v]
        after_up = [(t, v) for t, v in rows if t >= up]
        shown = next((t for t, v in after_up if (v[new_key] or 0) > 0.3), None)
        blank = [t - up for t, v in after_up if (v['e'] or 0) <= 0.05 and (v['p'] or 0) <= 0.05]
        dv = [(v['d'], v.get('ty', 0)) for t, v in rows if v['d'] is not None]
        tdv = [(t - up, v['d'], v.get('ty', 0)) for t, v in rows if v['d'] is not None]
        jump = next((i for i in range(1, len(tdv)) if abs(tdv[i][1] - tdv[i - 1][1]) > 20), None)
        # a sample where the block has moved by the form's height change with no translate yet, followed by one whose
        # translate cancels that move, is the layout read between the form's height snap (a React commit in a task) and
        # the ResizeObserver that sets the glide's translate in the next rendering update, before its paint: never
        # drawn. Such samples are dropped and counted in the detail; any other jump counts.
        # (one or two such samples: headless Chrome can run two animation frames 1-2 ms apart after the swap's long task)
        spikes = []
        for i in range(1, len(dv) - 1):
            jump = dv[i][0] - dv[i - 1][0]
            if abs(jump) <= 20 or dv[i][1] != 0:
                continue
            run = [i] + ([i + 1] if i + 2 < len(dv) and dv[i + 1] == dv[i] else [])
            nxt = run[-1] + 1
            if abs(dv[nxt][1] + jump) <= 2 and abs(dv[nxt][0] - dv[i - 1][0]) <= 20:
                spikes += run
        ds = [x for i, (x, _) in enumerate(dv) if i not in spikes]
        steps = [round(b - a, 1) for a, b in zip(ds, ds[1:]) if abs(b - a) > 0.3]
        # the leaving form's input, while it is still drawn next to the new one, is aria-hidden from its first exit frame
        old_hid = 'eh' if old_key == 'e' else 'ph'
        not_inert = [t - up for t, v in after_up if (v[old_key] or 0) > 0.02 and v[new_key] is not None and v[old_hid] is False]
        # (FINAL_PLAN M53's rows: the fields by +200 ms, the glide; frames with neither field drawn are reported, not gated)
        check('MW3 (M53): %s → %s: the %s field above 0.3 opacity %s ms after the finger lifts (at most 200; %d frames with neither field), the block below glides over %d frames (at least 8) at most %.1f px a frame (at most 20), the leaving inputs inert'
              % (frm, to, to, None if shown is None else shown - up, len(blank), len(steps), max([abs(x) for x in steps] or [0])),
              shown is not None and shown - up <= 200 and len(steps) >= 8 and max([abs(x) for x in steps] or [0]) <= 20 and not not_inert,
              'blank frames (ms after the lift) %s; old inputs not aria-hidden while drawn %s; divider steps %s; pre-ResizeObserver samples dropped %d; samples (ms after the lift, top, translate) around the first jump %s' % (blank[:8], not_inert[:6], steps[:20], len(spikes), tdv[max(0, jump - 3):jump + 4] if jump is not None else []))
        app.b.pump(0.6)
    # ---- MW1 (M52, M56) and MW2 (M61): the sign-in → Home exit, then Home's Wellness centre
    app.js(MW_OWN_JS)
    ready = ea.sign_in_with_card(app) if PREVIEW else (app.wait_visible(r'^Sign in$', 20) and app.type_into('Email', MEMBER[0]) and app.type_into('Password', MEMBER[1]))
    app.b.pump(1.2)
    app.js('(%s)(%s)' % (MW_FETCH_JS, json.dumps(['/auth/open-preview'] if PREVIEW else ['/auth/login'])))
    probe = r"""() => { const H = window.__mvh, own = window.__mwOwn; const title = own('^Sign in$', null, '[role=button]');
        const sub = own('^Your coach, your plan, your blood tests'); const em = Array.from(document.querySelectorAll('input')).find((e) => e.placeholder === 'you@example.com') || null;
        const forgot = own('^Forgotten your password\\?$'); const top = (e) => e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null;
        const w = H.ownAny('^Wellness$'); let lay = null, dash = false;
        if (w && !w.closest('[aria-hidden="true"]')) { lay = [w.offsetTop, w.offsetParent ? w.offsetParent.offsetTop : null, w.offsetParent ? w.offsetParent.offsetHeight : null];
          const r = w.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          dash = Array.from(document.querySelectorAll('div,span')).some((e) => !e.closest('[aria-hidden="true"]') && Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() === '—') && (() => { const b = e.getBoundingClientRect(); return b.width > 0 && Math.abs(b.left + b.width / 2 - cx) < 140 && Math.abs(b.top + b.height / 2 - cy) < 140 && H.eff(e) > 0.05; })()); }
        return { p: location.pathname, o: title ? Math.round(H.eff(title) * 1000) / 1000 : null, y: [top(title), top(sub), top(em), top(forgot)], w: lay, dash }; }"""
    mv_sample(app, probe, 7000)
    app.b.pump(0.2)
    if PREVIEW:
        c = mw_center(app, "(%s)(%s, true)" % (ah.FIND_CLICKABLE, json.dumps(ea.PREVIEW_CARD)))
    else:
        c = mw_center(app, "(%s)(%s, true)" % (ah.FIND_CLICKABLE, json.dumps('Sign in')))
    if ready and c:
        mw_touch_tap(app, c[0], c[1], hold=0.05)
    home = bool(ready and c) and ea.on_home(app, 'Priya', 30)
    if home:
        app.workspace = 'member'
    app.b.pump(3.0)
    d = mv_stop(app)
    up = d['marks'].get('up')
    answered = d['marks'].get('answered')
    rows = [(t, v) for t, v in d['frames'] if isinstance(v, dict) and 'p' in v]
    on_sign_in = [(t, v) for t, v in rows if up is not None and t >= up and v['p'] == '/sign-in' and v['o'] is not None]
    exit_at = next((t for t, v in on_sign_in if v['o'] < 0.98), None)
    before = [v['y'] for t, v in on_sign_in if exit_at is None or t < exit_at]
    move = 0.0
    for k in range(4):
        ys = [y[k] for y in before if y[k] is not None]
        if ys:
            move = max(move, max(ys) - min(ys))
    exit_frames = [t for t, v in on_sign_in if exit_at is not None and t >= exit_at and 0.02 < v['o'] < 0.98]
    via = 'the "%s" card' % ea.PREVIEW_CARD if PREVIEW else 'the email sign-in (no open preview on this server)'
    lag = None if exit_at is None or answered is None else exit_at - answered
    check('MW1 (M52): %s → Home: nothing on the sign-in moves more than 2 px until the exit starts (%.1f px), the exit starts %s ms after the answer (at most 650 after the open preview\'s) and is drawn over %d frames (at least 6)'
          % (via, move, lag, len(exit_frames)),
          # the 650 ms is the open preview's (FINAL_PLAN M52); the password sign-in still reads /me after its answer
          home and exit_at is not None and move <= 2 and lag is not None and (lag <= 650 or not PREVIEW) and len(exit_frames) >= 6,
          'home %s; finger up at %s ms, answer at %s ms, exit from %s ms; title opacity runs %s' % (home, up, answered, exit_at, mv_runs([(t, v['o']) for t, v in on_sign_in])[:12]))
    ws = [(t, v['w']) for t, v in rows if v['p'] == '/' and v['w']]
    lays = sorted(set(tuple(x) for _, x in ws))
    dash = [t for t, v in rows if v['p'] == '/' and v['dash']]
    check('MW2 (M61): Home\'s Wellness centre keeps its layout from its first frame to rest (%d frames, %d layout%s) and, for a member with a score (%s), no frame shows "—" in the ring'
          % (len(ws), len(lays), '' if len(lays) == 1 else 's', score),
          home and len(ws) >= 10 and len(lays) == 1 and (score is None or not dash), 'layouts (offsetTop, centre top, centre height) %s; dash frames (ms) %s' % (lays[:6], dash[:8]))
    if not home:
        ensure_priya(app)
    # ---- MW4 (M77): Coach: the message just sent stays inside the visible thread on every frame from +333 ms
    mv_tab(app, 'Coach', 2.0)
    msg = 'Gate check %d: a short note' % int(time.time())
    label = app.js("(() => { const e = Array.from(document.querySelectorAll('textarea,input')).find((x) => /^Message to /.test(x.getAttribute('aria-label') || '') && !x.closest('[aria-hidden=\"true\"]')); return e ? e.getAttribute('aria-label') : null; })()")
    typed = bool(label) and app.type_into(label, msg)
    app.b.pump(0.6)
    probe = r"""(() => { const msg = %s; return () => { const H = window.__mvh;
        const note = H.ownAny('^With .*Messages stay in the app; nothing here is medical advice\\.$'); let sc = note;
        while (sc && sc !== document.body) { const cs = getComputedStyle(sc); if (/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight > sc.clientHeight + 1) break; sc = sc.parentElement; }
        const bs = Array.from(document.querySelectorAll('div,span')).filter((e) => !e.closest('[aria-hidden="true"]') && Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() === msg));
        const b = bs.length ? bs[bs.length - 1] : null; if (!b || !sc || sc === document.body) return { b: null, s: !!sc };
        const r = b.getBoundingClientRect(), v = sc.getBoundingClientRect(); return { b: [Math.round(r.top), Math.round(r.bottom)], v: [Math.round(v.top), Math.round(v.bottom)], o: Math.round(H.eff(b) * 100) / 100 }; }; })()""" % json.dumps(msg)
    c = mw_center(app, "Array.from(document.querySelectorAll('[aria-label=\"Send\"]')).find((e) => !e.closest('[aria-hidden=\"true\"]'))") if typed else None
    if c:
        mv_sample(app, probe, 3200)
        app.b.pump(0.1)
        mw_touch_tap(app, c[0], c[1], hold=0.05)
        app.b.pump(3.0)
        d = mv_stop(app)
        up = d['marks'].get('up', 0)
        rows = [(t - up, v) for t, v in d['frames'] if isinstance(v, dict) and t - up >= 333]
        seen = [(t, v) for t, v in rows if v.get('b')]
        out = [(t, v['b'], v['v']) for t, v in seen if v['b'][1] > v['v'][1] + 1 or v['b'][1] < v['v'][0]]
        missing = [t for t, v in rows if not v.get('b')]
        check('MW4 (M77): Coach: after Send the new message\'s bottom edge is inside the visible thread on every frame from +333 ms (%d frames, %d outside, %d without it)' % (len(seen), len(out), len(missing)),
              len(seen) >= 20 and not out and not missing, 'outside (ms, bubble top/bottom, thread top/bottom) %s; frames without the bubble (ms) %s' % (out[:6], missing[:6]))
    else:
        check('MW4 (M77): Coach: after Send the new message stays in view', False, 'the composer (%s) or Send was not found; typed %s' % (label, typed))
    # ---- MW5 (M75): Train This week → Plan: no spinner frame (Train prefetches the plan on focus)
    mv_tab(app, 'Train', 2.5)
    c = mw_center(app, SEG_JS % json.dumps('Plan'))
    if c:
        mv_sample(app, r"""() => ({ s: Array.from(document.querySelectorAll('[role=progressbar]')).filter((e) => !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 0 && window.__mvh.eff(e) > 0.05).map((e) => e.getAttribute('aria-label') || '').slice(0, 3), p: location.pathname })""", 1600)
        mw_touch_tap(app, c[0], c[1])
        app.b.pump(1.5)
        d = mv_stop(app)
        up = d['marks'].get('up', 0)
        spin = [(t - up, v['s']) for t, v in d['frames'] if isinstance(v, dict) and t >= up and v.get('s')]
        on_plan = app.js("(() => { const e = %s; return !!e && e.getAttribute('aria-selected') === 'true'; })()" % (SEG_JS % json.dumps('Plan')))
        check('MW5 (M75): Train This week → Plan shows no spinner frame (%d with one)' % len(spin), on_plan and not spin, 'Plan selected %s; spinner frames (ms, labels) %s' % (on_plan, spin[:6]))
        c2 = mw_center(app, SEG_JS % json.dumps('This week'))
        if c2:
            mw_touch_tap(app, c2[0], c2[1])
            app.b.pump(1.0)
    else:
        check('MW5 (M75): Train This week → Plan shows no spinner frame', False, 'no Plan segment on Train: ' + app.visible_text()[:160])
    mv_touch(app, False)
    mv_tab(app, 'Home', 1.0)


# ---------------------------------------------------------------- MW9: the tier-C and reduced-motion passes (wave-2 gate)
# FINAL_PLAN §10 (wave-2 gate): "reduced-motion and tier-C passes showing no hard cut and no frozen loader". Per frame:
# each pager page drawn across the screen, as [page id, how much of it shows] (its opacity as drawn, measured on one of
# its texts so the content fade counts, times the share of the screen width it covers), and how many "Loading"
# placeholders (Skeleton gates, spinners, the pager's page skeleton) are drawn.
MW9_PROBE = r"""() => { const H = window.__mvh; const s = H.slot(); const W = innerWidth;
    const ids = window.__mw9ids || (window.__mw9ids = new WeakMap()); const txt = window.__mw9txt || (window.__mw9txt = new WeakMap());
    const pick = (c) => { let best = null, bo = -1; const re = /\S/;
      for (const e of c.querySelectorAll('div,span,h1,h2,h3,p')) { if (!Array.from(e.childNodes).some((n) => n.nodeType === 3 && re.test(n.textContent))) continue;
        const o = H.eff(e, c); if (o > bo) { bo = o; best = e; } if (bo >= 0.999) break; } return best; };
    const out = [];
    if (s) for (const c of s.children) { if (!c.childElementCount) continue; if (!ids.has(c)) ids.set(c, (window.__mw9n = (window.__mw9n || 0) + 1));
      const cs = getComputedStyle(c); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = c.getBoundingClientRect(); const ov = Math.max(0, Math.min(W, r.right) - Math.max(0, r.left)) / W; if (ov <= 0.01) continue;
      let t = txt.get(c); if (!t || !t.isConnected || !c.contains(t) || H.eff(t, c) < 0.5) { t = pick(c); if (t) txt.set(c, t); }
      const o = t ? H.eff(t, s) : parseFloat(cs.opacity);
      out.push([ids.get(c), Math.round(o * ov * 1000) / 1000]); }
    const busy = Array.from(document.querySelectorAll('[aria-label^="Loading"]')).filter((e) => !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 0 && H.eff(e) > 0.05).length;
    return [out, busy, location.pathname]; }"""
MW9_TOUR = ['Train', 'Bio', 'Life', 'Fuel', 'Coach', 'Tests', 'Store', 'Profile', 'Home']


def mw9_tab(app, label):
    """One tab change filmed with MW9_PROBE: (blank-run frames, destination's in-between frames, cut, busy at the end, detail)."""
    mv_sample(app, MW9_PROBE, 4600)
    app.b.pump(0.1)
    app.js("(() => { window.__mv.mark('tap'); return true; })()")
    app.click_tab(label)
    app.wait_js("location.pathname === %s" % json.dumps(TAB_PATHS[label]), 8)
    app.b.pump(4.4)
    d = mv_stop(app)
    tap = d['marks'].get('tap', 0)
    rows = [(t - tap, v) for t, v in d['frames'] if isinstance(v, list) and t >= tap]
    if len(rows) < 10:
        return None, None, None, None, 'only %d frames after the tap' % len(rows)
    last = dict(rows[-1][1][0])
    dest = max(last, key=last.get) if last else None
    seq = [(t, dict(v[0]).get(dest, 0.0)) for t, v in rows]
    between = [(t, x) for t, x in seq if 0.05 < x < 0.95]
    first_full = next((i for i, (t, x) in enumerate(seq) if x >= 0.95), None)
    cut = bool(first_full and seq[first_full - 1][1] < 0.05 and not between)
    blank, run, worst = [], 0, 0
    for t, v in rows:
        if sum(x for _, x in v[0]) < 0.3:
            blank.append(t)
            run += 1
            worst = max(worst, run)
        else:
            run = 0
    busy_end = [(t, v[1]) for t, v in rows if t >= 3500 and v[1]]
    detail = '%s: dest page %s at %.2f; %d frames; in-between %d %s; blank frames (ms) %s; loader frames after +3.5 s %s' % (
        label, dest, last.get(dest, 0) if dest else 0, len(rows), len(between), between[:4], blank[:6], busy_end[:3])
    return worst, len(between), cut, len(busy_end), detail


def mw9_reload(app):
    """Reload the app (the web reads the motion tier at load) and come back to Priya's Home: the sign-in again when the
    reload ended the session (as in M1). Returns whether Home is drawn."""
    app.b.call('Page.navigate', url=app.app_url + '/')
    wait_until(lambda: (app.path() == '/sign-in' and app.has_input('Email')) or app.has_text(GREETING), app, 40, 0.2)
    app.err_mark = 0
    if app.has_text(GREETING):
        return ea.on_home(app, 'Priya', 30)
    app.workspace = None
    r = app.sign_in('member', *MEMBER)
    return bool(r['ok']) and ea.on_home(app, 'Priya', 30)


def motion_w2_calm(app):
    print('motion v2, wave 2: MW9 the tier-C and reduced-motion passes (no hard cut, no frozen loader)')
    mv_touch(app, False)
    for mode in ('tier C', 'reduced motion'):
        try:
            if mode == 'tier C':
                app.set_motion_tier('C')
            else:
                app.set_motion_tier(None)
                app.reduced_motion(True)
            # the web reads the tier at load: a reload (the session does not survive it, as in M1), then the sign-in
            home = mw9_reload(app)
            stored = app.js("localStorage.getItem('bp.fx.motionTier')")
            app.b.pump(3.0)
            if not home:
                check('MW9: %s: Home is reached for the tab tour' % mode, False, 'not on Home: ' + app.visible_text()[:160])
                continue
            bad, notes = [], []
            for label in MW9_TOUR:
                worst, between, cut, busy, detail = mw9_tab(app, label)
                notes.append(detail)
                if worst is None or worst >= 2 or cut or busy:
                    bad.append(label)
            check('MW9: %s (stored tier %s): a tour of the nine tabs has no hard cut (no 2 frames running with no page drawn, no page arriving whole in one frame) and no loader still drawn 3.5 s after a tap (%d of 9 tabs bad)' % (mode, stored, len(bad)),
                  not bad, 'bad %s; %s' % (bad, ' | '.join(n for n in notes if any(n.startswith(b + ':') for b in bad)) or ' | '.join(notes[:3])))
            # the Home inbox sheet (M67): its lists are drawn, not a loader, 1.5 s after it opens
            mv_tab(app, 'Home', 1.5)
            mv_sample(app, r"""() => [Array.from(document.querySelectorAll('[aria-label^="Loading"]')).filter((e) => !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 0 && window.__mvh.eff(e) > 0.05).length, document.querySelectorAll('[aria-label="Close"]').length]""", 2600)
            app.js("(() => { window.__mv.mark('tap'); return true; })()")
            opened = click_label(app, 'Notifications')
            app.b.pump(2.4)
            d = mv_stop(app)
            tap = d['marks'].get('tap', 0)
            late = [(t - tap, v[0]) for t, v in d['frames'] if isinstance(v, list) and t - tap >= 1500 and v[0]]
            shown = any(isinstance(v, list) and v[1] for t, v in d['frames'])
            check('MW9: %s: the Home inbox sheet shows its list, not a loader, from 1.5 s after it opens (%d loader frames then)' % (mode, len(late)),
                  opened and shown and not late, 'opened %s; sheet drawn %s; loader frames (ms, count) %s' % (opened, shown, late[:6]))
            close_sheet(app)
            app.screenshot('mw9-' + mode.replace(' ', '-'))
        finally:
            app.reduced_motion(False)
            app.set_motion_tier(None)
    # back to the default tier for the sections after this one: reload, then sign in again
    mw9_reload(app)
    app.b.pump(1.0)


# ---------------------------------------------------------------- layout
TAB_SHEETS = {   # a sheet each tab opens, by the aria-label of the control that opens it
    'Home': 'Notifications', 'Train': 'Mark ', 'Bio': 'Weight: ', 'Life': 'Vitamin D (25-OH), ', 'Fuel': 'Food preferences',   # Train's: while a session is still to do (the train section also checks it)
    'Coach': 'About Asha Menon', 'Store': 'View details of Core',
}
OVERLAYS = ['/notifications', '/announcements', '/recommendations', '/progress-entry', '/goals', '/habits', '/meal-log', '/book-appointment', '/coach-ai', '/book-test',
            '/packages?package=core', '/bespoke', '/refer', '/photos', '/billing', '/help', '/settings/profile', '/settings/security', '/settings/consents',
            '/settings/data', '/settings/credits', '/report/{report}', '/booking/{booking}', '/workout/{workout}', '/exercise/{exercise}']
TAB_TITLES = dict([('Home', GREETING)] + [(t[0], t[3]) for t in ea.TAB_WALK])


def audit_pages(app, max_pages, width):
    """Scroll the screen's main scroller page by page from the top, auditing each; returns (issues, pages, last pos)."""
    issues = []
    pos = app.scroll('top')
    app.b.pump(0.3)
    pages = 0
    while True:
        pages += 1
        a = app.layout_audit()
        if a.get('sw', 0) > width or a.get('iw', width) != width:
            issues.append('sideways: scroll width %s, window %s (set %s) at %s' % (a.get('sw'), a.get('iw'), width, pos.get('top')))
        for k, what in (('overlaps', 'text over text'), ('cut', 'cut'), ('small', 'under 24x24'), ('smallKey', 'under 44x44')):
            for x in a.get(k, []):
                issues.append('%s: %s (at %s)' % (what, x, pos.get('top')))
        if pos.get('atEnd', True) or pages >= max_pages:
            break
        pos = app.scroll(0.8)
        app.b.pump(0.25)
    return issues, pages, pos


def layout_section(app):
    print('layout: L1 every tab, overlay and sheet at four sizes; L2 the tablet column and pill')
    if not ensure_priya(app):
        check('layout: Priya is signed in', False)
        return
    s = api_session()
    try:
        ids = {'report': ah.ApiSession.first_id(s.s, '/me/reports'), 'booking': ah.ApiSession.first_id(s.s, '/me/bloodwork/bookings'),
               'workout': ah.ApiSession.first_id(s.s, '/me/workouts'), 'exercise': ah.ApiSession.first_id(s.s, '/me/exercises')}
    finally:
        s.logout()
    app.reduced_motion(True)
    try:
        for w, h, dpr, ua in SIZES:
            size = '%dx%d' % (w, h)
            if ua:
                app.b.call('Emulation.setUserAgentOverride', userAgent=PHONE_UA, platform='Linux armv8l')
                app.b.call('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            app.set_viewport(w, h, dpr, True)
            app.b.pump(1.0)
            app.open_route('/(tabs)', None, 30)
            ea.on_home(app)
            for label in ea.MEMBER_TABS:
                app.err_mark = len(app.b.errors)
                app.click_tab(label)
                app.wait_visible(TAB_TITLES[label], 30)
                app.b.pump(0.8)
                issues, pages, pos = audit_pages(app, 30, w)
                clear = app.pill_clearance() if pos.get('atEnd') else None
                if clear and clear.get('gap', 99) < 8:
                    issues.append('the last content (%s) ends %s pt from the pill' % (clear.get('what'), clear.get('gap')))
                errs = app.errors_since()
                check('L1 %s: %s tab, %d screens scrolled: no sideways scroll, overlap, cut text or small control; clear of the pill; no console error' % (size, label, pages),
                      not issues and not errs, '; '.join(issues[:6] + errs[:2]))
                if label in ('Home', 'Train', 'Store') or w in (360, 820):
                    app.screenshot('layout-%s-%s' % (size, label.lower()))
                opener = TAB_SHEETS.get(label)
                if opener:
                    app.scroll('top')
                    app.b.pump(0.3)
                    if label == 'Train' and app.click_text('This week', seconds=3):   # Train remembers the segment last used
                        app.b.pump(0.8)
                    app.err_mark = len(app.b.errors)
                    if not click_label(app, opener):
                        skip('L1 %s: %s\'s sheet' % (size, label), 'no control labelled "%s…" on the tab now' % opener.strip())
                        continue
                    opened = wait_until(lambda: app.js(CLOSE_COUNT_JS), app, 8)   # a sheet carries its Close control
                    app.b.pump(0.8)
                    if opened:
                        a = app.layout_audit()
                        sheet_issues = [('text over text: ' + x) for x in a.get('overlaps', [])] + [('cut: ' + x) for x in a.get('cut', [])] + [('under 24x24: ' + x) for x in a.get('small', [])] + [('under 44x44: ' + x) for x in a.get('smallKey', [])]
                        if a.get('sw', 0) > w or a.get('iw', w) != w:
                            sheet_issues.append('sideways scroll %s/%s' % (a.get('sw'), a.get('iw')))
                        errs = app.errors_since()
                        check('L1 %s: %s\'s sheet (%s…): laid out cleanly, no console error' % (size, label, opener.strip()), not sheet_issues and not errs, '; '.join(sheet_issues[:6] + errs[:2]))
                        if w in (360, 820):
                            app.screenshot('layout-%s-%s-sheet' % (size, label.lower()))
                        if label == 'Home' and (w, h) == SIZES[0][:2]:
                            # a keyboard on the web (a laptop, a tablet with a keyboard): Escape closes the open sheet
                            # and the pager still switches tabs afterwards (the onboarding section checks Escape with no sheet)
                            app.press_key('Escape')
                            gone = wait_until(lambda: not app.js(CLOSE_COUNT_JS), app, 6)
                            check('L1 %s: Escape closes Home\'s sheet' % size, gone, app.visible_text()[:160])
                        if not close_sheet(app):
                            check('L1 %s: %s\'s sheet closes with its Close control' % (size, label), False, app.visible_text()[:160])
                            app.open_route('/(tabs)', None, 20)
                    else:
                        check('L1 %s: %s\'s sheet (%s…) opens' % (size, label, opener.strip()), False, app.visible_text()[:160])
            if w == 820:
                l2(app)
            for route in OVERLAYS:
                route = route.format(**{k: v or 'none' for k, v in ids.items()})
                if 'none' in route:
                    skip('L1 %s: %s' % (size, route), 'no record for Priya')
                    continue
                app.err_mark = len(app.b.errors)
                app.open_route(route, None, 30)
                app.wait_js("!/Bundling/.test(document.body.innerText) && document.querySelectorAll('[aria-hidden=\"true\"]').length > 0", 20)
                app.b.pump(1.2)
                issues, pages, pos = audit_pages(app, 5, w)
                errs = app.errors_since()
                check('L1 %s: %s, %d screen(s): no sideways scroll, overlap, cut text or small control; no console error' % (size, route, pages), not issues and not errs, '; '.join(issues[:6] + errs[:2]))
                if w in (360, 820) and route in ('/workout/{workout}'.format(**ids), '/packages?package=core', '/book-test', '/settings/profile'):
                    app.screenshot('layout-%s-%s' % (size, re.sub(r'[^a-z0-9]+', '-', route.split('?')[0].lower()).strip('-')))
            app.open_route('/(tabs)', None, 30)
            if ua:
                app.b.call('Emulation.setUserAgentOverride', userAgent='')
                app.b.call('Emulation.setTouchEmulationEnabled', enabled=False)
        l3_widen(app)
    finally:
        app.reduced_motion(False)
        app.set_viewport(390, 844, 2, True)
        app.b.pump(1.0)


# the photos on screen (decorative ones included: they are hidden from screen readers, not from the eye): drawn from
# their file, or still the blurred placeholder (a data: URL); pages off screen are not displayed or sit outside the window
PHOTOS_JS = r"""(() => { const out = { loaded: 0, placeholder: 0 }; for (const i of document.querySelectorAll('img')) { const s = i.currentSrc || i.src || ''; const r = i.getBoundingClientRect();
  if (r.width < 40 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
  if (s.startsWith('data:')) out.placeholder++; else out.loaded++; } return out; })()"""


def l3_widen(app):
    """L3: a window that widens after the photos were drawn (split screen, a foldable opening, a browser window dragged
    wider) keeps every photo: Home and Store loaded at 390, then the window at 820."""
    for label in ('Home', 'Store'):
        app.set_viewport(390, 844, 2, True)
        app.b.pump(0.8)
        app.click_tab(label)
        app.wait_visible(TAB_TITLES[label], 30)
        app.scroll('top')
        app.b.pump(2.5)
        before = app.js(PHOTOS_JS) or {}
        app.set_viewport(820, 1180, 2, True)
        app.b.pump(1.0)
        after = before
        for _ in range(16):
            after = app.js(PHOTOS_JS) or {}
            if not after.get('placeholder'):
                break
            app.b.pump(0.5)
        check('L3: %s loaded at 390 then widened to 820 keeps its photos (%s → %s)' % (label, before, after),
              after.get('loaded', 0) >= 1 and not after.get('placeholder'), str(after))
    app.set_viewport(390, 844, 2, True)
    app.b.pump(0.8)


COLUMN_JS = r"""(() => { const s = window.__bpScroller; if (!s) return null;
  const hidden = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) < 0.05) return true; } return false; };
  let L = 1e9, R = -1e9;
  for (const e of s.querySelectorAll('div,span')) { if (!Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.bottom < 0 || r.top > innerHeight || hidden(e)) continue;
    let scroller = false; for (let p = e.parentElement; p && p !== s; p = p.parentElement) { const c = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(c.overflowX) && p.scrollWidth > p.clientWidth + 4) { scroller = true; break; } }
    if (scroller) continue; L = Math.min(L, r.left); R = Math.max(R, r.right); }
  return { left: Math.round(L), right: Math.round(R), width: Math.round(R - L), centre: Math.round((L + R) / 2), W: innerWidth }; })()"""
PILL_JS = r"""(() => { const tabs = Array.from(document.querySelectorAll('[role=tab][aria-label]')).filter((e) => !e.closest('[aria-hidden="true"]') && /^(Home|Train|Bio|Life|Fuel|Coach|Tests|Store|Profile)(, |$)/.test(e.getAttribute('aria-label')));
  if (tabs.length !== 9) return { tabs: tabs.length };
  let p = tabs[0].parentElement; while (p && !(getComputedStyle(p).overflowX !== 'visible')) p = p.parentElement;
  const box = p ? p.getBoundingClientRect() : { left: 0, right: innerWidth };
  const inside = tabs.every((t) => { const r = t.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; });
  const chevrons = Array.from(tabs[0].closest('[role=tablist]').parentElement.querySelectorAll('[aria-hidden="true"]')).filter((e) => parseFloat(getComputedStyle(e).opacity) > 0.05 && e.querySelector('svg')).length;
  return { tabs: tabs.length, inside, chevrons, scrollable: p ? p.scrollWidth > p.clientWidth + 2 : null }; })()"""


def l2(app):
    for label in ('Home', 'Bio', 'Profile'):
        app.click_tab(label)
        app.wait_visible(TAB_TITLES[label], 30)
        app.b.pump(0.6)
        app.scroll('top')
        app.scroll(1.2)
        app.b.pump(0.5)
        col = app.js(COLUMN_JS) or {}
        check('L2 820x1180: %s\'s content column is at most 520 wide and centred (%s)' % (label, col), col and col.get('width', 999) <= 524 and abs(col.get('centre', 0) - 410) <= 14, str(col))
        app.scroll('top')
    pill = app.js(PILL_JS) or {}
    check('L2 820x1180: the pill shows all nine tabs, none scrolled away and no chevron', pill.get('tabs') == 9 and pill.get('inside') and not pill.get('chevrons') and not pill.get('scrollable'), str(pill))


# ---------------------------------------------------------------- offline
def run_cmd(cmd):
    r = subprocess.run(shlex.split(cmd), capture_output=True, text=True, timeout=180)
    return r.returncode == 0, (r.stdout + r.stderr)[-300:]


def api_up():
    try:
        with urllib.request.urlopen(BASE + '/api/health', timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def offline_section(app):
    real = bool(API_STOP and API_START)
    how = 'the API stopped' if real else 'the API unreachable (blocked in Chrome)'
    print('offline: O1 with %s' % how)
    if not ensure_priya(app):
        check('offline: Priya is signed in', False)
        return
    app.open_route('/(tabs)', None, 30)
    ea.on_home(app)
    if real:
        ok, out = run_cmd(API_STOP)
        down = ok and wait_until(lambda: not api_up(), app, 20)
        check('O1: the scratch API is stopped (API_STOP)', down, out)
        if not down:
            return
    else:
        app.b.call('Fetch.enable', patterns=[{'urlPattern': BASE.replace('127.0.0.1', 'localhost') + '/api/*', 'requestStage': 'Request'}, {'urlPattern': BASE + '/api/*', 'requestStage': 'Request'}])
        inner = app.b._event

        def refuse(msg, inner=inner):
            if msg.get('method') == 'Fetch.requestPaused':
                app.b.send('Fetch.failRequest', requestId=msg['params']['requestId'], errorReason='ConnectionRefused')
                return
            inner(msg)
        app.b._event = refuse
    try:
        honest = []
        for route, title in (('/(tabs)/bio', r'^Bio$'), ('/(tabs)/fuel', r'^Nutrition$'), ('/billing', r'^Billing$'), ('/announcements', r'^Announcements$')):
            app.open_route(route, None, 30)
            said = app.wait_visible(r'^No connection$', 20) and app.has_visible(r'^The Bioptime service could not be reached\. Check your connection; nothing you did was lost\.$') and app.find_clickable('Try again')
            if not said and app.has_visible(r'^Offline$'):
                said = app.has_visible(r'^Showing what was saved ')
            honest.append((route, bool(said), app.has_visible(title)))
            app.screenshot('offline-' + re.sub(r'[^a-z]+', '-', route).strip('-'))
        check('O1: with %s each screen says so honestly ("No connection" with "The Bioptime service could not be reached. …" and "Try again", or "Offline" with the saved copy), keeping its title' % how,
              all(s and t for _, s, t in honest), str(honest))
        check('O1: no screen crashed and the session is kept (still Priya, no sign-in screen)', app.path() != '/sign-in' and not app.has_visible(r'^Signed out$'), app.path())
    finally:
        if real:
            ok, out = run_cmd(API_START)
            up = ok and wait_until(api_up, app, 90, 1.0)
            check('O1: the scratch API is started again on the same database (API_START)', up, out)
        else:
            app.b._event = inner
            app.b.call('Fetch.disable')
    app.b.pump(1.0)
    app.err_mark = len(app.b.errors)
    app.open_route('/billing', None, 30)
    if app.find_clickable('Try again'):
        app.click_text('Try again')
    back = app.wait_visible(r'Payments here are simulated; no money moved\.|^PAID ORDERS$|^DOCUMENTS$', 30) and not app.has_visible(r'^No connection$')
    check('O1: once the API answers again, "Try again" brings the screen back', back, app.visible_text()[:200])
    app.open_route('/(tabs)/bio', None, 30)
    # Bio's metric rings sit below its first cards since motion v2 (M64: the grid mounts once the page has settled and
    # each tile is revealed as it crosses the line), so the Weight tile is found by its control, brought into view the
    # way a person scrolls to it, and must then be drawn
    WEIGHT = "(() => { const e = Array.from(document.querySelectorAll('[aria-label^=\"Weight: \"]')).find((x) => !x.closest('[aria-hidden=\"true\"]')); if (!e) return false; e.scrollIntoView({ block: 'center' }); return true; })()"
    back = wait_until(lambda: not app.has_visible(r'^No connection$') and app.js(WEIGHT) and wait_until(lambda: app.has_visible(r'^Weight$'), app, 3), app, 30)
    check('O1: coming back to a tab loads it again (Bio\'s metrics: the Weight tile, scrolled into view)', back, app.visible_text()[:200])
    ea.screen_ok(app, 'O1: no console error once the API is back', None)


# ---------------------------------------------------------------- onboarding
def onboarding_section(app):
    print('onboarding: F2 a new member, from registration to Home, with no number made up')
    if app.workspace:
        app.sign_out()
    email = 'e2e.fx.%d@demo.bioptime.test' % int(time.time())
    ok, d = app.register_member('Kavya Fresh', email, 'E2E-fresh-member-2026!')
    check('F2: registration and the email code (filled in by the demo server)', ok, d)
    if not ok:
        return
    ok, steps, d = app.onboard()
    check('F2: consent, the three slides, the nine quiz steps and "Send my answers" lead Home', ok and ea.on_home(app, 'Kavya'), 'steps %s; %s' % (steps, d))
    if not ok:
        return
    app.wait_visible(r'^Set a steps goal$', 15)  # offered once the goals have answered (none yet)
    seen = app.visible_text()
    check('F2: Home invents no number: the score is a dash with "Bioptime does not calculate a Wellness Score yet.", no steps target, no kcal',
          bool(re.search(r'^Bioptime does not calculate a Wellness Score yet\.$', seen, re.M)) and bool(re.search(r'^Set a steps goal$', seen, re.M)) and not re.search(r'kcal', seen, re.I), seen[:300])
    ea.no_labels(app, 'F2 new member home')
    app.screenshot('onboarding-home')
    tabs = app.member_tabs()
    check('F2: the new member has the nine tabs', [t for t, _ in tabs] == ea.MEMBER_TABS, str(tabs))
    for label, route, path, expect in ea.TAB_WALK:
        app.err_mark = len(app.b.errors)
        app.click_tab(label)
        app.wait_js("location.pathname === %s" % json.dumps(path), 20)
        app.b.pump(1.5)
        seen = app.visible_text()
        errs = app.errors_since()
        box = re.search(r'^Something went wrong$', seen, re.M)
        made_up = label == 'Fuel' and re.search(r'\d+ kcal', seen)
        check('F2: %s draws for the new member with no error box and no console error%s' % (label, ', no kcal made up' if label == 'Fuel' else ''), not errs and not box and not made_up, '; '.join(errs[:2]) + ' ' + seen[:120])
    # the keyboard on the web: Escape with no sheet open must leave the tab pager working (a browser on a laptop or a
    # tablet with a keyboard); checked last, as a broken pager stays broken until the page is loaded again
    app.click_tab('Home')
    ea.on_home(app, 'Kavya', 10)
    app.press_key('Escape')
    app.b.pump(1.0)
    app.click_tab('Train')
    app.b.pump(2.0)
    width = app.js('({iw: innerWidth, sw: document.documentElement.scrollWidth})') or {}
    fine = app.has_visible(r'^Train$') and width.get('iw') == app.b.w and width.get('sw') == app.b.w
    check('keyboard: Escape on a tab (no sheet open) leaves the pager working: the next tab shows and the page stays one screen wide', fine,
          'Train title visible %s; window %s, scroll width %s (set %s)' % (app.has_visible(r'^Train$'), width.get('iw'), width.get('sw'), app.b.w))
    if not fine:
        app.screenshot('keyboard-escape-pager')
    ok, d = app.sign_out()
    check('F2: the new member signs out (Profile › Settings)', ok, d)
    try:
        onboarding_w2(app)
    finally:
        mv_touch(app, False)
        app.b.call('Emulation.setUserAgentOverride', userAgent='')
        app.set_viewport(390, 844, 2, True)


# the wave-2 gate's onboarding rows (FINAL_PLAN §10: M54 and M59 at 360x740 and 820x1180 as well; M58 at 390x844)
OB_SIZES = [(390, 844, 3, None), (360, 740, 3, 'android'), (820, 1180, 2, None)]
OB_CTA_JS = "(() => { const c = Array.from(document.querySelectorAll('[role=button]')).find((e) => /^(Agree and continue|Continue|Send my answers)$/.test(e.getAttribute('aria-label') || '') && !e.closest('[aria-hidden=\"true\"]')); return c ? Math.round(c.getBoundingClientRect().y * 10) / 10 : null; })()"
OB_CLIP_JS = r"""(() => { const out = []; for (const e of document.querySelectorAll('div[dir=auto], span')) { if (e.closest('[aria-hidden="true"]')) continue; const s = getComputedStyle(e);
  if (s.overflow === 'hidden' && e.scrollHeight > e.clientHeight + 1 && e.innerText.trim()) out.push(e.innerText.trim().slice(0, 40)); } return out.slice(0, 5); })()"""
OB_STEP_JS = "(document.body.innerText.match(/STEP (\\d) OF 9/i) || [])[1] || null"
OB_PICK = "Array.from(document.querySelectorAll('[role=%s]')).filter((e) => !e.closest('[aria-hidden=\\'true\\']'))"
OB_SLIDES = ['Your coach, your plan', 'Blood tests at home', 'Progress you can see']
# the slide on screen: the most opaque slide title inside the window (the dots carry no aria-selected on the web)
OB_SLIDE_JS = r"""(() => { const ts = %s; let best = null, bo = 0.5;
  ts.forEach((x, i) => { for (const e of document.querySelectorAll('div,span,h1,h2,h3,p')) { if (e.closest('[aria-hidden="true"]')) continue;
    if (!Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() === x)) continue; const r = e.getBoundingClientRect(); if (r.width <= 0 || r.right <= 0 || r.left >= innerWidth) continue;
    let o = 1; for (let p = e; p && p !== document.body; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity); if (o > bo) { bo = o; best = i + 1; } } });
  return best; })()""" % json.dumps(['Your coach, your plan', 'Blood tests at home', 'Progress you can see'])


def ob_answer(app):
    if app.js(OB_PICK % 'radio' + '.length'):
        app.js(OB_PICK % 'radio' + '[1].click()')
    elif app.js(OB_PICK % 'checkbox' + '.length') and not app.js(OB_PICK % 'checkbox' + ".some((e) => e.getAttribute('aria-checked') === 'true')"):
        app.js(OB_PICK % 'checkbox' + '[0].click()')


def ob_slides_drag(app):
    """MW8 (M59) on the first slide: a short slow drag springs back within 300 ms; a 220 pt drag over 450 ms moves the
    title on >= 20 frames while the finger moves and turns the slide."""
    probe = r"""() => { const own = window.__mwOwn; const t = %s.map((x) => { const e = own('^' + x + '$'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(window.__mvh.eff(e) * 100) / 100]; });
        return { t, k: %s }; }""" % (json.dumps(OB_SLIDES), OB_SLIDE_JS.replace('(() =>', '(() =>', 1))
    app.js(MW_OWN_JS)
    c = mw_center(app, "window.__mwOwn('^%s$')" % OB_SLIDES[0])
    if not c or app.js(OB_SLIDE_JS) != 1:
        check('MW8 (M59): the slides follow a finger', False, 'not on the first slide (%s) or its title is not drawn' % app.js(OB_SLIDE_JS))
        return
    out = {}
    for name, dist, secs, hold in (('short', -60, 0.6, 0.25), ('full', -220, 0.45, 0.0)):
        mv_sample(app, probe, 2400)
        app.b.pump(0.1)
        mw_paced_drag(app, int(c[0] + 90), int(c[0] + 90 + dist), int(c[1]), secs, hold)
        app.b.pump(1.6)
        d = mv_stop(app)
        up = d['marks'].get('up', 0)
        rows = [(t, v) for t, v in d['frames'] if isinstance(v, dict) and 't' in v]
        xs = [(t, v['t'][0][0] if v['t'][0] else None) for t, v in rows]
        rest = next((x for t, x in xs if x is not None), None)
        moving = [t for (t, x), (t2, x2) in zip(xs, xs[1:]) if t2 <= up and x is not None and x2 is not None and abs(x2 - x) > 0.3]
        back = next((t - up for t, x in xs if t > up and x is not None and rest is not None and abs(x - rest) < 1), None)
        far = max([abs(x - rest) for t, x in xs if x is not None and rest is not None and t <= up] or [0])
        out[name] = {'moving': len(moving), 'back': back, 'far': far, 'slide': app.js(OB_SLIDE_JS)}
        app.b.pump(0.6)
    s, f = out['short'], out['full']
    check('MW8 (M59): a short slow drag on the first slide follows the finger (%.0f px) and springs back %s ms after release (at most 300) on the same slide; a 220 pt drag over 450 ms moves the title on %d frames (at least 20) and turns the slide (now %s)'
          % (s['far'], s['back'], f['moving'], f['slide']),
          s['far'] >= 10 and s['back'] is not None and s['back'] <= 300 and s['slide'] == 1 and f['moving'] >= 20 and f['slide'] == 2, json.dumps(out))


def ob_quiz_threshold(app, w):
    """MW8 (M59) at 820x1180 on quiz step 2: the commit threshold is 0.25 of the column (448 → 112 pt), not of the
    window: a slow 100 pt drag back stays on step 2, a slow 130 pt one goes back to step 1."""
    app.js(MV_HELPERS_JS)
    got = []
    for dist in (100, 130):
        # on the step's eyebrow ("STEP 2 OF 9", inside the pan's area), not on an answer or a dial
        c = mw_center(app, "window.__mvh.own('^STEP \\\\d OF 9$')")
        if not c:
            got.append(None)
            break
        mv_sample(app, "() => null", 300)
        mw_paced_drag(app, int(w / 2 - dist / 2), int(w / 2 + dist / 2), int(c[1]), 0.8, 0.25)
        mv_stop(app)
        app.b.pump(1.3)
        got.append(app.js(OB_STEP_JS))
    check('MW8 (M59): at %dx1180 the quiz\'s commit threshold is the column\'s: a slow 100 pt drag back stays on step 2 (%s), a slow 130 pt one goes back to step 1 (%s)' % (w, got[0] if got else None, got[1] if len(got) > 1 else None),
          got == ['2', '1'], str(got))


def onboarding_w2(app):
    print('onboarding, wave 2: MW6 fixed CTAs at three sizes, MW7 the quiz deck, MW8 the slides and the quiz drag')
    for w, h, dpr, ua in OB_SIZES:
        size = '%dx%d' % (w, h)
        if app.workspace:
            app.sign_out()
        if ua:
            app.b.call('Emulation.setUserAgentOverride', userAgent=PHONE_UA, platform='Linux armv8l')
        else:
            app.b.call('Emulation.setUserAgentOverride', userAgent='')
        app.set_viewport(w, h, dpr, True)
        mv_touch(app, True)
        app.b.pump(1.0)
        ok, d = app.register_member('Wave Two', 'e2e.fx.w2.%d.%d@demo.bioptime.test' % (w, int(time.time())), 'E2E-wave-two-member-2026!')
        if not ok:
            check('MW6 (M54) %s: a new member registers' % size, False, d)
            continue
        if not app.click_text('Continue', seconds=10) and not app.path().startswith('/onboarding'):
            app.open_route('/onboarding', None, 30)
        if not app.wait_text(r'^Your data, your control$', 30):
            check('MW6 (M54) %s: the consent screen' % size, False, app.visible_text()[:200])
            continue
        app.b.pump(1.5)
        consent = [app.js(OB_CTA_JS)]
        for on in (True, False, True):
            app.set_checkbox('Process my health information', on)
            app.b.pump(0.9)
            consent.append(app.js(OB_CTA_JS))
        app.click_text('Agree and continue')
        app.wait_clickable('Next', 30)
        app.b.pump(1.5)
        if w == 390:
            ob_slides_drag(app)
        for _ in range(5):
            if app.find_clickable('Start'):
                app.click_text('Start')
                break
            if not app.click_text('Next', seconds=10):
                break
            app.b.pump(0.9)
        if not app.wait_text(r'STEP \d OF 9', 30):
            check('MW6 (M54) %s: the quiz' % size, False, 'no quiz after the slides: ' + app.visible_text()[:200])
            continue
        app.b.pump(1.0)
        if w == 820:
            ob_answer(app)
            app.b.pump(0.5)
            app.click_text('Continue')
            app.wait_js("/STEP 2 OF 9/i.test(document.body.innerText)", 10)
            app.b.pump(1.2)
            ob_quiz_threshold(app, w)
            if app.js(OB_STEP_JS) != '1':
                c = mw_center(app, "Array.from(document.querySelectorAll('[role=button]')).find((e) => (e.getAttribute('aria-label') || '') === 'Back' && !e.closest('[aria-hidden=\"true\"]'))")
                if c:
                    mw_touch_tap(app, c[0], c[1])
                app.wait_js("/STEP 1 OF 9/i.test(document.body.innerText)", 6)
            app.b.pump(1.0)
        steps, ctas, clipped, blanks, deck = [], [], [], [], 0
        for _ in range(14):
            n = app.js(OB_STEP_JS)
            if not n:
                break
            if steps and steps[-1] == n:
                app.b.pump(0.5)
                continue
            steps.append(n)
            y0 = app.js(OB_CTA_JS)
            ob_answer(app)
            app.b.pump(0.6)
            y1 = app.js(OB_CTA_JS)
            ctas.append((n, y0, y1))
            if w == 360:
                c_ = app.js(OB_CLIP_JS) or []
                if c_:
                    clipped.append((n, c_))
            if app.find_clickable('Send my answers'):
                app.type_into('City', 'Pune')
                app.type_into('State', 'Maharashtra')
                app.b.pump(0.3)
                ctas.append((n + ' (city typed)', app.js(OB_CTA_JS), None))
                app.click_text('Send my answers')
                break
            if w == 390:
                # MW7 (M58): from the tap until the new step stands, an answer (old or new) is drawn on every frame
                c = mw_center(app, "Array.from(document.querySelectorAll('[role=button]')).find((e) => (e.getAttribute('aria-label') || '') === 'Continue' && !e.closest('[aria-hidden=\"true\"]'))")
                mv_sample(app, r"""() => { const H = window.__mvh; const W = innerWidth; const vis = Array.from(document.querySelectorAll('[role=radio],[role=checkbox]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < W && H.eff(e) > 0.05; });
                    return { n: vis.length, live: vis.filter((e) => !e.closest('[aria-hidden="true"]')).length }; }""", 1500)
                app.b.pump(0.1)
                if c:
                    mw_touch_tap(app, c[0], c[1])
                app.wait_js("!/STEP %s OF 9/i.test(document.body.innerText)" % n, 10)
                app.b.pump(1.0)
                d = mv_stop(app)
                up = d['marks'].get('up', 0)
                rows = [(t, v) for t, v in d['frames'] if isinstance(v, dict) and 'n' in v]
                old = [v for t, v in rows if t < up]
                if old and old[-1]['n'] and rows and rows[-1][1]['live']:
                    deck += 1
                    blank = [t - up for t, v in rows if t >= up and not v['n']]
                    if blank:
                        blanks.append((n, blank[:6]))
            else:
                app.click_text('Continue')
                app.wait_js("!/STEP %s OF 9/i.test(document.body.innerText)" % n, 10)
                app.b.pump(0.9)
        home = app.wait_text(ah.HOME_TEXT['member'], 60)
        ys = sorted(set(y for _, a, b in ctas for y in (a, b) if y is not None))
        cy = sorted(set(y for y in consent if y is not None))
        check('MW6 (M54) %s: the quiz CTA stands at one y on all nine steps (%s) and the consent CTA does not move when its box is ticked or unticked (%s)%s'
              % (size, ys, cy, ', no text clipped' if w == 360 else ''),
              bool(home) and [s_ for s_ in steps if s_] == [str(k) for k in range(1, 10)] and ys and max(ys) - min(ys) <= 0.5 and len(cy) >= 1 and None not in consent and max(cy) - min(cy) <= 0.5 and not clipped,
              'steps %s; home %s; CTA y (step, before, after the answer) %s; consent (rest, ticked, unticked, ticked) %s; clipped %s' % (steps, bool(home), ctas, consent, clipped[:4]))
        if w == 390:
            check('MW7 (M58): a quiz step change from one set of answers to the next never shows a frame without answers (%d changes filmed, %d with a blank frame)' % (deck, len(blanks)),
                  deck >= 3 and not blanks, 'blank (step, ms after the tap) %s' % blanks[:4])
        if home:
            app.workspace = 'member'
            app.b.pump(1.0)
            app.sign_out()
    mv_touch(app, False)


SECTIONS = {'login': login_section, 'nav': nav_section, 'wellness': wellness_section, 'train': train_section, 'sync': sync_section, 'ai': ai_section,
            'motion': motion_section, 'layout': layout_section, 'offline': offline_section, 'onboarding': onboarding_section}


def main():
    global PREVIEW
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:3984 (never the live demo).')
    why = ah.live_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s.' % (BASE, why))
    why = ah.port_refusal(APP_PORT) if not APP_URL else ah.live_refusal(APP_URL)
    if why:
        sys.exit('Refusing the app server %s: %s.' % (APP_URL or APP_PORT, why))
    if ah.staff_app():
        sys.exit('e2e_app_fx.py checks the client app; run it without APP_STAFF.')
    status, cfg, _ = ah.api(BASE, 'GET', '/public/config')
    PREVIEW = status == 200 and isinstance(cfg, dict) and cfg.get('openPreview') is True
    ea.PREVIEW = PREVIEW
    only = [s.strip() for s in os.environ.get('E2E_FX_ONLY', '').split(',') if s.strip()] or list(SECTION_NAMES)
    unknown = [s for s in only if s not in SECTIONS]
    if unknown:
        sys.exit('E2E_FX_ONLY names unknown sections %s; the sections are %s' % (unknown, ', '.join(SECTION_NAMES)))
    only = [s for s in SECTION_NAMES if s in only]
    why = ah.cdp_refusal(CDP_PORT)
    if why:
        sys.exit('Refusing E2E_CDP_PORT %s: %s.' % (CDP_PORT, why))
    if not APP_URL and ah.port_in_use(APP_PORT):
        sys.exit('APP_PORT %s is already in use.' % APP_PORT)
    ah.configure(OUT, CDP_PORT)
    app_url = APP_URL or 'http://localhost:%s' % int(APP_PORT)
    if not ah.cors_allows(BASE, app_url):
        sys.exit('The API at %s does not allow the browser origin %s (CORS_ORIGINS).' % (BASE, app_url))
    t0 = time.monotonic()
    timings = {}
    expo = b = app = None
    try:
        if not APP_URL:
            expo = ah.ExpoWeb(APP_PORT, BASE, APP_DIR, staff=False)
            expo.start()
            timings['expo start'] = round(expo.started_in, 1)
        b = ah.start_browser()
        b.viewport(390, 844, mobile=True)
        app = ah.App(b, BASE, app_url)
        timings['first screen'] = round(app.boot(), 1)
        check('the client app opens on its sign-in after the splash', app.wait_text(ah.SIGN_IN_SCREEN, 60) and app.wait_js("location.pathname === '/sign-in'", 20), app.path())
        for name in only:
            t1 = time.monotonic()
            try:
                SECTIONS[name](app)
            except Exception as e:
                traceback.print_exc()
                check('%s: the section ran to its end without an unexpected error' % name, False, repr(e)[:300])
                try:
                    app.screenshot('error-' + name)
                    app.reduced_motion(False)
                    app.set_viewport(390, 844, 2, True)
                except Exception:
                    pass
            timings[name] = round(time.monotonic() - t1, 1)
            print('  (%s took %.0fs)' % (name, timings[name]))
    except Exception as e:
        traceback.print_exc()
        check('the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        end_sessions()
        if app:
            try:
                app.screenshot('last-screen')
            except Exception:
                pass
        if b:
            try:
                b.close()
                b.proc.wait(10)
            except Exception:
                pass
        if expo:
            expo.stop()
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'openPreview': PREVIEW, 'offline': 'API stopped' if API_STOP and API_START else 'blocked in Chrome', 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
