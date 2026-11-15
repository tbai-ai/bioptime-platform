#!/usr/bin/env python3
"""End-to-end check of the coach workspace's module pieces, part 1 (apps/mobile, Expo web build, headless Chrome at
390x844; Python 3.9, stdlib, Google Chrome): the eight client-record module tabs and the screens /coach/sessions,
/coach/sessions/:id, /coach/announcements, /coach/ai, /coach/help (+ article, request) and /coach/discovery-calls.

    BASE=http://127.0.0.1:4211 APP_PORT=9211 E2E_CDP_PORT=9911 python3 -I tools/e2e_app_coach_m1.py
    BASE=… APP_URL=http://localhost:9211 E2E_ONLY=sessions,help python3 -I tools/e2e_app_coach_m1.py   # a running Expo, named sections

BASE is the scratch API (required; the live demo's ports 3000, 3100, 3101 and 8081 are refused, as in tools/e2e_app.py),
started with CORS_ORIGINS=http://localhost:<APP_PORT>. Without APP_URL the check starts `npx expo start --web` for
apps/mobile in its own process group and stops it at the end. E2E_OUT (screenshots, report.json; default
.local/e2e/app-coach-m1/) and E2E_CDP_PORT (default 9911) keep parallel runs apart.

One sign-in through the app's coach sign-in (Asha) for the whole run, plus one from Python for record ids, both counted
by the server's limit of about 20 per 10 minutes. Sections (E2E_ONLY): sessions, announcements, ai, help, discovery,
tabs. Writes to the scratch database: a draft session (published, then cancelled), two announcements (withdrawn, one
of them from Python while its reason sheet is open, so that the server refuses the sheet's own withdrawal), a support
request and a reply, a habit, a goal. Every reason sheet is checked for the portal's ReasonDialog wording ("Reason
(recorded in the audit log)", "Keep as is", "Say why, in a few words.") and keeps a refusal inside it. Pull to refresh
is run as the gesture runs it (React Native Web draws no pull gesture in a desktop browser): the RefreshControl's
onRefresh of the visible screen, with the page's fetches counted. Exit status 1 if anything fails; the JSON summary is
the last line."""
import json
import os
import re
import sys
import time
import traceback

sys.dont_write_bytecode = True
os.environ['APP_STAFF'] = '1'   # coach and administrator screens exist only in the staff build: the harness starts Expo with EXPO_PUBLIC_STAFF_APP=1
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_harness as ah  # noqa: E402
from app_harness import check, skip  # noqa: E402

BASE = os.environ.get('BASE', '').rstrip('/')
APP_PORT = os.environ.get('APP_PORT') or '9211'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-coach-m1')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9911'
SECTION_NAMES = ('sessions', 'announcements', 'ai', 'help', 'discovery', 'tabs', 'notshared')
DEFAULT_SECTIONS = SECTION_NAMES[:-1]   # notshared signs in a second coach (Meera): opt in with E2E_ONLY
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
COACH2 = ('meera.iyer@demo.bioptime.test', 'Demo-Coach-2026!')   # Deepa, her client, does not share health records
EMAIL_RX = r'[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}'
PHONE_RX = r'\+91\s?\d{10}|\b9\d{9}\b'

CTX = {}
TAG = time.strftime('%H%M%S')   # a unique word per run, so a second run against the same scratch database finds its own records


def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label', not hit, hit)


def no_contacts(app, name):
    """A coach never sees an email address or a phone number (the sign-in address never shows on these screens)."""
    text = app.text()
    hit = re.search(EMAIL_RX, text, re.I) or re.search(PHONE_RX, text)
    check(name + ': no email address or phone number on the screen', not hit, hit.group(0) if hit else '')


def open_screen(app, route, expect, name, seconds=45):
    app.open_route(route, expect, seconds)
    ok = app.page_ok(name, expect)
    no_labels(app, name)
    return ok


LAST_BUTTON = r"""(text) => { const norm = (s) => (s || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
  const all = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => norm(e.innerText) === text || norm(e.getAttribute('aria-label')) === text);
  return all.length ? all[all.length - 1] : null; }"""


def click_last(app, text, seconds=10):
    """Press the last button reading `text` in the document: a sheet's confirm button, which renders after the page's
    own button of the same name (Cancel session, Withdraw)."""
    if not app.wait_js("!!(%s)(%s)" % (LAST_BUTTON, json.dumps(text)), seconds):
        return False
    return bool(app.js("(() => { const el = (%s)(%s); if (!el) return false; el.click(); return true; })()" % (LAST_BUTTON, json.dumps(text))))


REASON = 'Reason (recorded in the audit log)'   # the portal's ReasonDialog field (apps/dashboard/src/ui/index.tsx)


def reason_sheet_wording(app, confirm, name):
    """The open reason sheet reads like the portal's ReasonDialog, and confirming without a reason asks for one."""
    check(name + ': the web’s field, placeholder and Keep as is', app.has_text(r'^Reason \(recorded in the audit log\)$') and app.has_input(REASON) and bool(app.js("!!document.querySelector('[placeholder=\"What you know, and why this is right\"]')")) and app.find_clickable('Keep as is'))
    check(name + ': confirming without a reason says “Say why, in a few words.”', click_last(app, confirm) and app.wait_text(r'^Say why, in a few words\.$', 10))


FETCH_LOG = r"""(() => { if (!window.__e2eFetches) { window.__e2eFetches = []; const orig = window.fetch.bind(window);
  window.fetch = (u, o) => { try { window.__e2eFetches.push(String((u && u.url) || u)); } catch (e) {} return orig(u, o); }; }
  window.__e2eFetches.length = 0; return true; })()"""

PULL = r"""(rx) => { const re = new RegExp(rx);
  const els = Array.from(document.querySelectorAll('div,span')).filter((e) => e.offsetParent !== null && !e.children.length && re.test((e.innerText || '').trim()));
  for (const el of els) { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); let f = k ? el[k] : null;
    for (let i = 0; f && i < 400; i++, f = f.return) { const rc = f.memoizedProps && f.memoizedProps.refreshControl;
      if (rc && rc.props && typeof rc.props.onRefresh === 'function') { rc.props.onRefresh(); return true; } } }
  return false; }"""


def count_fetches(app):
    """Count the page's fetches from now on (the app calls the global fetch for every API request)."""
    return bool(app.js(FETCH_LOG))


def pull_to_refresh(app, anchor_rx):
    """Pull to refresh as the gesture runs it: the onRefresh of the RefreshControl on the scroll view that holds a visible
    text matching anchor_rx."""
    return bool(app.js('(%s)(%s)' % (PULL, json.dumps(anchor_rx))))


def fetched(app, rx, seconds=10):
    return app.wait_js("(window.__e2eFetches || []).some((u) => new RegExp(%s).test(u))" % json.dumps(rx), seconds)


def wait_gone(app, rx, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not app.has_text(rx):
            return True
        app.b.pump(0.3)
    return False


# ---------------------------------------------------------------- sessions
def sessions_section(app):
    print('sessions: /coach/sessions and /coach/sessions/:id')
    open_screen(app, '/coach/sessions', r'^Live sessions$', 'live sessions list')
    check('list sub-title and the pending-configuration notice', app.has_text(r'The group classes, webinars and workshops you host') and app.has_text(r'^Video meetings: pending configuration$'))
    check('list tabs Upcoming, Past and All', all(app.find_clickable(t) for t in ('Upcoming', 'Past', 'All')))
    check('upcoming lists the published and the draft session from the seed', app.wait_text(r'Morning mobility class', 20) and app.has_text(r'Strength basics for Core members'), app.text()[:200])
    check('an upcoming row carries its status pill and places line', app.has_text(r'^OPEN$|^Open$') and app.has_text(r'registered'))
    app.click_text('Past')
    check('Past lists the completed session', app.wait_text(r'Posture check-in class', 20))
    app.screenshot('coach-sessions-list')
    # create a draft
    app.click_text('Upcoming')
    check('New session opens the form sheet', app.click_text('New session') and app.wait_text(r'^New session$', 10) and app.has_input('Title'))
    check('form carries the IST date and time fields and the join-link hint', app.has_input('Date (IST)') and app.has_input('Starts (IST)') and app.has_text(r'No video provider is connected, so nothing is created for you'))
    title = 'Walk and talk %s' % TAG
    app.type_into('Title', title)
    app.type_into('Date (IST)', time.strftime('%Y-%m-%d', time.gmtime(time.time() + 9 * 86400)))
    check('Save as draft creates the session and opens it', app.click_text('Save as draft') and app.wait_js("/\\/coach\\/sessions\\/lvs_/.test(location.pathname)", 30) and app.wait_text(r'^%s$' % re.escape(title), 30), app.path())
    check('the web’s “Draft saved” shows on the new session, once', app.wait_text(r'^Draft saved$', 5) and app.wait_js("!/saved=/.test(location.search)", 10), app.js('location.search'))
    sid_new = (app.path() or '').rsplit('/', 1)[-1] if '/coach/sessions/lvs_' in (app.path() or '') else None
    app.page_ok('session detail (new draft)', r'^%s$' % re.escape(title))
    check('the draft notice and the Draft pill show', app.has_text(r'Members cannot see it yet\. Publish it to open registration\.') and app.has_text(r'^DRAFT$|^Draft$'))
    check('details card: host, who can join, places, how to join', app.has_text(r'^The session$') and app.has_text(r'Asha Menon') and app.has_text(r'Members with a live programme') and app.has_text(r'No join link\. No video provider is connected'))
    check('registrations: nobody yet, registration opens when you publish', app.has_text(r'^Nobody yet$') and app.has_text(r'Registration opens when you publish\.'))
    no_contacts(app, 'session detail')
    app.screenshot('coach-session-draft')
    check('Publish opens registration (toast)', app.click_text('Publish') and app.wait_text(r'Published: members in the audience can register', 20))
    check('after publishing the pill reads Open and Add to calendar appears', app.wait_text(r'^OPEN$|^Open$', 15) and app.find_clickable('Add to calendar'))
    app.click_text('Add to calendar')
    app.b.pump(2.0)
    check('Add to calendar fetches the .ics without an error', not app.errors_since() and not app.has_text(r'could not be fetched|Sharing is not available'), '; '.join(app.errors_since()[:2]))
    check('Edit opens the form with the audience fixed', app.click_text('Edit') and app.wait_text(r'^Edit the session$', 10) and app.has_text(r'Fixed once the session is published\.') and app.has_text(r'People who registered are told when the time or the join link changes\.'))
    app.type_into('Join link (optional)', 'https://meet.example.test/walk')
    check('Save keeps the change (toast Saved) and shows the join link', app.click_text('Save') and app.wait_text(r'^Saved$', 20) and app.wait_text(r'link shared by the host', 15))
    check('Cancel session asks for a reason', app.click_text('Cancel session') and app.wait_text(r'^Cancel this session\?$', 10) and app.has_text(r'Everyone registered or waiting is told, with your reason\.'))
    reason_sheet_wording(app, 'Cancel session', 'cancel session sheet')
    app.type_into(REASON, 'Moved to next month')
    check('cancelling records the reason (toast Session cancelled, Cancelled notice)', click_last(app, 'Cancel session') and app.wait_text(r'^Session cancelled$', 20) and app.wait_text(r'Moved to next month', 15))
    app.screenshot('coach-session-cancelled')
    # the completed seeded session with attendance
    api = CTX.get('api')
    done = CTX.get('completed_session')
    if done:
        open_screen(app, '/coach/sessions/%s' % done, r'^Posture check-in class$', 'session detail (completed)')
        check('completed session lists registrations by name with attendance pills', app.has_text(r'^Registrations \(names only\)$') and app.has_text(r'^ATTENDED$|^Attended$') and app.has_text(r'^NO-SHOW$|^No-show$'))
        check('attendance can be changed once started (chips per person)', app.js("!!document.querySelector('[aria-label^=\"Attendance for \"]')"))
        no_contacts(app, 'completed session')
        app.screenshot('coach-session-completed')
    else:
        skip('completed session detail', 'no completed session in the seed')
    if api and sid_new:
        try:
            s = api.get('/coach/sessions/%s' % sid_new)
            check('the API confirms the new session is cancelled with the reason', s.get('status') == 'cancelled' and s.get('cancelledReason') == 'Moved to next month', json.dumps({k: s.get(k) for k in ('status', 'cancelledReason')}))
        except Exception as e:
            check('the API confirms the new session', False, str(e)[:200])


# ---------------------------------------------------------------- announcements
def announcements_section(app):
    print('announcements: /coach/announcements')
    open_screen(app, '/coach/announcements', r'^Announcements$', 'announcements')
    check('sub-title and the audience notice (assigned clients only, service news only)', app.has_text(r'A note to all of your assigned clients at once') and app.wait_text(r'Goes to your 2 assigned clients only\. Service news only', 20))
    check('the seeded announcement is listed as Published with its reach', app.has_text(r'A note from your coach') and app.has_text(r'^PUBLISHED$|^Published$') and app.has_text(r'2 clients · 0 read'))
    check('Send now is disabled until a title and a message are written', app.is_disabled('Send now'))
    app.type_into('Title', 'Working hours next week')
    app.type_into('Message', 'I am away on Friday; consultations move to Thursday.')
    check('Send now sends to the coach’s clients (toast) and lists it', app.click_text('Send now') and app.wait_text(r'^Sent to your clients$', 20) and app.wait_text(r'Working hours next week', 15))
    app.screenshot('coach-announcements')
    check('Withdraw asks for a reason with the web’s wording', app.click_text('Withdraw') and app.wait_text(r'^Withdraw “', 10) and app.has_text(r'It disappears for your clients at once, and the notification it sent loses its text\.'))
    reason_sheet_wording(app, 'Withdraw', 'withdraw sheet')
    app.type_into(REASON, 'Sent by mistake')
    check('withdrawing records the reason (toast Withdrawn, Reason line)', click_last(app, 'Withdraw') and app.wait_text(r'^Withdrawn$', 20) and app.wait_text(r'Reason: Sent by mistake', 15))
    check('the sheet closes on success', wait_gone(app, r'^Reason \(recorded in the audit log\)$', 10))
    # a refusal stays in the sheet: withdraw the next one from Python while its sheet is open, then confirm in the app
    api = CTX.get('api')
    second = 'Clinic closed on Monday %s' % TAG
    app.type_into('Title', second)
    app.type_into('Message', 'The clinic is closed on Monday; messages are answered on Tuesday.')
    check('a second announcement is sent', app.click_text('Send now') and app.wait_text(r'^Sent to your clients$', 20) and app.wait_text(re.escape(second), 15))
    aid = None
    if api:
        try:
            aid = next((a['id'] for a in api.get('/coach/announcements').get('items', []) if a.get('title') == second), None)
        except Exception as e:
            check('the second announcement from the API', False, str(e)[:200])
    opened = bool(app.js("(() => { const t = Array.from(document.querySelectorAll('div,span')).find((e) => !e.children.length && (e.innerText || '').trim() === %s); if (!t) return false; let n = t; for (let i = 0; n && i < 6; i++, n = n.parentElement) { const b = Array.from(n.querySelectorAll('[role=button]')).find((x) => (x.innerText || '').trim() === 'Withdraw'); if (b) { b.click(); return true; } } return false; })()" % json.dumps(second)))
    if aid and opened and app.wait_text(r'^Withdraw “%s”\?$' % re.escape(second), 10):
        st, j, _ = ah.api(BASE, 'POST', '/coach/announcements/%s/withdraw' % aid, {'reason': 'Withdrawn from another device'}, token=api.token)
        check('the announcement is withdrawn behind the open sheet (API)', st == 200, '%s %s' % (st, json.dumps(j)[:160]))
        app.type_into(REASON, 'Sent twice')
        check('the server’s refusal stays inside the sheet, which stays open', click_last(app, 'Withdraw') and app.wait_text(r'already withdrawn', 15) and app.has_text(r'^Withdraw “%s”\?$' % re.escape(second)) and app.find_clickable('Keep as is'), app.text()[-200:])
        check('Keep as is closes the sheet', app.click_text('Keep as is') and wait_gone(app, r'^Reason \(recorded in the audit log\)$', 10))
    else:
        check('the second announcement’s Withdraw opens its sheet', False, 'id %s, opened %s' % (aid, opened))
    no_contacts(app, 'announcements')


# ---------------------------------------------------------------- Coach AI
def ai_section(app):
    print('ai: /coach/ai')
    open_screen(app, '/coach/ai', r'^Coach AI$', 'coach ai page')
    check('sub-title and the How it works card', app.has_text(r'Nothing is sent to a client: you accept a draft and send it yourself\.') and app.has_text(r'^You stay in charge$') and app.has_text(r'Drafts are never sent\. You edit, accept and send them yourself\.'))
    check('not configured: the warning names what is missing', app.wait_text(r'^Coach AI is not configured$', 20) and app.has_text(r'An AI provider and model, chosen by the owner') and app.has_text(r'A signed data-processing agreement'))
    check('no drafts yet, kept-for wording is the owner decision, prompt version', app.has_text(r'^No drafts yet$') and app.has_text(r'Drafts appear here once Coach AI is configured\.') and app.has_text(r'How long drafts are kept is still an owner decision\. Prompt version coach-ai-draft-v1\.'))
    check('the request card for no client', app.has_text(r'^Ask for a draft \(no client\)$') and app.has_text(r'^What should Coach AI draft\?$') and app.has_text(r'Up to \d+ requests an hour\. Drafts are never sent to the client\.'))
    check('choosing a client opens the picker', app.click_text('Client') and app.wait_text(r'Ananya Rao · BPM-00001', 10))
    app.click_text('Ananya Rao · BPM-00001')
    check('the client card: consent given under the draft wording, health records shared', app.wait_text(r'^Coach AI consent$', 20) and app.has_text(r'under the draft wording, pending review by counsel') and app.has_text(r'Shared: logged values and check-in answers can be included') and app.has_text(r'Phone, email, address, PIN code, date of birth\.'))
    check('the purposes are offered as choices', app.click_text('Reply to a message') and app.wait_text(r'Uses the last messages of your conversation \(2 so far\)\.', 10))
    check('asking is refused while not configured, with the web’s refusal wording', app.click_text('Ask for a draft') and app.wait_text(r'^Request refused$', 20) and app.has_text(r'Coach AI is not configured, so nothing was generated\.'))
    no_contacts(app, 'coach ai')
    app.screenshot('coach-ai')


# ---------------------------------------------------------------- help
def help_section(app):
    print('help: /coach/help, an article, a request')
    open_screen(app, '/coach/help', r'^Help$', 'help home')
    check('sub-title and the onboarding checklist', app.has_text(r'Articles for coaches, your questions to the Bioptime team, and your onboarding checklist\.') and app.wait_text(r'^You are set up$|^\d of \d done$', 20) and app.has_text(r'Complete your profile'))
    check('the training note while no coach course is published', app.has_text(r'No training courses for coaches are published yet'))
    check('tabs Help articles and My requests', app.find_clickable('Help articles') and app.find_clickable('My requests'))
    check('articles grouped by category', app.wait_text(r'^Coaching on Bioptime$', 20) and app.has_text(r'Setting your working hours') and app.has_text(r'^Using Bioptime$'))
    count_fetches(app)
    check('help: pull to refresh reloads the checklist and the open tab’s articles', pull_to_refresh(app, r'^Help$') and fetched(app, r'/api/coach/onboarding') and fetched(app, r'/api/help/articles'), json.dumps(app.js('window.__e2eFetches'))[:300])
    app.type_into('Search the articles', 'working')
    check('the search narrows the articles', app.wait_text(r'Setting your working hours', 5) and wait_gone(app, r'Asking the Bioptime team for help', 5))
    app.type_into('Search the articles', 'zzzz')
    check('no match wording', app.wait_text(r'^No article matches$', 5) and app.has_text(r'Try another word, or ask the team under My requests\.'))
    app.type_into('Search the articles', '')
    app.screenshot('coach-help')
    check('an article opens', app.click_text('Setting your working hours', exact=False) and app.wait_text(r'^Setting your working hours$', 30))
    app.page_ok('help article', r'^Setting your working hours$')
    check('article shows category, updated date, text and the way to ask the team', app.has_text(r'Coaching on Bioptime · updated') and app.has_text(r'Open Settings and set your weekly working hours') and app.has_text(r'Not what you needed\?') and app.find_clickable('All articles'))
    check('article formatting is drawn natively: bold run and a bulleted list, no markup', bool(app.js("(() => { const b = Array.from(document.querySelectorAll('div,span')).find((e) => !e.children.length && (e.innerText || '').trim() === 'Settings' && e.offsetParent !== null); return !!b && Number(getComputedStyle(b).fontWeight) >= 700; })()")) and app.has_text(r'^•$') and app.has_text(r'^Mark yourself away, with a reason, to pause your assignments\.$') and not app.has_text(r'<(p|ul|li|strong)>'))
    app.screenshot('coach-help-article')
    open_screen(app, '/coach/help?tab=requests', r'^Help$', 'help requests tab')
    count_fetches(app)
    check('help, My requests: pull to refresh reloads the checklist and the requests', pull_to_refresh(app, r'^Help$') and fetched(app, r'/api/coach/onboarding') and fetched(app, r'/api/support-requests'), json.dumps(app.js('window.__e2eFetches'))[:300])
    check('My requests lists the seeded request with its status', app.wait_text(r'SUP-0902', 20) and app.has_text(r'Change the email on my coach account') and app.has_text(r'^WITH THE TEAM$|^With the team$'))
    check('the request opens with its thread', app.click_text('Change the email on my coach account', exact=False) and app.wait_text(r'^Change the email on my coach account$', 30) and app.has_text(r'SUP-0902 · Account and sign-in · opened'))
    app.page_ok('support request', r'^Change the email on my coach account$')
    app.type_into('Write to the Bioptime team', 'Thanks. The new address is in my profile already.')
    check('a reply is sent and shows in the thread', app.click_text('Send') and app.wait_text(r'The new address is in my profile already\.', 20))
    no_contacts(app, 'support request')
    app.screenshot('coach-help-request')
    open_screen(app, '/coach/help?tab=requests', r'^Help$', 'help requests tab (again)')
    check('New request opens the sheet', app.click_text('New request') and app.wait_text(r'^Ask the Bioptime team$', 10) and app.has_text(r'For a medical emergency call 112\.'))
    check('Payments and orders is not offered to a coach', not app.find_clickable('Payments and orders') and app.find_clickable('Coaching'))
    app.click_text('Coaching')
    subject = 'A question about scope %s' % TAG
    app.type_into('Subject', subject)
    app.type_into('What happened', 'A client asked me about supplements; what may I say within my coaching scope?')
    sent = click_last(app, 'Send')
    check('sending creates the request and opens it', sent and app.wait_js("/\\/coach\\/help\\/requests\\/sup_/.test(location.pathname)", 30) and app.wait_text(r'^%s$' % re.escape(subject), 30) and app.wait_text(r'· Coaching · opened', 10), app.path())


# ---------------------------------------------------------------- discovery calls
def discovery_section(app):
    print('discovery: /coach/discovery-calls')
    open_screen(app, '/coach/discovery-calls', r'^Discovery calls$', 'discovery calls')
    check('sub-title says the contact details stay with the team', app.has_text(r'their contact details stay with the team\.'))
    check('the assigned call shows reference, name, goals, status and suggested times', app.wait_text(r'DC-1002', 20) and app.has_text(r'Arjun Pillai') and app.has_text(r'Training for a first half marathon') and app.has_text(r'^CONTACTED$|^Contacted$') and app.has_text(r'Times they suggested') and app.has_text(r'Weekday evenings after 7pm'))
    no_contacts(app, 'discovery calls')
    app.screenshot('coach-discovery-calls')


# ---------------------------------------------------------------- client record module tabs
TABS = [
    ('habits', 'Habits', r'^Due days checked in as done$', r'Evening walk'),
    ('goals', 'Goals and check-ins', r'^Set a goal for the client$', r'Walk after dinner on weekdays'),
    ('nutrition', 'Nutrition', r'^Meal log$', r'Regular meals'),
    ('workouts', 'Workouts', r'^Workout programmes$', r'Three-week full body'),
    ('lab-follow-ups', 'Lab next steps', r'^Add a next step$', r'Retest'),
    ('sessions', 'Sessions', r'^Summaries for the client$', r'Morning mobility class'),
    ('learning', 'Learning', r'^Courses and progress$', r'Getting started with courses'),
    ('ai', 'Coach AI', r'^Coach AI consent$', r'Ask for a draft'),
]


# what each tab requests again when the record screen is pulled to refresh (besides the record, GET /coach/clients/:id)
TAB_REFRESH = {
    'habits': [r'/coach/clients/{m}/habits'],
    'goals': [r'/coach/clients/{m}/goals', r'/coach/clients/{m}/checkins'],
    'nutrition': [r'/coach/clients/{m}/nutrition'],
    'workouts': [r'/coach/clients/{m}/workouts'],
    'lab-follow-ups': [r'/coach/clients/{m}/lab-follow-ups'],
    'sessions': [r'/coach/clients/{m}/sessions'],
    'learning': [r'/coach/clients/{m}/learning'],
    'ai': [r'/coach/ai/status\?memberId={m}', r'/coach/ai/drafts\?memberId={m}'],
}


def open_tab(app, member_id, tab_id, tab_label, expect, seconds=45):
    """The record screen with ?tab=; when the screen ignores the parameter, the tab is pressed by its label."""
    app.open_route('/coach/clients/%s?tab=%s' % (member_id, tab_id), None, seconds)
    if app.has_text(ah.NO_SUCH_SCREEN):
        return 'missing'
    if app.wait_text(expect, 15):
        return 'ok'
    if app.wait_clickable(tab_label, 15) and app.click_text(tab_label) and app.wait_text(expect, 20):
        return 'ok'
    return 'no'


def tabs_section(app):
    print('tabs: the module tabs on the client record')
    member = CTX.get('ananya')
    if not member:
        skip('client record module tabs', 'no client id from the API')
        return
    first = open_tab(app, member, TABS[0][0], TABS[0][1], TABS[0][2])
    if first == 'missing':
        skip('client record module tabs', 'not built yet: /coach/clients/[id] (another group’s screen hosts the tabs)')
        return
    for tab_id, tab_label, expect, detail in TABS:
        got = open_tab(app, member, tab_id, tab_label, expect)
        check('tab %s (%s) renders its heading' % (tab_id, tab_label), got == 'ok', app.text()[:160])
        if got != 'ok':
            continue
        app.page_ok('tab %s' % tab_id, expect)
        check('tab %s shows the seed’s data: %s' % (tab_id, detail), app.has_text(detail))
        count_fetches(app)
        pulled = pull_to_refresh(app, expect)
        want = [r'/api/coach/clients/%s($|\?)' % member] + [r'/api' + rx.format(m=member) for rx in TAB_REFRESH[tab_id]]
        check('tab %s: pull to refresh reloads the record and the tab’s own data' % tab_id, pulled and all(fetched(app, rx) for rx in want), json.dumps(app.js('window.__e2eFetches'))[:300])
        no_labels(app, 'tab ' + tab_id)
        no_contacts(app, 'tab ' + tab_id)
        app.screenshot('coach-tab-' + tab_id)
    # actions on two of them
    if open_tab(app, member, 'habits', 'Habits', TABS[0][2]) == 'ok':
        check('habits: the follow-up threshold card and the adherence table', app.has_text(r'^Off$|^After \d+ missed day') and app.has_text(r'Week of'))
        check('habits: Set a habit opens the sheet', app.click_text('Set a habit') and app.wait_text(r'^Set a habit$', 10) and app.has_input('Habit'))
        check('habits: Set habit stays disabled until a title is written', app.is_disabled('Set habit'))
        app.type_into('Habit', 'Ten minutes of mobility')
        check('habits: Set habit creates it (toast) and lists it', app.click_text('Set habit') and app.wait_text(r'Habit set; the client is told in the app', 20) and app.wait_text(r'Ten minutes of mobility', 15))
        check('habits: a coach-set habit offers Edit, Pause and Archive', app.find_clickable('Pause') and app.find_clickable('Archive'))
        check('habits: Archive opens the reason sheet with the web’s wording', app.click_text('Archive') and app.wait_text(r'^Archive “', 10) and app.has_text(r'It stops running for the client and leaves their list\. Their check-ins stay in the record\.'))
        reason_sheet_wording(app, 'Archive', 'habit archive sheet')
        check('habits: Keep as is closes the sheet without archiving', app.click_text('Keep as is') and wait_gone(app, r'^Reason \(recorded in the audit log\)$', 10))
    if open_tab(app, member, 'goals', 'Goals and check-ins', TABS[1][2]) == 'ok':
        check('goals: the weekly check-in line and the check-in cards', app.has_text(r'Every Friday: “Weekly check-in”, set by Asha Menon') and app.has_text(r'^Waiting for answers$|^WAITING FOR ANSWERS$') and app.has_text(r'^Reviewed$|^REVIEWED$|^Sent, not reviewed$|^SENT, NOT REVIEWED$'))
        check('goals: the measured-by choice and the trends card show while the client shares', app.has_text(r'Measured by') and app.has_text(r'^Over a chosen range$') and app.has_text(r'^Due and done$'))
        goal = 'Sleep seven hours on weeknights %s' % TAG
        app.type_into('Goal', goal)
        check('goals: Set the goal creates it (toast)', app.click_text('Set the goal') and app.wait_text(r'Goal set; the member was told', 20) and app.wait_text(re.escape(goal), 15))
        if app.find_clickable('Review'):
            check('goals: Review opens the review sheet for the sent check-in', app.click_text('Review') and app.wait_text(r'^Review: Weekly check-in$', 10) and app.has_input('Reply to the member (optional)'))
            app.type_into('Reply to the member (optional)', 'Good week. Keep the earlier dinner.')
            check('goals: Send the reply saves the review (toast)', app.click_text('Send the reply') and app.wait_text(r'Review saved; the member was told', 20) and app.wait_text(r'Good week\. Keep the earlier dinner\.', 15))
        else:
            skip('goals: review a sent check-in', 'no check-in waiting for review (an earlier run reviewed it)')
    if open_tab(app, member, 'lab-follow-ups', 'Lab next steps', TABS[4][2]) == 'ok':
        check('lab next steps: open steps with Mark done and the report link', app.has_text(r'^\d open$') and app.find_clickable('Mark done') and app.has_text(r'Full Body Checkup, Advanced · BIO-24001'))
        check('lab next steps: Cancel opens the reason sheet with the web’s wording', app.click_text('Cancel') and app.wait_text(r'^Cancel this next step$', 10) and app.has_text(r'The member no longer sees a cancelled next step\. The reason is kept with it\.'))
        reason_sheet_wording(app, 'Cancel it', 'next step cancel sheet')
        check('lab next steps: Keep as is closes the sheet', app.click_text('Keep as is') and wait_gone(app, r'^Reason \(recorded in the audit log\)$', 10))
        # "Its report" on a next step linked to a retest booking that has its report (the seed has none: opportunistic)
        linked = None
        try:
            items = CTX['api'].get('/coach/clients/%s/lab-follow-ups' % member).get('items', [])
            linked = next((f for f in items if (f.get('booking') or {}).get('reportId')), None)
        except Exception as e:
            check('lab next steps from the API', False, str(e)[:200])
        if linked:
            rid = linked['booking']['reportId']
            check('lab next steps: a linked booking with its report shows “Its report”', app.find_clickable('Its report', exact=True) or bool(app.js("Array.from(document.querySelectorAll('[role=link]')).some((e) => (e.innerText || '').trim() === 'Its report')")))
            clicked = bool(app.js("(() => { const e = Array.from(document.querySelectorAll('[role=link],div,span')).find((x) => !x.children.length && (x.innerText || '').trim() === 'Its report'); if (!e) return false; e.click(); return true; })()"))
            check('lab next steps: “Its report” opens /coach/reports/%s' % rid, clicked and app.wait_js("location.pathname === '/coach/reports/%s'" % rid, 20), app.path())
        else:
            skip('lab next steps: “Its report”', 'no next step is linked to a booking with a report in this database')
    if open_tab(app, member, 'nutrition', 'Nutrition', TABS[2][2]) == 'ok':
        check('nutrition: preferences in the client’s words and the 14-day readout', app.has_text(r'Vegetarian') and app.has_text(r'Avoids peanuts \(avoid\)') and app.has_text(r'^Last 14 days$') and app.has_text(r'planned meals logged as planned or swapped'))
        check('nutrition: Feedback opens the sheet', app.click_text('Feedback') and app.wait_text(r'^Feedback on this meal$', 10) and app.has_text(r'no medical or supplement advice'))
        app.type_into('Your feedback (the client reads it under Nutrition)', 'Nice choice for an evening snack.')
        check('nutrition: Send to the client sends the feedback (toast)', app.click_text('Send to the client') and app.wait_text(r'Feedback sent to the client', 20))
    if open_tab(app, member, 'workouts', 'Workouts', TABS[3][2]) == 'ok':
        check('workouts: a logged session offers Review', app.find_clickable('Review'))
        check('workouts: Review opens the session with sets and effort', app.click_text('Review') and app.wait_text(r'self-rated|Not rated', 20) and app.has_text(r'Set 1: ') and app.has_input('Feedback for the client'))
        app.click_text('Close')


NOT_SHARED = [
    ('habits', 'Habits', r'^Health information not shared$', r'Habits the client added themselves, and their check-in notes, stay private'),
    ('goals', 'Goals and check-ins', r'^Health records not shared$', r'values, answers, trends and photos stay hidden until the member turns on sharing'),
    ('nutrition', 'Nutrition', r'^Meal log and preferences are private$', r'You still see the plans you wrote\.'),
    ('workouts', 'Workouts', r'^Workout logs not shared$', r'Sets, effort, duration and notes appear once the client turns on sharing'),
    ('lab-follow-ups', 'Lab next steps', r'^Not shared$', r'Next steps come from the client’s reports, which stay private'),
    ('learning', 'Learning', r'^Only the courses coaches assigned$', r'nothing about courses they chose themselves'),
    ('ai', 'Coach AI', r'^Health records$', r'Not shared: no values or check-in answers are included'),
]


def notshared_section(app):
    """Meera's client Deepa does not share health records: every tab that needs them says so with the web's wording."""
    print('notshared: Deepa (does not share) as Meera')
    ok, d = app.sign_out()
    check('Asha signs out before the second coach signs in', ok, d)
    r = app.sign_in('coach', *COACH2)
    check('Meera signs in through the coach sign-in', r['ok'], r['detail'])
    if not r['ok']:
        return
    try:
        api2 = ah.ApiSession(BASE).login(COACH2[0], COACH2[1], 'coach')
        clients = api2.get('/coach/clients?limit=100&sort=name').get('items', [])
        deepa = next((c['id'] for c in clients if c.get('name') == 'Deepa Krishnan'), None)
        api2.logout()
    except Exception as e:
        check('Meera’s clients from the API', False, str(e)[:200])
        return
    if not deepa:
        skip('not-shared tabs', 'Deepa is not among Meera’s clients')
        return
    for tab_id, tab_label, title, body in NOT_SHARED:
        got = open_tab(app, deepa, tab_id, tab_label, title)
        check('not shared, tab %s: the web’s notice' % tab_id, got == 'ok' and app.has_text(body), app.text()[:160])
        if got == 'ok':
            app.page_ok('not shared, tab %s' % tab_id, title)
            no_contacts(app, 'not shared, tab ' + tab_id)
    app.screenshot('coach-tab-not-shared')
    check('not shared, nutrition: the plans the coach wrote still show', open_tab(app, deepa, 'nutrition', 'Nutrition', r'^Meal log and preferences are private$') == 'ok' and app.has_text(r'^No meal plan yet$|plan'))
    check('not shared, workouts: sessions offer Open, not Review', open_tab(app, deepa, 'workouts', 'Workouts', r'^Workout logs not shared$') == 'ok' and not app.find_clickable('Review'))


SECTIONS = {'notshared': notshared_section, 'sessions': sessions_section, 'announcements': announcements_section, 'ai': ai_section, 'help': help_section, 'discovery': discovery_section, 'tabs': tabs_section}


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4211 (never the live demo).')
    why = ah.live_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server.' % (BASE, why))
    why = ah.port_refusal(APP_PORT) if not APP_URL else ah.live_refusal(APP_URL)
    if why:
        sys.exit('Refusing the app server %s: %s.' % (APP_URL or APP_PORT, why))
    only = [s.strip() for s in os.environ.get('E2E_ONLY', '').split(',') if s.strip()] or list(DEFAULT_SECTIONS)
    unknown = [s for s in only if s not in SECTIONS]
    if unknown:
        sys.exit('E2E_ONLY names unknown sections %s; the sections are %s' % (unknown, ', '.join(SECTION_NAMES)))
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
        # record ids from Python (one sign-in), so the screens open the seed's own records
        api = ah.ApiSession(BASE).login(COACH[0], COACH[1], 'coach')
        CTX['api'] = api
        clients = api.get('/coach/clients?limit=100&sort=name').get('items', [])
        CTX['ananya'] = next((c['id'] for c in clients if c.get('name') == 'Ananya Rao'), clients[0]['id'] if clients else None)
        sessions = api.get('/coach/sessions?range=all').get('items', [])
        CTX['completed_session'] = next((s['id'] for s in sessions if s.get('status') == 'completed'), None)
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
        check('the app draws its first screen', app.has_text(ah.SIGN_IN_SCREEN), '%.1fs, at %s' % (took, app.path()))
        r = app.sign_in('coach', *COACH)
        check('Asha signs in through the coach sign-in (one sign-in for the run)', r['ok'], r['detail'])
        if r['ok']:
            for name in only:
                t1 = time.monotonic()
                try:
                    SECTIONS[name](app)
                except Exception as e:
                    traceback.print_exc()
                    check('section %s completed without an unexpected error' % name, False, repr(e)[:300])
                timings[name] = round(time.monotonic() - t1, 1)
                print('  (%s took %.0fs)' % (name, timings[name]))
            ok, d = app.sign_out()
            check('the coach signs out', ok, d)
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
        if expo:
            expo.stop()
        if CTX.get('api'):
            try:
                CTX['api'].logout()
            except Exception:
                pass
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
