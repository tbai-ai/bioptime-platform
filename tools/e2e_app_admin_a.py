#!/usr/bin/env python3
"""End-to-end check of the administrative portal's core screens in the app (apps/mobile, group admin-a) through its Expo
web build in headless Chrome at 390x844 (Python 3.9, stdlib, Google Chrome), on the shared harness tools/app_harness.py.

    BASE=http://127.0.0.1:4231 APP_PORT=9231 E2E_CDP_PORT=9931 python3 -I tools/e2e_app_admin_a.py
    BASE=… APP_URL=http://localhost:9231 E2E_APP_ONLY=members,record python3 -I tools/e2e_app_admin_a.py   a running Expo; some sections

BASE is a scratch API (required; reset-demo first, started with CORS_ORIGINS=http://localhost:<APP_PORT>). The live
demo's ports (3000, 3100, 3101, 8081) are refused for BASE and the app server, BASE must be an explicit port on
127.0.0.1, localhost, *.localhost or *.test, and E2E_OUT / E2E_CDP_PORT keep parallel runs apart (defaults
.local/e2e/app-admin-a and 9931), exactly as tools/e2e_app.py. tools/e2e_app.py's admin section also calls run(app, ctx)
here when it is pointed at this file.

Sections (E2E_APP_ONLY, default all, in this order), one sign-in through the app as the owner for all of them:
  overview      /(admin): the eight readouts, orders per week, bookings by status, capacity, exceptions; a readout opens its section
  members       /(admin)/members: the list with email and state (the joined date drawn in full), search, the state filter, the
                "Invite a member" sheet with its Optional tag (one invitation is created)
  record        /admin/clients/:id (Ananya): header, tabs, the ledger, "Adjust entitlements by hand" (one unit granted), an administrative
                note, suspend and reactivate with reasons, password reset and verification links, orders and history; then an
                unknown id opened in place shows the error and none of Ananya's record
  coaches       /admin/coaches and /admin/coaches/:id (Asha): the list, the invite sheet, Mark away (a two-character reason is refused,
                as on the web) / Mark available, Capacity (changed and restored), the Suspend dialog (opened and kept as is)
  assignments   /admin/assignments: requests with candidates, the assign sheet, Pause and Resume with reasons, the End dialog kept as is
  packages      /admin/packages: the cards, Preview, Revise and New package sheets (Optional tags), Unpublish then Publish (the toast
                floats in view), a coupon created, deactivated and reactivated, the seeded coupon's note drawn in full
  approvals     /admin/approvals: the request cards and the "Work on it" sheet (Optional tags); a request moved on with a recommended
                coach stores that coach in its proposal (read back from Python)
  orders        /admin/orders: the list, the status filter, the Refund dialog kept as is (no refund is made)
  permissions   the gates: the owner (from Python) revokes reports.view and members.view_restricted from the seeded administrator, who then
                signs in through the app, lands on Members instead of Overview and reads "Restricted" on a record, including the IP of
                a member session made from Python for the check; both permissions are restored
Up to five POST /auth/login per full run (the owner through the screen, the owner from Python once, shared by approvals and
permissions, the member from Python, the administrator through the screen), against the server's limit of about 20 per 10
minutes. Nothing irreversible is done: no refund, archive, end or suspension of a coach. No code or secret is written here:
the authenticator code comes from the server's own preview helper. Exit status 1 if anything fails; the JSON summary is the
last line."""
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
APP_PORT = os.environ.get('APP_PORT') or '9231'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-admin-a')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9931'
SECTION_NAMES = ('overview', 'members', 'record', 'coaches', 'assignments', 'packages', 'approvals', 'orders', 'permissions')

OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
ADMIN = ('admin@demo.bioptime.test', 'Demo-Admin-2026!')
MEMBER = ('ananya.rao@demo.bioptime.test', 'Demo-Member-2026!')   # signed in from Python so her record lists a session
MEMBER_NAME = 'Ananya Rao'          # shares health records, has a programme, entitlements, notes and an order in the seed
COACH_NAME = 'Asha Menon'
REASON_LABEL = 'Reason (recorded in the audit log)'
RUN_TAG = time.strftime('%H%M%S')


# ---------------------------------------------------------------- helpers
def click_last(app, text, after=0.8):
    """Press the last button reading `text` in DOM order: a sheet's confirm button when a header button reads the same
    (the web's dialogs reuse the trigger's words: "Mark away", "Publish")."""
    ok = app.js("(() => { const norm = (s) => (s || '').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g, ' ').trim(); const t = norm(%s);"
                " const all = Array.from(document.querySelectorAll('[role=button],button,a,[role=link]')).filter((e) => norm(e.innerText) === t || norm(e.getAttribute('aria-label')) === t);"
                " const el = all[all.length - 1]; if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()" % json.dumps(text))
    app.b.pump(after)
    return bool(ok)


_OWNER_API = {}


def owner_api(app):
    """The owner's API session from Python, signed in once per run and shared by the sections that need it."""
    if 'session' not in _OWNER_API:
        base = BASE or app.base
        _OWNER_API['session'] = ah.ApiSession(base).login(OWNER[0], OWNER[1], 'admin', ah.demo_totp(base, OWNER[0]))
    return _OWNER_API['session']


def owner_api_logout():
    s = _OWNER_API.pop('session', None)
    if s:
        s.logout()


_LEAVES = "Array.from(document.querySelectorAll('div,span')).filter((e) => e.children.length === 0)"


def in_view(app, text):
    """True when an element reading exactly `text` lies inside the viewport: a toast that floats over the screen, not one
    drawn at the top of a scrolled page."""
    return bool(app.js("%s.filter((e) => (e.innerText || '').trim() === %s).some((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; })" % (_LEAVES, json.dumps(text))))


def optional_tags(app):
    """How many "Optional" tags the screen draws beside field labels."""
    return app.js("%s.filter((e) => (e.innerText || '').trim() === 'Optional').length" % _LEAVES) or 0


def unclamped(app, rx):
    """True when the text matching `rx` is on screen and no element holding it clamps its lines (RecordRow keeps its meta
    to two lines, so text drawn there can be cut off)."""
    return bool(app.js("(() => { const re = new RegExp(%s); const els = %s.filter((e) => re.test(e.innerText || '')); if (!els.length) return false;"
                       " return els.every((e) => { for (let n = e, i = 0; n && i < 3; n = n.parentElement, i++) { const c = getComputedStyle(n).webkitLineClamp; if (c && c !== 'none') return false; } return true; }); })()" % (json.dumps(rx), _LEAVES)))


def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def open_screen(app, name, route, expect, loaded=None, seconds=40):
    """Open a route, wait for its title and (when given) the text that proves its data arrived; one page_ok check."""
    app.open_route(route, expect, seconds)
    if loaded:
        app.wait_text(loaded, seconds)
    app.b.pump(1.0)
    ok = app.page_ok(name + ' draws', expect)
    no_labels(app, name)
    return ok


def reason_confirm(app, confirm_label, reason='Checked from the app', after=0.8):
    """Fill the ReasonSheet's reason and press its confirm button (the last button reading so)."""
    typed = app.type_into(REASON_LABEL, reason)
    pressed = click_last(app, confirm_label, after)
    return typed and pressed


# ---------------------------------------------------------------- sections
def overview_section(app):
    print('overview: the readouts and cards')
    open_screen(app, 'overview', '/(admin)', r'^Overview$', r'Orders per week')
    for label in ['Members', 'New orders · 30 days', 'Verified revenue · 30 days', 'Unassigned members', 'Coach utilisation', 'Appointments · 7 days', 'Reports awaiting review', 'Operational exceptions']:
        check('overview readout "%s"' % label, app.has_text('^' + re.escape(label.upper()) + '$'), label)
    check('overview sub-line counts members, programmes, utilisation and exceptions', app.has_text(r'active members · \d+ active programmes · \d+% coach utilisation · \d+ open exceptions'))
    for label in ['Bookings by status', 'Coaches', 'By kind']:
        check('overview card "%s"' % label, app.has_text('^' + re.escape(label) + '$'))
    check('overview capacity rows show a caseload fraction and Available / Away', app.has_text(r'\d+/\d+') and app.has_text(r'^(AVAILABLE|AWAY)$'))
    check('overview orders chart carries its caption', app.has_text(r'Bars: orders created\. Verified revenue in the period: ₹'))
    app.screenshot('admin-a-overview')
    if app.click_text('Unassigned members', exact=False):
        arrived = app.wait_text(r'^Assignments$', 30)
        check('pressing the "Unassigned members" readout opens Assignments', arrived and app.path().endswith('/admin/assignments'), app.path())
    else:
        check('pressing the "Unassigned members" readout opens Assignments', False, 'readout not pressable')


def members_section(app):
    print('members: the list, search, the state filter and the invitation sheet')
    open_screen(app, 'members', '/(admin)/members', r'^Members$', r'Everyone with a member account')
    check('members list shows a seeded member with their email', app.has_text(MEMBER_NAME) and app.has_text(r'ananya\.rao@demo\.bioptime\.test'))
    check('members list shows the account state pill', app.has_text(r'^(ACTIVE|ONBOARDING|PENDING VERIFICATION)$'))
    check('members list draws the coach and the joined date in full (not cut off by the two-line meta)', unclamped(app, r'· joined \d{1,2} \w{3} \d{4}$'))
    t = app.text()   # case matters here (has_text ignores it): a pill draws its label in capitals
    check('members list shows goals as plain text, not as pills', bool(re.search(r'^Energy and sleep$', t, re.M)) and not re.search(r'^ENERGY AND SLEEP$', t, re.M))
    app.type_into('Search name or email', 'ananya')
    app.b.pump(2.5)
    check('search narrows the list to the matching member', app.has_text(MEMBER_NAME) and not app.has_text('Farah Ali'), app.text()[:200])
    app.type_into('Search name or email', '')
    app.b.pump(2.0)
    app.click_text('suspended')
    app.b.pump(2.5)
    check('the state filter answers with rows or the "No members match" empty state', app.has_text(r'^SUSPENDED$') or app.has_text(r'No members match'), app.text()[:300])
    if app.has_text('No members match'):
        check('the filtered empty state says "Try another name, email or state."', app.has_text(r'Try another name, email or state\.'))
    app.click_text('Any state')
    app.b.pump(2.0)
    check('"Invite a member" opens the invitation sheet', app.click_text('Invite a member') and app.wait_text(r'The member sets their own password from the link', 10))
    check('the invitation sheet has Email, Name and Reason', app.has_input('Email') and app.has_input('Name') and app.has_input('Reason'))
    check('the invitation sheet tags Reason "Optional", as the web does', optional_tags(app) == 1, optional_tags(app))
    check('"Send the invitation" waits for an email and a name', app.is_disabled('Send the invitation'))
    email = 'app.invite.%s@demo.bioptime.test' % RUN_TAG
    app.type_into('Email', email)
    app.type_into('Name', 'App Invitee')
    app.type_into('Reason', 'Invited during the app check')
    app.click_text('Send the invitation')
    created = app.wait_text(r'^Invitation created$', 20)
    check('the invitation is created and the server\'s note is shown', created and app.has_text(r'outbox|queued|Activation link'), app.text()[:300])
    app.screenshot('admin-a-members-invite')
    app.click_text('Done')
    app.b.pump(2.0)
    check('the new invitee appears in the list', app.wait_text(re.escape(email), 15))
    app.screenshot('admin-a-members')


def record_section(app):
    print('record: %s in full' % MEMBER_NAME)
    app.open_route('/(admin)/members', r'^Members$', 40)
    app.wait_text(r'Everyone with a member account', 40)
    app.b.pump(1.5)
    if not app.click_text(MEMBER_NAME, exact=False):
        check('the member record opens from the list', False, 'no row for ' + MEMBER_NAME)
        return
    arrived = app.wait_text(r'Goals and details', 40)
    app.b.pump(1.0)
    app.page_ok('record draws', r'Goals and details')
    no_labels(app, 'record')
    check('the record opens at /admin/clients/:id', arrived and '/admin/clients/' in app.path(), app.path())
    check('record header: the name, the member code and the state pill', app.has_text(r'^BPM-\d+$') and app.has_text(r'^ACTIVE$'))
    check('record header: the programme line names the package and the coach', app.has_text(r'· ends \d+ \w+ \d{4} · coach '))
    for t in ['Overview', 'Plan', 'Bloodwork', 'Appointments', 'Progress', 'Notes', 'Account']:
        check('record tab "%s"' % t, app.find_clickable(t))
    check('record Overview: the Package card with entitlements and the ledger note', app.has_text(r'^Held = reserved for a booked collection or consultation\. Select a service to open its ledger\.$') and app.has_text(r'^Consultation$'))
    check('record Overview: Goals and details with Member ID, Email and Phone', app.has_text(r'^Member ID$') and app.has_text(r'^Email$') and app.has_text(r'^Phone$'))
    check('record Overview: the owner reads the phone, not "Restricted"', not app.has_text(r'^Restricted$'))
    check('record Overview: "What is coming" and "Plan tasks due"', app.has_text(r'^What is coming$') and app.has_text(r'^Plan tasks due$'))
    app.screenshot('admin-a-record-overview')
    # the ledger
    check('pressing an entitlement opens its ledger sheet', app.click_text('Consultation') and app.wait_text(r'^Ledger · Consultation · \d+ granted$', 10))
    click_last(app, 'Close')
    # adjust by hand (owner holds entitlements.adjust)
    check('"Adjust entitlements" opens the sheet', app.click_text('Adjust entitlements') and app.wait_text(r'^Adjust entitlements by hand$', 10))
    check('"Grant units" waits for a reason', app.is_disabled('Grant units'))
    check('the adjust sheet explains that used and held units are never removed', app.has_text(r'Used and held units are never removed'))
    app.type_into('Reason (recorded on the ledger and in the audit log)', 'Goodwill after a missed collection')
    app.screenshot('admin-a-record-adjust')
    click_last(app, 'Grant units')
    check('one unit is granted: "Entitlements adjusted"', app.wait_text(r'^Entitlements adjusted$', 20))
    app.b.pump(2.0)
    # the other tabs
    app.click_text('Plan'); app.b.pump(1.0)
    check('record Plan tab: a plan version or "No plan yet"', app.has_text(r'^VERSION \d+ · ') or app.has_text(r'^No plan yet$'))
    app.click_text('Bloodwork'); app.b.pump(1.0)
    check('record Bloodwork tab: bookings and laboratory reports', app.has_text(r'^Blood tests$') and app.has_text(r'^Laboratory reports$'))
    check('record Bloodwork tab: a report row with Open or Review', app.find_clickable('Open') or app.find_clickable('Review') or app.has_text(r'^No reports$'))
    app.click_text('Appointments'); app.b.pump(1.0)
    check('record Appointments tab', app.has_text(r'^Appointments$') and (app.has_text(r'IST$') or app.has_text(r'^No appointments$')))
    app.click_text('Progress'); app.b.pump(1.0)
    check('record Progress tab: completion and the self-reported note', app.has_text(r'^Completion (\d+%|not available)$') and app.has_text(r'none are laboratory measurements'))
    app.screenshot('admin-a-record-progress')
    app.click_text('Notes'); app.b.pump(1.0)
    check('record Notes tab: the three kinds explained and the administrative note field', app.has_text(r'Laboratory results are never notes\.') and app.has_input('Administrative note'))
    note = 'Administrative note from the app check %s' % RUN_TAG
    app.type_into('Administrative note', note)
    app.click_text('Save administrative note')
    check('an administrative note is saved and listed as administrative', app.wait_text(r'^Note saved$', 20) and app.wait_text(re.escape(note), 15) and app.has_text(r'^ADMINISTRATIVE$'))
    check('record Notes tab: follow-ups note', app.has_text(r'^Follow-ups appear on Today until resolved\.$'))
    app.click_text('Account'); app.b.pump(1.0)
    check('record Account tab: state and recovery with its four actions', all(app.find_clickable(t) for t in ['Suspend', 'Reactivate', 'Send password reset', 'Resend verification']))
    check('record Account tab: Orders, Data requests and History', app.has_text(r'^Orders$') and app.has_text(r'^Data requests$') and app.has_text(r'^History$') and app.has_text(r'Record views are not listed here'))
    check('"Suspend" opens the reason dialog with the web\'s wording', app.click_text('Suspend') and app.wait_text(r'^Suspend %s\?$' % re.escape(MEMBER_NAME), 10) and app.has_text(r'signed out everywhere and cannot sign in until reactivated'))
    reason_confirm(app, 'Suspend account', 'Suspended during the app check')
    check('the account is suspended: "Account updated" and the pill', app.wait_text(r'^Account updated$', 20) and app.wait_text(r'^SUSPENDED$', 15))
    app.screenshot('admin-a-record-suspended')
    check('"Reactivate" opens the reason dialog', app.click_text('Reactivate') and app.wait_text(r'^Reactivate %s\?$' % re.escape(MEMBER_NAME), 10))
    reason_confirm(app, 'Reactivate', 'Reactivated after the app check')
    check('the account is active again', app.wait_text(r'^Account updated$', 20) and app.wait_text(r'^ACTIVE$', 15))
    app.click_text('Send password reset')
    check('"Send password reset" queues the link', app.wait_text(r'^Reset link queued to the outbox$', 15))
    app.click_text('Resend verification')
    check('"Resend verification" queues the link', app.wait_text(r'^Verification link queued$', 15))
    check('record history lists the state changes with their reasons', app.has_text(r'Account state · Suspended during the app check'))
    check('record Account tab: no invented "No sessions." line', not app.has_text(r'^No sessions\.$'))
    app.screenshot('admin-a-record-account')
    app.open_route('/admin/clients/usr_nope', None, 30)
    gone = app.wait_text(r'Member was not found', 30)
    app.b.pump(1.0)
    check('an unknown id opened in place shows the error and nothing of the previous record', gone and not app.has_text(re.escape(MEMBER_NAME)) and not app.has_text(r'Goals and details'), app.text()[:300])
    app.screenshot('admin-a-record-unknown')


def coaches_section(app):
    print('coaches: the list, the invitation sheet and %s' % COACH_NAME)
    open_screen(app, 'coaches', '/admin/coaches', r'^Coaches$', r'Invite, scope and capacity')
    check('coaches list shows a seeded coach with availability and account pills', app.has_text(COACH_NAME) and app.has_text(r'^(AVAILABLE|AWAY)') and app.has_text(r'caseload \d+/\d+'))
    check('"Invite a coach" opens the sheet with its fields', app.click_text('Invite a coach') and app.wait_text(r'The coach sets their own password from the link', 10) and app.has_input('Display name') and app.has_input('Expertise (comma separated)') and app.has_input('Caseload limit'))
    check('the invite sheet tags City "Optional"', optional_tags(app) == 1, optional_tags(app))
    app.click_text('Cancel'); app.b.pump(0.8)
    app.screenshot('admin-a-coaches')
    if not app.click_text(COACH_NAME, exact=False):
        check('the coach record opens', False, 'no row for ' + COACH_NAME)
        return
    arrived = app.wait_text(r'Working hours and blocks', 40)
    app.b.pump(1.0)
    app.page_ok('coach record draws', r'Working hours and blocks')
    no_labels(app, 'coach record')
    check('the coach record opens at /admin/coaches/:id', arrived and '/admin/coaches/' in app.path(), app.path())
    check('coach record: assignments count, working hours in IST and the history', app.has_text(r'^\d+ active$') and app.has_text(r'\d\d:\d\d–\d\d:\d\d · \d+ min') and app.has_text(r'^History$'))
    m = re.search(r'caseload (\d+)/(\d+)', app.text())
    limit = int(m.group(2)) if m else None
    check('coach record header shows the caseload', limit is not None, app.text()[:200])
    check('"Mark away" opens its dialog with the Until field', app.click_text('Mark away') and app.wait_text(r'^Mark %s as away\?$' % COACH_NAME, 10) and app.has_input('Until (optional)'))
    app.type_into('Until (optional)', time.strftime('%Y-%m-%d', time.gmtime(time.time() + 7 * 86400)))
    reason_confirm(app, 'Mark away', 'ab')
    check('a two-character reason is refused with "Say why, in a few words." (the web asks for three)', app.wait_text(r'^Say why, in a few words\.$', 5) and app.has_text(r'^Mark %s as away\?$' % COACH_NAME) and not app.has_text(r'^Coach marked away$'))
    reason_confirm(app, 'Mark away', 'On leave for a week')
    check('the coach is marked away', app.wait_text(r'^Coach marked away$', 20) and in_view(app, 'Coach marked away') and app.wait_text(r'^AWAY$', 15))
    app.screenshot('admin-a-coach-away')
    check('"Mark available" opens its dialog', app.click_text('Mark available') and app.wait_text(r'^Mark %s as available\?$' % COACH_NAME, 10))
    reason_confirm(app, 'Mark available', 'ok')
    check('Mark available also wants three characters', app.wait_text(r'^Say why, in a few words\.$', 5) and not app.has_text(r'^Coach available; paused assignments resumed$'))
    reason_confirm(app, 'Mark available', 'Back early')
    check('the coach is available again and paused assignments resumed', app.wait_text(r'^Coach available; paused assignments resumed$', 20) and app.wait_text(r'^AVAILABLE$', 15))
    if limit is not None:
        check('"Capacity" opens the caseload dialog', app.click_text('Capacity') and app.wait_text(r'^Change the caseload limit$', 10) and app.has_input('Maximum active clients'))
        app.type_into('Maximum active clients', str(limit + 1))
        reason_confirm(app, 'Save', 'One more client')
        check('the caseload limit is raised by one', app.wait_text(r'^Capacity updated$', 20) and app.wait_text(r'caseload \d+/%d' % (limit + 1), 15))
        app.click_text('Capacity'); app.b.pump(0.8)
        app.type_into('Maximum active clients', str(limit))
        reason_confirm(app, 'Save', 'Restored after the app check')
        check('the caseload limit is restored', app.wait_text(r'^Capacity updated$', 20) and app.wait_text(r'caseload \d+/%d' % limit, 15))
    check('"Suspend" opens the dialog with the web\'s wording', app.click_text('Suspend') and app.wait_text(r'^Suspend %s\?$' % COACH_NAME, 10) and app.has_text(r'loses access to the workspace, and their members pause'))
    check('"Keep as is" closes it without suspending', app.click_text('Keep as is') and app.wait_js("!document.body.innerText.includes('Keep as is')", 5) and app.has_text(r'^ACTIVE$'))
    app.screenshot('admin-a-coach')


def assignments_section(app):
    print('assignments: requests, the assign sheet, pause and resume')
    open_screen(app, 'assignments', '/admin/assignments', r'^Assignments$', r'The hybrid engine recommends')
    check('assignments: the Requests and All assignments tabs', app.find_clickable('Requests') and app.find_clickable('All assignments'))
    check('assignments: the status chips', all(app.find_clickable(t) for t in ['Open', 'Exceptions', 'Assigned', 'All']))
    has_open = app.has_text(r'^OPEN$|^EXCEPTION$')
    if has_open:
        check('an open request lists ranked candidates with scores and eligibility', app.has_text(r'· score \d+') and app.has_text(r'^(YES|NO)$'))
        check('"Choose coach" opens the assign sheet', app.click_text('Choose coach') and app.wait_text(r'^Assign a coach to ', 10))
        check('the assign sheet has Coach, Method and Reason', app.has_text(r'^Coach$') and app.has_text(r'Override skips the availability and capacity checks') and app.has_input('Reason (recorded)'))
        check('"Confirm assignment" waits for a reason', app.is_disabled('Confirm assignment'))
        app.screenshot('admin-a-assign')
        app.click_text('Cancel'); app.b.pump(0.8)
    else:
        skip('an open request with candidates', 'no open request on this server (the seed\'s were assigned)')
    app.click_text('All assignments'); app.b.pump(1.5)
    check('all assignments: rows with member → coach, status, method and reason', app.has_text(r' → ') and app.has_text(r'manual · since '))
    if app.find_clickable('Pause'):
        check('"Pause" opens the reason dialog', app.click_text('Pause') and app.wait_text(r'^Pause the assignment for ', 10))
        reason_confirm(app, 'Pause', 'Coach on leave')
        check('the assignment is paused', app.wait_text(r'^Updated$', 20) and app.wait_text(r'^PAUSED$', 15))
        app.screenshot('admin-a-assignments-paused')
        check('"Resume" opens the reason dialog', app.click_text('Resume') and app.wait_text(r'^Resume the assignment for ', 10))
        reason_confirm(app, 'Resume', 'Coach is back')
        check('the assignment is active again', app.wait_text(r'^Updated$', 20))
        app.b.pump(2.0)
        check('"End" opens a destructive reason dialog', app.click_text('End') and app.wait_text(r'^End the assignment for ', 10))
        check('"Keep as is" closes it without ending', app.click_text('Keep as is') and app.wait_js("!document.body.innerText.includes('Keep as is')", 5))
        check('"Reassign" opens the assign sheet in reassign mode', app.click_text('Reassign') and app.wait_text(r'^Assign a coach to ', 10) and app.find_clickable('Reassign') and not app.has_text('Override skips'))
        app.click_text('Cancel'); app.b.pump(0.8)
    else:
        skip('pause / resume an assignment', 'no active assignment on this server')
    app.screenshot('admin-a-assignments')


def packages_section(app):
    print('packages: cards, preview, revise, publish state and coupons')
    open_screen(app, 'packages', '/admin/packages', r'^Packages$', r'Editing creates a new version')
    check('package cards with kind, version, price and the four actions', app.has_text(r'^PACKAGE · VERSION \d+$') and app.has_text(r'^Price$') and all(app.find_clickable(t) for t in ['Revise', 'Preview as a member', 'Archive']))
    check('"Preview as a member" shows the card as members read it', app.click_text('Preview as a member') and app.wait_text(r'^Preview as a member$', 10) and app.has_text(r'Listed on the website and in the app\.|Hidden: not listed') and app.has_text(r'Buy button shown\.|Not for sale: no buy button\.'))
    app.screenshot('admin-a-package-preview')
    click_last(app, 'Close')
    check('"Revise" opens the package form', app.click_text('Revise') and app.wait_text(r'^Revise ', 10) and app.has_input('Name') and app.has_input('Reason (recorded)') and app.has_text(r'Changing a package never alters entitlements already paid for'))
    check('the revise form has no Slug field; the new-package form does', not app.has_input('Slug'))
    check('the package form tags Promotional label and Services "Optional"', optional_tags(app) == 2, optional_tags(app))
    app.click_text('Cancel'); app.b.pump(0.8)
    check('"New package" opens the form with Slug and Kind', app.click_text('New package') and app.wait_text(r'^New package$', 10) and app.has_input('Slug') and app.find_clickable('Create package'))
    app.click_text('Cancel'); app.b.pump(0.8)
    if app.find_clickable('Unpublish'):
        check('"Unpublish" opens a destructive reason dialog', app.click_text('Unpublish') and app.wait_text(r'^Unpublish .*\?$', 10) and app.has_text(r'members already enrolled continue on their version'))
        reason_confirm(app, 'Unpublish', 'Off sale for the app check')
        toast = app.wait_text(r'^Unpublished$', 20)
        check('the "Unpublished" toast floats in view after acting on a card lower down', toast and in_view(app, 'Unpublished'))
        check('the package is unpublished', toast and app.wait_text(r'^UNPUBLISHED$', 15))
        check('"Publish" opens its reason dialog', app.click_text('Publish') and app.wait_text(r'^Publish .*\?$', 10) and app.has_text(r'goes on sale on the website and in the app at once'))
        reason_confirm(app, 'Publish', 'Back on sale')
        check('the package is published again', app.wait_text(r'^Published$', 20))
    else:
        skip('unpublish and publish a package', 'no published package on this server')
    check('the coupons card with its footer', app.has_text(r'^Coupon codes$') and app.has_text(r'A use counts only on a verified capture'))
    check('the seeded coupon\'s note is drawn in full', unclamped(app, r'^Welcome code showing how codes work at checkout; not a commercial decision$'))
    code = 'APP%s' % RUN_TAG
    check('"New code" opens the coupon form', app.click_text('New code') and app.wait_text(r'^New coupon code$', 10) and app.has_input('Code') and app.has_input('Percent'))
    check('"Create" waits for a code and a reason', app.is_disabled('Create'))
    check('the coupon form tags Maximum uses, Valid until and Note "Optional"', optional_tags(app) == 3, optional_tags(app))
    app.type_into('Code', code)
    app.type_into('Reason (recorded)', 'Launch test code')
    click_last(app, 'Create')
    check('the coupon is created and listed', app.wait_text(r'^Coupon created$', 20) and app.wait_text(re.escape(code) + r' · 10%', 15))
    # deactivate the new code: its button is the first "Deactivate" (newest first) or found by the row order; the dialog names the code
    if app.click_text('Deactivate'):
        named = app.wait_text(r'^Deactivate [A-Z0-9]+\?$', 10)
        check('"Deactivate" opens a destructive reason dialog naming the code', named)
        reason_confirm(app, 'Deactivate', 'Not needed after the check')
        check('the coupon is deactivated', app.wait_text(r'^Coupon deactivated$', 20))
        if app.click_text('Reactivate'):
            reason_confirm(app, 'Reactivate', 'Needed again')
            check('the coupon is active again', app.wait_text(r'^Coupon active$', 20))
    app.screenshot('admin-a-packages')


def approvals_section(app):
    print('approvals: bespoke requests and the work sheet')
    open_screen(app, 'approvals', '/admin/approvals', r'^Custom plans$', r'Bespoke programmes move through')
    check('approvals: the status chips start with "Any status"', app.find_clickable('Any status') and app.find_clickable('Proposal sent'))
    if not app.find_clickable('Work on it'):
        check('approvals: the empty state', app.has_text(r'^No bespoke requests$'))
        skip('the work sheet', 'no bespoke request on this server')
        return
    check('a request card with reference, status, Asked for, Owner and Coach', app.has_text(r'^CPL-\d+ · ') and app.has_text(r'^Asked for$') and app.has_text(r'^Owner$') and app.has_text(r'^Coach$'))
    check('"Work on it" opens the sheet titled by reference and state', app.click_text('Work on it') and app.wait_text(r'^CPL-\d+ · ', 10))
    check('the work sheet shows the timeline and a next state or "No change to make here"', app.has_text(r'^Next state$') or app.has_text(r'^No change to make here$'))
    if app.has_text(r'^Next state$'):
        check('the work sheet carries the proposal fields', app.has_input('Duration (months)') and app.has_input('Consultations') and app.has_input('Price ₹') and app.has_text(r'^Recommended coach$'))
        check('the footer offers "Move to <state>"', app.find_clickable('Move to ', exact=False))
        check('the work sheet tags Recommended coach, Deliverables, Conditions, Review schedule and Note "Optional"', optional_tags(app) == 5, optional_tags(app))
    app.screenshot('admin-a-approvals-work')
    click_last(app, 'Close')
    app.b.pump(0.8)
    # a request still at "Enquiry received" moves on to "Under review" (not a closing state) with a recommended coach;
    # the stored proposal must then name that coach, as the web sends it with every transition
    # each "Work on it" belongs to the widest ancestor holding no other "Work on it": its card
    opened = app.js("(() => { const b = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => (e.innerText || '').trim() === 'Work on it'); const count = (n) => ((n.innerText || '').match(/Work on it/g) || []).length;"
                    " for (const el of b) { let card = el; while (card.parentElement && count(card.parentElement) === 1) card = card.parentElement; if (/ENQUIRY RECEIVED/.test(card.innerText || '')) { el.scrollIntoView({block: 'center'}); el.click(); return true; } } return false; })()")
    if not opened or not app.wait_text(r'^CPL-\d+ · Enquiry received$', 10):
        skip('a request moved on with a recommended coach', 'no request at "Enquiry received" on this server')
    else:
        m = re.search(r'^(CPL-\d+) · Enquiry received$', app.text(), re.M)
        ref = m.group(1) if m else None
        chose = click_last(app, 'Under review') and click_last(app, COACH_NAME)
        moved = chose and click_last(app, 'Move to Under review', 0.5) and app.wait_text(r'^Updated$', 20)
        check('"Move to Under review" with %s as the recommended coach updates %s' % (COACH_NAME, ref), moved, app.text()[:300])
        if moved:
            try:
                api = owner_api(app)
                coach = next((c for c in api.get('/admin/coaches').get('items', []) if c.get('displayName') == COACH_NAME), None)
                req = next((r for r in api.get('/admin/custom-plans').get('items', []) if r.get('reference') == ref), None)
                stored = ((req or {}).get('proposal') or {}).get('coachId')
                check('the stored proposal names the chosen coach, as the web sends it (proposal.coachId)', coach is not None and stored == coach.get('id'), 'stored %s, coach %s' % (stored, (coach or {}).get('id')))
            except RuntimeError as e:
                check('the stored proposal is read back from Python', False, str(e))
        else:
            click_last(app, 'Close')
    app.click_text('Proposal sent'); app.b.pump(2.0)
    check('the status filter narrows the list or shows the empty state', app.has_text(r'^PROPOSAL SENT$') or app.has_text(r'^No bespoke requests$'))
    app.screenshot('admin-a-approvals')


def orders_section(app):
    print('orders: the list, the status filter and the refund dialog')
    open_screen(app, 'orders', '/admin/orders', r'^Orders and payments$', r'Only a signature-verified provider event')
    check('orders rows: reference · member, package, total with GST, payment line and status pill', app.has_text(r'^PAY-\d+ · ') and app.has_text(r'GST ₹') and app.has_text(r'^(ACTIVATED|PAID|PENDING PAYMENT)$'))
    check('a simulated payment says so, as the record does', app.has_text(r'\(simulated\)$') and app.has_text(r'^PAYMENT (CAPTURED|CREATED|FAILED)'))
    if app.find_clickable('Refund'):
        check('"Refund" opens a destructive reason dialog with the total', app.click_text('Refund') and app.wait_text(r'^Refund PAY-\d+ \(₹[\d,]+\)\?$', 10) and app.has_text(r'Unused entitlements are cancelled, the programme ends'))
        check('"Keep as is" closes it without refunding', app.click_text('Keep as is') and app.wait_js("!document.body.innerText.includes('Keep as is')", 5))
    else:
        skip('the refund dialog', 'no paid or activated order on this server')
    app.click_text('Pending payment')
    filtered = app.wait_js("(() => { const t = document.body.innerText; return (/^PENDING PAYMENT$/m.test(t) && !/^ACTIVATED$/m.test(t)) || /^No orders$/m.test(t); })()", 15)
    check('the status filter shows only that status or "No orders"', filtered, app.text()[:300])
    app.click_text('Any status'); app.b.pump(1.5)
    app.screenshot('admin-a-orders')


def permissions_section(app):
    print('permissions: an administrator without reports.view and members.view_restricted')
    try:
        owner = owner_api(app)
    except RuntimeError as e:
        check('the owner signs in from Python to change permissions', False, str(e))
        return
    users = owner.get('/admin/users')
    admin = next((u for u in users.get('items', []) if u.get('email') == ADMIN[0]), None)
    if not admin:
        check('the seeded administrator exists', False, 'admin@demo.bioptime.test not listed')
        return
    member = None
    try:
        member = ah.ApiSession(BASE or app.base).login(MEMBER[0], MEMBER[1], 'member')
    except RuntimeError as e:
        check('the member signs in from Python so her record lists a session', False, str(e))
    revoked = []
    try:
        for p in ('reports.view', 'members.view_restricted'):
            owner.post('/admin/users/%s/permissions' % admin['id'], {'permission': p, 'granted': False, 'reason': 'App check: the gates without this permission'})
            revoked.append(p)
        app.sign_out()
        r = app.sign_in('admin', ADMIN[0], ADMIN[1], mfa='preview')
        landed = app.wait_text(r'^Members$', 30) and app.path().endswith('/members')
        check('an administrator without reports.view lands on Members (the first section held), as AdminIndex does', landed, r.get('detail', '') + ' · ' + app.path())
        app.wait_text(r'Everyone with a member account', 30)
        app.b.pump(1.5)
        if app.click_text(MEMBER_NAME, exact=False) and app.wait_text(r'Goals and details', 40):
            app.b.pump(1.0)
            txt = app.text()
            check('without members.view_restricted the record reads "Restricted" for phone, address, PIN code and date of birth', txt.count('Restricted') >= 4 and 'Phone, address, PIN code and date of birth are restricted' in txt, txt[:200])
            check('the email still shows (it is not a restricted field)', app.has_text(r'ananya\.rao@demo\.bioptime\.test'))
            app.screenshot('admin-a-record-restricted')
            app.click_text('Account'); app.b.pump(1.0)
            check('a session\'s IP reads "Restricted" and the note says why', app.has_text(r'^IP Restricted · last seen ') and app.has_text(r'Session IP addresses need the “View members’ restricted contact fields” permission') and not re.search(r'^IP (\d{1,3}\.){3}\d{1,3}|^IP [0-9a-f]*:[0-9a-f:]+', app.text(), re.M), re.findall(r'^IP .*$', app.text(), re.M))
            app.screenshot('admin-a-record-restricted-sessions')
        else:
            check('the administrator opens a member record', False, app.text()[:200])
        app.open_route('/(admin)', None, 30)
        check('opening Overview again sends the administrator back to Members', app.wait_text(r'^Members$', 30) and app.path().endswith('/members'), app.path())
        app.open_route('/admin/coaches', r'^Coaches$', 40)
        check('the administrator (coaches.manage) opens Coaches', app.wait_text(r'Invite, scope and capacity', 40))
        app.sign_out()
    finally:
        for p in revoked:
            try:
                owner.post('/admin/users/%s/permissions' % admin['id'], {'permission': p, 'granted': True, 'reason': 'App check: restored'})
            except RuntimeError as e:
                check('permission %s restored' % p, False, str(e))
        if member:
            member.logout()


SECTIONS = {'overview': overview_section, 'members': members_section, 'record': record_section, 'coaches': coaches_section, 'assignments': assignments_section, 'packages': packages_section, 'approvals': approvals_section, 'orders': orders_section, 'permissions': permissions_section}


def run(app, ctx):
    """tools/e2e_app.py's extension hook: the owner is already signed in through the app."""
    only = [s.strip() for s in os.environ.get('E2E_APP_ONLY_ADMIN_A', '').split(',') if s.strip()] or [s for s in SECTION_NAMES if s != 'permissions']
    try:
        for name in only:
            SECTIONS[name](app)
    finally:
        owner_api_logout()


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4231 (never the live demo).')
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
        sys.exit('The API at %s does not allow the browser origin %s: start the scratch API with CORS_ORIGINS=%s (apps/api/src/config.ts).' % (BASE, app_url, app_url))
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
        check('the owner signs in through the administrative sign-in with the authenticator code', r['ok'] and r['mfa_asked'], r['detail'])
        if r['ok']:
            for name in only:
                t1 = time.monotonic()
                try:
                    SECTIONS[name](app)
                except Exception as e:  # one section's crash must not hide the others
                    traceback.print_exc()
                    check('section %s completed without an unexpected error' % name, False, repr(e)[:300])
                timings[name] = round(time.monotonic() - t1, 1)
                print('  (%s took %.0fs)' % (name, timings[name]))
            if app.workspace:
                ok, d = app.sign_out()
                check('the session signs out from More and lands on a sign-in screen', ok, d)
    except Exception as e:
        traceback.print_exc()
        check('the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        try:
            owner_api_logout()
        except Exception:
            pass
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
    summary = ah.write_report({'base': BASE, 'app': app_url, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
