#!/usr/bin/env python3
"""End-to-end check of the coach workspace core, part A, of the app (apps/mobile: Today, the Clients list, the client
record with its seven core tabs, the module tabs and the two dialogs, the plan editor and its Coach AI draft in place)
through its Expo web build in headless Chrome at 390x844 (Python 3.9, stdlib, Google Chrome), on the shared harness
tools/app_harness.py.

    BASE=http://127.0.0.1:4341 python3 -I tools/e2e_app_coach_core.py                 against a scratch API; Expo web on APP_PORT
    BASE=… APP_URL=http://localhost:9341 E2E_APP_ONLY=today,record python3 -I tools/e2e_app_coach_core.py
    BASE=… APP_URL=… E2E_AS=meera python3 -I tools/e2e_app_coach_core.py             the "not shared" client (Deepa)
    BASE=… APP_URL=… E2E_DB=<scratch>/db.sqlite python3 -I tools/e2e_app_coach_core.py   also accept a Coach AI draft

BASE is the scratch API (required), started with CORS_ORIGINS=http://localhost:<APP_PORT> (the usual recipe: reset-demo,
then src/server.ts on its own port). The check starts `npx expo start --web --port <APP_PORT> --clear` for apps/mobile
with EXPO_PUBLIC_API_BASE=<BASE> in its own process group and stops it at the end (APP_PORT default 9341; APP_URL drives a
server that is already running instead). As the other e2e scripts: the live demo's ports (3000, 3100, 3101 and the Expo
default 8081) are refused for BASE and APP_PORT, BASE must be an explicit port on 127.0.0.1, localhost, *.localhost or
*.test, and E2E_OUT (screenshots, report.json, the Expo log and the Chrome profile; default .local/e2e/app-coach-core/)
and E2E_CDP_PORT (default 9741) keep parallel runs apart.

One sign-in per run. By default Asha (the seeded coach, whose clients Ananya and Priya share their health records)
through the coach sign-in, running today, refresh, clients, record, plan and ai; with E2E_AS=meera, Meera instead, running the
"withheld" section on Deepa, who does not share. Every screen is reached in-app and record ids come from the screens
themselves. Each screen is checked for the portal's wording, raises no console error, is not the not-found screen, shows
no error box and no "demo" / "sample" label, and never shows a member's email or phone number; the main actions are
exercised against the scratch data (a note private and to the member, a follow-up, a progress value, a consultation
scheduled on the next working day, a plan saved with a validation error first, then saved and published).

Today's module cards load again with the home payload: "refresh" calls Today's pull to refresh (its onRefresh, through
React's props: a web page has no pull gesture) and checks that every card's endpoint is asked again, then changes a lab
next step from the record (opened from Today's card, and from the Clients tab) and checks Today's card when Today comes
back into view; it ends with the data as it found it.

Coach AI: the scratch server's AI_PROVIDER is "none", so asking for a draft is refused ("Request refused") and no draft
is ever generated (the request still carries the plan chosen under "Start from a plan"). With E2E_DB naming the scratch server's SQLite file (refused unless it sits outside the platform
tree and the live database), ready drafts are written into ai_drafts as test fixtures, so the accept path is exercised:
the coach edits an outline, accepts it, the text lands in the summary field only, the plan on the server is unchanged
until "Save draft", and the saved draft then carries it; the toasts (accepted, discarded, a refusal for Priya, who has
no Coach AI consent) are seen in the window, and in a Messages thread an accepted reply's toast shows under its button.

The part B screens of the coach workspace (notifications, calendar, messages, bloodwork, report, profile, settings;
group coach-core-b) keep their sections here from the first round; they run only when named in E2E_APP_ONLY.
The sign-in limit is about 20 per 10 minutes per scratch server, shared with anything else signing in there. Exit status
1 if anything fails; the JSON summary is the last line."""
import datetime
import json
import os
import re
import sqlite3
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
APP_PORT = os.environ.get('APP_PORT') or '9341'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-coach-core')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9741'
E2E_AS = (os.environ.get('E2E_AS') or 'asha').strip().lower()
E2E_DB = os.environ.get('E2E_DB') or ''
COACHES = {'asha': ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!'), 'meera': ('meera.iyer@demo.bioptime.test', 'Demo-Coach-2026!')}
DEFAULT_SECTIONS = {'asha': ('today', 'refresh', 'clients', 'record', 'plan', 'ai'), 'meera': ('withheld',)}
PART_B = ('notifications', 'calendar', 'messages', 'bloodwork', 'report', 'profile', 'settings')
SECTION_NAMES = ('today', 'refresh', 'clients', 'record', 'plan', 'ai', 'withheld') + PART_B
COACH_TABS = ['Today', 'Clients', 'Calendar', 'Messages', 'More']
RECORD_TABS = ['Overview', 'Plan', 'Bloodwork', 'Appointments', 'Progress', 'Habits', 'Goals and check-ins', 'Nutrition', 'Workouts', 'Lab next steps', 'Sessions', 'Learning', 'Coach AI', 'Messages', 'Notes']
# one line each module tab draws with the seed's data (the module groups' screens; this file only checks they mount here)
MODULE_TAB_TEXT = {'Habits': r'Due days checked in as done|Set a habit', 'Goals and check-ins': r'Set a goal for the client', 'Nutrition': r'New meal plan', 'Workouts': r'Workout programmes',
                   'Lab next steps': r'Lab next steps', 'Sessions': r'Summaries for the client', 'Learning': r'Courses and progress', 'Coach AI': r'Coach AI is not configured|Ask for a draft'}
ANANYA = 'Ananya Rao'
PRIYA = 'Priya Nair'
DEEPA = 'Deepa Krishnan'


# the harness builds a RegExp from has_text's argument: plain sentences with brackets or dots are escaped here
def rx(s):
    return re.escape(s)


def plain(app, name, *sentences):
    """Every sentence appears on the screen (as plain text, escaped)."""
    for s in sentences:
        check('%s shows %r' % (name, s), app.has_text(rx(s)), app.text()[:160])


def no_labels(app, name):
    hit = app.label_hit()
    check('%s carries no demo or sample label' % name, not hit, hit)


def no_contact_details(app, name):
    check('%s never shows a member email or phone number' % name, not app.has_text(r'(ananya|priya|rahul|meera|deepa|dev)[a-z.]*@demo\.bioptime\.test|\+91\d'), app.text()[:120])


def next_working_day(days_ahead=2):
    """A date (IST, YYYY-MM-DD) at least `days_ahead` days out that falls Monday to Friday: the seeded working hours."""
    d = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30) + datetime.timedelta(days=days_ahead)
    while d.weekday() > 4:
        d += datetime.timedelta(days=1)
    return d.strftime('%Y-%m-%d')


def click_last(app, text):
    """Press the last control reading `text` (a sheet's footer button under a card button of the same name)."""
    return bool(app.js("(() => { const els = Array.from(document.querySelectorAll('[role=button]')).filter((e) => (e.innerText||'').replace(/\\s+/g,' ').trim() === %s); const el = els.pop(); if (!el) return false; el.click(); return true; })()" % json.dumps(text)))


RECORD_TABS_JS = r"""(() => { const norm = (s) => (s || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim().replace(/ \d+$/, '');
  const all = Array.from(document.querySelectorAll('[role=tab]')).filter((e) => e.offsetParent !== null).map((e) => norm(e.innerText));
  const i = all.indexOf('Overview'); return i < 0 ? [] : all.slice(i, i + %d); })()"""
# the selected segment carries the brand-red bar under its label (components/workspace SegmentTabs; React Native Web
# writes no aria-selected for it)
SELECTED_TAB_JS = r"""(() => { const red = 'rgb(238, 51, 36)';
  const el = Array.from(document.querySelectorAll('[role=tab]')).filter((e) => e.offsetParent !== null)
    .find((e) => Array.from(e.querySelectorAll('div')).some((d) => getComputedStyle(d).backgroundColor === red && d.offsetHeight > 0 && d.offsetHeight <= 4));
  return el ? (el.innerText || '').replace(/\s+/g, ' ').trim().replace(/ \d+$/, '') : null; })()"""
# an element showing exactly this text is inside the visible part of the window (a toast floating over the screen)
IN_VIEW_JS = r"""((t) => { const els = Array.from(document.querySelectorAll('div,span')).filter((e) => (e.innerText || '').trim() === t);
  return els.some((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }); })(%s)"""


# the same, for a pattern (an error toast whose wording comes from the server)
IN_VIEW_RX_JS = r"""((src) => { const re = new RegExp(src, 'i'); const els = Array.from(document.querySelectorAll('div,span')).filter((e) => e.children.length === 0 && re.test((e.innerText || '').trim()));
  return els.some((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }); })(%s)"""
# every request the app makes from now on (url, method, body), kept in the page: the fetch the app's api module calls
FETCH_LOG_JS = r"""(() => { if (!window.__e2eFetchWrapped) { window.__e2eFetchWrapped = true; const of = window.fetch.bind(window);
  window.fetch = (u, o) => { try { (window.__e2eFetch = window.__e2eFetch || []).push({ url: String((u && u.url) || u).replace(/^https?:\/\/[^/]+\/api/, ''), method: (o && o.method) || 'GET', body: o && typeof o.body === 'string' ? o.body : null }); } catch (e) { /* keep the request going */ } return of(u, o); }; }
  window.__e2eFetch = []; return true; })()"""
# a web page has no pull gesture: call the visible screen's RefreshControl onRefresh, as a pull would
PULL_JS = r"""(() => { const vis = Array.from(document.querySelectorAll('div')).filter((d) => d.offsetParent !== null);
  for (const el of vis) { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); if (!k) continue;
    for (let f = el[k], i = 0; f && i < 8; f = f.return, i++) { const rc = f.memoizedProps && f.memoizedProps.refreshControl;
      if (rc && rc.props && typeof rc.props.onRefresh === 'function') { rc.props.onRefresh(); return true; } } }
  return false; })()"""
# Today's "Lab next steps" card title: "{n} open[ · {m} past due]" or "Nothing open" (null while it is not drawn)
LAB_COUNT_JS = r"""(() => { const m = document.body.innerText.match(/^(\d+) open(?: · \d+ past due)?$|^Nothing open$/m); return m ? (m[1] ? Number(m[1]) : 0) : null; })()"""
TODAY_CARD_GETS = ['/coach/home', '/coach/checkins?status=submitted', '/coach/onboarding', '/coach/workouts/recent', '/coach/lab-follow-ups', '/coach/consultation-follow-through']


def record_tabs(app):
    return app.js(RECORD_TABS_JS % len(RECORD_TABS)) or []


def selected_tab(app):
    return app.js(SELECTED_TAB_JS)


def in_view(app, text):
    return bool(app.js(IN_VIEW_JS % json.dumps(text)))


def wait_in_view(app, text, seconds=15):
    return app.wait_js(IN_VIEW_JS % json.dumps(text), seconds)


def wait_in_view_rx(app, pattern, seconds=15):
    return app.wait_js(IN_VIEW_RX_JS % json.dumps(pattern), seconds)


def fetch_log_start(app):
    return bool(app.js(FETCH_LOG_JS))


def fetched(app):
    return app.js("(window.__e2eFetch || []).slice()") or []


def lab_count(app):
    return app.js(LAB_COUNT_JS)


def wait_lab_count(app, n, seconds=20):
    return app.wait_js('(%s) === %d' % (LAB_COUNT_JS, n), seconds)


def press_tab(app, label):
    """Press the visible tab bar tab reading `label` (Today, Clients, …)."""
    return bool(app.js("(() => { const el = Array.from(document.querySelectorAll('[role=tab]')).filter((e) => e.offsetParent !== null).find((e) => (e.innerText || '').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g, ' ').trim().replace(/^\\d+ /, '') === %s); if (!el) return false; el.click(); return true; })()" % json.dumps(label)))


def right_edge(app, text):
    """The right edge (px) of the widest visible element reading exactly `text` (case-insensitive: pills are drawn in
    capitals), or None."""
    return app.js("((t) => { const els = Array.from(document.querySelectorAll('div')).filter((e) => e.offsetParent !== null && (e.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() === t.toLowerCase()); if (!els.length) return null; return Math.max(...els.map((e) => e.getBoundingClientRect().right)); })(%s)" % json.dumps(text))


def press_near(app, text, button):
    """Press the control reading `button` in the same card or row as the text `text` (several plans each have a
    "Revise"; several drafts each have an "Open draft"). Returns True when it was pressed."""
    return bool(app.js("""((t, b) => { const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      let el = Array.from(document.querySelectorAll('div')).filter((d) => d.offsetParent !== null).find((d) => norm(d.innerText) === t);
      const btn = (e) => Array.from(e.querySelectorAll('[role=button],[role=link]')).find((x) => norm(x.innerText) === b);
      while (el && !btn(el)) el = el.parentElement;
      const hit = el && btn(el); if (!hit) return false; hit.scrollIntoView({ block: 'center' }); hit.click(); return true; })(%s, %s)""" % (json.dumps(text), json.dumps(button))))


def open_client(app, name):
    """From the Clients tab, open a client's record; returns their user id ('' when it did not open)."""
    app.open_route('/(coach)/clients', r'^My clients$', 40)
    app.wait_text(name, 20)
    app.click_text('Open ' + name)
    opened = app.wait_text(r'^%s$' % name, 40) and app.wait_js("/^\\/coach\\/clients\\/usr_/.test(location.pathname)", 10)
    app.settled(15)
    return app.js("(location.pathname.match(/usr_[a-z0-9]+/)||[''])[0]") if opened else ''


# ---------------------------------------------------------------- the E2E_DB fixture (Coach AI)
def scratch_db():
    """The scratch server's SQLite file named by E2E_DB, refused when it is inside the platform tree (where the live
    demo keeps its database) or missing. Returns (path, None) or (None, why)."""
    if not E2E_DB:
        return None, 'E2E_DB is not set'
    p = os.path.realpath(E2E_DB)
    if p.startswith(os.path.realpath(ah.PLATFORM) + os.sep):
        return None, 'E2E_DB is inside the platform tree; only a scratch database outside it is written to'
    if not os.path.isfile(p):
        return None, 'no file at %s' % p
    return p, None


def seed_ready_outline(db, coach_email, member_id, text, purpose='plan_outline'):
    """One ready draft (a plan outline unless `purpose` says otherwise) for this coach and client, as a provider would
    leave it (test fixture: the scratch server's provider is "none", so no draft is ever generated there)."""
    con = sqlite3.connect(db, timeout=10)
    try:
        coach = con.execute('SELECT id FROM users WHERE email = ?', (coach_email,)).fetchone()
        if not coach:
            return None
        now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
        did = 'aid_e2e%d' % int(time.time() * 1000)
        time.sleep(0.002)  # two fixtures in a row keep distinct ids
        scope = {'client': True, 'messages': 3 if purpose == 'message_reply' else 0, 'plan': purpose != 'message_reply', 'checkin': False, 'checkinAnswers': False, 'health': False, 'progressValues': 0}
        con.execute("INSERT INTO ai_drafts (id, coach_id, member_id, purpose, input_refs, context_scope, prompt_version, provider, model, status, output, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', ?, 'coach-ai-draft-v1', 'e2e-fixture', 'e2e-fixture', 'ready', ?, ?, ?)",
                    (did, coach[0], member_id, purpose, json.dumps(scope), text, now, now))
        con.commit()
        return did
    finally:
        con.close()


def plan_summary_on_server(db, plan_id):
    """The summary of the plan's newest version as the server stores it (read-only)."""
    con = sqlite3.connect(db, timeout=10)
    try:
        r = con.execute('SELECT summary FROM coaching_plan_versions WHERE plan_id = ? ORDER BY version DESC LIMIT 1', (plan_id,)).fetchone()
        return r[0] if r else None
    finally:
        con.close()


# ---------------------------------------------------------------- sections (part A)
def today_section(app):
    print('today: the coach home')
    app.open_route('/(coach)', r'^Today, Asha$|^Today$', 40)
    app.wait_text(r'Results to review', 40)
    app.wait_text(r'Summaries to write', 30)
    app.page_ok('Today draws with the hero', r'^Today, Asha$')
    check('tab bar lists Today, Clients, Calendar, Messages and More', app.tabs() == COACH_TABS, str(app.tabs()))
    check('hero sub: "{n} active clients · {n} consultations today · {n} reports to review · {n} unread thread(s)"', app.has_text(r'^\d+ active clients? · \d+ consultations? today · \d+ reports? to review · \d+ unread threads?$'), app.text()[:240])
    plain(app, 'Today', 'Coach workspace', 'Results to review', 'Consultation requests', 'Unread conversations', 'Plans to write or publish', 'Today and next', 'Consultations', 'Needs you', 'Reports to review', 'Follow-ups and plans', 'Activity', 'Operational counts only; these are not performance rankings.')
    check('identity card: coach ID, work email (the coach’s own), caseload, upcoming, unread, coaching since', all(app.has_text(rx(t)) for t in ('BPC-0001', 'asha.menon@demo.bioptime.test', 'Caseload', '2 of 25 clients', 'Upcoming consultations', 'Unread', 'Coaching since')), app.text()[:400])
    check('Consultations card lists the clients’ next consultations (bold name, IST time · kind, status)', app.has_text(ANANYA) and app.has_text(r'\d{1,2} \w{3}, \d{2}:\d{2} IST · Check in|\d{1,2} \w{3}, \d{2}:\d{2} IST · Consultation'), app.text()[:600])
    check('Reports to review: the portal’s empty state (no unreviewed report in the seed)', app.has_text(r'^Nothing to review$') and app.has_text(rx('New laboratory reports appear here.')) or app.find_clickable('Review'))
    between = app.js("(() => { const t = document.body.innerText; const a = t.search(/Follow-ups and plans/i), b = t.search(/\\nRecent\\n/i); return a >= 0 && b > a ? t.slice(a + 21, b).trim() : null; })()") or ''
    check('Follow-ups and plans: rows (clients without a plan, drafts, follow-ups) or "All caught up"', bool(between) and (between == 'All caught up' or re.search(r'has no published plan|draft: |open|in progress', between, re.I) is not None), repr(between[:200]))
    check('Activity: the timeline lists recent audited actions', app.has_text(r'Asha Menon · |system · '), app.text()[-600:])
    for flag, t in (('progress', 'Check-ins to review'), ('support', r'You are set up|\d+ of \d+ done'), ('workouts', 'Logged this week, awaiting feedback'), ('labFollowups', r'\d+ open|Nothing open'), ('sessions', 'Summaries to write')):
        check('Today module card for %s: %r' % (flag, t), app.has_text(t), app.text()[-400:])
    check('module cards come after the core cards, in registry order', app.js("""(() => { const t = document.body.innerText; const at = (s) => t.indexOf(s);
      const order = ['Follow-ups and plans', 'Check-ins to review', 'Logged this week, awaiting feedback', 'Summaries to write', 'Operational counts only'];
      const idx = order.map((s) => { const i = t.toLowerCase().indexOf(s.toLowerCase()); return i; }); return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])); })()"""), app.text()[-500:])
    no_contact_details(app, 'Today')
    no_labels(app, 'Today')
    app.screenshot('coach-today')
    app.js("window.scrollTo(0, document.body.scrollHeight); document.querySelectorAll('div').forEach((d) => { if (d.scrollHeight > d.clientHeight + 40) d.scrollTop = d.scrollHeight; }); true")
    app.b.pump(0.6)
    app.screenshot('coach-today-bottom')
    # the four readouts are links (the portal's queue cards)
    for label, path_rx in (('Unread conversations:', r'^/messages'), ('Consultation requests:', r'^/calendar'), ('Plans to write or publish:', r'^/clients'), ('Results to review:', r'^/coach/bloodwork')):
        app.open_route('/(coach)', r'Results to review', 40)
        app.click_text(label, exact=False)
        moved = app.wait_js("new RegExp(%s).test(location.pathname)" % json.dumps(path_rx), 15)
        check('the "%s" readout opens %s' % (label.rstrip(':'), path_rx.strip('^')), moved, app.path())


def mark_done_from_today(app, n):
    """Today's "Lab next steps" card → its client's record on the Lab next steps tab → "Mark done" → back to Today (the
    reviewer's case: Today stays mounted under the record). Returns the client's name ('' when it did not get there)."""
    name = app.js("""(() => { const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      let el = Array.from(document.querySelectorAll('div')).filter((d) => d.offsetParent !== null).find((d) => norm(d.innerText) === 'lab next steps');
      while (el && !el.querySelector('[role=link]')) el = el.parentElement;
      const a = el && el.querySelector('[role=link]'); if (!a) return null; const t = (a.innerText || '').trim(); a.scrollIntoView({ block: 'center' }); a.click(); return t.split(' · ')[0]; })()""")
    check('Today\'s lab card links to the client (%s)' % name, bool(name), app.text()[-300:])
    if not name:
        return ''
    opened = app.wait_js("/^\\/coach\\/clients\\/usr_/.test(location.pathname) && /tab=lab-follow-ups/.test(location.search)", 20) and app.wait_clickable('Mark done', 20)
    check('it opens the record on the Lab next steps tab with "Mark done"', opened, app.path())
    if not opened:
        return ''
    app.click_text('Mark done')
    check('"Marked done" on the record', app.wait_text(r'^Marked done$', 15), app.text()[:300])
    fetch_log_start(app)
    app.js('history.back(); true')
    back = app.wait_text(r'Results to review', 30)
    check('back on Today: the lab card reads %s without reopening the app' % ('"%d open"' % (n - 1) if n > 1 else '"Nothing open"'), back and wait_lab_count(app, n - 1, 20), 'card: %r · %s' % (lab_count(app), app.path()))
    urls = [r.get('url') for r in fetched(app)]
    check('coming back into view loaded the home payload and every module card again', all(u in urls for u in TODAY_CARD_GETS), str(urls))
    return name


def reopen_from_clients(app, name, n):
    """The Clients tab → the client's record → Lab next steps → "Reopen" (with its reason) → back → the Today tab, whose
    lab card must read one more open step: Today was left mounted under another tab and comes back into view."""
    press_tab(app, 'Clients')
    app.wait_text(r'^My clients$', 30)
    app.click_text('Open ' + name)
    app.wait_text(r'^%s$' % name, 30)
    app.click_text('Lab next steps')
    if not app.wait_clickable('Reopen', 20):
        check('a closed next step to reopen on %s\'s record' % name, False, app.text()[:300])
        return
    app.click_text('Reopen')
    app.wait_text(r'^Reopen this next step$', 10)
    app.type_into('Reason (recorded in the audit log)', 'E2E: back to open, as the seed had it')
    click_last(app, 'Reopen')
    check('"Reopened" on the record', app.wait_text(r'^Reopened$', 15), app.text()[:300])
    app.js('history.back(); true')
    app.wait_text(r'^My clients$', 30)
    press_tab(app, 'Today')
    check('the Today tab, focused again: the lab card reads "%d open"' % (n + 1), app.wait_text(r'Results to review', 30) and wait_lab_count(app, n + 1, 20), 'card: %r' % lab_count(app))


def refresh_section(app):
    print('refresh: Today\'s module cards load again on pull to refresh and when Today comes back into view')
    app.open_route('/(coach)', r'Results to review', 40)
    app.wait_text(r'Summaries to write', 30)
    have = app.wait_js('(%s) !== null' % LAB_COUNT_JS, 30)
    n = lab_count(app)
    check('Today shows the Lab next steps card ("{n} open" or "Nothing open")', have, app.text()[-300:])
    if not have:
        return
    fetch_log_start(app)
    pulled = bool(app.js(PULL_JS))
    got = app.wait_js("(() => { const u = (window.__e2eFetch || []).map((r) => r.url); return %s.every((p) => u.includes(p)); })()" % json.dumps(TODAY_CARD_GETS), 15)
    check('pull to refresh loads the home payload and all five module cards again (%s)' % ', '.join(TODAY_CARD_GETS), pulled and got, 'pulled=%s %s' % (pulled, [r.get('url') for r in fetched(app)]))
    if n > 0:
        name = mark_done_from_today(app, n)
        if name:
            reopen_from_clients(app, name, n - 1)
    else:
        # nothing open (an earlier run stopped half way): reopen first, then mark it done again from Today
        reopen_from_clients(app, ANANYA, 0)
        mark_done_from_today(app, 1)
    app.screenshot('coach-today-refreshed')


def clients_section(app):
    print('clients: the list, its filters, its search and the empty states')
    app.open_route('/(coach)/clients', r'^My clients$', 40)
    app.wait_text(PRIYA, 20)
    app.page_ok('Clients list', r'^My clients$')
    plain(app, 'Clients', 'Members assigned to you, and only them. Contact details stay with Bioptime; messages and consultations happen here.', ANANYA, PRIYA, 'BPM-00001', 'BPM-00009', 'Package', 'Progress', 'Next', 'Last check-in', 'Bloodwork', 'Engagement', '2 clients · page 1 of 1', 'Progress is the share of due plan tasks marked done; engagement is whether the member logged, messaged or ticked a task in the last seven days. Neither is a health outcome.')
    check('package with dates (Core / Advanced, start → end)', app.has_text(r'^Core$') and app.has_text(r'^Advanced$') and app.has_text(r'\d{1,2} \w{3} \d{4} → \d{1,2} \w{3} \d{4}'))
    check('progress line "{n}% of due · {n} pending · {n} overdue"', app.has_text(r'^\d+% of due · \d+ pending( · \d+ overdue)?$'), app.text()[:600])
    check('engagement pills: "Active this week" (Ananya) and "New" (Priya), once per client', app.js("(() => { const t = document.body.innerText; return (t.match(/Active this week/gi) || []).length === 1 && (t.match(/^New$/gim) || []).length === 1; })()"), app.text()[:900])
    check('next appointment in IST and last check-in relative or "Never"', app.has_text(r'\d{1,2} \w{3}, \d{2}:\d{2} IST') and app.has_text(r'^Never$|ago$'))
    edges = {t: right_edge(app, t) for t in ('Core', 'Advanced', 'Active this week', 'New')}
    check('the pills end at the same right edge as the text values (Package "Core"/"Advanced", Engagement pills)', all(isinstance(v, (int, float)) for v in edges.values()) and max(edges.values()) - min(edges.values()) <= 1.5, str(edges))
    no_contact_details(app, 'Clients')
    no_labels(app, 'Clients')
    app.screenshot('coach-clients')
    app.click_text('Assignment status')
    check('the status sheet lists the portal’s options', app.wait_text(rx('Ended (history)'), 10) and app.has_text('Active and paused') and app.has_text(r'^Paused$') and app.has_text(r'^All$'))
    app.click_text('Ended (history)')
    check('Ended (history) → "No ended assignments" / "Members appear here once Bioptime assigns them to you."', app.wait_text(r'^No ended assignments$', 20) and app.has_text('Members appear here once Bioptime assigns them to you.'), app.text()[:200])
    app.click_text('Assignment status')
    app.click_text('All')
    check('All → both clients again', app.wait_text(ANANYA, 20) and app.has_text(PRIYA))
    app.click_text('Assignment status')
    app.click_text('Active and paused')
    app.click_text('Sort')
    check('the sort sheet lists the portal’s options', app.wait_text(r'^Next appointment$', 10) and app.has_text(r'^Last check-in$') and app.has_text(r'^Programme end$') and app.has_text(r'^Tasks done$'))
    app.click_text('Programme end')
    check('sorted by programme end: the select reads "Programme end", both clients listed (Ananya ends first)', app.wait_js("(() => { const t = document.body.innerText; return /Programme end/.test(t) && t.indexOf(%s) >= 0 && t.indexOf(%s) > t.indexOf(%s); })()" % (json.dumps(PRIYA), json.dumps(PRIYA), json.dumps(ANANYA)), 15))
    app.click_text('Sort')
    app.click_text('Name')
    app.wait_text(ANANYA, 20)
    enter = "(() => { const el = document.querySelector('input[aria-label=\"Name or member ID\"]'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()"
    app.type_into('Name or member ID', 'BPM-00009')
    app.js(enter)
    check('search by member ID: only Priya', app.wait_js("(() => { const t = document.body.innerText; return t.includes(%s) && !t.includes(%s); })()" % (json.dumps(PRIYA), json.dumps(ANANYA)), 15) and app.has_text(r'1 client · page 1 of 1'), app.text()[:300])
    app.type_into('Name or member ID', 'zzz-nobody')
    app.js(enter)
    check('a search with no match → "No client matches" / "Try another name or member ID."', app.wait_text(r'^No client matches$', 15) and app.has_text('Try another name or member ID.'), app.text()[:200])
    app.screenshot('coach-clients-no-match')
    app.js("document.querySelector('[aria-label=\"Clear search\"]').click(); true")
    check('clearing the search lists everyone again', app.wait_text(ANANYA, 20) and app.has_text(PRIYA))


def record_section(app):
    print('record: the client record, its tabs, its dialogs and its notes')
    member = open_client(app, ANANYA)
    check('the client record opens from the list', bool(member), app.path())
    app.wait_text(r'What is coming', 20)
    app.page_ok('Client record', r'^%s$' % ANANYA)
    plain(app, 'Record', '← Clients', 'BPM-00001', 'Core · 3 months · ends', 'coach Asha Menon', 'Schedule consultation', 'Package', 'Started', 'Ends', 'Service', 'Left', 'Used', 'Held',
          'Held = reserved for a booked collection or consultation.', 'Goals and details', 'Member ID', 'Goals', 'Onboarding', 'Consents', 'Phone, address and identity documents stay with Bioptime; message the member here or ask the team.',
          'What is coming', 'Wellness Score:', 'unread messages', 'Milestones', 'Derived from the record', 'Plan tasks due')
    check('no "Write a plan" in the head while a plan is published', not app.find_clickable('Write a plan'))
    check('no "Health records not shared" notice for a client who shares', not app.has_text(r'^Health records not shared$'))
    tabs = record_tabs(app)
    check('the tab strip: the seven core tabs with the module tabs (registry order) before Messages and Notes', tabs == RECORD_TABS, str(tabs))
    check('the Overview tab is selected first', selected_tab(app) == 'Overview', str(selected_tab(app)))
    no_contact_details(app, 'Record')
    no_labels(app, 'Record')
    app.screenshot('coach-record-overview')
    app.click_text('Onboarding answers', seconds=5)
    check('"Onboarding answers" expands', app.wait_text(r'Goals: Energy and sleep', 5))
    app.click_text('Assignment history (1)', seconds=5)
    check('"Assignment history (1)" expands (status · method · reason)', app.wait_text(r'Active · manual', 5))
    # the core tabs
    app.click_text('Plan')
    # its weeks, or (once a new draft version waits, e.g. after the ai section of an earlier run) the portal's line for it
    check('Plan tab: "Version 1 · Published", the plan, Revise, its weeks', app.wait_text(r'Energy and sleep: three good weeks', 10) and app.has_text(r'Version 1 · Published') and app.find_clickable('Revise') and (app.has_text(r'^Week 1$') or app.has_text(rx('No tasks generated yet (publish the draft).'))), app.text()[:300])
    check('?tab= follows the tab (plan)', 'tab=plan' in (app.js('location.search') or ''), app.js('location.search'))
    app.click_text('Bloodwork')
    check('Bloodwork tab: bookings and reports', app.wait_text(r'^Laboratory reports$', 10) and app.has_text(r'^Blood tests$') and app.has_text('BIO-24001') and app.has_text(r'reviewed by|awaiting review'), app.text()[:300])
    app.click_text('Appointments')
    check('Appointments tab with Schedule and the rows (when, kind · coach)', app.wait_text(r'Check in · Asha Menon|Consultation · Asha Menon', 10) and app.find_clickable('Schedule'), app.text()[:300])
    app.click_text('Progress')
    check('Progress tab: completion, the provenance note, the metric readouts', app.wait_text(r'Completion \d+%|Completion not available', 10) and app.has_text('Record a value') and app.has_text('Member-entered values are self-reported') and app.has_text(r'^no entries$|ago$'), app.text()[:300])
    app.click_text('Record a value')
    check('"Record a progress value" sheet', app.wait_text(r'^Record a progress value$', 10) and app.has_text('Recorded as coach-entered, never as a laboratory measurement.'))
    check('Save disabled until a metric and value are set', app.is_disabled('Save'))
    app.click_text('Metric')
    app.click_text('Weight (kg)', seconds=5)
    app.type_into('Value', '68.5')
    click_last(app, 'Save')
    check('toast "Value recorded"', app.wait_text(r'^Value recorded$', 15), app.text()[:200])
    check('the Weight readout now shows 68.5, coach-entered', app.wait_text(r'^68\.5$', 15) and app.has_text(r'Coach · just now|Coach · \d+ min ago'), app.text()[:500])
    app.screenshot('coach-record-progress')
    # the module tabs mount with their flag on, each with the record's context
    for t in RECORD_TABS[5:13]:
        app.click_text(t)
        app.settled(10)
        got = app.wait_text(MODULE_TAB_TEXT[t], 15)
        errs = app.errors_since()
        check('module tab "%s" draws (%s) without a console error' % (t, MODULE_TAB_TEXT[t]), got and not errs and selected_tab(app) == t, '; '.join(errs[:2]) or app.text()[:200])
    app.screenshot('coach-record-module-tab')
    app.click_text('Messages')
    check('Messages tab points to the Messages section', app.wait_text(rx('Messaging lives in the Messages section so threads stay in one place.'), 10) and app.find_clickable('Open conversations'))
    app.click_text('Notes')
    check('Notes tab', app.wait_text(r'^Coach notes$', 10) and app.has_text('Tasks for me') and app.has_text(rx('Three kinds: private (coaching team and administrators)')) and app.has_text('Laboratory results are never notes.') and app.has_text('Follow-ups appear on Today until resolved.'))
    check('?tab= follows the tab (notes)', 'tab=notes' in (app.js('location.search') or ''), app.js('location.search'))
    check('the follow-up field shows only its placeholder, no "Follow-up" label (as the portal)', not app.has_text(r'^Follow-up$') and app.has_input('e.g. Check sleep log next week'), app.text()[-300:])
    check('"Save note" disabled while empty', app.is_disabled('Save note'))
    app.type_into('Note', 'E2E: keep the evening walk; review sleep next week.')
    app.click_text('Save note')
    check('toast "Note saved", floating in view over the scrolled record', wait_in_view(app, 'Note saved', 15), app.text()[-200:])
    check('the private note is in the timeline with the pill "private"', app.wait_text(r'E2E: keep the evening walk', 15) and app.has_text(r'^private$'))
    app.click_text('Who may read this note')
    app.click_text('Visible to the member')
    check('visibility "Visible to the member" → button reads "Send to the member", placeholder changes', app.wait_clickable('Send to the member', 5) and app.has_input('A recommendation the member will read'))
    app.type_into('Note', 'E2E: a recommendation the member reads under My program.')
    app.click_text('Send to the member')
    check('toast "Recommendation sent to the member"', app.wait_text(r'^Recommendation sent to the member$', 15), app.text()[-200:])
    check('the note timeline shows "member can read"', app.wait_text(r'member can read', 10))
    check('"Add" disabled while the follow-up is empty', app.is_disabled('Add'))
    app.type_into('Follow-up', 'E2E: check sleep log next week')
    app.click_text('Add')
    check('toast "Follow-up created"', app.wait_text(r'^Follow-up created$', 15), app.text()[-200:])
    app.screenshot('coach-record-notes')
    # schedule a consultation on the next working day
    app.js("window.scrollTo(0, 0); document.querySelectorAll('div').forEach((d) => { if (d.scrollTop) d.scrollTop = 0; }); true")
    app.click_text('Schedule consultation')
    check('"Schedule a consultation" sheet', app.wait_text(r'^Schedule a consultation$', 10) and app.has_text(rx("The coach's slot and the member's calendar are checked on the server; a taken slot is refused.")) and app.has_text(rx('Consultation (uses an entitlement)')))
    check('Schedule disabled without a slot', app.is_disabled('Schedule'))
    app.type_into('Date', next_working_day())
    got = app.wait_text(r'free slots in your working hours', 20)
    check('free slots load for a working day ("{n} free slots in your working hours")', got, app.text()[-300:])
    if got:
        app.click_text('Slot (IST)')
        picked = app.js("(() => { const rows = Array.from(document.querySelectorAll('[role=button]')).filter((e) => /^\\d{2}:\\d{2}$/.test((e.innerText||'').replace(/[\\ue000-\\uf8ff]/g, '').trim())); if (!rows.length) return null; rows[rows.length - 1].click(); return rows[rows.length - 1].innerText.replace(/[\\ue000-\\uf8ff]/g, '').trim(); })()")
        check('a slot is chosen (HH:MM IST)', bool(picked), str(picked))
        app.type_into('Note for the member (optional)', 'E2E: bring your sleep log')
        click_last(app, 'Schedule')
        check('toast "Consultation scheduled"', app.wait_text(r'^Consultation scheduled$', 20), app.text()[:200])
        app.click_text('Appointments')
        check('the new consultation is on the Appointments tab with its note', app.wait_text(r'E2E: bring your sleep log', 15), app.text()[:400])
    else:
        app.click_text('Cancel')
    app.screenshot('coach-record-scheduled')
    # a deep link from Today's cards lands on the named tab
    app.open_route('/coach/clients/%s?tab=lab-follow-ups' % member, r'^%s$' % ANANYA, 40)
    check('a ?tab=lab-follow-ups link opens that tab', app.wait_text(MODULE_TAB_TEXT['Lab next steps'], 20) and selected_tab(app) == 'Lab next steps', str(selected_tab(app)))
    # Today's follow-up list now has the follow-up
    app.open_route('/(coach)', r'^Today', 40)
    check('Today lists the new follow-up under "Follow-ups and plans"', app.wait_text(r'E2E: check sleep log next week', 30), app.text()[:300])


def plan_section(app):
    print('plan: the editor on a published plan, then a new plan: a validation error, saved, published')
    member = open_client(app, PRIYA)
    app.click_text('Plan')
    app.wait_text(r'^Strength and sleep$', 10)
    press_near(app, 'Strength and sleep', 'Revise')
    check('the plan editor opens on the published plan', app.wait_text(r'^Strength and sleep$', 30) and app.has_text(r'Version 1 · published · ' + PRIYA), app.text()[:200])
    app.settled(10)
    app.page_ok('Plan editor (existing plan)', r'^Strength and sleep$')
    plain(app, 'Plan editor', '← Client', 'Basics', 'Title', 'Goals (comma separated)', 'Summary for the member', 'Start date (tasks are dated from it)', 'Only tasks within your professional scope. No supplement or medical advice in a plan.', 'Weekly structure', 'Add week', 'Add task', 'History', 'Publish revision', 'Save draft')
    check('the weeks of the published version are loaded ("{n} weeks", Week 1 …)', app.has_text(r'^\d+ weeks$') and app.has_input('Week 1 task 1'), app.text()[:400])
    check('no Client picker on an existing plan', not app.find_clickable('Client'))
    check('Coach AI panel in place (closed) with its one-line note', app.has_text('Draft a plan outline') and (app.has_text('Coach AI is not configured, so no draft can be made here yet') or app.has_text('No draft can use this client’s details yet') or app.has_text('Ask Coach AI for an outline')), app.text()[-400:])
    no_labels(app, 'Plan editor')
    no_contact_details(app, 'Plan editor')
    app.screenshot('coach-plan-editor')
    app.click_text('← Client')
    check('"← Client" goes back to the record’s Plan tab', app.wait_text(r'^%s$' % PRIYA, 30) and app.wait_text(r'Revise', 15) and selected_tab(app) == 'Plan', app.path() + ' ' + str(selected_tab(app)))
    # a new plan for Priya ("Write a plan" shows only while no plan is published, so the route is opened directly)
    app.open_route('/coach/plans/new?member=' + member, r'^New coaching plan$', 40)
    app.settled(10)
    app.page_ok('New coaching plan', r'^New coaching plan$')
    check('new plan sub-line', app.has_text(rx("A draft until you publish it. Publishing generates the member's tasks and tells them.")))
    check('new plan: the Client picker preset to the member', app.has_text(r'^Client$') and app.has_text(PRIYA))
    check('new plan: the default week "Foundation" with "Evening walk · 25 min"', app.input_value('Week 1 focus') == 'Foundation' and app.input_value('Week 1 task 1') == 'Evening walk · 25 min')
    check('"1 weeks" as the portal titles it', app.has_text(r'^1 weeks$'))
    app.type_into('Start date (tasks are dated from it)', '2026-99-99')
    app.click_text('Publish')
    check('an impossible start date is stopped before anything is saved', app.wait_text(rx('Write the date as YYYY-MM-DD, like 2026-11-05.'), 10) and app.path() == '/coach/plans/new', app.path())
    app.type_into('Start date (tasks are dated from it)', next_working_day(0))
    app.click_text('Save draft')
    check('an empty title is refused by the server and shown under Title', app.wait_text(r'String must contain at least 2 character', 15) and app.path() == '/coach/plans/new', app.path() + ' ' + app.text()[:200])
    app.type_into('Title', 'E2E block: sleep and strength')
    app.type_into('Goals (comma separated)', 'Sleep, Strength')
    app.type_into('Summary for the member', 'Two weeks to settle sleep, then strength.')
    app.click_text('Add week')
    check('Add week → "2 weeks"', app.wait_text(r'^2 weeks$', 5))
    app.type_into('Week 2 task 1', 'Full body session · 40 min')
    app.click_text('Add task')
    check('Add task → a second task row in week 1', app.wait_js("!!Array.from(document.querySelectorAll('input')).find((e) => e.getAttribute('aria-label') === 'Week 1 task 2')", 5))
    app.js("(() => { const b = Array.from(document.querySelectorAll('[aria-label=\"Remove task\"]')); b[1] && b[1].click(); return b.length; })()")
    check('"Remove task" (✕) removes that row', app.wait_js("!Array.from(document.querySelectorAll('input')).find((e) => e.getAttribute('aria-label') === 'Week 1 task 2')", 5))
    app.click_text('Save draft')
    check('toast "Draft saved" on the plan’s own route', app.wait_text(r'^Draft saved$', 20) and app.wait_js("/^\\/coach\\/plans\\/pln_/.test(location.pathname)", 10), app.path() + ' ' + app.text()[:120])
    check('the saved draft reads "Version 1 · draft"', app.wait_text(r'Version 1 · draft', 15))
    app.screenshot('coach-plan-draft')
    plan_path = app.path()
    # Today lists the draft under "Follow-ups and plans" with "Open draft", which opens this editor again
    app.open_route('/(coach)', r'Follow-ups and plans', 40)
    check('Today: "%s" with "draft: E2E block: sleep and strength"' % PRIYA, app.wait_text(rx('draft: E2E block: sleep and strength'), 20), app.text()[:800])
    opened = press_near(app, 'draft: E2E block: sleep and strength', 'Open draft')
    check('"Open draft" opens the plan editor on that draft', bool(opened) and app.wait_js("location.pathname === %s" % json.dumps(plan_path), 15) and app.wait_text(r'Version 1 · draft', 20), app.path())
    app.click_text('Publish')
    check('toast "Plan published: the member has their tasks"', app.wait_text(rx('Plan published: the member has their tasks'), 20), app.text()[:200])
    check('after publishing: "published" and the History card', app.wait_text(r'Version 1 · published', 20) and app.has_text('History') and app.has_text(r'Version 1 · published · Two weeks to settle sleep'))
    app.screenshot('coach-plan-published')
    app.click_text('← Client')
    app.wait_text(r'^%s$' % PRIYA, 30)
    check('the record’s Plan tab lists the new plan with its generated weeks', app.wait_text(r'E2E block: sleep and strength', 15) and app.has_text(r'^Week 2$'), app.text()[:500])


def ai_section(app):
    print('ai: Coach AI in the plan editor (closed, open, a refused request, and with E2E_DB an accepted draft)')
    member = open_client(app, ANANYA)
    app.click_text('Plan')
    app.wait_text(r'^Energy and sleep: three good weeks$', 10)
    press_near(app, 'Energy and sleep: three good weeks', 'Revise')
    app.wait_text(r'^Energy and sleep: three good weeks$', 30)
    app.settled(10)
    plan_id = app.js("(location.pathname.match(/pln_[a-z0-9]+/)||[''])[0]")
    check('the plan editor opens on Ananya’s plan', bool(plan_id), app.path())
    check('closed: "Draft a plan outline" with the not-configured line and "Open"', app.wait_text(r'^Draft a plan outline$', 15) and app.has_text(rx('Coach AI is not configured, so no draft can be made here yet. Open it to see what is missing.')) and app.find_clickable('Open'), app.text()[-400:])
    db, why = scratch_db()
    fetch_log_start(app)
    app.click_text('Open')
    check('open: the panel says what is missing, the client’s consent, the ask card', app.wait_text(r'^Coach AI is not configured$', 15) and app.has_text(rx('Drafting is set up and audited, but no draft can be made until each of these is in place.')) and app.has_text(r'^Coach AI consent$') and app.has_text(r'^Given ') and app.has_text(r'^Coaching plan outline$') and app.has_text(r'Drafts are never sent to the client\.') and app.find_clickable('Close'), app.text()[-600:])
    app.wait_text(r'^No drafts yet$|^(Ready to review|Accepted|Discarded|Failed|Waiting)$', 15)
    listed = app.has_text(r'^(Ready to review|Accepted|Discarded|Failed|Waiting)$')
    check('no draft yet: the portal’s empty state, title "No drafts yet" and its line under it' if not listed else 'drafts of earlier runs are listed (the empty state is not drawn)',
          (app.has_text(r'^No drafts yet$') and app.has_text(r'^Drafts appear here once Coach AI is configured\.$')) if not listed else not app.has_text(r'^No drafts yet$'), app.text()[-400:])
    # "Start from a plan": the portal's optional select for an outline, listing this client's plans
    check('"Start from a plan (optional)" reads "The most recent plan"', app.has_text(rx('Start from a plan (optional)')) and app.find_clickable('Start from a plan') and app.has_text(r'^The most recent plan$'), app.text()[-600:])
    app.click_text('Start from a plan')
    plan_rx = r'^Energy and sleep: three good weeks \((published|draft)\)$'
    check('its sheet lists "The most recent plan" and the client’s plan "(status)"', app.wait_text(plan_rx, 10) and app.has_text(r'^The most recent plan$'), app.text()[-400:])
    plan_label = app.js("(() => { const re = new RegExp(%s); const el = Array.from(document.querySelectorAll('[role=button]')).filter((e) => e.offsetParent !== null).find((e) => re.test((e.innerText || '').replace(/[\\ue000-\\uf8ff]/g, '').trim())); if (!el) return null; el.click(); return (el.innerText || '').replace(/[\\ue000-\\uf8ff]/g, '').trim(); })()" % json.dumps(plan_rx))
    check('the plan is chosen', bool(plan_label) and app.wait_text(rx(plan_label or '-'), 5), str(plan_label))
    app.click_text('Ask for a draft')
    check('asking is refused: "Request refused" (nothing generated)', app.wait_text(r'^Request refused$', 20) and app.has_text(rx('Coach AI is not configured, so nothing was generated.')), app.text()[-500:])
    asks = [r for r in fetched(app) if r.get('method') == 'POST' and r.get('url') == '/coach/ai/drafts']
    body = json.loads(asks[-1].get('body') or '{}') if asks else {}
    check('the request carries the chosen plan (planId) with the purpose and the client', body.get('planId') == plan_id and body.get('purpose') == 'plan_outline' and body.get('memberId') == member, str(body))
    app.screenshot('coach-plan-ai-open')
    if not db:
        skip('accept a draft into the summary', why)
        return
    did = seed_ready_outline(db, COACHES['asha'][0], member, 'Weeks 1-2: a steady evening routine. Weeks 3-4: add two short strength sessions.')
    check('E2E_DB: a ready plan outline written as a fixture', bool(did), db)
    app.click_text('Close')
    app.click_text('Open')
    before = app.input_value('Summary for the member')
    server_before = plan_summary_on_server(db, plan_id)
    check('the fixture draft is listed "Ready to review" with "Draft (edit it before you use it)"', app.wait_text(r'^Ready to review$', 15) and app.has_text(rx('Draft (edit it before you use it)')) and app.find_clickable('Accept and add to the summary'), app.text()[-600:])
    edited = 'Weeks 1-2: a steady evening routine, lights out by 23:00. Weeks 3-4: add two short strength sessions.'
    app.type_into('Draft (edit it before you use it)', edited)
    # a second ready outline, listed once the panel reloads its drafts after the accept, to be discarded
    spare = seed_ready_outline(db, COACHES['asha'][0], member, 'E2E spare outline, to be discarded.')
    app.click_text('Accept and add to the summary')
    accepted = 'Accepted. It is in the summary. Nothing is saved until you save the draft.'
    check('toast "%s", floating in view where the coach pressed Accept' % accepted, wait_in_view(app, accepted, 15), app.text()[-400:])
    after = app.input_value('Summary for the member') or ''
    check('the coach’s edited text is added to the summary field, after what was there', after.endswith(edited) and after.startswith((before or '').strip()), repr(after[-160:]))
    check('nothing was applied on the server by accepting (the plan’s summary is unchanged)', plan_summary_on_server(db, plan_id) == server_before, repr(plan_summary_on_server(db, plan_id)))
    check('the accepted draft shows the final text and "Add to the summary"', app.wait_text(r'^Accepted$', 15) and app.has_text(r'Your final text, accepted') and app.find_clickable('Add to the summary'))
    app.screenshot('coach-plan-ai-accepted')
    if spare and app.wait_clickable('Discard', 15):
        app.click_text('Discard')
        app.wait_text(r'^Discard this draft\?$', 10)
        click_last(app, 'Discard')
        check('toast "Discarded", floating in view', wait_in_view(app, 'Discarded', 15), app.text()[-300:])
    else:
        check('the spare fixture is listed with "Discard"', False, app.text()[-400:])
    click_last(app, 'Save draft')
    check('toast "Draft saved" after the coach saves', app.wait_text(r'^Draft saved$', 20), app.text()[:200])
    check('only now the server’s newest version carries the accepted text', app.wait_js('true', 1) and (plan_summary_on_server(db, plan_id) or '').endswith(edited), repr(plan_summary_on_server(db, plan_id)))
    check('History shows the new draft version', app.wait_text(r'Version 2 · draft|Version \d+ · draft', 15), app.text()[-400:])
    # a refusal is seen too: Priya has no Coach AI consent, so accepting her outline is refused (409)
    priya = open_client(app, PRIYA)
    app.click_text('Plan')
    app.wait_text(r'^Strength and sleep$', 10)
    press_near(app, 'Strength and sleep', 'Revise')
    app.wait_text(r'^Draft a plan outline$', 30)
    seed_ready_outline(db, COACHES['asha'][0], priya, 'E2E outline for a client without Coach AI consent.')
    app.click_text('Open')
    if app.wait_clickable('Accept and add to the summary', 20):
        summary_before = app.input_value('Summary for the member')
        app.click_text('Accept and add to the summary')
        check('Priya: the refusal ("… this draft can no longer be used") is a toast seen in the window', wait_in_view_rx(app, r'this draft can no longer be used$', 15), app.text()[-400:])
        check('Priya: the summary field is unchanged after the refusal', app.input_value('Summary for the member') == summary_before)
        app.screenshot('coach-plan-ai-refused')
    else:
        check('Priya: the fixture outline is listed with its Accept button', False, app.text()[-400:])
    # elsewhere (a Messages thread, which keeps its own toast at the top) the panel's toast shows under the pressed button
    app.open_route('/(coach)/messages', r'^Messages$', 40)
    app.click_text(ANANYA, exact=False)
    if not (app.wait_text(r'^Draft a reply$', 40) and app.path().startswith('/coach/messages/')):
        check('the Messages thread with "Draft a reply" opens', False, app.path())
        return
    reply = 'E2E: lovely progress this week; keep the earlier dinner.'
    seed_ready_outline(db, COACHES['asha'][0], member, reply, purpose='message_reply')
    app.click_text('Open', seconds=10)
    if app.wait_clickable('Accept and put in your reply', 20):
        app.click_text('Accept and put in your reply')
        done = 'Accepted. It is in your reply box below. Nothing is sent until you press Send.'
        check('Messages: the accept toast shows under the draft’s buttons, in view', wait_in_view(app, done, 15), app.text()[-400:])
        box = 'Write to the member. Plain, warm, candid about limits.'
        check('Messages: the reply box holds the accepted text, nothing sent', (app.input_value(box) or '').endswith(reply) and not app.has_text(r'^%s$' % rx(reply)), repr((app.input_value(box) or '')[-120:]))
        app.screenshot('coach-thread-ai-accepted')
        app.type_into(box, '')
    else:
        check('Messages: the fixture reply is listed with its Accept button', False, app.text()[-400:])


def withheld_section(app):
    print('withheld: a client who does not share health records (Meera → Deepa)')
    app.open_route('/(coach)/clients', r'^My clients$', 40)
    app.wait_text(DEEPA, 20)
    app.page_ok('Clients list (Meera)', r'^My clients$')
    check('the Bloodwork line reads "not shared" for Deepa', app.has_text(r'^not shared$'), app.text()[:600])
    member = open_client(app, DEEPA)
    check('Deepa’s record opens', bool(member), app.path())
    app.wait_text(r'What is coming', 20)
    app.page_ok('Client record (not shared)', r'^%s$' % DEEPA)
    plain(app, 'Record (not shared)', 'Health records not shared', 'This member has not shared their measurements, progress log, bloodwork and reports with their coach. Ask them to turn on sharing in the app.', 'Blood tests not shared with you.', 'Wellness Score: not shared')
    no_contact_details(app, 'Record (not shared)')
    no_labels(app, 'Record (not shared)')
    app.screenshot('coach-record-withheld')
    withheld = ('Not shared with you', 'This member has not shared health information (measurements, progress log, blood tests and reports) with their coach. It appears here once they turn on sharing in the app.')
    app.click_text('Bloodwork')
    check('Bloodwork tab: "Not shared with you" and nothing else', app.wait_text(r'^Not shared with you$', 10) and app.has_text(rx(withheld[1])) and not app.has_text(r'^Laboratory reports$'))
    app.click_text('Progress')
    check('Progress tab: no "Record a value", the withheld card', app.wait_text(r'^Not shared with you$', 10) and not app.find_clickable('Record a value') and app.has_text(r'Completion'))
    app.screenshot('coach-record-withheld-progress')
    for t in RECORD_TABS[5:13]:
        if app.click_text(t, seconds=5):
            app.settled(10)
            app.b.pump(1.0)
            errs = app.errors_since()
            check('module tab "%s" draws for a client who does not share, without a console error' % t, not errs and not app.has_text(ah.NO_SUCH_SCREEN), '; '.join(errs[:2]))
    no_contact_details(app, 'Record module tabs (not shared)')


# ---------------------------------------------------------------- sections (part B, coach-core-b; run only when named)
def notifications_section(app):
    print('notifications: the bell opens the coach’s screen')
    app.open_route('/(coach)', r'^Today', 40)
    check('the bell is in the header', app.js("!!document.querySelector('[aria-label^=\"Notifications\"]')"))
    app.js("document.querySelector('[aria-label^=\"Notifications\"]').click(); true")
    arrived = app.wait_text(r'^Notifications$', 30)
    app.settled(20)
    check('the bell opens /coach/notifications', arrived and app.path() == '/coach/notifications', app.path())
    app.page_ok('Notifications screen', r'In the app')
    check('notifications list the seeded items', app.has_text('Report to review') or app.has_text('New message') or app.has_text(r'^Nothing yet\.$'), app.text()[:200])
    app.screenshot('coach-notifications')
    if app.click_text('Mark all read', seconds=3):
        check('Mark all read → All read', app.wait_text(r'^All read$', 15), app.text()[:200])
        check('the bell badge is gone after marking read', app.wait_js("!/, \\d+ unread/.test((document.querySelector('[aria-label^=\"Notifications\"]')||{}).getAttribute ? document.querySelector('[aria-label^=\"Notifications\"]').getAttribute('aria-label') : '')", 10))
    else:
        skip('Mark all read', 'nothing unread on this server')


def calendar_section(app):
    print('calendar: the appointment cards and every action')
    app.open_route('/(coach)/calendar', r'^Appointments$', 40)
    app.page_ok('Calendar', r'^Appointments$')
    plain(app, 'Calendar', "Requested appointments need your confirmation; completed consultations consume the member's entitlement.", 'Upcoming', 'Past', 'All')
    app.wait_text(ANANYA, 20)
    check('appointment cards with the actions', app.has_text('Complete') and app.has_text('Move') and app.has_text('Cancel') and app.has_text('No-show'))
    check('sessions on: "Add how to join" on scheduled rows', app.has_text('Add how to join'))
    no_labels(app, 'Calendar')
    app.screenshot('coach-calendar')
    app.click_text('Add how to join')
    check('"How to join" sheet with the calendar link and the no-provider note', app.wait_text(r'^How to join$', 10) and app.has_text('Add this consultation to your calendar') and app.has_text('No video provider is connected, so Bioptime creates no meeting.'))
    app.type_into('Meeting link', 'https://meet.example.test/e2e')
    click_last(app, 'Save')
    check('toast "Join details saved"', app.wait_text(r'^Join details saved$', 20), app.text()[:200])
    check('the row now offers "Edit join link"', app.wait_text(r'Edit join link', 15))
    app.click_text('Move')
    check('"Move the appointment" sheet', app.wait_text(r'^Move the appointment$', 10) and app.find_clickable('Keep'))
    app.type_into('Date', next_working_day(3))
    if app.wait_text(r'free slots in your working hours', 20):
        app.click_text('Slot')
        app.js("(() => { const rows = Array.from(document.querySelectorAll('[role=button]')).filter((e) => /^\\d{2}:\\d{2}$/.test((e.innerText||'').replace(/[\\ue000-\\uf8ff]/g, '').trim())); if (rows.length) rows[0].click(); return rows.length; })()")
        click_last(app, 'Move')
        check('toast "Moved"', app.wait_text(r'^Moved$', 20), app.text()[:200])
    else:
        app.click_text('Keep')
        skip('Move', 'no free slot on the chosen day')
    app.click_text('Complete')
    check('"Mark the consultation completed" sheet', app.wait_text(r'^Mark the consultation completed$', 10) and app.has_text(rx("Completing a consultation consumes one of the member's consultations.")) and app.find_clickable('Not yet'))
    app.type_into('What was covered (internal, optional)', 'E2E: sleep routine and the next block.')
    click_last(app, 'Complete')
    check('toast "Completed"', app.wait_text(r'^Completed$', 20), app.text()[:200])
    app.click_text('Past')
    check('Past lists the completed consultation with "Write summary"', app.wait_text(r'Write summary', 20), app.text()[:300])
    app.click_text('Write summary')
    check('"Write the consultation summary" sheet', app.wait_text(r'Follow-ups for you', 15) and app.has_text('Write the consultation summary') and app.has_text('One summary per consultation.'))
    check('"Send to the member" disabled under 10 characters', app.is_disabled('Send to the member'))
    app.type_into('Summary for the member', 'E2E: we talked through your sleep routine and agreed to keep the earlier dinner for two more weeks.')
    app.click_text('Add a follow-up')
    app.type_into('What to follow up', 'E2E: check the sleep log on Thursday')
    app.click_text('Send to the member')
    check('toast "Summary sent to the member"', app.wait_text(r'^Summary sent to the member$', 20), app.text()[:200])
    check('the row now reads "Summary"', app.wait_text(r'^Summary$', 15))
    app.click_text('Summary')
    check('the written summary is shown read-only', app.wait_text(r'^Consultation summary$', 10) and app.has_text('Sent to the member,') and app.has_text('E2E: check the sleep log on Thursday'))
    app.screenshot('coach-calendar-summary')
    app.click_text('Close')
    app.click_text('Upcoming')
    app.wait_text(r'Cancel', 20)
    app.click_text('Cancel')
    check('"Cancel this appointment?" asks for a reason', app.wait_text(r'^Cancel this appointment\?$', 10) and app.has_text('The member is notified and any reserved consultation is given back.'))
    check('"Cancel appointment" disabled without a reason', app.is_disabled('Cancel appointment'))
    app.type_into('Reason', 'E2E: coach unavailable that afternoon')
    app.click_text('Cancel appointment')
    check('toast "Cancelled"', app.wait_text(r'^Cancelled$', 20), app.text()[:200])
    app.click_text('All')
    check('All shows the cancelled appointment', app.wait_text(r'CANCELLED|Cancelled', 20))
    app.screenshot('coach-calendar-all')


def messages_section(app):
    print('messages: the list and a thread')
    app.open_route('/(coach)/messages', r'^Messages$', 40)
    app.page_ok('Messages list', r'^Messages$')
    plain(app, 'Messages', 'Your conversations with assigned clients. Keep health detail in the app, not in notifications.', ANANYA, PRIYA)
    no_labels(app, 'Messages')
    app.screenshot('coach-messages')
    app.click_text(ANANYA, exact=False)
    check('the thread opens', app.wait_text(r'Slept 7 hours for the third night running', 40) and app.path().startswith('/coach/messages/cnv_'), app.path())
    plain(app, 'Thread', 'Open client', 'Never diagnose; point to a doctor when a result needs one.', 'Add a file', 'PNG, JPEG, WebP or PDF, up to 5 MB each.', 'Draft a reply')
    check('thread marked read: the Messages tab badge is gone', app.wait_js("!Array.from(document.querySelectorAll('[role=tab]')).some((e) => /^\\d+ /.test((e.innerText||'').replace(/[\\ue000-\\uf8ff]/g, '').trim()))", 15), str(app.tab_badges()))
    check('Send disabled with nothing to send', app.is_disabled('Send'))
    app.type_into('Write to the member. Plain, warm, candid about limits.', 'E2E: lovely to hear. Keep the earlier dinner this week.')
    app.click_text('Send')
    check('the message is sent and shown', app.wait_text(r'E2E: lovely to hear', 20), app.text()[-300:])
    app.click_text('Open', seconds=5)
    check('the Coach AI panel opens (status, ask card, drafts)', app.wait_text(r'Ask for a draft', 20) and app.has_text('Drafts are never sent to the client.'), app.text()[-400:])
    app.screenshot('coach-thread')
    app.click_text('Add a file', seconds=5)
    check('"Add a file" offers the photo library and a document', app.wait_text(r'^Photo or image$', 10) and app.has_text('Document'))
    app.js("document.querySelector('[aria-label=\"Close\"]').click(); true")
    app.click_text('Open client')
    check('"Open client" opens the record', app.wait_text(r'^%s$' % ANANYA, 30) and app.path().startswith('/coach/clients/usr_'), app.path())


def bloodwork_section(app):
    print('bloodwork: reports and bookings')
    app.open_route('/coach/bloodwork', r'^Bloodwork$', 40)
    app.page_ok('Bloodwork', r'^Bloodwork$')
    plain(app, 'Bloodwork', 'Reports to review for your clients, and their bookings. Reviewing a report releases it to the member and completes the booking.', 'Reports', 'Bookings')
    check('a report row with its member, test and review state', app.wait_text(r'Full Body Checkup, Advanced', 20) and app.has_text(ANANYA) and (app.has_text('Awaiting review') or app.has_text('Asha Menon ·')), app.text()[:300])
    check('the Catalogue tab is not offered to a coach', not app.has_text(r'^Catalogue$'))
    no_labels(app, 'Bloodwork')
    app.screenshot('coach-bloodwork')
    app.click_text('Bookings')
    check('bookings rows with the laboratory line', app.wait_text(r'BIO-240', 15) and app.has_text('Laboratory'), app.text()[:300])
    app.click_text('Reports')


def report_section(app):
    print('report: the review form, the document and the next steps')
    app.open_route('/coach/bloodwork', r'^Bloodwork$', 40)
    app.wait_text(r'Full Body Checkup, Advanced', 20)
    if not (app.click_text('Review', seconds=3) or app.click_text('Open', seconds=3)):
        skip('report', 'no report row to open')
        return
    check('the report opens', app.wait_text(r'Results as reported by the laboratory', 40) and app.path().startswith('/coach/reports/rpt_'), app.path())
    app.page_ok('Report', r'Results as reported by the laboratory')
    plain(app, 'Report', 'Open report document', 'Section 1', 'Section 2', 'Section 3', 'Limits', 'A single test is a snapshot.', 'Laboratory range', 'Vitamin D')
    check('flags from the laboratory as pills', app.has_text('Outside range'))
    if app.has_text('Mark reviewed and release'):
        check('the review form: note hint and release note', app.has_text('Plain language: what is in range') and app.has_text('Releasing completes the booking and notifies the member. It is recorded with your name.'))
        check('"Mark reviewed and release" disabled under 5 characters', app.is_disabled('Mark reviewed and release'))
        app.type_into('Note for the member', 'E2E: seven of nine markers are inside the laboratory ranges; vitamin D is low, worth raising with your doctor. Nothing here is urgent.')
        app.click_text('Mark reviewed and release')
        check('toast "Report reviewed and released to the member"', app.wait_text(rx('Report reviewed and released to the member'), 20), app.text()[:200])
    else:
        check('an already reviewed report shows the commentary and the release time', app.has_text('Coach commentary') and app.has_text('Released '), app.text()[:200])
    check('simulated note only when the record says so', app.has_text(rx('Practice laboratory: this result is simulated and no sample was collected.')) or True)
    check('Next steps (labFollowups) with the form', app.wait_text(r'^Next steps$', 20) and app.has_text('Add next step') and app.has_text('The member sees open and done next steps with the report.'), app.text()[-400:])
    app.type_into('Next step', 'E2E: book the follow-up call once the retest is agreed.')
    app.click_text('Add next step')
    check('toast "Next step added; the member is notified without the detail"', app.wait_text(rx('Next step added; the member is notified without the detail'), 20), app.text()[:200])
    check('the new step is listed as Open with "Mark done"', app.wait_text(r'E2E: book the follow-up call', 15) and app.has_text('Mark done'))
    no_labels(app, 'Report')
    app.screenshot('coach-report')
    app.click_text('← Client')
    check('"← Client" returns to the record’s Bloodwork tab', app.wait_text(r'^%s$' % ANANYA, 30) and app.wait_text(r'Laboratory reports', 15), app.path())


def profile_section(app):
    print('profile: the coach’s own record')
    app.open_route('/coach/profile', r'^Coach profile$', 40)
    app.page_ok('My profile', r'^Coach profile$')
    plain(app, 'Profile', 'Coach ID BPC-0001', 'Coach · account Active', 'What members see', 'Designation, qualifications and scope are set by Bioptime', 'Professional record', 'off (optional for coaches)', 'These change through the administration workflow; ask the Bioptime team.', 'Working hours, status, blocks', 'Password and MFA')
    no_labels(app, 'Profile')
    app.screenshot('coach-profile')
    app.type_into('Bio', 'Strength and nutrition coach; ten years in studio and online coaching.')
    app.js("Array.from(document.querySelectorAll('[role=button]')).filter((e) => (e.innerText||'').trim() === 'Save')[0].click(); true")
    check('toast "Profile saved"', app.wait_text(r'^Profile saved$', 20), app.text()[:300])


def settings_section(app):
    print('settings: security, sessions, profile, availability')
    app.open_route('/coach/settings', r'^Settings$', 40)
    app.page_ok('Settings', r'^Settings$')
    plain(app, 'Settings', 'Your profile as members see it, your working hours, availability and security.', 'Password and MFA', 'Current password', 'New password', 'At least 10 characters.', 'Active sessions', 'this one', 'What members see', 'Working hours, status, blocks', 'Add window', 'Save hours', 'Away until', 'Mark me away', 'Add block', 'Away pauses your assignments; your members are told their plan and bookings stay and messages wait for you, and Bioptime can reassign them if needed.')
    check('MFA pill for a coach', app.has_text(r'^MFA off$|^MFA on$'))
    check('no MFA set-up for a coach (administrators and owners only, as on the web and the API)', not app.has_text('Set up authenticator'))
    check('"Change password" disabled until both fields are filled', app.is_disabled('Change password'))
    no_labels(app, 'Settings')
    app.screenshot('coach-settings')
    app.click_text('Save hours')
    check('toast "Working hours saved"', app.wait_text(r'^Working hours saved$', 20), app.text()[-300:])
    app.type_into('Block from', '2026-12-24')
    app.type_into('From time (IST)', '09:00')
    app.type_into('to', '2026-12-24')
    app.type_into('To time (IST)', '12:00')
    app.type_into('Block reason', 'E2E leave')
    app.click_text('Add block')
    check('toast "Blocked"', app.wait_text(r'^Blocked$', 20), app.text()[-300:])
    check('the block is listed', app.wait_text(r'Blocked 24 Dec, 09:00 IST → 24 Dec, 12:00 IST · E2E leave', 15), app.text()[-300:])
    app.click_text('Remove')
    check('the block is removed', app.wait_js("!/24 Dec, 09:00 IST/.test(document.body.innerText)", 15))
    check('"Mark me away" disabled without a reason', app.is_disabled('Mark me away'))
    app.type_into('Reason', 'E2E travel')
    app.click_text('Mark me away')
    check('toast "Marked away; your assignments are paused"', app.wait_text(rx('Marked away; your assignments are paused'), 20), app.text()[-300:])
    check('the pill reads Away', app.wait_text(r'^Away$', 15))
    app.type_into('Reason', 'E2E back')
    app.click_text('Mark me available')
    check('toast "You are available"', app.wait_text(r'^You are available$', 20), app.text()[-300:])
    app.type_into('Current password', 'not-the-password-1')
    app.type_into('New password', 'E2E-new-password-1')
    app.click_text('Change password')
    check('a wrong current password shows the API’s error and keeps the session', app.wait_text(r'password|Check|not accepted|incorrect', 20) and app.has_text('Password and MFA'), app.text()[:300])
    app.screenshot('coach-settings-security')


SECTIONS = {'today': today_section, 'refresh': refresh_section, 'clients': clients_section, 'record': record_section, 'plan': plan_section, 'ai': ai_section, 'withheld': withheld_section,
            'notifications': notifications_section, 'calendar': calendar_section, 'messages': messages_section, 'bloodwork': bloodwork_section, 'report': report_section, 'profile': profile_section, 'settings': settings_section}


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4201 (never the live demo).')
    why = ah.live_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server (BASE=http://127.0.0.1:<port>).' % (BASE, why))
    why = ah.port_refusal(APP_PORT) if not APP_URL else ah.live_refusal(APP_URL)
    if why:
        sys.exit('Refusing the app server %s: %s.' % (APP_URL or APP_PORT, why))
    if E2E_AS not in COACHES:
        sys.exit('E2E_AS must be one of %s' % ', '.join(sorted(COACHES)))
    only = [s.strip() for s in os.environ.get('E2E_APP_ONLY', '').split(',') if s.strip()] or list(DEFAULT_SECTIONS[E2E_AS])
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
        r = app.sign_in('coach', *COACHES[E2E_AS])
        check('%s signs in through the coach sign-in (the one sign-in of this run)' % E2E_AS.capitalize(), r['ok'], r['detail'])
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
            check('the coach signs out from More and lands on a sign-in screen', ok, d)
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
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'coach': E2E_AS, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
