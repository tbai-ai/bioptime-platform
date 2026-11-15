#!/usr/bin/env python3
"""End-to-end check of the administrative portal's module pages, part B, in the app (apps/mobile, its Expo web build)
in headless Chrome at a phone's size (Python 3.9, stdlib, Google Chrome; tools/app_harness.py).

    BASE=http://127.0.0.1:4391 APP_PORT=9391 E2E_CDP_PORT=9791 python3 -I tools/e2e_app_admin_mod_b.py
    BASE=… APP_URL=http://localhost:9391 E2E_ONLY=announcements,growth python3 -I tools/e2e_app_admin_mod_b.py

BASE is the scratch API (required; reset-demo first, started with CORS_ORIGINS=http://localhost:<APP_PORT>). The check
starts Expo web for apps/mobile on APP_PORT in its own process group and stops it (APP_URL drives a server that is
already running instead; start that one with EXPO_PUBLIC_API_BASE=http://localhost:<api port> so the website images
the course editor shows are same-site). As tools/e2e_app.py: the live demo's ports (3000, 3100, 3101, 8081) are refused
for BASE and the app, BASE must be an explicit port on 127.0.0.1, localhost, *.localhost or *.test, and E2E_OUT /
E2E_CDP_PORT keep parallel runs apart (defaults .local/e2e/app-admin-mod-b and 9791).

One sign-in through the screen (the owner, with the preview authenticator code of the demo server) is shared by every
section; one more from Python (ApiSession) reads what the screens wrote and, for the gates section only, switches the
growth module off and on again with a reason. Every section writes its own records, named with this run's stamp (an
announcement published and withdrawn, a session created, published and cancelled, a course with a module and a lesson
published and archived, a check-in template drafted and archived, a food added and published, an exercise added and
published and a team template built from it, a discovery call booked with a note, an offered time added and withdrawn,
a corporate enquiry noted, a newsletter sign-up taken off), so run it against a scratch server, never the live demo.
Every toast is looked for as the portal shows it: floating over the page (the aria-live region each screen renders next
to its scroll view) and inside the viewport, wherever on a long screen the action was taken.

Sections (E2E_ONLY, default all, in this order): announcements, sessions, learning, checkins, nutrition, exercises,
discovery, corporate, newsletter, gates. Also importable: run(app, ctx) adds the same checks to another runner (the
owner signed in). Exit status 1 if anything fails; the JSON summary is the last line."""
import json
import os
import random
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
APP_PORT = os.environ.get('APP_PORT') or '9391'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-admin-mod-b')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9791'
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
SECTION_NAMES = ('announcements', 'sessions', 'learning', 'checkins', 'nutrition', 'exercises', 'discovery', 'corporate', 'newsletter', 'gates')
HOME = r'^Overview$'
REASON = 'Checked with the team for this end-to-end run'
REASON_FIELD = 'Reason (recorded in the audit log)'
STAMP = time.strftime('%H%M%S')
GATE_WORDS = r'^Something went wrong$|^No connection$|^Signed out$|^Permission needed$|^No such page$'


# ---------------------------------------------------------------- helpers
def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def shot(app, name, settle=0.7):
    try:
        app.b.pump(settle)
        app.screenshot(name)
    except Exception:
        pass


def click_last(app, text):
    """Press the LAST button that reads `text` (a sheet's confirm repeats the words of the row button behind it; the
    sheet is appended at the end of the document)."""
    js = r"""(() => { const norm = (s) => (s || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim();
      const all = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => norm(e.innerText) === %s || norm(e.getAttribute('aria-label')) === %s);
      const el = all[all.length - 1]; if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()""" % (json.dumps(text), json.dumps(text))
    end = time.monotonic() + 10
    while time.monotonic() < end:
        if app.js(js):
            return True
        app.b.pump(0.3)
    return False


def click_in_row(app, row_text, button):
    """Press the button reading `button` in the row (the smallest block) that also reads `row_text`."""
    js = r"""(() => { const norm = (s) => (s || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim();
      const want = %s, label = %s; let best = null, size = Infinity;
      for (const b of Array.from(document.querySelectorAll('[role=button],button'))) {
        if (norm(b.innerText) !== label && norm(b.getAttribute('aria-label')) !== label) continue;
        let p = b.parentElement;
        while (p && !norm(p.innerText).includes(want)) p = p.parentElement;
        if (p && norm(p.innerText).length < size) { size = norm(p.innerText).length; best = b; } }
      if (!best) return false; best.scrollIntoView({block: 'center'}); best.click(); return true; })()""" % (json.dumps(row_text), json.dumps(button))
    end = time.monotonic() + 10
    while time.monotonic() < end:
        if app.js(js):
            return True
        app.b.pump(0.3)
    return False


TOAST_JS = r"""((src) => { const rx = new RegExp(src, 'im');
  return Array.from(document.querySelectorAll('[aria-live]')).some((e) => { const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
    const r = e.getBoundingClientRect(); return rx.test(t) && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }); })(%s)"""


def toast_seen(app, rx, seconds=20):
    """True once the screen's floating toast (the aria-live region next to the scroll view, never inline at the top of
    the content) reads `rx` and lies inside the viewport, however far down the page the action was taken."""
    return app.wait_js(TOAST_JS % json.dumps(rx), seconds)


def wait_gone(app, rx, seconds=10):
    """True once nothing on the screen matches `rx` (a filter that settles after typing)."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not app.has_text(rx):
            return True
        app.b.pump(0.3)
    return False


def confirm_reason(app, title_rx, confirm, reason=REASON):
    """Fill the reason sheet titled `title_rx` and press its confirm. True when the sheet showed."""
    if not app.wait_text(title_rx, 10):
        return False
    app.type_into(REASON_FIELD, reason)
    return click_last(app, confirm)


def open_screen(app, route, expect, name, seconds=60):
    app.open_route(route, expect, seconds)
    app.b.pump(1.0)
    errs = app.errors_since()
    missing = app.has_text(ah.NO_SUCH_SCREEN)
    box = app.has_text(GATE_WORDS)
    want = app.has_text(expect)
    ok = check(name, want and not errs and not missing and not box, '; '.join(errs[:3] + (['not-found screen'] if missing else []) + (['error or gate shown'] if box else []) + ([] if want else ['expected %r, saw %r' % (expect, app.text()[:160])])))
    no_labels(app, name)
    return ok


def screen_clean(app, name):
    errs = app.errors_since()
    check(name + ': no console error', not errs, '; '.join(errs[:3]))


def owner_session(ctx):
    if ctx.get('session') is None:
        code = ah.demo_totp(ctx['base'], OWNER[0])
        ctx['session'] = ah.ApiSession(ctx['base']).login(OWNER[0], OWNER[1], workspace='admin', mfa_code=code)
    return ctx['session']


def api_get(ctx, path):
    return owner_session(ctx).get(path)


def find(items, **kw):
    for it in items or []:
        if all(it.get(k) == v for k, v in kw.items()):
            return it
    return None


# ---------------------------------------------------------------- sections
def announcements_section(app, ctx):
    print('announcements: list, a new draft saved, published, then withdrawn with a reason')
    if not open_screen(app, '/admin/announcements', r'^Service news only$', 'announcements: the list opens with the service-news notice'):
        return
    check('announcements: the seeded team and coach announcements are listed with their status and reach', app.has_text(r'^Welcome to Bioptime$') and app.has_text(r'^From Asha Menon$') and app.has_text(r'^Reaches: Every member · \d+$'), app.text()[:200])
    title = 'Opening hours note %s' % STAMP
    app.click_text('New announcement')
    app.wait_text(r'^Packages \(optional\)$', 30)
    app.type_into('Title', title)
    app.type_into('Message', 'From next week the team answers messages from 9:00 to 18:00 IST.')
    app.click_text('Save draft')
    saved = toast_seen(app, r'^Draft saved$', 20)
    check('announcements: "Save draft" creates the draft and the screen follows it', saved and '/admin/announcements/ann_' in app.path(), app.path())
    app.click_text('Publish now')
    check('announcements: "Publish now" publishes it with the web\'s toast', toast_seen(app, r'^Published: members in its audience are notified$', 20), app.text()[:200])
    check('announcements: a published announcement opens read only with its reach', app.wait_text(r'^Reaches now$', 10) and app.has_text(r'^Written by$'), app.text()[:200])
    shot(app, 'mod-b-announcement-published')
    app.click_text('Withdraw')
    ok = confirm_reason(app, r'^Withdraw “%s”\?$' % title, 'Withdraw')
    check('announcements: "Withdraw" asks for a reason in the audit-log sheet', ok, app.text()[-200:])
    check('announcements: withdrawn, the reason shows under the announcement', app.wait_text(r'^Withdrawn by$', 20) and app.has_text(r'^%s$' % REASON), app.text()[:300])
    row = find(api_get(ctx, '/admin/announcements').get('items'), title=title)
    check('announcements: the API holds it withdrawn with the reason', bool(row) and row.get('status') == 'withdrawn' and row.get('withdrawReason') == REASON, json.dumps(row)[:200])
    coach = next((a for a in api_get(ctx, '/admin/announcements').get('items') or [] if a.get('origin') == 'coach'), None)
    if not coach:
        skip('announcements: the screen follows its address', 'no coach announcement in the seed')
    else:
        app.open_route('/admin/announcements/%s' % coach['id'], r'^Written by$', 45)
        app.open_route('/admin/announcements/new', r'^New announcement$', 30)
        app.b.pump(0.5)
        check('announcements: the same screen moved from a coach\'s announcement to /new shows an empty new draft', app.has_text(r'^New announcement$') and app.find_clickable('Save draft') and not app.has_text(r'^Written by$') and (app.input_value('Title') or '') == '', app.text()[:200])
    screen_clean(app, 'announcements')


def sessions_section(app, ctx):
    print('sessions: list, a new public webinar created, published and cancelled; attendance on a past session')
    if not open_screen(app, '/admin/sessions', r'^Video meetings: pending configuration$', 'sessions: the list opens with the video-provider notice'):
        return
    check('sessions: upcoming sessions show their span in IST, host and places', app.has_text(r'IST$') and app.has_text(r' registered'), app.text()[:200])
    title = 'Sleep webinar %s' % STAMP
    app.click_text('New session')
    app.wait_text(r'^Save as draft$', 20)
    app.type_into('Title', title)
    app.click_text('Webinar')
    app.click_text('Public (anyone, on the public listing)')
    app.click_text('Save as draft')
    check('sessions: "Save as draft" opens the new session with "Draft saved"', toast_seen(app, r'^Draft saved$', 30) and '/admin/sessions/lvs_' in app.path(), app.path())
    check('sessions: the draft notice and the host (Bioptime team) show', app.has_text(r'^Members cannot see it yet\. Publish it to open registration\.$') and app.has_text(r'\(Bioptime team\)$'), app.text()[:300])
    app.click_text('Publish')
    check('sessions: "Publish" opens registration', toast_seen(app, r'^Published: members in the audience can register$', 20), app.text()[:200])
    app.click_text('Cancel session')
    ok = confirm_reason(app, r'^Cancel this session\?$', 'Cancel session')
    check('sessions: "Cancel session" asks for a reason', ok, '')
    check('sessions: cancelled, with the reason as the notice', toast_seen(app, r'^Session cancelled$', 20) and app.wait_text(r'^%s$' % REASON, 10), app.text()[:300])
    shot(app, 'mod-b-session-cancelled')
    s = find(api_get(ctx, '/admin/sessions?range=all').get('items'), title=title)
    check('sessions: the API holds it cancelled, public, hosted by the team', bool(s) and s.get('status') == 'cancelled' and s.get('audience') == 'public', json.dumps(s)[:200])
    past = find(api_get(ctx, '/admin/sessions?range=past').get('items'), status='completed')
    if not past:
        skip('sessions: attendance on a past session', 'no completed session in the seed')
        return
    app.open_route('/admin/sessions/%s' % past['id'], r'^REGISTRATIONS$|^Registrations$', 45)
    check('sessions: a completed session shows the attendance choice for each person', app.wait_text(r'^No-show$', 20) and app.has_text(r'^Not recorded$'), app.text()[:300])
    screen_clean(app, 'sessions')


def learning_section(app, ctx):
    print('learning: a new course with a module and a lesson, the lesson and the course published, then archived')
    if not open_screen(app, '/admin/learning', r'^COURSES$|^Courses$', 'learning: the course list opens'):
        return
    check('learning: the seeded course is listed with its lessons and learners', app.has_text(r'^Getting started with courses$') and app.has_text(r'^Lessons: '), app.text()[:200])
    seeded = find(api_get(ctx, '/admin/courses').get('items'), title='Getting started with courses')
    if not seeded:
        skip('learning: the refusal to publish a video lesson', 'the seeded course is not there')
    else:
        app.open_route('/admin/learning/%s' % seeded['id'], r'^A video lesson \(draft\)$', 45)
        if not app.has_text(r'^A video lesson \(draft\)$'):
            skip('learning: the refusal to publish a video lesson', 'the seeded course has no draft video lesson')
        else:
            click_in_row(app, 'A video lesson (draft)', 'Publish')
            check('learning: "Publish" on a video lesson far down the outline shows the server\'s refusal floating in view', toast_seen(app, r'^A video lesson cannot be published yet\.', 20), app.text()[-200:])
            shot(app, 'mod-b-video-lesson-refused')
        app.open_route('/admin/learning', r'^COURSES$|^Courses$', 45)   # a fresh screen: the 409 above is the expected refusal
    title = 'Sleep basics %s' % STAMP
    app.click_text('New course')
    app.wait_text(r'^Create the draft$', 20)
    app.type_into('Title', title)
    app.click_text('Create the draft')
    check('learning: "Create the draft" opens the course editor', app.wait_text(r'^No modules yet$', 30) and '/admin/learning/' in app.path(), app.path())
    check('learning: a draft without a published lesson says so', app.has_text(r'^Publish at least one lesson before publishing the course\.$'), '')
    app.type_into('New module title', 'Basics')
    app.click_text('Add module')
    check('learning: "Add module" adds the module', toast_seen(app, r'^Module added$', 20), '')
    app.click_text('Add a lesson')
    app.wait_text(r'^New lesson$', 10)
    app.type_into('Title', 'A regular bedtime')
    app.type_into('Minutes', '4')
    app.type_into('Lesson text', '<p>Going to bed at the same time <strong>most nights</strong> helps.</p>')
    app.click_text('Preview')
    check('learning: the lesson preview shows the text as learners read it', app.wait_text(r'^Going to bed at the same time most nights helps\.$', 10), '')
    app.click_text('Add as a draft')
    check('learning: the lesson is added as a draft', toast_seen(app, r'^Lesson added as a draft$', 20) and app.wait_text(r'^A regular bedtime$', 10), '')
    click_in_row(app, 'A regular bedtime', 'Publish')
    check('learning: the lesson is published from the outline', toast_seen(app, r'^Lesson published$', 20), '')
    app.click_text('Publish')
    ok = confirm_reason(app, r'^Publish this course\?$', 'Publish')
    check('learning: publishing the course asks for a reason', ok and toast_seen(app, r'^Course published$', 20), app.text()[:200])
    app.click_text('Archive')
    ok = confirm_reason(app, r'^Archive this course\?$', 'Archive')
    check('learning: archiving the course asks for a reason and locks the editor', ok and toast_seen(app, r'^Course archived$', 20) and app.wait_text(r'^This course is archived', 10) and not app.find_clickable('Add module'), app.text()[:200])
    shot(app, 'mod-b-course-archived')
    c = find(api_get(ctx, '/admin/courses').get('items'), title=title)
    check('learning: the API holds the course archived with one published lesson', bool(c) and c.get('status') == 'archived' and (c.get('lessonCounts') or {}).get('published') == 1, json.dumps(c)[:200])
    screen_clean(app, 'learning')


def checkins_section(app, ctx):
    print('checkins: a library template drafted, then archived with a reason')
    if not open_screen(app, '/admin/checkin-templates', r'^Write a library template$', 'checkins: the library opens'):
        return
    app.click_text('Weekly check-in')
    check('checkins: a row opens its questions with their answer type', app.wait_text(r'^1\. .+ · 1 to 5', 10), app.text()[:200])
    title = 'Fortnightly check %s' % STAMP
    app.click_text('Write a library template')
    app.wait_text(r'^Save the draft$', 10)
    app.type_into('Title', title)
    app.type_into('Question 1', 'How rested do you feel this fortnight?')
    check('checkins: the key is derived from the question', (app.input_value('Key 1') or '').startswith('how_rested'), app.input_value('Key 1'))
    app.click_text('Save the draft')
    check('checkins: the draft is created', toast_seen(app, r'^Draft created; publish it when it is ready$', 20) and app.wait_text(title, 10), '')
    click_in_row(app, title, 'Archive')
    ok = confirm_reason(app, r'^Archive “%s”\?$' % title, 'Archive')
    check('checkins: "Archive" asks for a reason', ok and toast_seen(app, r'^Archived$', 20), app.text()[:200])
    t = find(api_get(ctx, '/admin/checkin-templates?scope=all').get('items'), title=title)
    check('checkins: the API holds the template archived', bool(t) and t.get('status') == 'archived', json.dumps(t)[:200])
    screen_clean(app, 'checkins')


def nutrition_section(app, ctx):
    print('nutrition: a food added as a draft, found by search and published with a reason')
    if not open_screen(app, '/admin/nutrition-library', r'^Nutrient values need a source$', 'nutrition: the library opens with the source notice'):
        return
    check('nutrition: the pending-configuration notices show', app.has_text(r'^Pending configuration: licensed food dataset$') and app.has_text(r'^Pending configuration: automatic estimates$'), '')
    name = 'Sprouted moong %s' % STAMP
    app.click_text('Add food')
    app.wait_text(r'^Add a food$', 10)
    app.type_into('Name', name)
    app.type_into('Serving', '1 katori')
    app.click_text('Save')
    check('nutrition: the food is added as a draft', toast_seen(app, r'^Food added as a draft$', 20), '')
    app.type_into('Name or title', STAMP)
    check('nutrition: the search finds it and only it', wait_gone(app, r'^Moong dal$', 15) and app.wait_text(name, 15), app.text()[:300])
    click_in_row(app, name, 'Publish')
    ok = confirm_reason(app, r'^Publish: %s$' % name, 'Publish')
    check('nutrition: "Publish" asks for a reason and changes the status', ok and toast_seen(app, r'^Status changed$', 20), app.text()[:200])
    f = find(api_get(ctx, '/admin/foods?q=%s' % STAMP).get('items'), name=name)
    check('nutrition: the API holds the food published', bool(f) and f.get('status') == 'published', json.dumps(f)[:200])
    screen_clean(app, 'nutrition')


def exercises_section(app, ctx):
    print('exercises: an exercise added and published; a team template built from it; a coach\'s template read only')
    if not open_screen(app, '/admin/exercise-library', r'^Demonstration media: pending configuration$', 'exercises: the library opens with the media notice'):
        return
    name = 'Wall sit %s' % STAMP
    app.click_text('Add exercise')
    app.wait_text(r'^Add an exercise$', 10)
    app.type_into('Name', name)
    app.type_into('Muscle groups (comma separated)', 'legs')
    app.click_text('Save')
    check('exercises: the exercise is added as a draft', toast_seen(app, r'^Draft exercise added$', 20), '')
    app.type_into('Search by name', STAMP)
    app.wait_text(name, 15)
    click_in_row(app, name, 'Publish')
    ok = confirm_reason(app, r'^Publish: %s$' % name, 'Confirm')
    check('exercises: "Publish" asks for a reason', ok and toast_seen(app, r'^Status changed$', 20), app.text()[:200])
    app.click_text('Templates')
    app.wait_text(r'^New team template$', 20)
    app.click_text('New team template')
    app.wait_text(r'^Exercises in order, each with sets, reps or a time, and rest\.$', 30)
    title = 'Wall work %s' % STAMP
    app.type_into('Title', title)
    app.click_text('Exercise')
    app.type_into('Search', STAMP)
    app.wait_text(name, 10)
    app.click_text(name)
    app.type_into('Reps', '30 s hold')
    click_last(app, 'Save')
    check('exercises: the team template is saved as a draft and its editor opens', toast_seen(app, r'^Team template saved as a draft$', 30) and '/admin/exercise-library/templates/wkt_' in app.path(), app.path())
    shot(app, 'mod-b-team-template')
    rows = api_get(ctx, '/admin/workout-templates').get('items')
    t = find(rows, title=title)
    check('exercises: the API holds the team template with its exercise', bool(t) and t.get('source') == 'team' and t.get('itemCount') == 1, json.dumps(t)[:200])
    coach = next((r for r in rows or [] if r.get('source') == 'coach'), None)
    if coach:
        app.open_route('/admin/exercise-library/templates/%s' % coach['id'], r'^Block: ', 45)
        check('exercises: a coach\'s template opens read only', app.has_text(r'^Block: ') and not app.find_clickable('Save') and not app.find_clickable('Add exercise'), app.text()[:200])
    screen_clean(app, 'exercises')


def discovery_section(app, ctx):
    print('discovery: a request booked and assigned with a note; an offered time added and withdrawn')
    if not open_screen(app, '/admin/growth/discovery-calls', r'^Offered times$', 'discovery: the requests open'):
        return
    rows = api_get(ctx, '/admin/growth/discovery-calls?status=all').get('items') or []
    r = next((x for x in rows if x.get('status') != 'closed'), None)
    if not r:
        skip('discovery: a request', 'no open request in the seed')
    else:
        app.open_route('/admin/growth/discovery-calls/%s' % r['id'], r'^Status and owner$|^STATUS AND OWNER$', 45)
        check('discovery: the request shows the goals, the contact and what they agreed to', app.wait_text(r'^Goals$|^GOALS$', 10) and app.has_text(r'^Agreed to$') and app.has_text(r'^%s$' % r['reference']), app.text()[:200])
        app.click_text('Booked')
        app.wait_text(r'^Agreed time \(IST\) \(optional\)$', 10)
        app.type_into('Agreed time (IST) (optional)', time.strftime('%Y-%m-%d', time.localtime(time.time() + 3 * 86400)))
        app.type_into('Time (IST)', '18:30')
        app.type_into('Note', 'Agreed by email for this run.')
        app.click_text('Save')
        check('discovery: the handling is saved', toast_seen(app, r'^Saved$', 20), app.text()[:200])
        app.type_into('New note', 'End-to-end note %s' % STAMP)
        app.click_text('Add note')
        check('discovery: a team note is added', toast_seen(app, r'^Note added$', 20) and app.wait_text('End-to-end note %s' % STAMP, 10), '')
        got = api_get(ctx, '/admin/growth/discovery-calls/%s' % r['id'])
        check('discovery: the API holds it booked at 18:30 IST with both notes', got.get('status') == 'booked' and (got.get('bookedAt') or '').endswith('13:00:00.000Z') and len(got.get('notes') or []) >= 2, json.dumps({k: got.get(k) for k in ('status', 'bookedAt', 'noteCount')}))
        shot(app, 'mod-b-discovery-booked')
    app.open_route('/admin/growth/discovery-calls?tab=times', r'^Times on the discovery call page$', 45)
    app.wait_text(r'^Times on the discovery call page$', 20)
    day = time.strftime('%Y-%m-%d', time.localtime(time.time() + (20 + random.randint(0, 30)) * 86400))
    minute = '%02d' % random.choice(range(0, 60, 5))
    app.type_into('Starts (IST)', day)
    app.type_into('Time (IST)', '07:%s' % minute)
    app.click_text('Offer this time')
    check('discovery: a time is offered on the website', toast_seen(app, r'^Time offered on the website$', 20), app.text()[:200])
    slots = api_get(ctx, '/admin/growth/slots').get('items') or []
    mine = next((s for s in slots if s.get('status') == 'published' and '07:%s' % minute in s.get('label', '') and day[8:].lstrip('0') in s.get('label', '')), None)
    if mine:
        click_in_row(app, mine['label'], 'Withdraw')
        ok = confirm_reason(app, r'^Stop offering ', 'Withdraw')
        check('discovery: the offered time is withdrawn with a reason', ok and toast_seen(app, r'^Withdrawn$', 20), app.text()[:200])
        after = find(api_get(ctx, '/admin/growth/slots').get('items'), id=mine['id'])
        check('discovery: the API holds the time withdrawn', bool(after) and after.get('status') == 'withdrawn', json.dumps(after)[:200])
    else:
        check('discovery: the new time is listed by the API', False, json.dumps(slots)[:200])
    screen_clean(app, 'discovery')


def corporate_section(app, ctx):
    print('corporate: an enquiry opened, its status changed, a note added')
    if not open_screen(app, '/admin/growth/corporate', r'^Corporate enquiries$', 'corporate: the enquiries open'):
        return
    rows = api_get(ctx, '/admin/growth/corporate?status=all').get('items') or []
    if not rows:
        skip('corporate: an enquiry', 'no enquiry in the seed')
        return
    e = rows[0]
    app.open_route('/admin/growth/corporate/%s' % e['id'], r'^Status and owner$|^STATUS AND OWNER$', 45)
    check('corporate: the enquiry shows the team size, the contact and the handling', app.wait_text(r'^A team of ', 10) and app.has_text(r'^Promise only what Bioptime runs today\.$|Promise only what Bioptime runs today\.$'), app.text()[:200])
    to = ('Contacted', 'contacted') if e.get('status') == 'in_discussion' else ('In discussion', 'in_discussion')
    app.click_text(to[0])
    app.click_text('Save')
    check('corporate: the status is saved', toast_seen(app, r'^Saved$', 20), '')
    app.type_into('New note', 'Corporate note %s' % STAMP)
    app.click_text('Add note')
    check('corporate: a team note is added', toast_seen(app, r'^Note added$', 20), '')
    got = api_get(ctx, '/admin/growth/corporate/%s' % e['id'])
    check('corporate: the API holds the new status with the note', got.get('status') == to[1] and any('Corporate note %s' % STAMP == n.get('body') for n in got.get('notes') or []), json.dumps({k: got.get(k) for k in ('status', 'noteCount')}))
    shot(app, 'mod-b-corporate')
    screen_clean(app, 'corporate')


def newsletter_section(app, ctx):
    print('newsletter: counts, the CSV, a sign-up taken off with a reason')
    if not open_screen(app, '/admin/growth/newsletter', r'^Download CSV$', 'newsletter: the subscribers open'):
        return
    check('newsletter: the three counts show', app.has_text(r'^Agreed twice$') and app.has_text(r'^Deleted 30 days after the link expires$'), '')
    app.click_text('All')
    app.b.pump(1.0)
    app.click_text('Download CSV')
    app.b.pump(2.0)
    check('newsletter: "Download CSV" fetches the export without an error', not app.has_text(r'could not be fetched'), app.text()[:200])
    rows = api_get(ctx, '/admin/growth/newsletter?status=all').get('items') or []
    s = next((x for x in rows if x.get('status') != 'unsubscribed'), None)
    if not s:
        skip('newsletter: unsubscribe', 'everyone in the seed has already left')
    else:
        click_in_row(app, s['email'], 'Unsubscribe')
        ok = confirm_reason(app, r'^Take %s off the newsletter\?$' % s['email'].replace('.', r'\.'), 'Unsubscribe')
        check('newsletter: "Unsubscribe" asks for a reason', ok and toast_seen(app, r'^Unsubscribed$', 20), app.text()[:200])
        after = find(api_get(ctx, '/admin/growth/newsletter?status=all').get('items'), id=s['id'])
        check('newsletter: the API holds the sign-up unsubscribed', bool(after) and after.get('status') == 'unsubscribed', json.dumps(after)[:200])
    shot(app, 'mod-b-newsletter')
    screen_clean(app, 'newsletter')


def gates_section(app, ctx):
    print('gates: every route answers for the owner; the growth module switched off shows "No such page" and loads nothing')
    for route, expect in (('/admin/announcements', r'^Service news only$'), ('/admin/sessions', r'^Video meetings: pending configuration$'), ('/admin/learning', r'^Video lessons: pending configuration$|^COURSES$'),
                          ('/admin/checkin-templates', r'^Write a library template$'), ('/admin/nutrition-library', r'^Nutrient values need a source$'), ('/admin/exercise-library', r'^Demonstration media: pending configuration$'),
                          ('/admin/growth/discovery-calls', r'^Offered times$'), ('/admin/growth/corporate', r'^Corporate enquiries$'), ('/admin/growth/newsletter', r'^Download CSV$')):
        app.open_route(route, expect, 45)
        check('gates: %s renders for the owner' % route, app.wait_text(expect, 20) and not app.has_text(GATE_WORDS), app.text()[:120])
    s = owner_session(ctx)
    st, j, _ = ah.api(ctx['base'], 'PATCH', '/admin/modules', {'key': 'growth', 'enabled': False, 'reason': 'End-to-end check of the growth module gate'}, token=s.token)
    if st != 200:
        check('gates: the growth module switched off through the API', False, '%s %s' % (st, json.dumps(j)[:160]))
        return
    try:
        print('  waiting 62 s for the app\'s flag cache (60 s) to lapse')
        app.open_route('/(admin)', HOME, 30)
        time.sleep(62)
        app.err_mark = len(app.b.errors)
        app.open_route('/admin/growth/newsletter', r'^No such page$', 45)
        check('gates: with growth off the newsletter screen shows "No such page" and no subscriber', app.wait_text(r'^No such page$', 30) and app.has_text(r'^This part of Bioptime is not switched on\.$') and not app.has_text(r'@example\.test'), app.text()[:160])
        reqs = [e for e in app.b.errors[app.err_mark:] if '/admin/growth/' in e]
        check('gates: nothing under /admin/growth was asked for while the module was off', not reqs, '; '.join(reqs[:2]))
        shot(app, 'mod-b-gate-growth-off')
    finally:
        ah.api(ctx['base'], 'PATCH', '/admin/modules', {'key': 'growth', 'enabled': True, 'reason': 'End-to-end check of the growth module gate, restored'}, token=s.token)


SECTIONS = {'announcements': announcements_section, 'sessions': sessions_section, 'learning': learning_section, 'checkins': checkins_section, 'nutrition': nutrition_section,
            'exercises': exercises_section, 'discovery': discovery_section, 'corporate': corporate_section, 'newsletter': newsletter_section, 'gates': gates_section}


def run(app, ctx, only=None):
    """The sections, for another runner (the owner is signed in) or main() below. ctx carries base, app_url, out."""
    ctx = dict(ctx)
    ctx.setdefault('session', None)
    names = [s for s in SECTION_NAMES if s in (only or SECTION_NAMES)]
    for name in names:
        t1 = time.monotonic()
        try:
            SECTIONS[name](app, ctx)
        except Exception as e:
            traceback.print_exc()
            check('%s: the section completed without an unexpected error' % name, False, repr(e)[:300])
        print('  (%s took %.0fs)' % (name, time.monotonic() - t1))
    if ctx.get('session'):
        ctx['session'].logout()


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4391 (never the live demo).')
    why = ah.live_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server.' % (BASE, why))
    why = ah.port_refusal(APP_PORT) if not APP_URL else ah.live_refusal(APP_URL)
    if why:
        sys.exit('Refusing the app server %s: %s.' % (APP_URL or APP_PORT, why))
    only = [s.strip() for s in os.environ.get('E2E_ONLY', '').split(',') if s.strip()] or list(SECTION_NAMES)
    unknown = [s for s in only if s not in SECTIONS]
    if unknown:
        sys.exit('E2E_ONLY names unknown sections %s; the sections are %s' % (unknown, ', '.join(SECTION_NAMES)))
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
        r = app.sign_in('admin', *OWNER, mfa='preview')
        check('the owner signs in through the administrative sign-in with the preview authenticator code', r['ok'] and r['mfa_asked'], r['detail'])
        if r['ok']:
            t1 = time.monotonic()
            run(app, {'base': BASE, 'app_url': app_url, 'out': ah.cs.OUT}, only)
            timings['sections'] = round(time.monotonic() - t1, 1)
            ok, d = app.sign_out()
            check('the owner signs out from More and lands on a sign-in screen', ok, d)
    except Exception as e:
        traceback.print_exc()
        check('the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        if app:
            try:
                app.screenshot('mod-b-last-screen')
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
    summary = ah.write_report({'base': BASE, 'app': app_url, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
