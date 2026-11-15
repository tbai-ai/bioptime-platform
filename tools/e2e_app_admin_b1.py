#!/usr/bin/env python3
"""End-to-end check of the administrative portal's part B1 screens in the app (apps/mobile, its Expo web build) in
headless Chrome at a phone's size (Python 3.9, stdlib, Google Chrome; tools/app_harness.py).

    BASE=http://127.0.0.1:4241 APP_PORT=9241 E2E_CDP_PORT=9941 python3 -I tools/e2e_app_admin_b1.py
    BASE=… APP_URL=http://localhost:9241 E2E_ONLY=bloodwork,operations python3 -I tools/e2e_app_admin_b1.py

BASE is the scratch API (required; reset-demo first, started with CORS_ORIGINS=http://localhost:<APP_PORT>). The check
starts Expo web for apps/mobile on APP_PORT in its own process group and stops it (APP_URL drives a server that is
already running instead). As tools/e2e_app.py: the live demo's ports (3000, 3100, 3101, 8081) are refused for BASE
and the app, BASE must be an explicit port on 127.0.0.1, localhost, *.localhost or *.test, and E2E_OUT /
E2E_CDP_PORT keep parallel runs apart (defaults .local/e2e/app-admin-b1 and 9941).

One sign-in through the screen (the owner, with the preview authenticator code of the demo server) is shared by every
section; one more from Python (ApiSession) reads ids and prepares a report that no coach can review for the Release
dialog, through the stand-in vendor's test webhook (owner, demo only). The sections change the scratch data (an
exception is owned and resolved, an enquiry taken, a catalogue price saved unchanged with a reason, notifications
marked read), so run against a scratch server, never the live demo.

Sections (E2E_ONLY, default all, in this order): shell, appointments, messages, bloodwork, report, analytics,
operations, audit, notifications. Also importable: run(app, ctx) adds the same checks to tools/e2e_app.py's admin
section (the owner already signed in). Exit status 1 if anything fails; the JSON summary is the last line."""
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
APP_PORT = os.environ.get('APP_PORT') or '9241'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-admin-b1')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9941'
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
SECTION_NAMES = ('shell', 'appointments', 'messages', 'bloodwork', 'report', 'analytics', 'operations', 'audit', 'notifications')
ADMIN_TABS = ['Overview', 'Members', 'Operations', 'Messages', 'More']
HOME = r'^Overview$'


# ---------------------------------------------------------------- helpers
def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def shot(app, name, settle=0.7):
    """A screenshot once the screen has settled (a sheet slides in for a moment after its text is in the DOM)."""
    try:
        app.b.pump(settle)
        app.screenshot(name)
    except Exception:
        pass


def click_last(app, text):
    """Press the LAST button that reads `text`: a sheet's confirm button carries the same words as a row's button
    behind it (the sheet is appended at the end of the document)."""
    js = r"""(() => { const norm = (s) => (s || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
      const all = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => norm(e.innerText) === %s);
      const el = all[all.length - 1]; if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()""" % json.dumps(text)
    end = time.monotonic() + 10
    while time.monotonic() < end:
        if app.js(js):
            return True
        app.b.pump(0.3)
    return False


def open_screen(app, route, expect, name, seconds=45):
    app.open_route(route, expect, seconds)
    ok = app.page_ok(name, expect)
    no_labels(app, name)
    return ok


def tab_bar(app):
    """The bottom tab bar's titles only (SegmentTabs on a screen are role=tab too), without icon glyphs and badges."""
    return app.js(r"""Array.from(document.querySelectorAll('[role=tab]')).map((e) => (e.innerText || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim().replace(/^\d+ /, '')).filter((t) => %s.includes(t))""" % json.dumps(ADMIN_TABS)) or []


def header_title(app):
    """The stack header's title (React Navigation draws it as a heading), or None."""
    return app.js(r"""(() => { const hs = Array.from(document.querySelectorAll('[role=heading]')).filter((e) => e.offsetParent !== null).map((e) => (e.innerText || '').trim()).filter(Boolean); return hs.length ? hs[0] : null; })()""")


def segment_tabs(app):
    """The labels of the screen's SegmentTabs (role=tab outside the bottom tab bar), counts included."""
    return app.js(r"""Array.from(document.querySelectorAll('[role=tab]')).map((e) => (e.innerText || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim()).filter((t) => !%s.includes(t.replace(/^\d+ /, '')))""" % json.dumps(ADMIN_TABS)) or []


def bell_label(app):
    return app.js("((e) => e ? e.getAttribute('aria-label') : null)(document.querySelector('[aria-label^=\"Notifications\"]'))")


def owner_session(ctx):
    """One API sign-in as the owner, kept in ctx for every section that needs an id."""
    if ctx.get('session') is None:
        code = ah.demo_totp(ctx['base'], OWNER[0])
        ctx['session'] = ah.ApiSession(ctx['base']).login(OWNER[0], OWNER[1], workspace='admin', mfa_code=code)
    return ctx['session']


# ---------------------------------------------------------------- sections
def shell_section(app, ctx):
    print('shell: the admin tab bar, the bell opens /admin/notifications')
    app.open_route('/(admin)', HOME, 45)
    app.page_ok('admin home', HOME)
    tabs = tab_bar(app)
    check('admin tab bar lists Overview, Members, Operations, Messages and More', tabs == ADMIN_TABS, str(tabs))
    label = bell_label(app)
    check('the admin header carries the notifications bell with its unread count', bool(label) and label.startswith('Notifications'), str(label))
    clicked = app.js("(() => { const e = document.querySelector('[aria-label^=\"Notifications\"]'); if (!e) return false; e.click(); return true; })()")
    arrived = clicked and app.wait_text(r'^Notifications$', 30) and app.wait_text(r'unread$|^Nothing unread$|^Nothing yet\.$', 30)
    check('pressing the bell opens the admin notifications screen (/admin/notifications)', arrived and app.path().endswith('/admin/notifications'), app.path() + ' ' + app.text()[:80].replace('\n', ' / '))
    shot(app, 'admin-b1-notifications-from-bell')
    app.open_route('/(admin)', HOME, 30)


def appointments_section(app, ctx):
    print('appointments: /admin/appointments (upcoming, past, all)')
    if not open_screen(app, '/admin/appointments', r'^Appointments$', 'screen /admin/appointments'):
        return
    check('appointments: the sub-line is the portal\'s', app.has_text(r'Every consultation, check-in and review across coaches\.'))
    check('appointments: Upcoming lists a seeded consultation with its member, time, kind and coach', app.wait_text(r'^Ananya Rao$', 20) and app.has_text(r'IST · (Check in|Consultation|Review) · (Asha Menon|Rahul Verma|Meera Iyer|Dev Kapoor)'), app.text()[:200])
    shot(app, 'admin-b1-appointments-upcoming')
    app.click_text('Past')
    check('appointments: Past lists the completed consultation', app.wait_text(r'^Sunita Bhat$', 20) and app.has_text(r'^COMPLETED$'), app.text()[:200])
    app.click_text('All')
    check('appointments: All lists upcoming and past together', app.wait_text(r'^Sunita Bhat$', 20) and app.wait_text(r'^Ananya Rao$', 20), app.text()[:200])
    check('appointments: no footer the web does not have', not app.has_text(r'Times are in IST\. Open a member'))
    check('appointments: no coach action is offered to an administrator', not any(app.find_clickable(t) for t in ('Confirm', 'Complete', 'Move', 'Cancel', 'No-show')))
    shot(app, 'admin-b1-appointments-all')


def messages_section(app, ctx):
    print('messages: the Messages tab and a thread')
    if not open_screen(app, '/(admin)/messages', r'^Messages$', 'Messages tab'):
        return
    check('messages: the sub-line says administrators read for support', app.has_text(r'Administrators can read threads for support; writing is between a member and their coach\.'))
    row = app.wait_text(r'^Ananya Rao ↔ Asha Menon$', 20)
    check('messages: the list names each conversation as member ↔ coach with the last line and its age', row and app.has_text(r'(min|h|d) ago|just now'), app.text()[:200])
    shot(app, 'admin-b1-messages-list')
    if not row:
        return
    app.click_text('Ananya Rao ↔ Asha Menon', exact=False)
    opened = app.wait_text(r'^Open client$', 30)
    check('messages: a conversation opens as its own screen at /admin/messages/[id] with "Open client"', opened and '/admin/messages/' in app.path(), app.path())
    app.page_ok('screen /admin/messages/[id]', r'Ananya Rao ↔ Asha Menon')
    check('messages: every message names its author before the time', app.has_text(r'^(Ananya Rao|Asha Menon|Bioptime) · \d+ \w+, \d\d:\d\d IST$'), app.text()[:300])
    check('messages: no composer and no Send for an administrator', not app.find_clickable('Send') and not app.has_input('Write to the member'))
    no_labels(app, 'screen /admin/messages/[id]')
    shot(app, 'admin-b1-messages-thread')


UNASSIGNED_MEMBERS = ('karthik.reddy@demo.bioptime.test', 'arjun.patel@demo.bioptime.test', 'rohan.das@demo.bioptime.test', 'farah.ali@demo.bioptime.test', 'neha.joshi@demo.bioptime.test')
MEMBER_PASSWORD = 'Demo-Member-2026!'


def releasable(s):
    for r in s.get('/admin/reports').get('items', []):
        if not r.get('reviewed') and r.get('coachCanReview') is False:
            return r
    return None


def prepare_releasable_report(ctx):
    """A report no coach can review, for the Release dialog: one that exists, else a new booking by a seeded member
    without a coach (one member sign-in from Python), which the stand-in laboratory of a demo server delivers within
    seconds (LABSTACK_STANDIN_SPEED fast; the seeded bookings live in another process's memory, so only a booking
    placed on this server progresses). Returns (report row or None, why)."""
    s = owner_session(ctx)
    r = releasable(s)
    if r:
        return r, ''
    members = {m['email']: m for m in s.get('/admin/members').get('items', []) if isinstance(m, dict)}
    tried = []
    for email in UNASSIGNED_MEMBERS:
        m = members.get(email)
        if not m or m.get('coach_name') or m.get('state') != 'active':
            continue
        try:
            ms = ah.ApiSession(ctx['base']).login(email, MEMBER_PASSWORD, workspace='member')
        except RuntimeError as e:
            return None, 'member sign-in failed: ' + str(e)[:120]
        try:
            tests = ms.get('/me/bloodwork/tests')
            if (tests.get('entitlement') or {}).get('remaining', 0) < 1 or not tests.get('items'):
                tried.append(email.split('@')[0])
                continue
            profile = (ms.get('/me/profile') or {}).get('profile') or {}
            pincode = str(profile.get('pincode') or '560001')
            date = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 5 * 86400))
            slots = (ms.get('/me/bloodwork/slots?date=%s&pincode=%s' % (date, pincode)) or {}).get('slots') or []
            if not slots:
                return None, 'no collection slot on %s for %s' % (date, email)
            test = tests['items'][0]
            body = {'testId': test['id'], 'slotAt': slots[0]['startAt'], 'pincode': pincode, 'address': profile.get('address') or 'Home address on file (app check)', 'city': profile.get('city') or 'Bengaluru', 'state': profile.get('state') or 'Karnataka'}
            if slots[0].get('labId'):
                body['labId'] = slots[0]['labId']
            booking = ms.post('/me/bloodwork/bookings', body)
            ctx['prepared_booking'] = booking.get('reference')
        finally:
            ms.logout()
        for _ in range(30):
            r = releasable(s)
            if r:
                return r, ''
            time.sleep(1)
        return None, 'the stand-in delivered no report for the new booking %s within 30 s' % ctx.get('prepared_booking')
    return None, 'no unassigned member with a blood test left to book (%s)' % ', '.join(tried)


def bloodwork_section(app, ctx):
    print('bloodwork: /admin/bloodwork reports, bookings, catalogue and the three dialogs')
    try:
        report, why = prepare_releasable_report(ctx)
    except Exception as e:  # the API helper failed; the screen checks still run
        report, why = None, repr(e)[:160]
    if not open_screen(app, '/admin/bloodwork', r'^Bloodwork$', 'screen /admin/bloodwork'):
        return
    check('bloodwork: the sub-line names both permissions\' scope and the override rule', app.has_text(r'Laboratory reports, bookings across members and the catalogue\.') and app.has_text(r'anything else is an owner override with a reason\.'))
    check('bloodwork: the owner sees the Laboratory integration link and the three tabs', app.find_clickable('Laboratory integration') and all(app.find_clickable(t, exact=False) for t in ('Reports', 'Bookings', 'Catalogue')))
    check('bloodwork: Reports lists the unreviewed report with its member, test, reference and "Awaiting review"', app.wait_text(r'^Vikram Shetty · Full Body Checkup, Essential$', 20) and app.has_text(r'BIO-24002 · delivered') and app.has_text(r'^AWAITING REVIEW$'), app.text()[:300])
    check('bloodwork: a flagged marker shows as a warning pill', app.has_text(r'^LDL CHOLESTEROL .*\(HIGH\)$'), app.text()[:300])
    shot(app, 'admin-b1-bloodwork-reports')
    # every report row reaches the member's record as well as the report (the web's member link beside "Open")
    first = (owner_session(ctx).get('/admin/reports').get('items') or [None])[0]
    check('bloodwork: each report row offers "Open client" beside "Open"', app.find_clickable('Open client') and app.find_clickable('Open'))
    if first and app.click_text('Open client'):
        check('bloodwork: "Open client" opens the member\'s record', app.wait_js("location.pathname.endsWith(%s)" % json.dumps('/admin/clients/' + first['memberId']), 20), app.path())
        app.open_route('/admin/bloodwork', r'^Bloodwork$', 30)
        app.wait_text(r'^Vikram Shetty · Full Body Checkup, Essential$', 20)
    # release: a report no coach can review
    if report:
        name = report.get('memberName') or ''
        check('bloodwork: the report no coach can review says so and offers Release', app.wait_text(re.escape(name), 20) and app.has_text(r'No coach can review it \(no active coach, or coach sharing off\)') and app.find_clickable('Release'), app.text()[:300])
        app.click_text('Release')
        opened = app.wait_text(r'^Release ' + re.escape(report.get('reference', '')) + '$', 10)
        check('bloodwork: the Release dialog opens with the portal\'s explanation', opened and app.has_text(r'Releasing it opens the report in the member’s app with your note; the reason goes to the audit log\.'), app.text()[:200])
        if opened:
            click_last(app, 'Release to the member')
            check('bloodwork: an empty note and reason are refused with the portal\'s two messages', app.wait_text(r'Write a note for the member \(at least 5 characters\)\.', 5) and app.has_text(r'Say why, in 3 to 300 characters\.'), app.text()[:300])
            shot(app, 'admin-b1-bloodwork-release-dialog')
            app.type_into('Note for the member', 'Your results are in. Most markers sit inside the laboratory ranges; your coach will go through the two outside with you.')
            app.type_into('Reason (recorded in the audit log)', 'Member has no active coach; released by the team')
            click_last(app, 'Release to the member')
            done = app.wait_text(r'^Report released to the member$', 20)
            check('bloodwork: the release succeeds with the toast "Report released to the member"', done, app.text()[:200])
            if done:
                check('bloodwork: the released report now reads as reviewed by the owner', app.wait_text(r'Reviewed by Bioptime owner', 20), app.text()[:300])
    else:
        skip('bloodwork: the Release dialog', why)
    # bookings and the owner's override
    app.click_text('Bookings')
    check('bloodwork: Bookings lists every member\'s booking with test, slot and laboratory line', app.wait_text(r'^BIO-24006 · Priya Nair$', 20) and app.has_text(r'Lipid Profile · \d+ \w+, \d\d:\d\d IST') and app.has_text(r'Laboratory: LS-88006 · PHLEBO_NO_SHOW'), app.text()[:400])
    check('bloodwork: the status filter offers Any status and the laboratory statuses', all(app.find_clickable(t) for t in ('Any status', 'Scheduled', 'Results ready', 'Cancelled')))
    app.click_text('Processing')
    check('bloodwork: filtering on Processing keeps only that booking', app.wait_js("!/BIO-24006/.test(document.body.innerText) && /BIO-24003 · Sunita Bhat/.test(document.body.innerText)", 20), app.text()[:300])
    app.click_text('Any status')
    app.wait_text(r'^BIO-24006 · Priya Nair$', 20)
    check('bloodwork: the owner sees an Override button on a booking', app.find_clickable('Override'))
    shot(app, 'admin-b1-bloodwork-bookings')
    app.click_text('Override')
    opened = app.wait_text(r'^Override BIO-\d+\?$', 10)
    check('bloodwork: the Override dialog is the portal\'s ReasonDialog: the body, New status, the reason field and "Keep as is"', opened and app.has_text(r'without a laboratory event\. The member is notified and the change is audited with your name\.') and app.has_text(r'^New status$') and app.has_input('Reason (recorded in the audit log)') and app.find_clickable('Keep as is') and not app.find_clickable('Cancel') and not app.has_text(r'At least 3 characters'), app.text()[:300])
    # the dialog's status chips wrap, so the preselected one is on screen once the sheet has slid in; a selected Chip
    # carries the brand fill (ui.tsx Chip), read here as a background different from an unselected chip's
    chips = r"""(() => { const all = Array.from(document.querySelectorAll('[role=button]')).filter((e) => ['Cancelled', 'Confirmed'].includes((e.innerText || '').trim()));
      const last = (t) => all.filter((e) => (e.innerText || '').trim() === t).pop(); const c = last('Cancelled'), o = last('Confirmed'); if (!c || !o) return null;
      const r = c.getBoundingClientRect(); return {inView: r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, selected: c.getAttribute('aria-selected'), bg: getComputedStyle(c).backgroundColor, other: getComputedStyle(o).backgroundColor}; })()"""
    preset = app.wait_js("((x) => !!x && x.inView && x.bg !== x.other)(%s)" % chips, 8)
    check('bloodwork: the Override dialog shows its preselected status, Cancelled (the web\'s default), in view', opened and preset, json.dumps(app.js(chips)))
    if opened:
        click_last(app, 'Override status')
        check('bloodwork: Override status without a reason answers "Say why, in a few words." and sends nothing', app.wait_text(r'^Say why, in a few words\.$', 5) and app.has_text(r'^Override BIO-\d+\?$'), app.text()[:300])
        shot(app, 'admin-b1-bloodwork-override-dialog')
        click_last(app, 'Keep as is')
        check('bloodwork: "Keep as is" closes the Override dialog', app.wait_js("!/^Override BIO-\\d+\\?$/m.test(document.body.innerText)", 10), app.text()[:200])
    app.b.pump(0.5)
    # catalogue and the price dialog
    app.click_text('Catalogue')
    check('bloodwork: the Catalogue lists tests with vendor id, price, fasting, turnaround and Shown/Hidden', app.wait_text(r'^Complete Blood Count \(CBC\)$', 20) and app.has_text(r'LS-CBC') and app.has_text(r'₹399 · fasting no · turnaround 12 hours') and app.has_text(r'^SHOWN$'), app.text()[:400])
    check('bloodwork: the catalogue footer explains unpriced and withdrawn tests', app.has_text(r'A new test from the vendor stays hidden until Bioptime sets its price; withdrawn tests are hidden, never deleted\.'))
    shot(app, 'admin-b1-bloodwork-catalogue')
    app.click_text('Set price')
    opened = app.wait_text(r'^Price \(₹, including GST\)$', 10)
    check('bloodwork: Set price opens the dialog with the price, the Hidden check and the reason', opened and app.has_input('Price (₹, including GST)') and app.checkbox_state('Hidden from members') is not None and app.has_input('Reason (recorded in the audit log)'), app.text()[:200])
    if opened:
        click_last(app, 'Save')
        check('bloodwork: saving without a reason is refused with "Say why, in 3 to 300 characters."', app.wait_text(r'Say why, in 3 to 300 characters\.', 5), app.text()[:200])
        shot(app, 'admin-b1-bloodwork-price-dialog')
        app.type_into('Reason (recorded in the audit log)', 'app check: price confirmed unchanged')
        click_last(app, 'Save')
        check('bloodwork: saving with a reason answers "Catalogue updated"', app.wait_text(r'^Catalogue updated$', 20), app.text()[:200])


def report_section(app, ctx):
    print('report: /admin/reports/[id]')
    s = owner_session(ctx)
    rows = s.get('/admin/reports').get('items', [])
    row = next((r for r in rows if r.get('reference') == 'BIO-24002'), rows[0] if rows else None)
    if not row:
        skip('screen /admin/reports/[id]', 'no report on this server')
        return
    route = '/admin/reports/%s' % row['id']
    name = (row.get('test') or {}).get('name') or 'Report'
    if not open_screen(app, route, re.escape(name), 'screen ' + route):
        return
    check('report: the header line carries reference, collection, laboratory date and review state', app.has_text(re.escape(row['reference']) + r' · collected .* IST · laboratory report \d+ \w+ \d{4} · (awaiting review|reviewed by)'), app.text()[:300])
    check('report: the released pill and the document button', app.has_text(r'^(NOT RELEASED|RELEASED TO MEMBER)$') and app.find_clickable('Open report document'))
    check('report: Section 1 lists every marker with its laboratory range and flag', app.has_text(r'^Results as reported by the laboratory$') and app.has_text(r'^Laboratory range ') and app.has_text(r'Outside range \(|^In range$'), app.text()[:400])
    check('report: the provenance line and Section 3 limits are the portal\'s', app.has_text(r'Values and ranges as reported by the laboratory') and app.has_text(r'A single test is a snapshot\.'))
    check('report: the simulated-laboratory note stays where the record says so', (not row.get('simulated')) or app.has_text(r'Practice laboratory: this result is simulated and no sample is collected\.'))
    check('report: Section 2 names the reviewer kind and the review state', app.has_text(r'^(Coach commentary|Review notes · Bioptime team)$') and app.has_text(r"Awaiting the assigned coach's review\.|Released \d|waits for a release by the Bioptime team"), app.text()[:400])
    check('report: no review form for an administrator', not app.find_clickable('Mark reviewed and release'))
    shot(app, 'admin-b1-report')
    app.click_text('Back')
    check('report: Back leaves the report', app.wait_js("!/Results as reported by the laboratory/.test(document.body.innerText)", 10), app.path())


def analytics_section(app, ctx):
    print('analytics: /admin/analytics readouts and Run a report')
    if not open_screen(app, '/admin/analytics', r'^Analytics$', 'screen /admin/analytics'):
        return
    check('analytics: the four readouts', all(app.has_text(t) for t in (r'^MEMBERS TOTAL$', r'^NEW MEMBERS · 30 D$', r'^VERIFIED REVENUE · ALL TIME$', r'^ACTIVATED · 30 D$')), app.text()[:300])
    check('analytics: the 12-week card, programmes, bloodwork and bespoke cards', all(app.has_text(t) for t in (r'^Orders and verified revenue per week$', r'^Active and ending$', r'^Bookings by status$', r'^Custom plans by status$', r'^Reports awaiting review$')), app.text()[:400])
    check('analytics: the simulated-payments note stays on a demo server', app.has_text(r'Simulated payments; no money moved\.'))
    check('analytics: Run a report offers the nine reports as chips with From and To', all(app.find_clickable(t) for t in ('Enrolments', 'Package sales', 'Consultations', 'Payments')) and app.has_input('From') and app.has_input('To') and app.is_disabled('Run'))
    shot(app, 'admin-b1-analytics')
    app.click_text('Consultations')
    app.click_text('Run')
    ran = app.wait_text(r'^Consultations · \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} · \d+ rows?$', 30)
    check('analytics: Run shows the report title, range, row count and note', ran and app.has_text(r'Appointments by coach and status within the range\.'), app.text()[:300])
    check('analytics: each row is a card of column → value', app.has_text(r'^Coach$') and app.has_text(r'^Appointments$'), app.text()[:400])
    check('analytics: Download CSV appears after a run', app.find_clickable('Download CSV'))
    app.click_text('Download CSV')
    check('analytics: Download CSV fetches the file with the session and starts the download on the web', app.wait_text(r'^Downloading bioptime-consultations-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$', 20), app.text()[:200])
    check('analytics: the footer gives the generation time in IST', app.has_text(r'^Generated \d+ \w+, \d\d:\d\d IST\. No health-outcome claims are derived from these numbers\.$'))
    shot(app, 'admin-b1-analytics-report')
    app.page_ok('analytics after a run and the CSV', r'^Analytics$')


def operations_section(app, ctx):
    print('operations: the Operations tab, its five tabs, Own it and Resolve')
    if not open_screen(app, '/(admin)/operations', r'^Operations$', 'Operations tab'):
        return
    check('operations: the sub-line and the five tabs', app.has_text(r'Every exception has an owner or an explicit unassigned state') and all(app.find_clickable(t, exact=False) for t in ('Exceptions', 'Audit log', 'Enquiries', 'Outbox', 'Jobs and events')))
    # the seeded queue: the capacity exception (unowned) and the rest; on a server where an earlier run already owned
    # and resolved them, the steps that need an unowned or open exception are skipped, never failed
    check('operations: Exceptions lists the open exceptions with their kind, owner line and status', app.wait_text(r'^(Meera Iyer is near capacity|Confirm a coach for a new member|BIO-\d+ needs a new collection visit)$', 20) and app.has_text(r'^(Unassigned|[A-Z][\w ]+) · created') and app.has_text(r'^OPEN$'), app.text()[:400])
    check('operations: an exception with a record carries "Open record →"', app.find_clickable('Open record →'))
    shot(app, 'admin-b1-operations-exceptions')
    before = [t for t in segment_tabs(app) if t.startswith('Exceptions')]
    app.click_text('Audit log')
    app.wait_text(r'^Auth login$', 30)
    app.b.pump(0.5)
    after = [t for t in segment_tabs(app) if t.startswith('Exceptions')]
    check('operations: the Exceptions count stays on the tab strip while another tab is open', bool(before) and re.match(r'^Exceptions \d+$', before[0]) is not None and after == before, '%s -> %s' % (before, after))
    app.click_text(before[0] if before else 'Exceptions', exact=bool(before))
    app.wait_text(r'^Any kind$', 20)
    if app.find_clickable('Own it'):
        app.click_text('Own it')
        check('operations: Own it answers "You own it"', app.wait_text(r'^You own it$', 20), app.text()[:200])
        app.click_text('In progress')
        check('operations: In progress lists the owned exception with the owner\'s name', app.wait_text(r'^Bioptime owner · created', 20) and app.has_text(r'^IN PROGRESS$'), app.text()[:300])
    else:
        skip('operations: Own it', 'every open exception already has an owner on this server')
        app.click_text('In progress')
        app.b.pump(1.0)
    if app.wait_clickable('Resolve', 5):
        app.click_text('Resolve')
        opened = app.wait_text(r'^Resolve: ', 10)
        check('operations: Resolve opens the portal\'s ReasonDialog: its body, "Reason (recorded in the audit log)" and "Keep as is"', opened and app.has_text(r'Say what was done; it becomes the resolution trail\.') and app.has_input('Reason (recorded in the audit log)') and app.find_clickable('Keep as is') and not app.has_text(r'At least 3 characters'), app.text()[:300])
        click_last(app, 'Resolve')
        check('operations: Resolve without a reason answers "Say why, in a few words." and keeps the dialog open', app.wait_text(r'^Say why, in a few words\.$', 5) and app.has_text(r'^Resolve: '), app.text()[:300])
        shot(app, 'admin-b1-operations-resolve-dialog')
        app.type_into('Reason (recorded in the audit log)', 'Second coach for Chennai agreed; capacity raised')
        click_last(app, 'Resolve')
        check('operations: resolving answers "Resolved"', app.wait_text(r'^Resolved$', 20), app.text()[:200])
        app.click_text('Resolved')
        check('operations: the Resolved view shows the resolution trail', app.wait_text(r'^Resolution: Second coach for Chennai agreed; capacity raised$', 20), app.text()[:300])
    else:
        skip('operations: Resolve', 'no exception in progress to resolve on this server')
    app.click_text('Open')
    app.click_text('Any kind')
    # audit log inside operations
    app.click_text('Audit log')
    check('operations: Audit log lists actions with who, target and age', app.wait_text(r'^Auth login$', 30) and app.has_text(r'^Bioptime owner · user ') and app.has_text(r'Append-only: rows are never edited or deleted \(enforced in the database\)\.'), app.text()[:300])
    # enquiries
    app.click_text('Enquiries')
    check('operations: Enquiries lists the website enquiry with its email, purpose, message and status', app.wait_text(r'^Nikhil Sharma$', 30) and app.has_text(r'nikhil\.sharma@demo\.bioptime\.test · General · received') and app.has_text(r'Do your packages include a nutrition plan\?') and app.has_text(r'^(NEW|IN PROGRESS|CLOSED)$'), app.text()[:300])
    if app.find_clickable('Take'):
        app.click_text('Take')
        check('operations: Take moves the enquiry to In progress and offers Close', app.wait_text(r'^IN PROGRESS$', 20) and app.wait_clickable('Close', 10), app.text()[:300])
    elif app.find_clickable('Close'):
        app.click_text('Close')
        check('operations: Close moves the enquiry to Closed', app.wait_text(r'^CLOSED$', 20), app.text()[:300])
    else:
        skip('operations: Take / Close an enquiry', 'the enquiry is already closed on this server')
    shot(app, 'admin-b1-operations-enquiries')
    # outbox
    app.click_text('Outbox')
    check('operations: Outbox carries the not-delivered note and rows by channel', app.wait_text(r'^What a configured provider would have sent$', 30) and app.has_text(r'Nothing here was delivered: the outbox records what a configured provider would send\.') and app.has_text(r'^(Email|Push|Sms) · '), app.text()[:300])
    check('operations: Outbox pages fifty at a time', app.has_text(r'^Showing 50 of \d+$') and app.find_clickable('Load more'))
    shot(app, 'admin-b1-operations-outbox')
    # jobs and events
    app.click_text('Jobs and events')
    check('operations: Jobs and events shows recent job runs and the dead letters', app.wait_text(r'^Recent job runs$', 30) and app.has_text(r'^Dead letters$') and app.has_text(r'^No dead letters$|^\d+ attempts$'), app.text()[:300])
    shot(app, 'admin-b1-operations-jobs')
    app.page_ok('Operations tab after every tab', r'^Operations$')
    # the same page as a plain screen (/admin/operations, linked from records)
    if open_screen(app, '/admin/operations', r'^Operations$', 'screen /admin/operations'):
        check('operations: the plain screen carries the five tabs too', app.wait_clickable('Jobs and events', 10, exact=False) and app.find_clickable('Enquiries', exact=False))
        check('operations: the plain screen\'s header reads "Operations" with the bell', header_title(app) == 'Operations' and bool(bell_label(app)), '%s / %s' % (header_title(app), bell_label(app)))


def audit_section(app, ctx):
    print('audit: /admin/audit, the fixed audit tab with filters and paging')
    if not open_screen(app, '/admin/audit', r'^Audit log$', 'screen /admin/audit'):
        return
    check('audit: the header reads "Audit log" with the bell', header_title(app) == 'Audit log' and bool(bell_label(app)), '%s / %s' % (header_title(app), bell_label(app)))
    check('audit: the portal\'s sub-line and no tab strip', app.has_text(r'Every administrative change with its actor, target, reason and time\. Append-only: rows are never edited or removed\.') and not app.find_clickable('Enquiries'))
    check('audit: entries list with action, actor, target and age, fifty at a time', app.wait_text(r'^Auth login$', 30) and app.has_text(r'^Showing 50 of \d+$') and app.find_clickable('Load more'), app.text()[:300])
    app.click_text('Load more')
    check('audit: Load more shows the next page', app.wait_text(r'^Showing 100 of \d+$', 10), app.text()[:200])
    app.click_text('Show filters')
    check('audit: the filters offer action, target, since and until', app.wait_clickable('Any action', 5) and app.find_clickable('Any target') and app.has_input('Since') and app.has_input('Until'))
    app.click_text('Report')
    # the newest unfiltered rows are report runs too (the analytics section just ran one), so wait until the sign-in rows are gone
    filtered = app.wait_js("!/^Auth login$/m.test(document.body.innerText) && /^Report run$/m.test(document.body.innerText)", 30)
    check('audit: filtering on the report actions keeps only report rows (the analytics run is audited)', filtered, app.text()[:300])
    check('audit: the filter count shows', app.has_text(r'^FILTERS · 1 SET$'))
    shot(app, 'admin-b1-audit-filtered')
    app.type_into('Since', '2099-01-01')
    check('audit: a future Since date empties the log with the portal\'s wording', app.wait_text(r'^No entries$', 30), app.text()[:200])
    app.type_into('Since', '2099-1')
    check('audit: a malformed date is refused before anything is asked', app.wait_text(r'Write the dates as YYYY-MM-DD to filter the log\.', 10), app.text()[:200])
    app.click_text('Clear filters')
    check('audit: Clear filters restores the full log', app.wait_text(r'^Auth login$', 30), app.text()[:200])
    app.page_ok('audit after filtering', r'^Audit log$')


def notifications_section(app, ctx):
    print('notifications: /admin/notifications and Mark all read')
    if not open_screen(app, '/admin/notifications', r'^Notifications$', 'screen /admin/notifications'):
        return
    check('notifications: the title only, without an invented sub-line', not app.has_text(r'What the bell collects'))
    check('notifications: the list shows the newest notices with their category and age', app.wait_text(r'^\d+ unread$|^Nothing unread$', 20) and app.has_text(r'(min|h|d) ago|just now'), app.text()[:300])
    unread = app.has_text(r'^\d+ unread$')
    if unread:
        app.click_text('Mark all read')
        check('notifications: Mark all read clears the count (no toast, as the web\'s popover)', app.wait_text(r'^Nothing unread$', 20) and not app.has_text(r'marked read'), app.text()[:200])
        app.open_route('/(admin)', HOME, 30)
        check('notifications: the bell no longer shows an unread count', app.wait_js("((e) => !!e && e.getAttribute('aria-label') === 'Notifications')(document.querySelector('[aria-label^=\"Notifications\"]'))", 20), str(bell_label(app)))
    else:
        skip('notifications: Mark all read', 'nothing unread for the owner on this server')
    shot(app, 'admin-b1-notifications')


SECTIONS = {'shell': shell_section, 'appointments': appointments_section, 'messages': messages_section, 'bloodwork': bloodwork_section, 'report': report_section, 'analytics': analytics_section, 'operations': operations_section, 'audit': audit_section, 'notifications': notifications_section}


def run(app, ctx, only=None):
    """The sections, for tools/e2e_app.py (the owner is signed in) or main() below. ctx carries base, app_url, out."""
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
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4241 (never the live demo).')
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
            run(app, {'base': BASE, 'app_url': app_url, 'out': ah.cs.OUT, 'accounts': {'owner': OWNER}}, only)
            timings['sections'] = round(time.monotonic() - t1, 1)
            ok, d = app.sign_out()
            check('the owner signs out from More and lands on a sign-in screen', ok, d)
    except Exception as e:
        traceback.print_exc()
        check('the run completed without an unexpected error', False, repr(e)[:300])
    finally:
        if app:
            try:
                app.screenshot('admin-b1-last-screen')
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
