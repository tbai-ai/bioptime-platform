#!/usr/bin/env python3
"""End-to-end check of the app (apps/mobile) through its Expo web build in headless Chrome (Python 3.9, stdlib, Google Chrome).

    BASE=http://127.0.0.1:4121 python3 -I tools/e2e_app.py                      the client app against a scratch API; Expo web on APP_PORT
    BASE=… APP_PORT=8121 E2E_APP_ONLY=member,auth python3 -I tools/e2e_app.py   only the named sections
    BASE=… APP_STAFF=1 python3 -I tools/e2e_app.py                              the staff build (three doors, coach, admin)
    BASE=<API started with OPEN_PREVIEW=1> python3 -I tools/e2e_app.py          the open preview: sections relay, preview, refused

Which build: the app is for clients (apps/mobile src/lib/config STAFF_APP, off by default), so the default run starts
Expo with EXPO_PUBLIC_STAFF_APP=0 and checks the client app; APP_STAFF=1 starts it with EXPO_PUBLIC_STAFF_APP=1 and checks
the staff build as before (the chooser, the coach and administrator sign-ins and workspaces). With APP_URL the running
server must have been started with the matching flag.

BASE is the scratch API (required): the usual recipe (README, "Checks": reset-demo, then src/server.ts on its own port),
started with CORS_ORIGINS=http://localhost:<APP_PORT> so the browser origin of the app is allowed. The check starts
`npx expo start --web --port <APP_PORT> --clear` for apps/mobile with EXPO_PUBLIC_API_BASE=<BASE> in its own process
group and stops it at the end (APP_PORT default 8121; APP_URL=http://localhost:<port> drives a server that is already
running instead; APP_DIR points it at a copy of the app). As the other e2e scripts: the live demo's ports (3000, 3100,
3101 and the Expo default 8081) are refused for BASE and APP_PORT, BASE must be an explicit port on 127.0.0.1, localhost,
*.localhost or *.test, and E2E_OUT (screenshots, report.json, the Expo log and the Chrome profile; default
.local/e2e/app/) and E2E_CDP_PORT (default 9580) keep parallel runs apart.

Sections (E2E_APP_ONLY; default member, auth, clients for the client app and member, auth, coach, admin with APP_STAFF=1,
in this order):
  member  sign in as Priya through the member sign-in; Home (greeting, first name, package line, Today's tasks, the
          coach's note, the Next rows), the nine tabs of the pill by their accessibility labels, each tab's title, then
          every member screen in src/app (redirects of old addresses included: each must land on its new place; the
          ones with a record id open the member's first record; a record the seed does not give Priya is opened as
          Ananya); each screen raises no console error, is not the not-found screen, shows no error box and no "demo" /
          "sample" label (the simulated-service notes are fine)
  auth    sign-out (Profile › Settings), the password reset flow (on a member nobody else uses), the registration form's
          validation, the phone-code sign-in with the preview code (through the sign-in's Phone segment and through
          /(auth)/phone), a new member's registration walk (register, confirm the email with the demo code, consent,
          the three slides, the nine quiz steps, sending, Home with honest empty states), the stand-in Google / Apple
          sign-in and, in the staff build only, the
          sign-in chooser, the coach and administrator sign-ins including WRONG_WORKSPACE, MFA_REQUIRED and the preview
          authenticator code; a screen or control the tree does not have yet is reported as "skip … not built yet", never
          as a failure
  clients the client app only (skipped with APP_STAFF=1): no chooser and no staff door or copy on the client screens;
          the chooser, the coach and administrator sign-ins, the (coach) and (admin) tabs and screens under coach/ and
          admin/ lead to the client sign-in (signed out) or back to Home (Priya) without drawing a staff screen or asking
          a coach or admin endpoint, opened in the app or as a cold start (a deep link); a remembered workspace
          (bp.workspace) is ignored at a cold start and never written; a coach and the
          owner are refused on the client sign-in, and a coach through the stand-in Google sign-in, with "This app is for
          Bioptime clients. …" (the addresses as plain text)
  coach   (staff build) sign in as Asha: the coach workspace shell loads with its title and tabs; tools/e2e_app_coach.py, when present,
          adds its own checks (run(app, ctx))
  admin   (staff build) sign in as the owner with the preview code: the administrative portal shell loads; tools/e2e_app_admin.py likewise
  preview the open preview (a scratch API started with OPEN_PREVIEW=1, so GET /public/config says openPreview; the default
          sections against such a server are preview, refused and relay, and the sign-in sections are skipped). The
          client app never opens a session by itself (BUILD_PLAN §7.4, owner decision D4): a cold start shows the splash,
          then the sign-in form with the one-tap "Continue without signing in" card, and no POST /auth/open-preview is
          sent until the card is tapped; the tap sends exactly one and opens Home as Priya; Sign out (Profile ›
          Settings) returns to the form with the card and sends nothing; the phone-code, registration and password-reset
          screens draw their forms; a session ended elsewhere (revoked from Python) leads to the sign-in with "Session
          ended" and the card, again without a request; the Server screen still changes the address
  refused the open preview when the server will not open a session (default against such a server, last): Python
          uses up the server's limit on POST /auth/open-preview (120 per 10 minutes per address; the browser shares the
          address); then a tap on the card sends one request and shows the reason under its pill while the form stays
          usable (Email, Password, Sign in), and cold starts at /, /sign-in, /register, /forgot and /phone draw their
          forms without sending anything. Afterwards the limit stays reached for 10 minutes: restart the scratch API
          before another run against it
  relay   the link relay (runs before the other sections, with its own Expo server and a Chrome that cannot reach the
          internet): Expo is started with EXPO_PUBLIC_API_BASE at a local port nothing answers on,
          EXPO_PUBLIC_LINK_RELAY_TOPIC (a random test topic) and EXPO_PUBLIC_LINK_RELAY_BASE pointing at a stand-in relay on
          this machine (app_harness.RelayStandIn, E2E_RELAY_PORT or a free port); the page's requests to
          https://<name>.trycloudflare.com are answered inside Chrome from BASE (app_harness route_quick_tunnels), so
          nothing is posted to or read from ntfy.sh. The app finds the newest valid link among invalid ones, uses it, moves
          to a newer one when the first starts answering Cloudflare's 530 (never carrying its session token there), keeps
          an address typed under Server, and finds the link again after Reset. The client app lands on its sign-in either
          way; against a server with OPEN_PREVIEW the card's tap opens the session through the link. Not with APP_URL
          (the build variables must be set by this script)

Accounts are the seeded demo ones (share/DEMO_LINK.md); no code or secret is written here: the authenticator and phone
codes come from the demo server's own preview helpers. Twelve POST /auth/login per full staff run (about nine for the
client app) (Priya and Ananya through
the screen and once each from Python for record ids, the reset-flow verification, the two WRONG_WORKSPACE refusals, the
MFA_REQUIRED stop and the code sign-in, the phone and stand-in sign-ins, the coach), all counted by the server's limit
of about 20 per 10 minutes: two full runs inside ten minutes reach it, so run sections one at a time when iterating, or
restart the scratch API. Exit status 1 if anything fails; the JSON summary is the last line."""
import importlib
import json
import os
import re
import sys
import time
import traceback

sys.dont_write_bytecode = True   # no tools/__pycache__ from importing the harness (python -I does not prevent it)
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_harness as ah  # noqa: E402
from app_harness import check, skip  # noqa: E402

BASE = os.environ.get('BASE', '').rstrip('/')
APP_PORT = os.environ.get('APP_PORT') or '8121'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9580'
STAFF = ah.staff_app()                               # APP_STAFF=1: the staff build; otherwise the client app
SECTION_NAMES = ('member', 'auth', 'clients', 'coach', 'admin', 'preview', 'refused', 'relay')
DEFAULT_SECTIONS = ('member', 'auth', 'coach', 'admin') if STAFF else ('member', 'auth', 'clients')
PREVIEW_SECTIONS = ('preview', 'refused', 'relay')    # the default against a server in the open preview (relay runs first)
PREVIEW = False                                      # main(): GET /public/config says openPreview (OPEN_PREVIEW=1)

MEMBER = ('priya.nair@demo.bioptime.test', 'Demo-Member-2026!')
MEMBER_PHONE = '+919700000019'                       # Priya's confirmed number (apps/api/src/seed/seed.ts)
SECOND_MEMBER = ('ananya.rao@demo.bioptime.test', 'Demo-Member-2026!')   # the seed gives her a released report, check-ins and workouts, which Priya has none of
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
RESET_MEMBER = 'farah.ali@demo.bioptime.test'        # the reset flow gives this member (no coach, used by no other check) a new password
MEMBER_TABS = ['Home', 'Train', 'Bio', 'Life', 'Fuel', 'Coach', 'Tests', 'Store', 'Profile']   # the pill, by accessibility label
GREETING = r'^Good (morning|afternoon|evening|night)$'   # Home's eyebrow (upper-cased by CSS; regexes are case-insensitive)
HOME_PRIYA = r'^Priya$'                              # the first name under it
COACH_TABS = ['Today', 'Clients', 'Calendar', 'Messages', 'More']
ADMIN_TABS = ['Overview', 'Members', 'Operations', 'Messages', 'More']

# every member screen without a record id: route, the text that proves it drew (a regex over the body's lines)
MEMBER_SCREENS = [
    ('/announcements', r'^Announcements$'), ('/bespoke', r'^Bespoke$'), ('/billing', r'^Billing$'),
    ('/book-appointment', r'^Book a consultation$'), ('/book-test', r'^Book a blood test$'), ('/coach-ai', r'^Coach AI'),
    ('/goals', r'^Goals$'), ('/habits', r'^Today.s habits$|^Habits$'), ('/help', r'^Help and support$'),
    ('/lab-follow-ups', r'^Next steps'), ('/learn', r'^Learn$'), ('/meal-log', r'^Log a meal$'), ('/messages', r'^Asha Menon$'),
    ('/milestones', r'^Achievements$'), ('/notifications', r'^Notifications$'), ('/nutrition', r'^Nutrition$'),
    ('/packages', r'^Programmes$'), ('/packages?package=core', r'Checkout here is simulated; no money moves\.'), ('/photos', r'^Progress photos$'),
    ('/progress-entry', r'^Log a value$'), ('/progress', r'^Bio$'), ('/recommendations', r'^Recommendations$'), ('/refer', r'^Refer a friend$'),
    ('/sessions', r'^Live classes$'), ('/workout-history', r'^History$'), ('/workouts', r'^Train$'),
    ('/settings/profile', r'^Profile$'), ('/settings/security', r'^Password and devices$'), ('/settings/consents', r'^Privacy and sharing$'),
    ('/settings/data', r'^Your data$'), ('/settings/server', r'^Server$'), ('/settings/credits', r'^Photo credits$'),
    ('/onboarding', GREETING), ('/(auth)/verify', r'^Confirm your email$'), ('/(tabs)/plan', r'^Train$'), ('/(tabs)/me', r'^Priya Nair$'),
]
# the address each old route (and a link with a parameter) must end at (BUILD_PLAN §7.1; a group segment is dropped)
REDIRECT_LANDING = {'/lab-follow-ups': '/life', '/learn': '/store', '/messages': '/coach', '/milestones': '/profile', '/nutrition': '/fuel',
                    '/packages': '/store', '/progress': '/bio', '/sessions': '/train', '/workout-history': '/train', '/workouts': '/train',
                    '/onboarding': '/', '/(tabs)/plan': '/train', '/(tabs)/me': '/profile'}
# screens that open one of the member's records: route, the list endpoint and the key its rows sit under, which field
# of the first row the screen is expected to show
RECORD_SCREENS = [
    ('/report/{id}', '/me/reports', ('items',), ('test_name', 'testName', 'reference', 'title')),
    ('/booking/{id}', '/me/bloodwork/bookings', ('items',), ('reference',)),
    ('/session/{id}', '/me/sessions', ('items', 'history'), ('title',)),
    ('/checkin/{id}', '/me/checkins', ('items',), ('title',)),
    ('/support/{id}', '/support-requests', ('items',), ('subject', 'reference')),
    ('/workout/{id}', '/me/workouts', ('items',), ('title',)),
    ('/move-appointment/{id}', '/me/appointments?range=upcoming', ('items',), None),
    ('/exercise/{id}', '/me/exercises', ('items',), ('name',)),
]
SHOTS = {'/(tabs)/train': 'member-train', '/(tabs)/bio': 'member-bio', '/(tabs)/life': 'member-life', '/(tabs)/fuel': 'member-fuel',
         '/(tabs)/coach': 'member-coach', '/(tabs)/tests': 'member-tests', '/(tabs)/store': 'member-store', '/(tabs)/profile': 'member-profile-tab',
         '/settings/profile': 'member-profile', '/packages?package=core': 'member-checkout', '/report/{id}': 'member-report', '/checkin/{id}': 'member-checkin',
         '/workout/{id}': 'member-workout', '/exercise/{id}': 'member-exercise'}
# the finish step of a Google / Apple sign-in whose identity has no account yet, and what the same screen says when
# nothing is pending (the not-found screen also offers "Start again", so neither word of that title is used)
SOCIAL_FINISH_TEXT = r'The sign-in that was being completed is no longer here|^Finish creating your account$'


def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def open_record(app, pattern, row, fields):
    """Open the screen for one record (pattern with {id}) and check it drew: the first of `fields` the row carries is
    the text expected on the screen."""
    route = pattern.replace('{id}', str(row['id']))
    expect = None
    for f in fields or ():
        if isinstance(row.get(f), str) and row[f].strip():
            expect = re.escape(row[f].strip()[:40])
            break
    if pattern.startswith('/move-appointment'):
        expect = r'^Move a consultation$|^Move your consultation$'
    app.open_route(route, None, 45)
    if expect:
        app.wait_visible(expect, 45)
    screen_ok(app, 'screen ' + route, expect)
    no_labels(app, 'screen ' + route)
    if pattern in SHOTS:
        app.screenshot(SHOTS[pattern])


def first_record(session, path, keys):
    try:
        j = session.get(path)
    except RuntimeError as e:
        return None, str(e)
    rows = j if isinstance(j, list) else next((j[k] for k in keys if isinstance(j, dict) and isinstance(j.get(k), list) and j[k]), [])
    for row in rows:
        if isinstance(row, dict) and row.get('id'):
            return row, ''
    return None, 'no record in %s' % path


def find_lesson_id(course):
    """The first lesson id anywhere in a course payload (its modules carry the lessons)."""
    if isinstance(course, dict):
        if 'lessons' in course and isinstance(course['lessons'], list):
            for l in course['lessons']:
                if isinstance(l, dict) and l.get('id'):
                    return str(l['id'])
        for v in course.values():
            found = find_lesson_id(v)
            if found:
                return found
    elif isinstance(course, list):
        for v in course:
            found = find_lesson_id(v)
            if found:
                return found
    return None


# ---------------------------------------------------------------- member
# the pill's tabs after Home: label, route, address, the title (or words) that prove the tab drew
TAB_WALK = [('Train', '/(tabs)/train', '/train', r'^Train$'), ('Bio', '/(tabs)/bio', '/bio', r'^Bio$'), ('Life', '/(tabs)/life', '/life', r'^Longevity$'),
            ('Fuel', '/(tabs)/fuel', '/fuel', r'^Nutrition$'), ('Coach', '/(tabs)/coach', '/coach', r'^Asha Menon$|^Your coach$|^Being matched$|^Not assigned yet$'),
            ('Tests', '/(tabs)/tests', '/tests', r'blood tests? left|^No blood tests included yet$'), ('Store', '/(tabs)/store', '/store', r'^Programmes$'),
            ('Profile', '/(tabs)/profile', '/profile', r'^Priya Nair$')]
ERROR_BOX = r'^Something went wrong$|^No connection$|^Signed out$'


def on_home(app, first='Priya', seconds=30):
    """Home as the member: the greeting eyebrow and the first name under it, on the screen (not behind an overlay)."""
    return app.wait_js("location.pathname === '/'", seconds) and app.wait_visible(GREETING, seconds) and app.wait_visible('^%s$' % re.escape(first), seconds)


def screen_ok(app, name, expect=None, path=None):
    """One check: the screen a person sees (visible_text: not the screen behind an overlay) shows `expect`, is at `path`
    when given (a redirect landed where it should), is not the not-found screen, shows no error box and raised no
    console error since it was opened."""
    errs = app.errors_since()
    seen = app.visible_text()
    missing = bool(re.search(ah.NO_SUCH_SCREEN, seen, re.I | re.M))
    box = bool(re.search(ERROR_BOX, seen, re.I | re.M))
    want = expect is None or bool(re.search(expect, seen, re.I | re.M))
    at = app.path()
    where = path is None or at.rstrip('/') == path.rstrip('/') or (path == '/' and at == '/')
    detail = '; '.join(errs[:3] + (['not-found screen'] if missing else []) + (['error box shown'] if box else []) + (['expected %r, saw %r' % (expect, seen[:100])] if not want else []) + (['at %s, not %s' % (at, path)] if not where else []))
    return check(name, not errs and not missing and not box and want and where, detail)


def home_seen(app, patterns, pages=10):
    """Which of `patterns` (regexes over the visible lines) Home shows as it is scrolled page by page from the top; a
    card is counted once it is drawn (visible_text skips anything at opacity 0, as a card is before its entrance)."""
    seen = {p: False for p in patterns}
    pos = app.scroll('top')
    # Home mounts what is below the brief only after the Wellness sweep has landed and the page is idle (motion v2 M63,
    # src/fx/nav/Deferred), so for its first seconds the page can end at the brief: an end of the page reached within
    # 6 s of the start is looked at again after a moment instead of ending the walk
    t0 = time.monotonic()
    for _ in range(pages + 8):
        app.b.pump(0.8)
        for p in patterns:
            seen[p] = seen[p] or app.has_visible(p)
        if all(seen.values()):
            break
        if pos.get('atEnd', True):
            if time.monotonic() - t0 > 6:
                break
            pos = app.scroll(0.0)
            continue
        pos = app.scroll(0.6)
    app.scroll('top')
    app.b.pump(0.3)
    return seen


def member_section(app):
    print('member: Priya through the member sign-in, the nine tabs, every member screen')
    if app.workspace:
        app.sign_out()
    r = app.sign_in('member', *MEMBER)
    check('Priya signs in through the member sign-in and lands on Home (greeting and first name)', r['ok'] and on_home(app), r['detail'])
    if not r['ok']:
        return
    screen_ok(app, 'member home', GREETING, '/')
    # Home's cards below the fold enter when they are scrolled to (motion v2, M01: a reveal starts when it crosses into
    # view, so until then it is drawn at opacity 0): Home is read page by page from the top, as a person scrolls it
    seen = home_seen(app, [r"^Today's tasks$", r'^\d+ tasks?$|^Nothing due$', r'^From your coach$', r'^Asha Menon\b', r'^Next$', r'^Appointment$', r'^Blood test$'])
    check("home shows Today's tasks with its count", seen[r"^Today's tasks$"] and seen[r'^\d+ tasks?$|^Nothing due$'], str(seen))
    check('home shows the coach: the note from Asha under "From your coach"', seen[r'^From your coach$'] and seen[r'^Asha Menon\b'])
    check('home shows the Next rows: the appointment and the blood test', seen[r'^Next$'] and seen[r'^Appointment$'] and seen[r'^Blood test$'])
    check('home shows the package and its end date under the name', app.has_visible(r'^(Core|Starter|Advanced)\b.*ends '))
    no_labels(app, 'member home')
    tabs = app.member_tabs()
    check('the pill lists the nine tabs by their accessibility labels, in order, Home selected', [t for t, _ in tabs] == MEMBER_TABS and [sel for _, sel in tabs] == [True] + [False] * 8, str(tabs))
    app.screenshot('member-home')
    for label, route, path, expect in TAB_WALK:
        app.err_mark = len(app.b.errors)
        pressed = app.click_tab(label)
        arrived = app.wait_js("location.pathname === %s" % json.dumps(path), 20) and app.wait_visible(expect, 30)
        selected = [t for t, sel in app.member_tabs() if sel]
        check('%s tab: a tap on the pill opens it and only it is selected' % label, pressed and arrived and selected == [label], 'at %s, selected %s' % (app.path(), selected))
        screen_ok(app, label + ' tab', expect, path)
        no_labels(app, label + ' tab')
        app.screenshot(SHOTS[route])
        if label == 'Tests':
            check('Tests keeps the small simulated-laboratory note', app.has_visible(r'^Simulated laboratory$'), app.visible_text()[:80])
    app.open_route('/(tabs)/profile?tab=settings', None, 30)
    check('Profile offers Sign out under Settings', app.wait_clickable('Sign out', 20))
    for route, expect in MEMBER_SCREENS:
        app.open_route(route, None, 45)
        app.wait_visible(expect, 45)
        landing = None if '?' in route else REDIRECT_LANDING.get(route)
        screen_ok(app, 'screen ' + route + (' (lands on %s)' % landing if landing else ''), expect, landing)
        no_labels(app, 'screen ' + route)
        if route in SHOTS:
            app.screenshot(SHOTS[route])
        if route == '/packages?package=core':
            check('the checkout keeps the small simulated-payment note', app.has_visible(r'simulated'), app.visible_text()[:80])
    # screens that open one of Priya's records: the ids come from the API, with one sign-in from here
    session = ah.ApiSession(BASE).login(*MEMBER)
    missing = []   # record screens Priya has nothing to open: opened as Ananya below
    try:
        for pattern, path, keys, fields in RECORD_SCREENS:
            row, why = first_record(session, path, keys)
            if not row:
                missing.append((pattern, path, keys, fields, why))
                continue
            open_record(app, pattern, row, fields)
        course, why = first_record(session, '/me/courses', ('enrolled', 'available'))
        lesson = find_lesson_id(session.get('/me/courses/%s' % course['id'])) if course else None
        if lesson:
            app.open_route('/learn/%s' % lesson, None, 45)
            app.wait_visible(r'^Lesson( \d+ of \d+)?$|^Reading a lesson$|^Written$', 45)
            screen_ok(app, 'screen /learn/%s' % lesson, r'^Lesson( \d+ of \d+)?$|^Written$|^Video$|^Audio$')
            no_labels(app, 'screen /learn/%s' % lesson)
        else:
            skip('screen /learn/[lessonId]', why or 'no lesson in the first course')
    finally:
        session.logout()
    app.open_route('/(tabs)', None, 30)
    check('back on Home after the walk', on_home(app))
    if not missing:
        return
    # a record the seed does not give Priya: opened through Ananya, who has it (two more sign-ins)
    app.sign_out()
    r = app.sign_in('member', *SECOND_MEMBER)
    check('Ananya signs in to open the screens Priya has no record for (%s)' % ', '.join(m[0] for m in missing), r['ok'], r['detail'])
    if not r['ok']:
        for pattern, path, keys, fields, why in missing:
            skip('screen ' + pattern, why + ' for Priya, and Ananya could not sign in')
        return
    session = ah.ApiSession(BASE).login(*SECOND_MEMBER)
    try:
        for pattern, path, keys, fields, why in missing:
            row, why2 = first_record(session, path, keys)
            if not row:
                skip('screen ' + pattern, '%s for Priya; %s for Ananya' % (why, why2))
                continue
            open_record(app, pattern, row, fields)
    finally:
        session.logout()


# ---------------------------------------------------------------- auth
def auth_section(app):
    print('auth: sign-out, reset, registration validation, phone code, a new member, ' + ('the chooser and the three sign-ins, ' if STAFF else '') + 'the stand-in social sign-in')
    if app.workspace == 'member':
        ok, d = app.sign_out()
        check('member signs out from Profile › Settings and lands on the sign-in screen', ok and d.startswith('through'), d)
    elif app.workspace:
        app.sign_out()
    # password reset, on a member no other check signs in as
    if app.route_exists('/(auth)/forgot', r'^Reset your password$'):
        app.type_into('Email on your account', RESET_MEMBER)
        app.click_text('Send the link')
        asked = app.wait_text(r'^Code from the email$', 20)
        check('forgot: the reset step appears after asking for the link', asked, app.text()[:120])
        if asked:
            token = app.input_value('Code from the email') or ''
            check('forgot: the demo server filled the reset code in (no email leaves it)', len(token) >= 10 and app.has_text('the reset code is filled in below'), '%d characters' % len(token))
            new_password = 'E2E-reset-%d!' % int(time.time())
            app.type_into('New password', new_password)
            app.click_text('Save the new password')
            saved = app.wait_text(r'Your password is saved', 20)
            check('forgot: the new password is saved', saved, app.text()[:120])
            if saved:
                status, j, _ = ah.api(BASE, 'POST', '/auth/login', {'email': RESET_MEMBER, 'password': new_password, 'workspace': 'member'})
                check('forgot: the new password signs that member in (API)', status == 200, 'status %s' % status)
                if status == 200:
                    ah.api(BASE, 'POST', '/auth/logout', {}, token=j['session']['token'])
            app.click_text('Sign in')
            # since motion v2 (C05) "Sign in" first plays the screen's flow exit and navigates at its end (about 300 ms):
            # the address is waited for (the old check read it at once; the button's own words matched "Sign in")
            check('forgot: Sign in leads back to the member sign-in', app.wait_js("location.pathname === '/sign-in'", 10) and app.wait_text(r'^Sign in$', 10), app.path())
    else:
        skip('forgot flow', 'not built yet: /(auth)/forgot')
    # registration: the form's own validation, nothing is submitted with valid data
    if app.route_exists('/(auth)/register', r'^Create your account$'):
        app.click_text('Create account')
        shown = app.wait_text(r'^Please tell us your name\.$', 10)
        check('register: an empty form names every missing field', shown and all(app.has_text(t) for t in (r'^Enter a valid email address\.$', r'^At least 10 characters\.$', r'^Please accept the terms and the privacy policy\.$')), app.text()[:200])
        app.type_into('Your name', 'E2E Check')
        app.type_into('Email', 'not-an-email')
        app.type_into('Password', 'short')
        app.click_text('Create account')
        app.b.pump(0.5)
        check('register: a bad email and a short password are refused before anything is sent', app.has_text(r'^Enter a valid email address\.$') and app.has_text(r'^At least 10 characters\.$') and not app.has_text(r'^Please tell us your name\.$'), app.text()[:200])
        ticked = app.set_checkbox('I have read and accept', True)
        app.click_text('Create account')
        app.b.pump(0.5)
        check('register: once the terms are ticked, only the email and password are still refused', ticked and not app.has_text(r'^Please accept the terms') and app.has_text(r'^Enter a valid email address\.$'), app.text()[:200])
        app.screenshot('auth-register')
    else:
        skip('register validation', 'not built yet: /(auth)/register')
    # the phone code (switch phone_sign_in): Priya's confirmed number and the preview code of the demo server, through
    # the sign-in's Phone segment and through the screen of its own (/(auth)/phone, for links)
    for via in ('segment', 'screen'):
        phone_sign_in(app, via)
    # a new member: registration, the email code, consent, the slides, the nine quiz steps, Home with honest empty states
    if not STAFF:
        new_member_walk(app)
    if STAFF:
        staff_doors(app)
    # the screen that finishes a new account after a stand-in sign-in, first with nothing pending (its own words, not
    # "Start again", which the not-found screen offers too)
    social_checks(app)


def phone_sign_in(app, via):
    """Priya signs in with a phone code, `via` the sign-in's Phone segment or /(auth)/phone; then signs out again."""
    name = 'phone (%s)' % ('the sign-in\'s Phone segment' if via == 'segment' else '/(auth)/phone')
    if via == 'segment':
        app.open_route('/(auth)/sign-in', r'^Sign in$', 30)
        if not app.wait_clickable('Phone', 10):
            skip(name, 'no Phone segment on the sign-in: phone_sign_in is off on this server')
            return
        app.click_text('Phone')
        if not app.wait_text(r'^Mobile number$', 10):
            check(name + ': the segment shows the number field', False, app.visible_text()[:160])
            return
    else:
        if not app.route_exists('/(auth)/phone', r'^Sign in with a code$'):
            check(name + ': the screen draws', False, app.path())
            return
        if app.wait_text(r'^Mobile number$|^Not available here$', 15) and app.has_text(r'^Not available here$'):
            skip(name, 'phone_sign_in is off on this server')
            return
    app.type_into('Mobile number', MEMBER_PHONE)
    app.click_text('Send me a code')
    step = app.wait_text(r'^Six-digit code$', 20)
    check(name + ': the code step appears with the server\'s delivery note (no text message is sent from this copy)', step and app.has_visible(r'Text messages are not sent from this copy of Bioptime'), app.visible_text()[:200])
    if not step:
        return
    filled = app.click_text('Fill in the preview code', seconds=5) and app.wait_js("/^\\d{6}$/.test(((%s)('Six-digit code') || {}).value || '')" % ah.FIND_INPUT, 10)
    check(name + ': the demo server\'s preview code fills the field', filled, str(app.input_value('Six-digit code')))
    app.click_text('Sign in')
    home = on_home(app)
    check(name + ': the code signs Priya in (Home)', home, app.visible_text()[:120])
    if home:
        app.workspace = 'member'
        app.screenshot('auth-phone-home-' + via)
        ok, d = app.sign_out()
        check(name + ': signed out again', ok, d)


def new_member_walk(app):
    """BUILD_PLAN §8.3: register → confirm the email (demo code) → consent → the three slides → the nine quiz steps →
    Home with honest empty states (no number made up: the score is a dash with its sentence, no steps target)."""
    email = 'e2e.walk.%d@demo.bioptime.test' % int(time.time())
    ok, d = app.register_member('Meera Walk', email, 'E2E-walk-through-2026!')
    check('new member: registration and the email code (filled in by the demo server)', ok, d)
    if not ok:
        return
    ok, steps, d = app.onboard()
    check('new member: consent, the three slides, the nine quiz steps and "Send my answers" lead Home', ok and on_home(app, 'Meera'), 'steps %s; %s' % (steps, d))
    if ok:
        # no score is calculated (the card says so); "Set a steps goal" once the goals have answered (none yet)
        app.wait_visible(r'^Set a steps goal$', 15)
        seen = app.visible_text()
        honest = bool(re.search(r'^Bioptime does not calculate a Wellness Score yet\.$', seen, re.M)) and bool(re.search(r'^Set a steps goal$', seen, re.M)) and not re.search(r'kcal', seen, re.I)
        check('new member: Home invents no number (score "—" with its sentence, no steps target, no kcal)', honest, seen[:300])
        no_labels(app, 'new member home')
        app.screenshot('auth-new-member-home')
        ok, d = app.sign_out()
        check('new member: signs out from Profile › Settings', ok, d)


def staff_doors(app):
    """The staff build: the chooser, the coach and administrator sign-ins, WRONG_WORKSPACE both ways, MFA_REQUIRED."""
    # the chooser and the three doors
    if app.route_exists('/(auth)/choose', r'^Three doors, one Bioptime\.$'):
        check('chooser offers the three sign-ins', all(app.find_clickable(t) for t in ('Sign in as a member', 'Sign in as a coach', 'Sign in as an administrator')))
        app.screenshot('auth-chooser')
        app.click_text('Sign in as a coach')
        check('chooser: the coach door opens the coach sign-in', app.wait_text(r'^Coach workspace$', 15) and app.path() == '/coach-sign-in', app.path())
        app.click_text('Not you? Choose another sign-in')
        check('coach sign-in links back to the chooser', app.wait_text(r'^Three doors, one Bioptime\.$', 15), app.path())
        app.click_text('Sign in as an administrator')
        check('chooser: the administrator door opens the administrative sign-in', app.wait_text(r'^Administrative portal$', 15) and app.path() == '/admin-sign-in', app.path())
        app.open_route('/(auth)/choose', r'^Three doors', 15)
        app.click_text('Sign in as a member')
        check('chooser: the member door opens the member sign-in', app.wait_text(r'^Sign in$', 15) and app.path() == '/sign-in', app.path())
    else:
        skip('sign-in chooser', 'not built yet: /(auth)/choose')
    # WRONG_WORKSPACE both ways
    r = app.sign_in('coach', *MEMBER)
    if r.get('missing'):
        skip('coach sign-in refuses a member account', 'not built yet: /(auth)/coach-sign-in')
    else:
        check('coach sign-in refuses a member account (WRONG_WORKSPACE) and says where to go', not r['ok'] and 'does not sign in here' in r['detail'] and app.has_text('member sign-in'), r['detail'])
        app.screenshot('auth-wrong-workspace')
    r = app.sign_in('member', *COACH)
    check('member sign-in refuses a coach account (WRONG_WORKSPACE) and names the coach workspace', not r['ok'] and 'does not sign in here' in r['detail'] and app.has_text('coach workspace'), r['detail'])
    # MFA_REQUIRED, then the preview code
    r = app.sign_in('admin', *OWNER, mfa=None)
    if r.get('missing'):
        skip('administrator sign-in asks for the authenticator code', 'not built yet: /(auth)/admin-sign-in')
    else:
        check('administrator sign-in asks for the authenticator code (MFA_REQUIRED) after the password', r['mfa_asked'], r['detail'])
        if r['mfa_asked']:
            app.screenshot('auth-admin-mfa')
            filled = app.click_text('Fill in the preview code', seconds=5) and app.wait_js("/^\\d{6}$/.test(((%s)('Authenticator code') || {}).value || '')" % ah.FIND_INPUT, 10)
            check('administrator sign-in: "Fill in the preview code" fetches the code from the demo server', filled, str(app.input_value('Authenticator code')))
            if not filled:
                app.type_into('Authenticator code', ah.demo_totp(BASE, OWNER[0]))
            app.click_text('Verify and sign in')
            home = app.wait_text(ah.HOME_TEXT['admin'], 45)
            check('administrator sign-in: the code signs the owner in to the administrative portal', home, app.text()[:120])
            if home:
                app.workspace = 'admin'
                ok, d = app.sign_out()
                check('administrator signs out from More', ok, d)


def social_checks(app):
    """The finish screen with nothing pending, then the stand-in Google / Apple sign-in of the demo server."""
    finish_built = app.route_exists('/(auth)/social-finish', SOCIAL_FINISH_TEXT)
    if finish_built:
        check('social finish without a pending sign-in says to start again, with a way back', app.has_text(r'^Start again$') and app.find_clickable('Back to sign-in'), app.text()[:120])
    else:
        skip('social finish screen', 'not built yet: /(auth)/social-finish')
    # the stand-in Google / Apple sign-in of the demo server
    if app.route_exists('/(auth)/sign-in', r'^Sign in$') and app.wait_clickable('Continue with Google', 10):
        app.click_text('Continue with Google')
        sheet = app.wait_text(r'^Preview sign-in$', 10)
        # the sheet's title comes with its panel; the body mounts a frame or two later (motion v2, M42/M43)
        check('social: Continue with Google opens the preview sheet that says no Google account is contacted', sheet and app.wait_text(r'No Google account is contacted', 5), app.text()[:160])
        if sheet:
            app.type_into('Email to sign in with', MEMBER[0])
            app.click_text('Continue')
            home = on_home(app)
            check('social: a prepared member (Priya) signs in through the stand-in and Home is hers', home, app.visible_text()[:120])
            if home or app.wait_js("location.pathname === '/'", 5):
                app.workspace = 'member'   # signed in either way: sign out, so the next checks start signed out
                ok, d = app.sign_out()
                check('social: signed out again', ok, d)
        app.open_route('/(auth)/sign-in', r'^Sign in$', 15)
        if not finish_built:
            skip('social: a new email leads to the finish step', 'not built yet: /(auth)/social-finish')
        elif app.click_text('Continue with Apple', seconds=5) and app.wait_text(r'^Preview sign-in$', 10):
            email = 'e2e.social.%d@demo.bioptime.test' % int(time.time())
            app.type_into('Email to sign in with', email)
            app.type_into('Name (for a new account)', 'Esha Verification')
            app.click_text('Continue')
            finish = app.wait_text(r'^Finish creating your account$', 30)
            if not finish and app.has_text(ah.NO_SUCH_SCREEN):
                skip('social: a new email leads to the finish step', 'not built yet: the stand-in was sent to a screen this build does not have (%s)' % app.path())
            else:
                check('social: a new email leads to the finish step (ACCOUNT_SETUP_NEEDED) on /social-finish', finish and app.path() == '/social-finish', app.path() + ' ' + app.text()[:100])
            if finish:
                check('social finish: the name from the stand-in is filled in', app.input_value('Your name') == 'Esha Verification', str(app.input_value('Your name')))
                app.click_text('Create account')
                check('social finish: the policies must be accepted first', app.wait_text(r'^Please accept the terms and the privacy policy\.$', 10))
                app.set_checkbox('I have read and accept', True)
                app.click_text('Create account')
                home = app.wait_text(r'^Your data, your control$|' + GREETING, 30)
                check('social finish: the account is created and signed in (onboarding starts with the consent screen)', home, app.visible_text()[:120])
                if home:
                    app.workspace = 'member'
                    app.screenshot('auth-social-new-member')
                    ok, d = app.sign_out()
                    check('social finish: signed out again', ok, d)
        else:
            skip('social: Continue with Apple', 'no Apple button on the member sign-in')
    else:
        skip('stand-in social sign-in', 'not built yet: no "Continue with Google" button on /(auth)/sign-in')


# ---------------------------------------------------------------- the client app
CLIENT_SIGN_IN = '/sign-in'          # the address of /(auth)/sign-in (the group is dropped)
HOME = '/'                           # the address of /(tabs)
# words the client screens must not say: another sign-in, the chooser, the coach workspace or the administrative portal
STAFF_COPY = (r'Three doors|Choose another sign-in|coach workspace|administrative portal|Coaches and the Bioptime team have their own|'
              r'Sign in as a coach|Sign in as an administrator|coach or team account')
STAFF_SIGN_IN_ROUTES = ['/(auth)/choose', '/(auth)/coach-sign-in', '/(auth)/admin-sign-in']
STAFF_WORKSPACE_ROUTES = ['/(coach)', '/(coach)/clients', '/(coach)/more', '/(admin)', '/(admin)/members', '/(admin)/more',
                          '/coach/clients', '/coach/clients/x', '/coach/bloodwork', '/admin/users', '/admin/audit', '/admin/coaches/x',
                          '/admin/notifications']


def no_staff_copy(app, name):
    hits = app.js("(document.body.innerText.match(new RegExp(%s, 'gi')) || [])" % json.dumps(STAFF_COPY)) or []
    check(name + ': names no other sign-in (no chooser, coach or administrator door)', not hits and not app.find_clickable('Not you? Choose another sign-in'), str(hits))


def visit_staff_route(app, route, landing, landing_rx, who):
    """Open a staff route in the client app: it must end at `landing` (an address) showing `landing_rx`, without any
    staff screen text appearing on the way (watched on every DOM change) and without a coach or admin request."""
    mark = len(app.requests)
    app.watch_text(ah.STAFF_SCREEN_TEXT)
    app.open_route(route, None, 30)
    landed = app.wait_js("location.pathname === %s" % json.dumps(landing), 20) and app.wait_text(landing_rx, 20)
    app.b.pump(1.0)   # a moment for anything that would still draw or ask the server
    seen = app.seen_text()
    calls = [u for u in app.requests[mark:] if re.search(ah.STAFF_API, u)]
    missing = app.has_text(ah.NO_SUCH_SCREEN)
    errs = app.errors_since()
    check('%s: %s leads to %s without drawing a staff screen' % (who, route, landing), landed and not seen and not calls and not missing and not errs,
          'at %s; staff text seen %s; staff requests %s%s%s' % (app.path(), seen, calls, '; not-found screen' if missing else '', ('; ' + '; '.join(errs[:2])) if errs else ''))
    return landed


def clients_section(app):
    print('clients: one sign-in; no chooser, no staff door, no staff screen; coaches and the team are refused')
    if STAFF:
        skip('clients section', 'the staff build (APP_STAFF=1) keeps the three doors; run without APP_STAFF for the client app')
        return
    if app.workspace:
        app.sign_out()
    # the client sign-in and the other signed-out client screens: no chooser link, no staff door, no staff copy
    app.open_route('/(auth)/sign-in', r'^Sign in$', 30)
    no_staff_copy(app, 'client sign-in')
    check('client sign-in keeps the Server link for testers', app.find_clickable('Change the server address (testers)'))
    app.screenshot('clients-sign-in')
    for route, expect in (('/(auth)/phone', r'^Sign in with a code$'), ('/(auth)/register', r'^Create your account$'), ('/(auth)/forgot', r'^Reset your password$'), ('/settings/server', r'^Server$')):
        if app.route_exists(route, expect):
            if route.endswith('/phone'):
                app.wait_text(r'^Mobile number$|^Not available here$', 5)
            app.page_ok('signed out: ' + route, expect)
            no_staff_copy(app, route)
        else:
            check('signed out: %s draws' % route, False, app.path() + ' ' + app.text()[:100])
    # the staff sign-ins and the staff workspaces, signed out: the client sign-in, nothing staff drawn or asked for
    app.open_route('/(auth)/sign-in', r'^Sign in$', 30)
    for route in STAFF_SIGN_IN_ROUTES + STAFF_WORKSPACE_ROUTES:
        visit_staff_route(app, route, CLIENT_SIGN_IN, r'^Sign in$', 'signed out')
    app.screenshot('clients-staff-route-signed-out')
    # cold starts (a page load is one here; a deep link on a phone is the same): a remembered workspace is ignored, and
    # a staff address opened directly leads to the client sign-in; the watch is in place before the app's first script
    app.js("localStorage.setItem('bp.workspace', 'coach'); true")
    for path, name in (('/', 'a remembered coach sign-in on this device (bp.workspace=coach) is ignored: the app opens on the client sign-in'),
                       ('/coach-sign-in', 'cold start at /coach-sign-in (a deep link) opens the client sign-in'),
                       ('/admin/users', 'cold start at /admin/users (a deep link) opens the client sign-in'),
                       ('/coach/clients', 'cold start at /coach/clients (a deep link) opens the client sign-in')):
        mark = len(app.requests)
        app.watch_text(ah.STAFF_SCREEN_TEXT, next_load=True)
        app.b.open(app.app_url + path, settle=0.5)
        app.err_mark = 0
        landed = app.wait_js("location.pathname === %s" % json.dumps(CLIENT_SIGN_IN), 60) and app.wait_text(r'^Sign in$', 30)
        app.b.pump(1.0)
        seen = app.seen_text()
        calls = [u for u in app.requests[mark:] if re.search(ah.STAFF_API, u)]
        check(name + ', drawing no staff screen', landed and not seen and not calls, 'at %s; staff text seen %s; staff requests %s' % (app.path(), seen, calls))
    app.js("localStorage.removeItem('bp.workspace'); true")
    # a coach and the owner on the client sign-in: WRONG_WORKSPACE becomes the clients-only answer, addresses as text
    for who, account in (('a coach', COACH), ('the owner', OWNER)):
        r = app.sign_in('member', *account)
        shown = app.has_text('^' + re.escape(ah.CLIENTS_ONLY) + '$')
        linked = app.js("Array.from(document.querySelectorAll('a,[role=link]')).some((e) => /bioptime\\.com/i.test((e.innerText || '') + ' ' + (e.getAttribute('href') || '')))")
        check('%s on the client sign-in is refused with "%s"' % (who, ah.CLIENTS_ONLY), not r['ok'] and shown, r['detail'])
        check('%s: bioptime.com/coach and bioptime.com/admin are plain text, with no link to another sign-in' % who, shown and not linked and not app.has_text(STAFF_COPY))
        if who == 'a coach':
            app.screenshot('clients-coach-refused')
    # the same answer through the stand-in Google sign-in (social login refuses staff with WRONG_WORKSPACE)
    app.open_route('/(auth)/sign-in', r'^Sign in$', 15)
    if app.wait_clickable('Continue with Google', 10):
        app.click_text('Continue with Google')
        if app.wait_text(r'^Preview sign-in$', 10):
            app.type_into('Email to sign in with', COACH[0])
            app.click_text('Continue')
            shown = app.wait_text('^' + re.escape(ah.CLIENTS_ONLY) + '$', 20)
            check('a coach through the stand-in Google sign-in is refused with the same clients-only answer', shown and not app.has_text(GREETING), app.text()[:160])
        else:
            check('the stand-in Google sign-in opens its sheet', False, app.text()[:120])
        app.b.open(app.app_url + '/', settle=0.5)   # closes the sheet; nobody is signed in
        app.err_mark = 0
        app.wait_text(r'^Sign in$', 60)
    else:
        skip('a coach through the stand-in Google sign-in', 'no "Continue with Google" on this server')
    # a signed-in client who opens a staff address goes back to Home; nothing staff is drawn or asked for
    r = app.sign_in('member', *MEMBER)
    check('Priya signs in through the client sign-in', r['ok'], r['detail'])
    if not r['ok']:
        return
    stored = app.js("localStorage.getItem('bp.workspace')")
    check('the client app does not remember a workspace on sign-in (bp.workspace stays empty)', stored is None, repr(stored))
    # signed in, every staff address (the staff sign-in chooser too: the client sign-in it leads to sends a member with a
    # session on the device to Home) ends on Home
    for route in ('/(coach)', '/(admin)/members', '/coach/clients', '/admin/users', '/(auth)/choose'):
        visit_staff_route(app, route, HOME, GREETING, 'Priya')
    app.open_route('/(tabs)', None, 30)
    check('Priya is still signed in on Home after the staff addresses', on_home(app))
    ok, d = app.sign_out()
    check('Priya signs out from Profile › Settings and lands on the client sign-in', ok and app.path() == CLIENT_SIGN_IN, d + ' ' + app.path())


# ---------------------------------------------------------------- coach and admin shells
def run_extension(name, app):
    """tools/e2e_app_<workspace>.py, when the next phase adds it: run(app, ctx) with the shared check() / skip()."""
    if not os.path.exists(os.path.join(HERE, name + '.py')):
        return
    mod = importlib.import_module(name)
    print('%s: its own checks' % name)
    mod.run(app, {'base': BASE, 'app_url': app.app_url, 'out': ah.cs.OUT, 'accounts': {'member': MEMBER, 'coach': COACH, 'owner': OWNER}})


def coach_section(app):
    print('coach: Asha through the coach sign-in')
    if not STAFF:
        skip('coach workspace', 'the client app has no coach workspace; run with APP_STAFF=1 for the staff build')
        return
    if app.workspace:
        app.sign_out()
    r = app.sign_in('coach', *COACH)
    if r.get('missing'):
        skip('coach workspace', 'not built yet: /(auth)/coach-sign-in')
        return
    check('Asha signs in through the coach sign-in and lands in the coach workspace', r['ok'], r['detail'])
    if not r['ok']:
        return
    app.page_ok('coach workspace home', r'^Today, Asha$|^Today$')
    tabs = app.tabs()
    check('coach tab bar lists Today, Clients, Calendar, Messages and More', tabs == COACH_TABS, str(tabs))
    check('coach home carries the notifications bell', app.js("!!document.querySelector('[aria-label^=\"Notifications\"]')"))
    # the coach's own work email is on their identity card, as on the web; no other address may appear
    others = app.js(r"(document.body.innerText.match(/[a-z0-9._+-]+@demo\.bioptime\.test/gi) || []).filter(e => e.toLowerCase() !== 'asha.menon@demo.bioptime.test')")
    check('coach home never shows a member email address', not others, str(others))
    no_labels(app, 'coach home')
    app.screenshot('coach-home')
    run_extension('e2e_app_coach', app)
    ok, d = app.sign_out()
    check('coach signs out from More and lands on a sign-in screen', ok, d)


def admin_section(app):
    print('admin: the owner through the administrative sign-in with the preview code')
    if not STAFF:
        skip('administrative portal', 'the client app has no administrative portal; run with APP_STAFF=1 for the staff build')
        return
    if app.workspace:
        app.sign_out()
    r = app.sign_in('admin', *OWNER, mfa='preview')
    if r.get('missing'):
        skip('administrative portal', 'not built yet: /(auth)/admin-sign-in')
        return
    check('the owner signs in through the administrative sign-in with the authenticator code', r['ok'] and r['mfa_asked'], r['detail'] + ('' if r['mfa_asked'] else '; no code was asked for'))
    if not r['ok']:
        return
    app.page_ok('administrative portal home', r'^Overview$')
    tabs = app.tabs()
    check('admin tab bar lists Overview, Members, Operations, Messages and More', tabs == ADMIN_TABS, str(tabs))
    check('admin home carries the notifications bell', app.js("!!document.querySelector('[aria-label^=\"Notifications\"]')"))
    no_labels(app, 'admin home')
    app.screenshot('admin-home')
    run_extension('e2e_app_admin', app)
    ok, d = app.sign_out()
    check('the owner signs out from More and lands on a sign-in screen', ok, d)


# ---------------------------------------------------------------- the open preview
# what the member sign-in form draws (its title, fields and links): in the client app's open preview it must be there
# (the positive check of BUILD_PLAN §8.3), with the one-tap card above it
SIGN_IN_FORM_TEXT = r'^Sign in$|^Password$|^Forgotten your password\?$|^Create an account$|^Continue with Google$'
OPEN_PREVIEW_API = '/api/auth/open-preview'
PREVIEW_CARD = 'Continue without signing in'
PREVIEW_CARD_TEXT = r'^Look around with a prepared member account\. Nothing you do here is real\.$'
OPEN_PREVIEW_LIMIT = 120   # POST /auth/open-preview: 120 per 10 minutes per address (apps/api/src/http/routes/auth.ts)


def preview_posts(app, mark=0):
    """The POST /auth/open-preview requests the page sent since `mark` (an index into app.request_log)."""
    return [u for m, u in app.request_log[mark:] if m == 'POST' and u.split('?')[0].endswith(OPEN_PREVIEW_API)]


def password_fields(app):
    return app.js("Array.from(document.querySelectorAll('input')).filter((e) => e.type === 'password' && !e.closest('[aria-hidden=\"true\"]')).length") or 0


def sign_in_with_card(app, seconds=30):
    """The client sign-in as the open preview shows it: the form (Email and Password fields, Sign in) and the card."""
    drawn = app.wait_js("location.pathname === '/sign-in'", seconds) and app.wait_visible(r'^Sign in$', seconds) and app.wait_clickable(PREVIEW_CARD, seconds)
    # the card enters a moment after the screen (a short delay at opacity 0): wait until it can be seen
    return bool(drawn and app.wait_visible(PREVIEW_CARD_TEXT, 10) and app.has_input('Email') and password_fields(app) == 1 and app.find_clickable('Sign in'))


def tap_card(app, seconds=30):
    """Tap "Continue without signing in"; returns (Home as Priya reached, open-preview posts the tap sent)."""
    mark = len(app.request_log)
    pressed = app.click_text(PREVIEW_CARD, seconds=10)
    home = pressed and on_home(app, 'Priya', seconds)
    app.b.pump(0.8)
    if home:
        app.workspace = 'member'
    return home, len(preview_posts(app, mark))


def preview_section(app):
    print('preview: the open preview; the sign-in form with a one-tap card, and no session the app opens by itself')
    if not PREVIEW:
        skip('open preview', 'the server at BASE is not in the open preview (start the scratch API with OPEN_PREVIEW=1)')
        return
    if STAFF:
        skip('open preview', 'checked on the client app; run without APP_STAFF')
        return
    app.open_route('/(auth)/sign-in', None, 30)
    mark = len(app.request_log)
    shown = sign_in_with_card(app)
    app.b.pump(1.5)
    check('open preview: the sign-in draws its form (Email, Password, Sign in) with the "Continue without signing in" card; nothing is sent until the tap',
          shown and not preview_posts(app, mark), 'form and card %s; open-preview posts %d; %s' % (shown, len(preview_posts(app, mark)), app.visible_text()[:200]))
    no_labels(app, 'open preview sign-in')
    app.screenshot('preview-sign-in-card')
    # the tap: exactly one POST /auth/open-preview, then Home as Priya; no password sign-in on the way
    logins = len([u for m, u in app.request_log if m == 'POST' and '/api/auth/login' in u])
    home, posts = tap_card(app)
    check('open preview: the tap sends exactly one POST /auth/open-preview and opens Home as Priya', home and posts == 1, 'home %s; posts %d; %s' % (home, posts, app.visible_text()[:120]))
    check('open preview: no POST /auth/login was sent for it', len([u for m, u in app.request_log if m == 'POST' and '/api/auth/login' in u]) == logins)
    check('open preview: the pill lists the nine tabs', app.tabs() == MEMBER_TABS, str(app.tabs()))
    no_labels(app, 'open preview home')
    app.screenshot('preview-home')
    for label, route, path, expect in (TAB_WALK[0], TAB_WALK[-1]):
        app.open_route(route, None, 45)
        app.wait_visible(expect, 45)
        screen_ok(app, 'open preview: ' + label + ' tab', expect, path)
    # the sign-in screen while the session is open: straight back to Home, no new session
    mark = len(app.request_log)
    app.open_route('/(auth)/sign-in', None, 30)
    back = on_home(app)
    check('open preview: the sign-in screen with a session open goes straight to Home (no new session)', back and not preview_posts(app, mark), 'at %s' % app.path())
    # Sign out: the form with the card again, and nothing is sent
    mark = len(app.request_log)
    ok, d = app.sign_out()
    shown = ok and sign_in_with_card(app)
    app.b.pump(2.0)
    check('open preview: Sign out (Profile › Settings) returns to the sign-in form with the card and sends nothing', shown and not preview_posts(app, mark),
          '%s; open-preview posts %d; at %s' % (d, len(preview_posts(app, mark)), app.path()))
    app.screenshot('preview-after-sign-out')
    # the phone code, registration and password reset draw their forms (nobody is signed in)
    for route, field in (('/(auth)/phone', 'Mobile number'), ('/(auth)/register', 'Your name'), ('/(auth)/forgot', 'Email on your account')):
        mark = len(app.request_log)
        app.open_route(route, None, 30)
        drawn = app.wait_js("!!(%s)(%s)" % (ah.FIND_INPUT, json.dumps(field)), 20)
        app.b.pump(0.8)
        check('open preview: %s draws its form (%s) and sends nothing' % (route.split('/')[-1], field), drawn and not preview_posts(app, mark), 'at %s; %s' % (app.path(), app.visible_text()[:120]))
    # a session ended elsewhere: "Session ended" on the sign-in with the card; nothing is sent. The open preview's own
    # account cannot end another of its sessions (GET and DELETE /auth/sessions show a shared preview session only
    # itself), so this is a member who signed in with a password (Ananya), her app session ended from Python
    app.b.pump(16)   # past the app's 15 s reuse of the last GET /me (see the report: the previous account's Home can show)
    r = app.sign_in('member', *SECOND_MEMBER)
    revoked = 0
    if r['ok']:
        other = ah.ApiSession(BASE).login(*SECOND_MEMBER)
        try:
            listed = other.get('/auth/sessions')
            for row in listed.get('items', []):
                if row.get('id') and row.get('id') != listed.get('current'):
                    st, _, _ = ah.api(BASE, 'DELETE', '/auth/sessions/%s' % row['id'], token=other.token)
                    revoked += st < 300
        finally:
            other.logout()
    if not revoked:
        check('open preview: a member\'s session ended elsewhere can be set up (Ananya signs in; her app session is ended from Python)', False, '%s; %d revoked' % (r['detail'], revoked))
    else:
        mark = len(app.request_log)
        app.open_route('/(tabs)/tests', None, 30)
        ended = app.wait_visible(r'^Session ended$', 45) and sign_in_with_card(app)
        app.b.pump(1.5)
        check('open preview: a session ended elsewhere (%d revoked) leads to the sign-in with "Session ended" and the card, and no session is opened by itself' % revoked,
              ended and not preview_posts(app, mark), 'at %s; open-preview posts %d; %s' % (app.path(), len(preview_posts(app, mark)), app.visible_text()[:200]))
        app.screenshot('preview-session-ended')
    app.workspace = None
    # a cold start straight at the sign-in screen (a deep link; on the web a page load also drops the session)
    mark = len(app.request_log)
    app.b.open(app.app_url + '/sign-in', settle=0.5)
    app.err_mark = 0
    shown = sign_in_with_card(app, 60)
    app.b.pump(1.5)
    check('open preview: a cold start at /sign-in draws the form with the card and sends nothing', shown and not preview_posts(app, mark), 'at %s; posts %d' % (app.path(), len(preview_posts(app, mark))))
    # the Server screen still changes the address (here: the same one again); the card stays the way in
    if app.route_exists('/settings/server', r'^Server$'):
        mark = len(app.request_log)
        typed = app.type_into('Address', BASE)
        app.click_text('Use this address')
        said = app.wait_text('^' + re.escape('Now using %s. Sign in again, or continue without signing in from the sign-in screen.' % BASE) + '$', 30)
        app.b.pump(1.0)
        check('open preview: the Server screen applies an address and points to the sign-in screen\'s card (nothing is sent by itself)', typed and said and not preview_posts(app, mark), '%s; open-preview posts %d' % (app.visible_text()[:200], len(preview_posts(app, mark))))
        app.screenshot('preview-server-screen')
        app.open_route('/(auth)/sign-in', None, 30)
        home, posts = tap_card(app)
        check('open preview: after the address change the card opens Home (one POST)', home and posts == 1, 'home %s; posts %d' % (home, posts))
    else:
        check('open preview: the Server screen draws', False, app.path())


def exhaust_open_preview():
    """POST /auth/open-preview from Python (the browser's address too) until the server's limit refuses it; each session
    opened on the way is ended at once. Returns (calls made, last status)."""
    n = st = 0
    while n < OPEN_PREVIEW_LIMIT + 20:
        st, j, _ = ah.api(BASE, 'POST', '/auth/open-preview', {'workspace': 'member'})
        n += 1
        if st != 200:
            break
        ah.api(BASE, 'POST', '/auth/logout', {}, token=((j or {}).get('session') or {}).get('token'))
    return n, st


def refused_section(app):
    print('refused: the open preview when the server will not open a session (its limit reached): the reason under the card, the form still usable')
    if not PREVIEW:
        skip('open preview refused', 'the server at BASE is not in the open preview (start the scratch API with OPEN_PREVIEW=1)')
        return
    if STAFF:
        skip('open preview refused', 'checked on the client app; run without APP_STAFF')
        return
    if app.workspace:
        app.sign_out()
    app.open_route('/(auth)/sign-in', None, 30)
    n, st = exhaust_open_preview()
    if st != 429:
        check('refused: Python reaches the server\'s limit on POST /auth/open-preview (429)', False, '%d calls, last status %s' % (n, st))
        return
    check('refused: the server\'s limit on POST /auth/open-preview is reached after about %d calls (429)' % OPEN_PREVIEW_LIMIT, OPEN_PREVIEW_LIMIT - 10 <= n <= OPEN_PREVIEW_LIMIT + 2, '%d calls' % n)
    print('  the limit was reached after %d calls from Python' % n)
    # the tap: one request, the reason under the card's pill, the form below still usable
    shown = sign_in_with_card(app)
    mark = len(app.request_log)
    pressed = app.click_text(PREVIEW_CARD, seconds=10)
    said = app.wait_visible(r'^Too many attempts\. Wait a few minutes and try again\.$', 20)
    app.b.pump(1.0)
    check('refused: a tap on the card sends one POST /auth/open-preview and says why under its pill ("Too many attempts…")',
          shown and pressed and said and len(preview_posts(app, mark)) == 1 and app.path() == '/sign-in', 'pressed %s; said %s; posts %d; %s' % (pressed, said, len(preview_posts(app, mark)), app.visible_text()[:200]))
    app.screenshot('refused-reason')
    # the form below the card: Priya with her password (the card's reason stays on the screen meanwhile, so the
    # harness's sign_in, which stops at any "Too many attempts", is not used here)
    typed = app.type_into('Email', MEMBER[0]) and app.type_into('Password', MEMBER[1])
    app.click_text('Sign in')
    home = typed and on_home(app)
    check('refused: the form stays usable: Priya signs in with her password', home, app.visible_text()[:160])
    if home:
        app.workspace = 'member'
        ok, d = app.sign_out()
        check('refused: and signs out to the form with the card', ok and sign_in_with_card(app), d)
    # cold starts (a page load, as a deep link opens the app) under the same refusal: forms, and nothing sent
    for route, field in (('/', 'Password'), ('/sign-in', 'Password'), ('/register', 'Your name'), ('/forgot', 'Email on your account'), ('/phone', 'Mobile number')):
        mark = len(app.request_log)
        app.b.open(app.app_url + route, settle=0.5)
        app.err_mark = 0
        drawn = app.wait_js("!!(%s)(%s)" % (ah.FIND_INPUT, json.dumps(field)), 60)
        if route in ('/', '/sign-in'):
            drawn = drawn and sign_in_with_card(app, 30)
        app.b.pump(1.5)
        check('refused: a cold start at %s draws its form (%s)%s and sends nothing' % (route, field, ' with the card' if route in ('/', '/sign-in') else ''),
              drawn and not preview_posts(app, mark), 'at %s; posts %d; %s' % (app.path(), len(preview_posts(app, mark)), app.visible_text()[:160]))
        if route == '/':
            app.screenshot('refused-cold-start')


def relay_run():
    """The link relay, with its own Expo server and a no-network Chrome (see the module docstring, section relay)."""
    print('relay: the app finds the shared link through a stand-in relay (nothing leaves this machine)')
    if APP_URL:
        skip('link relay', 'needs its own Expo server with the relay build variables; not with APP_URL')
        return
    if STAFF:
        skip('link relay', 'checked on the client app; run without APP_STAFF')
        return
    rand = os.urandom(4).hex()
    topic = 'bp-e2e-topic-' + os.urandom(6).hex()   # a test topic, only on the stand-in (no part of it in a link name)
    t0 = 'https://bp-e2e-%s-gone.trycloudflare.com' % rand
    t1 = 'https://bp-e2e-%s-one.trycloudflare.com' % rand
    t2 = 'https://bp-e2e-%s-two.trycloudflare.com' % rand
    dead = 'http://127.0.0.1:%d' % ah.free_port()   # the built-in address: nothing answers there
    typed_dead = dead
    while typed_dead == dead:
        typed_dead = 'http://127.0.0.1:%d' % ah.free_port()   # a typed address (a Mac on the Wi-Fi) that does not answer
    relay = ah.RelayStandIn(int(os.environ.get('E2E_RELAY_PORT') or ah.free_port()), topic).start()
    relay.publish(t0, age_seconds=7200)
    relay.publish(t1, age_seconds=60)
    for junk in ('http://bp-e2e-plain.trycloudflare.com', t1 + '/', t1 + '/api', 'https://evil.example', 'https://x.trycloudflare.com.evil.example', 'not a link', ' ' + t2):
        relay.publish(junk, age_seconds=10)   # newer, but none is a whole quick-tunnel address
    relay.publish(t2, age_seconds=5, event='keepalive')   # not a message
    expo = b = app = None
    landing = r'^Sign in$'   # the client app lands on its sign-in either way: no session opens by itself (BUILD_PLAN §7.4)

    def open_through(link, what):
        """Under the open preview: Home through the card's tap, its one request sent to `link`."""
        app.open_route('/(tabs)', None, 30)
        if on_home(app, 'Priya', 8):
            return True
        app.open_route('/(auth)/sign-in', None, 30)
        mark_t = len(app.tunnel_log)
        home, _ = tap_card(app)
        through = any(m == 'POST' and u == link + OPEN_PREVIEW_API and st == 200 for m, u, st, tok in app.tunnel_log[mark_t:])
        check('relay: %s: the card opens Home through %s (its POST /auth/open-preview went there)' % (what, 'the newer link' if link == t2 else 'the link'), home and through,
              'home %s; tunnel requests %s' % (home, [(m, u.split('.com')[-1], st) for m, u, st, tok in app.tunnel_log[mark_t:]][:6]))
        return home

    try:
        expo = ah.ExpoWeb(APP_PORT, dead, APP_DIR, staff=False, log=os.path.join(ah.cs.OUT, 'expo-web-relay.log'),
                          extra_env={'EXPO_PUBLIC_LINK_RELAY_TOPIC': topic, 'EXPO_PUBLIC_LINK_RELAY_BASE': relay.base, 'EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE': '1'})
        expo.start()
        print('expo web (link relay build, built-in address %s) answering on %s after %.0fs' % (dead, expo.url, expo.started_in))
        b = ah.start_browser(no_network=True)
        b.viewport(390, 844, mobile=True)
        app = ah.App(b, BASE, expo.url)
        app.route_quick_tunnels({t0: None, t1: BASE})
        t_start = time.monotonic()
        app.watch_text(r'^Service not reached$', next_load=True)
        app.boot()
        arrived = app.wait_text(landing, 90) and app.wait_js("location.pathname === '/sign-in'", 30)
        app.b.pump(1.0)
        seen = app.seen_text()
        polls = relay.polls()
        check('relay: the first start reads the relay once, at /<topic>/json?poll=1&since=12h', polls == ['GET /%s/json?poll=1&since=12h' % topic], str(polls))
        asked = sorted({u.split('/api/')[0] for m, u, st, tok in app.tunnel_log})
        check('relay: the app used the newest whole quick-tunnel link and no other (not the older one, none of the newer invalid texts)', asked == [t1], str(asked))
        hosts = sorted({re.sub(r'^(https?://[^/]+).*$', r'\1', u) for m, u in app.request_log if u.startswith('http')})
        allowed = {expo.url, dead, relay.base, t1}   # checked after the first start
        check('relay: the page asked no host but the app, the built-in address, the stand-in relay and that link (nothing to ntfy.sh)', set(hosts) <= allowed, str(hosts))
        check('relay: the app reaches the server through the link and shows the sign-in without "Service not reached", opening no session by itself',
              arrived and not seen and not any(m == 'POST' and u.endswith(OPEN_PREVIEW_API) for m, u, st, tok in app.tunnel_log), 'at %s; seen %s' % (app.path(), seen))
        if PREVIEW:
            check('relay: the sign-in offers the open preview\'s card (the server read through the link says openPreview)', sign_in_with_card(app), app.visible_text()[:200])
            open_through(t1, 'first start')
        app.screenshot('relay-first-start')
        app.open_route('/settings/server', r'^Server$', 30)
        check('relay: the Server screen shows the link in use and that it came from the relay (the topic is not shown)',
              app.has_text('^' + re.escape(t1) + '$') and app.has_text(r'^On · the address in use came from it$') and not app.has_text(re.escape(topic)), app.text()[:300])
        app.screenshot('relay-server-screen')
        # the tunnel moves: the first link answers Cloudflare's 530, the relay has a newer one
        app.open_route('/(tabs)' if PREVIEW else '/(auth)/sign-in', None, 30)
        wait = 21 - (time.monotonic() - (relay.last_poll or t_start))   # the app reads the relay at most every 20 seconds
        if wait > 0:
            app.b.pump(wait)
        relay.publish(t2, age_seconds=0)
        app.route_quick_tunnels({t0: None, t1: None, t2: BASE})
        mark_t, polls_before = len(app.tunnel_log), len(relay.polls())
        app.watch_text(r'^Service not reached$')
        if PREVIEW:
            app.open_route('/(tabs)/train', None, 30)   # its requests (with the session) meet the 530
        else:
            # signed out, the next request is a sign-in: a made-up address, answered by the gone link's 530 (it reaches
            # no server)
            app.type_into('Email', 'relay.check@example.test')
            app.type_into('Password', 'not-an-account-password')
            app.click_text('Sign in')
        moved = _wait(lambda: any(u.startswith(t2) for m, u, st, tok in app.tunnel_log[mark_t:]), app, 60)
        app.b.pump(1.0)
        seen = app.seen_text()
        after = app.tunnel_log[mark_t:]
        t1_530 = any(u.startswith(t1) and st == 530 for m, u, st, tok in after)
        first_t2 = [(m, u.split('/api')[1] if '/api' in u else u, tok) for m, u, st, tok in after if u.startswith(t2)]
        check('relay: when the link answers 530, the app reads the relay again and moves to the newer link', t1_530 and moved and len(relay.polls()) > polls_before,
              '530 seen %s; t2 asked %s; polls %d -> %d' % (t1_530, moved, polls_before, len(relay.polls())))
        check('relay: the old session token is never sent to the new link', first_t2 and not any(tok for m, u, tok in first_t2), str(first_t2[:6]))
        if PREVIEW:
            open_through(t2, 'after the move')
        app.screenshot('relay-after-move')
        # an address typed under Server is the tester's choice: used as typed, and kept even when it stops answering
        app.open_route('/settings/server', r'^Server$', 30)
        app.type_into('Address', BASE)
        app.click_text('Use this address')
        said = app.wait_text('^' + re.escape('Now using %s. Sign in again' % BASE) + (re.escape(', or continue without signing in from the sign-in screen.') if PREVIEW else r' to continue\.') + '$', 30)
        check('relay: a typed address is used as typed (the Server screen keeps working as a manual override)', said and app.has_text(r'^On · a typed address stays in use while it answers$'), app.text()[:300])
        polls_before = len(relay.polls())
        app.type_into('Address', typed_dead)
        app.click_text('Use this address')
        said = app.wait_text('^' + re.escape('%s could not be reached. Check the address and the connection.' % typed_dead) + '$', 30)
        app.b.pump(1.0)
        check('relay: a typed address that is not a quick tunnel stays in use when it does not answer; the relay is not asked', said and len(relay.polls()) == polls_before and app.input_value('Address') == typed_dead,
              '%s; polls %d -> %d' % (app.text()[:200], polls_before, len(relay.polls())))
        # Reset: the built-in address (nothing answers) and then the relay's current link again
        polls_before, mark_t = len(relay.polls()), len(app.tunnel_log)
        app.click_text('Reset')
        said = app.wait_text('^' + re.escape("%s did not answer. The link relay gave the shared link's current address, now in use: %s." % (dead, t2)) + '$', 45)
        check('relay: Reset goes back to the built-in address and, as nothing answers there, to the relay\'s current link', said and app.input_value('Address') == t2,
              'polls %d -> %d; tunnel requests %s; screen: %s' % (polls_before, len(relay.polls()), [(m, u.split('.com')[-1], st) for m, u, st, tok in app.tunnel_log[mark_t:]][:8], app.text()[:600]))
        app.screenshot('relay-after-reset')
        if PREVIEW:
            open_through(t2, 'after Reset')
        # Reset again (under the open preview with a session open on the link)
        app.open_route('/settings/server', r'^Server$', 30)
        app.b.pump(2.0)
        polls_before, mark_t = len(relay.polls()), len(app.tunnel_log)
        app.click_text('Reset')
        # the same words as after the first Reset are already on the screen: wait for this Reset's relay read and a
        # request to the link before reading them
        moved = _wait(lambda: len(relay.polls()) > polls_before and any(u.startswith(t2) for m, u, st, tok in app.tunnel_log[mark_t:]), app, 45)
        app.b.pump(1.0)
        said = moved and app.wait_text('^' + re.escape("%s did not answer. The link relay gave the shared link's current address, now in use: %s." % (dead, t2)) + '$', 15)
        check('relay: Reset %s also comes back to the relay\'s current link' % ('with a session open on the link' if PREVIEW else 'a second time'), said and app.input_value('Address') == t2,
              'polls %d -> %d; tunnel requests %s; screen: %s' % (polls_before, len(relay.polls()), [(m, u.split('.com')[-1], st, tok) for m, u, st, tok in app.tunnel_log[mark_t:]][:10], app.text()[:600]))
        if PREVIEW:
            open_through(t2, 'after the second Reset')
        asked = sorted({u.split('/api/')[0] for m, u, st, tok in app.tunnel_log})
        check('relay: over the whole run the app only ever asked the two valid links the relay gave it', asked == sorted([t1, t2]), str(asked))
        stray = [s for s in relay.seen if not s.startswith('GET /%s/json?poll=1&since=12h' % topic)]
        check('relay: the app only ever polled the relay (no publishing, no other path)', not stray, str(stray))
    except Exception as e:
        traceback.print_exc()
        check('relay: the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        if app:
            try:
                app.screenshot('relay-last-screen')
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
        relay.stop()


def _wait(cond, app, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if cond():
            return True
        app.b.pump(0.3)
    return bool(cond())


def relay_section(app):
    """Placeholder in SECTIONS: main() runs relay_run() before the other sections, with its own Expo server and Chrome
    (first, so the refused section, which uses up the server's open-preview limit, can come last)."""


SECTIONS = {'member': member_section, 'auth': auth_section, 'clients': clients_section, 'coach': coach_section, 'admin': admin_section,
            'preview': preview_section, 'refused': refused_section, 'relay': relay_section}
SIGN_IN_SECTIONS = ('member', 'auth', 'clients', 'coach', 'admin')   # they sign in through the forms: not in the open preview


def main():
    global PREVIEW
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4121 (never the live demo).')
    why = ah.live_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server (BASE=http://127.0.0.1:<port>).' % (BASE, why))
    why = ah.port_refusal(APP_PORT) if not APP_URL else ah.live_refusal(APP_URL)
    if why:
        sys.exit('Refusing the app server %s: %s.' % (APP_URL or APP_PORT, why))
    status, cfg, _ = ah.api(BASE, 'GET', '/public/config')
    PREVIEW = status == 200 and isinstance(cfg, dict) and cfg.get('openPreview') is True
    only = [s.strip() for s in os.environ.get('E2E_APP_ONLY', '').split(',') if s.strip()] or list(PREVIEW_SECTIONS if PREVIEW else DEFAULT_SECTIONS)
    unknown = [s for s in only if s not in SECTIONS]
    if unknown:
        sys.exit('E2E_APP_ONLY names unknown sections %s; the sections are %s' % (unknown, ', '.join(SECTION_NAMES)))
    only = [s for s in SECTION_NAMES if s in only]
    # nothing is started before every port is known to be usable: a Chrome whose DevTools port is taken could never be
    # reached, and an Expo port in use belongs to someone else's server
    why = ah.cdp_refusal(CDP_PORT)
    if why:
        sys.exit('Refusing E2E_CDP_PORT %s: %s.' % (CDP_PORT, why))
    if not APP_URL and ah.port_in_use(APP_PORT):
        sys.exit('APP_PORT %s is already in use: choose another, or pass APP_URL=http://localhost:%s to drive the server that runs there.' % (APP_PORT, APP_PORT))
    ah.configure(OUT, CDP_PORT)
    app_url = APP_URL or 'http://localhost:%s' % int(APP_PORT)
    if not ah.cors_allows(BASE, app_url):
        sys.exit('The API at %s does not allow the browser origin %s: start the scratch API with CORS_ORIGINS=%s (apps/api/src/config.ts).' % (BASE, app_url, app_url))
    if PREVIEW:
        print('the server at %s is in the open preview (GET /public/config openPreview): the sign-in sections are skipped' % BASE)
    t0 = time.monotonic()
    timings = {}
    if 'relay' in only:
        # its own Expo server and Chrome, before the others: the refused section uses up the open-preview limit
        t1 = time.monotonic()
        relay_run()
        timings['relay'] = round(time.monotonic() - t1, 1)
        print('  (relay took %.0fs)' % timings['relay'])
    expo = b = app = None
    in_browser = [s for s in only if s != 'relay']
    # everything started from here is stopped in the finally, whatever fails after it: the Expo process group, the
    # Chrome of this run (a Chrome whose DevTools port never answers is stopped by start_browser itself)
    try:
        if not in_browser:
            pass
        elif not APP_URL:
            expo = ah.ExpoWeb(APP_PORT, BASE, APP_DIR, staff=STAFF)
            expo.start()
            timings['expo start'] = round(expo.started_in, 1)
            print('expo web (%s) answering on %s after %.0fs (log: %s)' % ('staff build, EXPO_PUBLIC_STAFF_APP=1' if STAFF else 'client app, EXPO_PUBLIC_STAFF_APP=0', expo.url, expo.started_in, expo.log_path))
        if in_browser:
            b = ah.start_browser()
            b.viewport(390, 844, mobile=True)
            app = ah.App(b, BASE, app_url)
            t1 = time.monotonic()
            took = app.boot()
            timings['first screen'] = round(took, 1)
        if not in_browser:
            pass
        elif PREVIEW and not STAFF:
            # the open preview in the client app: the splash, then the sign-in form with the one-tap card; nothing is
            # sent to POST /auth/open-preview until the card is tapped (BUILD_PLAN §7.4, owner decision D4)
            drawn = sign_in_with_card(app, 60)
            app.b.pump(2.0)
            posts = preview_posts(app)
            check('open preview: a cold start shows the sign-in form (Email, Password, Sign in) with the "Continue without signing in" card, and sends no POST /auth/open-preview by itself',
                  drawn and not posts, '%.1fs, at %s; open-preview posts %d' % (time.monotonic() - t1, app.path(), len(posts)))
            app.screenshot('preview-first-screen')
        else:
            # boot() returns at the first text (the loading screen can be it); the entry route then redirects to a sign-in
            drawn = app.wait_text(ah.SIGN_IN_SCREEN, 30)
            if STAFF:
                check('the app draws its first screen (the chooser or a sign-in)', drawn, '%.1fs, at %s' % (time.monotonic() - t1, app.path()))
            else:
                drawn = drawn and app.wait_js("location.pathname === %s" % json.dumps(CLIENT_SIGN_IN), 15) and app.wait_text(r'^Sign in$', 15)
                check('the client app opens straight on the client sign-in (no "Three doors" chooser)', drawn and not app.has_text(r'Three doors'), '%.1fs, at %s' % (time.monotonic() - t1, app.path()))
        for name in in_browser:
            if PREVIEW and name in SIGN_IN_SECTIONS:
                skip(name + ' section', 'the server is in the open preview (nobody signs in); run it against a server without OPEN_PREVIEW')
                continue
            t1 = time.monotonic()
            SECTIONS[name](app)
            timings[name] = round(time.monotonic() - t1, 1)
            print('  (%s took %.0fs)' % (name, timings[name]))
    except Exception as e:
        traceback.print_exc()
        check('the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        if app:
            try:
                app.screenshot('last-screen')
            except Exception:
                pass
        if b:
            try:
                b.close()
            except Exception:
                pass
        if b:
            try:
                b.proc.wait(10)
            except Exception:
                pass
        if expo:
            expo.stop()
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'build': 'staff' if STAFF else 'client', 'openPreview': PREVIEW, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
