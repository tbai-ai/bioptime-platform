#!/usr/bin/env python3
"""End-to-end check of the coach's libraries, part B (apps/mobile, Expo web build, headless Chrome at 390x844; Python 3.9,
stdlib, Google Chrome): /coach/exercise-library (exercises: search, category filter, details, propose; templates),
/coach/templates/:id (a team template read-only, a new template created, saved, archived and restored),
/coach/workout-programs/:id (Ananya's published programme with its locked rows and a draft revision; a new programme for
Priya saved, published and archived; the client's Workouts tab linking in; /coach/programs/:id redirecting),
/coach/courses (+ the course read before assigning, a lesson, "Assign a course" from the course) and /coach/training
(a coach-training course started, two lessons marked complete, the course finished), and the module gate (workouts
switched off by the owner, then on again).

    BASE=http://127.0.0.1:4371 APP_PORT=9371 E2E_CDP_PORT=9771 python3 -I tools/e2e_app_coach_libs_b.py
    BASE=… APP_URL=http://localhost:9371 E2E_ONLY=library,template python3 -I tools/e2e_app_coach_libs_b.py   # a running Expo

BASE is the scratch API (required; the live demo's ports 3000, 3100, 3101 and 8081 are refused, as in tools/e2e_app.py),
started with BIOPTIME_MODE=demo and CORS_ORIGINS=http://localhost:<APP_PORT>. Without APP_URL the check starts
`npx expo start --web` for apps/mobile in its own process group and stops it at the end. E2E_OUT (screenshots,
report.json; default .local/e2e/app-coach-libs-b/) and E2E_CDP_PORT (default 9771) keep parallel runs apart.

Sign-ins: one through the app's coach sign-in (Asha) for the whole run; one coach sign-in from Python for record ids; one
owner sign-in (authenticator code from the demo-only GET /auth/demo/totp) to publish what the learning sections need (a
coach-training course and a member course assigned by coaches only), and two more for the gate section (module off,
then on). Sections (E2E_ONLY): library, template, program, courses, training, clienttab (the client record's Workouts
tab, another group's screen), gate. Writes to the scratch database: a proposed exercise, a template, a draft
revision of Ananya's programme, a programme for Priya (published, then archived), two courses, a course assignment and
the coach's progress in the training course. Exit status 1 if anything fails; the JSON summary is the last line."""
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
APP_PORT = os.environ.get('APP_PORT') or '9371'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-coach-libs-b')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9771'
SECTION_NAMES = ('library', 'template', 'program', 'courses', 'training', 'clienttab', 'gate')   # gate last: the app keeps the flags it read for a minute
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
EMAIL_RX = r'[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}'
PHONE_RX = r'\+91\s?\d{10}|\b9\d{9}\b'
TAG = time.strftime('%H%M%S')   # a unique word per run, so a second run against the same scratch database finds its own records
CTX = {}


# ---------------------------------------------------------------- helpers
def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def no_contacts(app, name):
    """A coach never sees an email address or a phone number on these screens."""
    text = app.text()
    hit = re.search(EMAIL_RX, text, re.I) or re.search(PHONE_RX, text)
    check(name + ': no email address or phone number on the screen', not hit, hit.group(0) if hit else '')


def open_screen(app, route, expect, name, shot=None, seconds=45):
    """Open a route; check it drew `expect`, raised no console error, shows no error box and no label; screenshot."""
    app.open_route(route, expect, seconds)
    ok = app.page_ok(name, expect)
    no_labels(app, name)
    if shot:
        app.screenshot(shot)
    return ok


def wait_path(app, rx, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if re.search(rx, app.path() or ''):
            return True
        app.b.pump(0.3)
    return False


def wait_gone(app, rx, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not app.has_text(rx):
            return True
        app.b.pump(0.3)
    return False


LAST_BUTTON = r"""(text) => { %s const t = norm(text);
  const all = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => norm(e.innerText) === t || norm(e.getAttribute('aria-label')) === t);
  return all.length ? all[all.length - 1] : null; }""" % ah._NORM

NTH_LABELLED = r"""(label, n, roles) => { const all = Array.from(document.querySelectorAll(roles)).filter((e) => (e.getAttribute('aria-label') || '') === label && !e.closest('[aria-hidden="true"]'));
  return all[n] || null; }"""


def click_last(app, text, seconds=10):
    """Press the LAST button of that name: a sheet is appended to the body, so its button comes after the screen's own."""
    if not app.wait_js("!!(%s)(%s)" % (LAST_BUTTON, json.dumps(text)), seconds):
        return False
    return bool(app.js("((el) => { if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })((%s)(%s))" % (LAST_BUTTON, json.dumps(text))))


def last_disabled(app, text):
    return bool(app.js("((el) => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true'))((%s)(%s))" % (LAST_BUTTON, json.dumps(text))))


def has_button(app, text):
    """A real button reads `text` (a bold phrase in a lesson's body is not one)."""
    return bool(app.js("(() => { %s return Array.from(document.querySelectorAll('[role=button],button')).some((e) => norm(e.innerText) === %s && !e.closest('[aria-hidden=true]')); })()" % (ah._NORM, json.dumps(text))))


def count_labelled(app, label, roles='[role=button],button'):
    return app.js("Array.from(document.querySelectorAll(%s)).filter((e) => (e.getAttribute('aria-label') || '') === %s && !e.closest('[aria-hidden=\"true\"]')).length" % (json.dumps(roles), json.dumps(label))) or 0


def click_nth(app, label, n, roles='[role=button],button'):
    """Press the n-th control (0-based) whose accessible name is `label` (the template rows' "Exercise", "Move up")."""
    return bool(app.js("((el) => { if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })((%s)(%s, %d, %s))" % (NTH_LABELLED, json.dumps(label), n, json.dumps(roles))))


def type_nth(app, label, n, value):
    """Fill the n-th input whose aria-label is `label` (every template row has its own "Reps", "Time (s)")."""
    got = app.js("((el) => el ? (%s)(el, %s) : null)((%s)(%s, %d, 'input,textarea'))" % (ah.SET_VALUE, json.dumps(value), NTH_LABELLED, json.dumps(label), n))
    return got == value


def pick(app, control, option, n=0):
    """Open a select (its accessible name, the n-th of that name) and choose an option by its label."""
    if not click_nth(app, control, n):
        return False
    app.b.pump(0.9)   # the sheet slides in
    if not click_last(app, option):
        return False
    app.b.pump(0.6)
    return True


def expected_refusals(app, name, path, status='400'):
    """The refusals a check provoked on purpose (`status` from `path`) are the only console errors since the screen
    opened; they are then set aside, so the screen's later checks count only new errors."""
    errs = app.errors_since()
    other = [e for e in errs if not (('status of %s' % status) in e and path in e)]
    check(name + ': the only console errors are the provoked %ss from %s' % (status, path), not other, '; '.join(other[:3]))
    app.err_mark = len(app.b.errors)


def sheet_open(app, title):
    return app.wait_text(r'^%s$' % re.escape(title), 10)


class Ids:
    """Record ids the sections open, read from the scratch API with one coach sign-in."""

    def __init__(self):
        self.coach = ah.ApiSession(BASE).login(*COACH, workspace='coach')
        clients = self.coach.get('/coach/clients?limit=100&sort=name')['items']
        self.priya = next((c['id'] for c in clients if c['name'] == 'Priya Nair'), None)
        self.ananya = next((c['id'] for c in clients if c['name'] == 'Ananya Rao'), None)
        tpls = self.coach.get('/coach/workout-templates?includeArchived=1')['items']
        self.team_template = next((t for t in tpls if t['source'] == 'team' and t['status'] == 'published'), None)
        self.own_template = next((t for t in tpls if t['source'] == 'coach' and t['status'] == 'published'), None)
        progs = self.coach.get('/coach/workout-programs')['items']
        self.ananya_program = next((p for p in progs if p['memberName'] == 'Ananya Rao' and p['status'] == 'published'), None)
        self.course = next(iter(self.coach.get('/coach/courses')['items']), None)

    def learning_of(self, member):
        try:
            return self.coach.get('/coach/clients/%s/learning' % member).get('items') or []
        except RuntimeError:
            return []

    def close(self):
        self.coach.logout()


def owner_session():
    owner = ah.ApiSession(BASE)
    owner.login(*OWNER, workspace='admin', mfa_code=ah.demo_totp(BASE, OWNER[0]))
    return owner


def seed_courses(training=True, member_course=True):
    """What the learning sections need and the seed does not have, published by the owner in one sign-in: a short
    coach-training course (audience 'coaches', one module, two written lessons) for the training screens, and a member
    course for coach assignment (audience 'assigned_only', one lesson) that no client holds yet, so "Assign a course"
    can be sent from the course. Returns {'training': (title, first lesson title) | None, 'member': {id, title} | None,
    'why': reason when something could not be made}."""
    out = {'training': None, 'member': None, 'why': ''}
    try:
        owner = owner_session()
    except RuntimeError as e:
        out['why'] = str(e)
        return out

    def course(title, summary, audience, lessons):
        c = owner.post('/admin/courses', {'title': title, 'summary': summary, 'audience': audience})
        owner.post('/admin/courses/%s/modules' % c['id'], {'title': 'First conversations' if audience == 'coaches' else 'Before we start'})
        module_id = (owner.get('/admin/courses/%s' % c['id']).get('modules') or [{}])[0].get('id')
        if not module_id:
            raise RuntimeError('no module id for %s' % title)
        for t, body in lessons:
            owner.post('/admin/course-modules/%s/lessons' % module_id, {'title': t, 'kind': 'written', 'body': body, 'durationMinutes': 3})
        for m in owner.get('/admin/courses/%s' % c['id']).get('modules') or []:
            for lesson in m.get('lessons') or []:
                owner.post('/admin/lessons/%s/publish' % lesson['id'])
        owner.post('/admin/courses/%s/publish' % c['id'], {'reason': 'Published by the app check for the coach learning screens'})
        return c['id']
    try:
        if training:
            lessons = [
                ('Opening the conversation', '<p>Start with <strong>what the client wants</strong> from the call.</p><ul><li>Ask one open question</li><li>Listen before advising</li></ul>'),
                ('Closing with a next step', '<h3>One next step</h3><p>Agree on <em>one</em> thing to do before you speak again.</p><ol><li>Name it</li><li>Write it down</li></ol>'),
            ]
            title = 'Coaching conversations %s' % TAG
            course(title, 'How to open and close a coaching conversation, in two short lessons.', 'coaches', lessons)
            out['training'] = (title, lessons[0][0])
        if member_course:
            title = 'Your first month %s' % TAG
            cid = course(title, 'What to expect in the first month of a programme.', 'assigned_only', [('What happens first', '<p>Your coach reads your answers and writes your plan.</p>')])
            out['member'] = {'id': cid, 'title': title}
    except RuntimeError as e:
        out['why'] = str(e)
    finally:
        owner.logout()
    return out


# ---------------------------------------------------------------- the exercise library
def library_section(app, ids):
    print('library: /coach/exercise-library')
    open_screen(app, '/coach/exercise-library', r'^Exercise library$', 'exercise library', 'libs-b-exercise-library')
    check('sub-title and the Exercises / Templates tabs', app.has_text(r'Exercises and templates to build your clients’ workout programmes from\. Propose an exercise and the Bioptime team reviews it\.') and app.find_clickable('Exercises') and app.find_clickable('Templates'))
    check('the demonstration-media notice (text only until licensed media and a video host)', app.wait_text(r'^Demonstration media: not available yet$', 20) and app.has_text(r'Exercises are text only until licensed demonstration media and a video host are in place\.'))
    check('eyebrow, count and the seeded exercises with source and status', app.has_text(r'^Published and your drafts$') and app.has_text(r'^\d+ exercises?$') and app.has_text(r'^Bodyweight Squat$') and app.has_text(r'^Step-Up$') and app.has_text(r'Bioptime team') and app.has_text(r'Coach · Asha Menon'), app.text()[:300])
    check('a coach proposal reads Draft, a team exercise Published', app.has_text(r'^DRAFT$|^Draft$') and app.has_text(r'^PUBLISHED$|^Published$'))
    check('search by name narrows the list', app.type_into('Search by name', 'plank') and app.wait_text(r'^Front Plank$', 15) and wait_gone(app, r'^Bodyweight Squat$', 15))
    app.type_into('Search by name', '')
    app.wait_text(r'^Bodyweight Squat$', 15)
    check('the category filter (Mobility) narrows the list', app.click_text('Mobility') and app.wait_text(r'^Cat-Cow$', 15) and wait_gone(app, r'^Bodyweight Squat$', 15))
    check('"Every category" brings every exercise back', app.click_text('Every category') and app.wait_text(r'^Bodyweight Squat$', 15))
    check('a row opens its details (Category, Equipment, Muscle groups, Source, Status)', app.click_text('Bodyweight Squat') and app.wait_text(r'^Muscle groups$', 10) and app.has_text(r'^Equipment$') and app.has_text(r'^None$'))
    app.screenshot('libs-b-exercise-details')
    # propose
    check('"Propose an exercise" opens the sheet with the web\'s fields and note', app.click_text('Propose an exercise') and sheet_open(app, 'Propose an exercise') and app.has_input('Name') and app.has_input('Instructions') and app.has_input('Equipment (comma separated)') and app.has_input('Muscle groups (comma separated)') and app.has_text(r'A proposal is a draft: you can use it in your own templates now, and every coach sees it once the Bioptime team publishes it\.') and app.has_text(r'How to perform it, in plain steps\. No medical, rehabilitation or injury-prevention claims\.'))
    app.type_into('Name', 'W')
    check('the server\'s rule shows on the Name field (at least 2 characters)', click_last(app, 'Propose') and app.wait_text(r'String must contain at least 2 character', 15))
    name = 'Wall sit %s' % TAG
    app.type_into('Name', name)
    check('the category is chosen from its sheet', pick(app, 'Category', 'Core') and app.wait_text(r'^Core$', 5))
    app.type_into('Equipment (comma separated)', 'wall')
    app.type_into('Muscle groups (comma separated)', 'legs, core')
    app.screenshot('libs-b-propose-sheet')
    check('Propose sends it (toast) and the list shows it as a draft', click_last(app, 'Propose') and app.wait_text(r'^Proposed: the Bioptime team reviews it$', 15) and app.wait_text(r'^%s$' % re.escape(name), 15))
    expected_refusals(app, 'propose', '/api/coach/exercises')
    CTX['proposed'] = name
    # templates
    check('the Templates tab lists team templates and the coach\'s own', app.click_text('Templates') and app.wait_text(r'^Team templates and yours$', 15) and app.wait_text(r'^Full body A$', 15) and app.has_text(r'^Lower body$') and app.has_text(r'^\d+ templates?$'), app.text()[:300])
    check('own templates offer Edit, team templates View; New template; Show archived', app.find_clickable('Edit') and app.find_clickable('View') and app.find_clickable('New template') and app.find_clickable('Show archived'))
    check('Show archived toggles to Hide archived', app.click_text('Show archived') and app.wait_clickable('Hide archived', 10))
    app.click_text('Hide archived')
    no_contacts(app, 'exercise library')
    app.page_ok('exercise library after the actions', r'^Exercise library$')
    app.screenshot('libs-b-templates-tab')


# ---------------------------------------------------------------- the template editor
def template_section(app, ids):
    print('template: /coach/templates/:id')
    t = ids.team_template
    if t:
        open_screen(app, '/coach/templates/%s' % t['id'], r'^%s$' % re.escape(t['title']), 'team template (read-only)', 'libs-b-template-team')
        check('team template: back link, source line and exercises, no Save', app.has_text(r'^← Exercise library$') and app.has_text(r'Bioptime team · .* · \d+ exercises?') and app.has_text(r'^Exercises$') and app.has_text(r'\d+ × ') and not app.find_clickable('Save'), app.text()[:300])
    else:
        skip('team template read-only', 'no published team template in the seed')
    open_screen(app, '/coach/templates/new', r'^New template$', 'new template', 'libs-b-template-new')
    check('new template: sub-title, Basics fields, the first row and the footnote', app.has_text(r'Exercises in order, each with sets, reps or a time, and rest\.') and app.has_input('Title') and app.has_input('Estimated minutes') and app.find_clickable('Level') and app.has_text(r'^0 in order$') and app.has_text(r'Give reps or a time for each exercise\. Sessions already given to clients keep the version they were given\.'))
    check('row controls carry the web\'s names (Move up, Move down, Remove exercise)', count_labelled(app, 'Move up') >= 1 and count_labelled(app, 'Move down') >= 1 and count_labelled(app, 'Remove exercise') >= 1)
    check('Save with no title shows the server\'s rule', app.click_text('Save') and app.wait_text(r'title: String must contain at least 2 character', 15))
    title = 'Mobility flow %s' % TAG
    app.type_into('Title', title)
    check('an exercise is chosen in the first row', pick(app, 'Exercise', 'Cat-Cow', 0) and app.wait_text(r'^1 in order$', 10))
    check('a row with neither reps nor a time shows the server\'s rule on the row', app.click_text('Save') and app.wait_text(r'Give the reps or a duration for each exercise', 15))
    type_nth(app, 'Reps', 0, '8-10')
    expected_refusals(app, 'new template', '/api/coach/workout-templates')
    check('Add exercise adds a second row', app.click_text('Add exercise') and app.wait_js("(%s)('Exercise', 1, '[role=button],button') !== null" % NTH_LABELLED, 10))
    check('the second row takes the coach\'s own draft exercise', pick(app, 'Exercise', 'Step-Up (your draft)', 1) and app.wait_text(r'^2 in order$', 10))
    type_nth(app, 'Time (s)', 1, '30')
    check('Move up puts the second row first', click_nth(app, 'Move up', 1) and app.wait_js("(() => { const b = Array.from(document.querySelectorAll('[role=button]')).filter((e) => e.getAttribute('aria-label') === 'Exercise'); return b.length === 2 && /Step-Up/.test(b[0].innerText); })()", 10))
    app.screenshot('libs-b-template-rows')
    check('Save creates the template and opens its editor (toast Template saved)', app.click_text('Save') and wait_path(app, r'/coach/templates/wkt_', 30) and app.wait_text(r'^Template saved$', 15) and app.wait_text(r'^%s$' % re.escape(title), 15), app.path())
    app.page_ok('template editor (created)', r'^%s$' % re.escape(title))
    check('the created template: Coach · Asha Menon · 2 exercises, Published, Archive', app.wait_text(r'Coach · Asha Menon · 2 exercises', 15) and app.has_text(r'^PUBLISHED$|^Published$') and app.find_clickable('Archive'), app.text()[:200])
    check('Archive (toast Template archived) turns the button into Restore', app.click_text('Archive') and app.wait_text(r'^Template archived$', 15) and app.wait_clickable('Restore', 15) and app.wait_text(r'^ARCHIVED$|^Archived$', 15))
    app.screenshot('libs-b-template-archived')
    check('Restore (toast Template restored)', app.click_text('Restore') and app.wait_text(r'^Template restored$', 15) and app.wait_clickable('Archive', 15))
    app.type_into('Title', title + ' v2')
    check('an edit saves (toast Template saved) and the title follows', app.click_text('Save') and app.wait_text(r'^Template saved$', 15) and app.wait_text(r'^%s v2$' % re.escape(title), 15))
    CTX['template'] = title + ' v2'
    check('back to the library: the Templates tab lists the new template', app.click_text('← Exercise library') and app.wait_text(r'^Exercise library$', 20) and app.click_text('Templates') and app.wait_text(r'^%s v2$' % re.escape(title), 20))
    app.page_ok('library after the editor', r'^Exercise library$')


# ---------------------------------------------------------------- the programme editor
def program_section(app, ids):
    print('program: /coach/workout-programs/:id')
    p = ids.ananya_program
    if p:
        route = '/coach/workout-programs/%s' % p['id']
        open_screen(app, route, r'^%s$' % re.escape(p['title']), 'programme (published, Ananya)', 'libs-b-program-published')
        note = r'draft revision not yet published' if p.get('draft') else r'Editing creates a draft revision; the published version stays with the client until you publish it\.'
        check('version line, status, the three actions and the revision note', app.has_text(r'^Version \d+ · Ananya Rao') and app.has_text(r'^PUBLISHED$|^Published$') and app.find_clickable('Save draft') and app.find_clickable('Publish revision') and app.find_clickable('Archive') and app.has_text(note), app.text()[:300])
        check('Sessions · So far: Done, Skipped, To come, Started', app.has_text(r'^So far$') and app.has_text(r'\d+ completed, \d+ partly') and app.has_text(r'^To come$') and app.has_text(r'^Started$'))
        check('weekly structure: weeks, the lock note, logged rows read "Logged"', app.has_text(r'^\d+ weeks?$') and app.has_text(r'Weeks keep their numbers once published') and len(re.findall(r'(?m)^Logged$', app.text())) >= 1, str(len(re.findall(r'(?m)^Logged$', app.text()))))
        logged = len(re.findall(r'(?m)^Logged$', app.text()))
        check('the logged days match the server (%d)' % len(p.get('loggedDays') or []), logged == len(p.get('loggedDays') or []), str(logged))
        weeks = (p.get('draft') or p['published'])['structure']['weeks']
        check('only the last, unlogged week can be removed', len(re.findall(r'(?m)^Remove week$', app.text())) <= 1 and (app.find_clickable('Remove week') == (weeks[-1]['week'] not in (p.get('loggedWeeks') or []))))
        check('versions: History lists version 1 as published', app.has_text(r'^History$') and app.has_text(r'Version 1 · published'))
        no_contacts(app, 'programme editor')
        app.type_into('Week %d focus' % weeks[-1]['week'], 'Lower body, slower %s' % TAG)
        check('Save draft keeps a draft revision (toast Draft saved)', app.click_text('Save draft') and app.wait_text(r'^Draft saved$', 20) and app.wait_text(r'draft revision not yet published', 20))
        app.screenshot('libs-b-program-draft-revision')
        app.open_route('/coach/programs/%s' % p['id'], None, 30)
        check('/coach/programs/:id redirects to the editor at /coach/workout-programs/:id', wait_path(app, r'^/coach/workout-programs/%s' % re.escape(p['id']), 20) and app.wait_text(r'^%s$' % re.escape(p['title']), 20), app.path())
    else:
        skip('Ananya\'s programme', 'no published programme in the seed')
    if not ids.priya:
        skip('new programme', 'Priya is not among Asha\'s clients')
        return
    open_screen(app, '/coach/workout-programs/new?member=%s' % ids.priya, r'^New workout programme$', 'new programme (Priya)', 'libs-b-program-new')
    check('new programme: sub-title, the client chosen from the link, start date and the scope note', app.has_text(r'A draft until you publish it\. Publishing gives the client their sessions and tells them\.') and app.wait_text(r'^Priya Nair$', 15) and app.has_input('Start date (sessions are dated from it)') and app.has_text(r'Only training within your professional scope\. No medical, rehabilitation or injury-prevention claims; no calorie figures\.'))
    check('an empty week reads as a rest week', app.has_text(r'A rest week\. Add a day to plan a session\.'))
    title = 'Walking block %s' % TAG
    app.type_into('Title', title)
    check('Add day adds a day row with a template choice', app.click_text('Add day') and app.wait_js("(%s)('Template', 0, '[role=button],button') !== null" % NTH_LABELLED, 10))
    check('a template is chosen for the day (team templates read "· team")', pick(app, 'Template', 'Walk and mobility · team', 0) and app.wait_text(r'^Walk and mobility · team$', 10))
    check('Add week copies the last week\'s days (2 weeks)', app.click_text('Add week') and app.wait_text(r'^2 weeks$', 10) and app.has_text(r'^Week 2$') and count_labelled(app, 'Template') == 2)
    app.screenshot('libs-b-program-new-filled')
    check('Save draft creates it and opens its editor (toast Draft saved, Draft pill, Publish)', app.click_text('Save draft') and wait_path(app, r'/coach/workout-programs/wpg_', 30) and app.wait_text(r'^Draft saved$', 15) and app.wait_text(r'^%s$' % re.escape(title), 15) and app.wait_text(r'^DRAFT$|^Draft$', 10) and app.wait_clickable('Publish', 10), app.path())
    app.page_ok('programme editor (draft)', r'^%s$' % re.escape(title))
    check('Publish gives the client their sessions (toast)', app.click_text('Publish') and app.wait_text(r'^Published: the client has their sessions$', 20) and app.wait_text(r'^PUBLISHED$|^Published$', 15) and app.wait_clickable('Publish revision', 15))
    check('Archive asks for a reason with the web\'s wording', app.click_text('Archive') and sheet_open(app, 'Archive this programme?') and app.has_text(r'Sessions still to come are removed; what the client logged stays in their history\.') and app.has_input('Reason (recorded in the audit log)') and app.find_clickable('Keep as is'))
    app.type_into('Reason (recorded in the audit log)', 'ab')
    check('a reason under three characters: "Say why, in a few words."', click_last(app, 'Archive') and app.wait_text(r'^Say why, in a few words\.$', 10))
    app.type_into('Reason (recorded in the audit log)', 'Client asked to pause')
    check('archiving closes it (toast Programme archived, Archived notice, no actions)', click_last(app, 'Archive') and app.wait_text(r'^Programme archived$', 20) and app.wait_text(r'This programme is closed\. Sessions the client logged stay in their history\.', 15) and not app.find_clickable('Save draft'))
    app.screenshot('libs-b-program-archived')
    CTX['priya_program'] = (app.path(), title)


def clienttab_section(app, ids):
    """The way in and out of the editor through the client's record (another group's screen, /coach/clients/:id?tab=):
    "← Client" lands on the Workouts tab, which lists the programme, and its "New workout programme" opens this editor.
    Run after the sections of this tree (a client record that cannot be bundled reloads the page and ends the session)
    and before the gate (which leaves the app's flags reading "off" for a minute)."""
    print('clienttab: the client record\'s Workouts tab and the editor')
    if not ids.priya:
        skip('client record', 'Priya is not among Asha\'s clients')
        return
    route, title = CTX.get('priya_program') or ('/coach/workout-programs/new?member=%s' % ids.priya, None)
    app.open_route(route, r'^← Client$', 30)
    check('"← Client" goes to the client\'s record on the Workouts tab', app.click_text('← Client') and wait_path(app, r'^/coach/clients/%s' % re.escape(ids.priya), 20) and 'tab=workouts' in (app.js('location.search') or '') , '%s%s' % (app.path(), app.js('location.search')))
    shown = app.wait_text(r'^Workout programmes$', 40)
    check('the client record shows the Workouts tab with its programmes', shown and (not title or app.wait_text(re.escape(title), 20)), '; '.join(app.errors_since()[:2]) or app.text()[:200])
    if shown:
        check('the Workouts tab\'s "New workout programme" opens this editor for the client', app.click_text('New workout programme') and wait_path(app, r'^/coach/workout-programs/new', 20) and app.wait_text(r'^New workout programme$', 20) and app.wait_text(r'^Priya Nair$', 20))
        app.page_ok('new programme from the Workouts tab', r'^New workout programme$')


# ---------------------------------------------------------------- courses
def courses_section(app, ids):
    print('courses: /coach/courses')
    c = ids.course
    open_screen(app, '/coach/courses', r'^Courses$', 'courses', 'libs-b-courses')
    check('sub-title as on the web', app.has_text(r'Published courses from the Bioptime team that you can assign to your clients\. Read one here; assign it from the client’s record, on the Learning tab\.'))
    if not c:
        check('the empty state', app.has_text(r'^No courses yet$'))
        return
    check('a course card: audience · lessons, title, outline and "Read the course"', app.wait_text(r'^%s$' % re.escape(c['title']), 15) and app.has_text(r'^Every member · \d+ lessons?|· \d+ lessons?') and app.has_text(re.escape(c['modules'][0]['title'])) and app.find_clickable('Read the course'), app.text()[:300])
    check('"Read the course" opens it', app.click_text('Read the course') and wait_path(app, r'/coach/courses/%s$' % re.escape(c['id']), 20) and app.wait_text(r'^← Courses$', 20) and app.wait_text(r'^%s$' % re.escape(c['title']), 20))
    app.page_ok('course (read before assigning)', r'^%s$' % re.escape(c['title']))
    no_labels(app, 'course preview')
    check('preview notice, Read the first lesson, Lessons, no progress card', app.has_text(r'You are reading this course as its learners see it\. Assign it from a client’s record, on the Learning tab\.') and app.find_clickable('Read the first lesson') and app.has_text(r'^Lessons$') and not app.has_text(r'^In this course$|^Not started$') and not app.has_text(r'^DONE$|^Done$|^OPENED$|^Opened$'))
    app.screenshot('libs-b-course-preview')
    # assign from the course: the member course the owner published for this run (assigned by a coach only)
    mc = (CTX.get('seed') or {}).get('member')
    if mc and ids.ananya:
        open_screen(app, '/coach/courses/%s' % mc['id'], r'^%s$' % re.escape(mc['title']), 'course to assign (assigned by a coach only)')
        check('"Assign to a client" opens "Assign a course" with the course, its audience and the Client choice', app.click_text('Assign to a client') and sheet_open(app, 'Assign a course') and app.wait_text(re.escape('%s (1 lesson)' % mc['title']), 10) and app.has_text(r'^Assigned by a coach\.$') and app.wait_clickable('Client', 15) and app.has_text(r'Shown with the course on their Learn page; not included in the notification\.'))
        check('Assign stays disabled until a client is chosen', last_disabled(app, 'Assign'))
        check('the client is chosen from the coach\'s own clients', pick(app, 'Client', 'Ananya Rao') and app.wait_text(r'^Ananya Rao$', 10))
        app.type_into('Note for the client', 'Read this before our next call')
        app.screenshot('libs-b-course-assign')
        check('Assign sends it (toast Course assigned: the client is told)', click_last(app, 'Assign') and app.wait_text(r'^Course assigned: the client is told$', 20))
        rows = [r for r in ids.learning_of(ids.ananya) if r.get('courseId') == mc['id']]
        check('the client\'s learning lists it, assigned by a coach, with the note (API)', bool(rows) and rows[0].get('source') == 'coach_assigned' and rows[0].get('assignedNote') == 'Read this before our next call', json.dumps(rows)[:200])
        check('assigning it again is refused with the server\'s reason, shown in the sheet', app.click_text('Assign to a client') and sheet_open(app, 'Assign a course') and pick(app, 'Client', 'Ananya Rao') and click_last(app, 'Assign') and app.wait_js("document.body.innerText.includes('Assign a course') && !/^Course assigned/m.test(document.body.innerText)", 10) and app.wait_text(r'already|enrolled|has this course|taking', 15), app.text()[-300:])
        expected_refusals(app, 'assign again', '/courses', '409')
        click_last(app, 'Not now')
        app.open_route('/coach/courses/%s' % c['id'], r'^%s$' % re.escape(c['title']), 30)
    else:
        skip('assign from the course', (CTX.get('seed') or {}).get('why') or 'no member course to assign')
    check('"Read the first lesson" opens the first lesson, read only', app.click_text('Read the first lesson') and app.wait_text(r'You are reading a member course before assigning it\. Progress is recorded only for its learners\.', 20) and not has_button(app, 'Mark as complete'))
    first = c['modules'][0]['lessons'][0]
    app.page_ok('lesson (read before assigning)', r'^%s$' % re.escape(first['title']))
    check('lesson line: module · lesson 1 of n · kind, and the back link to the course', app.has_text(r'^%s · lesson 1 of \d+ · ' % re.escape(c['modules'][0]['title'])) and app.has_text(r'^← %s$' % re.escape(c['title'])))
    app.screenshot('libs-b-course-lesson')
    check('"Next lesson →" opens the checklist lesson with its list items', app.click_text('Next lesson →') and app.wait_text(r'^Open the lesson$', 20) and app.has_text(r'^•$') and app.find_clickable('← Previous'))
    app.page_ok('second lesson (read before assigning)')
    app.screenshot('libs-b-course-lesson-list')


# ---------------------------------------------------------------- training
def training_section(app, ids):
    print('training: /coach/training')
    seeded = (CTX.get('seed') or {}).get('training')
    title, first = seeded if seeded else (None, None)
    check('the owner published a coach-training course for the check', bool(title), (CTX.get('seed') or {}).get('why') or title)
    open_screen(app, '/coach/training', r'^Training$', 'training', 'libs-b-training')
    check('sub-title and the two cards', app.has_text(r'Courses for coaches from the Bioptime team\. Your progress is saved as you mark each lesson complete\.') and app.has_text(r'^In progress and done$'))
    if not title:
        return
    check('the course is available to start (lessons · Coach training)', app.wait_text(r'^Training you can start$', 20) and app.wait_text(r'^%s$' % re.escape(title), 20) and app.has_text(r'2 lessons · about 6 min · Coach training'), app.text()[:300])
    check('"See the lessons" opens the course: Not started, Start this course', app.click_text('See the lessons') and app.wait_text(r'^← Training$', 20) and app.wait_text(r'^Not started$', 20) and app.has_text(r'Coach training\. Start the course to keep your progress\.') and app.find_clickable('Start this course'))
    app.page_ok('training course (not started)', r'^%s$' % re.escape(title))
    app.screenshot('libs-b-training-course')
    check('"Start this course" enrols (toast Enrolled) and opens the first lesson', app.click_text('Start this course') and app.wait_text(r'^Enrolled$', 15) and app.wait_text(r'^%s$' % re.escape(first), 20) and wait_path(app, r'/coach/training/crs_[^/]+/lsn_', 20), app.path())
    app.page_ok('training lesson 1', r'^%s$' % re.escape(first))
    check('lesson body: paragraph with bold words and a bulleted list', app.has_text(r'what the client wants') and app.has_text(r'^Ask one open question$') and app.has_text(r'^Listen before advising$'))
    check('progress card and "Mark as complete"', app.has_text(r'^Your progress$') and has_button(app, 'Mark as complete'))
    app.screenshot('libs-b-training-lesson')
    check('"Mark as complete" (toast Lesson complete, Done pill)', app.click_text('Mark as complete') and app.wait_text(r'^Lesson complete$', 15) and app.wait_text(r'^DONE |^Done ', 15) and not has_button(app, 'Mark as complete'))
    check('"Next lesson →" opens the second lesson with its heading and numbered list', app.click_text('Next lesson →') and app.wait_text(r'^Closing with a next step$', 20) and app.wait_text(r'^One next step$', 15) and app.has_text(r'^1\.$') and app.has_text(r'^Write it down$'))
    check('the last lesson finishes the course (toast)', app.click_text('Mark as complete') and app.wait_text(r'^Lesson complete: you have finished the course$', 15) and app.wait_text(r'^You have completed this course\.$', 15))
    app.screenshot('libs-b-training-finished')
    check('back to the course: In this course, Completed, both lessons Done', app.click_text('← %s' % title) and app.wait_text(r'^In this course$', 20) and app.wait_text(r'^COMPLETED$|^Completed$', 15) and len(re.findall(r'(?m)^(DONE|Done)$', app.text())) == 2 and app.has_text(r'^2 of 2 lessons$'))
    app.page_ok('training course (completed)', r'^%s$' % re.escape(title))
    open_screen(app, '/coach/training', r'^Training$', 'training after finishing')
    check('the training list shows it done: Completed, 2 of 2 lessons, completed date', app.wait_text(r'^%s$' % re.escape(title), 20) and app.has_text(r'^2 of 2 lessons$') and app.has_text(r'Coach training · completed \d'))
    app.screenshot('libs-b-training-done')


# ---------------------------------------------------------------- the module gate
def gate_section(app, ids):
    """The owner switches the workouts module off (PATCH /admin/modules); after the app's one-minute flag cache the exercise
    library shows "No such page" instead of its body; then the module goes back on."""
    print('gate: workouts switched off and on')

    def toggle(enabled):
        try:
            owner = owner_session()
        except RuntimeError as e:
            check('owner signs in to switch workouts %s' % ('on' if enabled else 'off'), False, str(e))
            return False
        try:
            st, j, _ = ah.api(BASE, 'PATCH', '/admin/modules', {'key': 'workouts', 'enabled': enabled, 'reason': 'Switched by the app check (coach-libs-b)'}, token=owner.token)
            return check('owner switches workouts %s' % ('on' if enabled else 'off'), st == 200, '%s %s' % (st, json.dumps(j)[:120]))
        finally:
            owner.logout()
    if not toggle(False):
        return
    try:
        time.sleep(61)   # lib/features keeps the flags for a minute
        app.open_route('/coach/exercise-library', r'^No such page$|^Exercise library$', 45)
        gated = app.wait_text(r'^No such page$', 45)
        check('exercise library with workouts off: "No such page" / not switched on, no library body', gated and app.has_text(r'This part of Bioptime is not switched on\.') and not app.has_text(r'^Published and your drafts$'), app.text()[:200])
        app.page_ok('exercise library (module off)', r'^No such page$')
        app.screenshot('libs-b-gate-off')
    finally:
        toggle(True)


SECTIONS = {'library': library_section, 'template': template_section, 'program': program_section, 'courses': courses_section, 'training': training_section, 'gate': gate_section, 'clienttab': clienttab_section}


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4371 (never the live demo).')
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
    expo = b = app = ids = None
    try:
        ids = Ids()
        if 'courses' in only or 'training' in only:
            CTX['seed'] = seed_courses(training='training' in only, member_course='courses' in only)
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
                    SECTIONS[name](app, ids)
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
        if ids:
            try:
                ids.close()
            except Exception:
                pass
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
