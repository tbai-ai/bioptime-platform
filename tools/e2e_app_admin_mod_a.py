#!/usr/bin/env python3
"""End-to-end check of the administrative portal's module pieces, part A, in the app (apps/mobile, its Expo web build)
in headless Chrome at a phone's size (Python 3.9, stdlib, Google Chrome; tools/app_harness.py).

    BASE=http://127.0.0.1:4381 APP_PORT=9381 E2E_CDP_PORT=9781 python3 -I tools/e2e_app_admin_mod_a.py
    BASE=… APP_URL=http://localhost:9381 E2E_ONLY=billing,imports python3 -I tools/e2e_app_admin_mod_a.py

BASE is the scratch API (required; reset-demo first, started with CORS_ORIGINS=http://localhost:<APP_PORT>). The check
starts Expo web for apps/mobile on APP_PORT in its own process group and stops it (APP_URL drives a server that is
already running instead). As tools/e2e_app.py: the live demo's ports (3000, 3100, 3101, 8081) are refused for BASE and
the app, BASE must be an explicit port on 127.0.0.1, localhost, *.localhost or *.test, and E2E_OUT / E2E_CDP_PORT keep
parallel runs apart (defaults .local/e2e/app-admin-mod-a and 9781).

One sign-in through the screen (the owner, with the preview authenticator code of the demo server) is shared by every
section; one more from Python (ApiSession) reads ids and, for the gates section only, switches the imports part off
and on again with a reason. The sections change the scratch data (a refund request declined, a support request taken,
noted and resolved, a progress import applied and another withdrawn, the seeded members import applied and invited, a
help article written, published and withdrawn, lab next steps marked done, cancelled and reopened), so run against a
scratch server, never the live demo. A CSV is handed to the document picker by a capture listener that fills the
picker's own <input type=file> (headless Chrome shows no file chooser); Chrome then logs "File chooser dialog can only
be shown with a user activation", which is set aside as the test's own doing.

Sections (E2E_ONLY, default all, in this order): overview, tabs, report, lab, billing, support, exports, imports, help,
referrals, ai, fresh, gates. "fresh" pulls to refresh as the gesture would (the RefreshControl's onRefresh, called
through the React tree): on the member record each module tab loads again, on the report page the Next steps section
loads again, and the record's Support tab keeps the member's requests when the exports list fails. Then, with the
page's fetch to the API failing as it does offline, a pull on every module screen, record tab, Overview card and the
report section shows the stale banner ("Showing what was saved …"), once per module screen, and a pull back online
clears it; an import's rows are never kept on the device, so offline its screen says No connection. Also importable:
run(app, ctx) adds the same checks to another runner (the owner signed in).
Exit status 1 if anything fails; the JSON summary is the last line."""
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
APP_PORT = os.environ.get('APP_PORT') or '9381'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-admin-mod-a')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9781'
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
SECTION_NAMES = ('overview', 'tabs', 'report', 'lab', 'billing', 'support', 'exports', 'imports', 'help', 'referrals', 'ai', 'fresh', 'gates')
HOME = r'^Overview$'
PICKER_NOTE = 'File chooser dialog can only be shown with a user activation'
REASON = 'Checked with the team for this end-to-end run'


# ---------------------------------------------------------------- helpers
def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def errors(app):
    return [e for e in app.errors_since() if PICKER_NOTE not in e]


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
    app.b.pump(1.0)
    errs = errors(app)
    missing = app.has_text(ah.NO_SUCH_SCREEN)
    box = app.has_text(r'^Something went wrong$|^No connection$|^Signed out$|^Permission needed$|^No such page$')
    want = app.has_text(expect)
    ok = check(name, want and not errs and not missing and not box, '; '.join(errs[:3] + (['not-found screen'] if missing else []) + (['error or gate shown'] if box else []) + ([] if want else ['expected %r, saw %r' % (expect, app.text()[:160])])))
    no_labels(app, name)
    return ok


def screen_clean(app, name):
    errs = errors(app)
    check(name + ': no console error', not errs, '; '.join(errs[:3]))


def owner_session(ctx):
    if ctx.get('session') is None:
        code = ah.demo_totp(ctx['base'], OWNER[0])
        ctx['session'] = ah.ApiSession(ctx['base']).login(OWNER[0], OWNER[1], workspace='admin', mfa_code=code)
    return ctx['session']


def member_id(ctx, name):
    s = owner_session(ctx)
    for row in s.get('/admin/members?q=%s' % name.split()[0]).get('items', []):
        if row.get('name') == name:
            return row['id']
    return None


HOOK = r"""(() => { if (!window.__pickHook) { window.__pickHook = true;
  document.addEventListener('click', (e) => { const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'file' && window.__nextFile) { const dt = new DataTransfer(); dt.items.add(window.__nextFile);
      t.files = dt.files; window.__nextFile = null; setTimeout(() => t.dispatchEvent(new Event('change')), 0); } }, true); } return true; })()"""


def give_file(app, name, text, mime='text/csv'):
    """The next document picker the app opens receives this file (see the module notes)."""
    app.js(HOOK)
    app.js('window.__nextFile = new File([%s], %s, { type: %s }); true' % (json.dumps(text), json.dumps(name), json.dumps(mime)))


def tab_titles(app):
    return app.js(r"""Array.from(document.querySelectorAll('[role=tab]')).map((e) => (e.innerText || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim().replace(/ \d+$/, ''))""") or []


# ---------------------------------------------------------------- sections
def overview_section(app, ctx):
    print('overview: the module cards on the Overview')
    if not open_screen(app, '/(admin)', HOME, 'Overview with the module cards'):
        return
    cards = [('Billing', r'refund requests? to decide$|^No refund requests waiting$'), ('Exercise library', r'^Coach proposals to review$'), ('Reports', r'^Lab next steps$'),
             ('Live sessions', r'^Coming up$'), ('Learning', r'^Courses$'), ('Growth', r'^From the website$')]
    for eyebrow, title in cards:
        check('overview: the %s card shows "%s"' % (eyebrow, title.strip('^$')), app.wait_text(title, 20), app.text()[-300:])
    check('overview: the billing card says what is missing for tax invoices', app.has_text(r'^Receipts only: tax invoices are pending configuration \(missing |^Tax invoices are issued\.'))
    check('overview: the lab card lists Open, Past due, Done and Cancelled', all(app.has_text(r'^%s$' % k) for k in ('Open', 'Past due', 'Done', 'Cancelled')))
    check('overview: the sessions card lists a published session with its host and places', app.has_text(r' IST$') and app.has_text(r' registered'))
    check('overview: the growth card counts discovery calls, corporate enquiries and subscribers', app.has_text(r'new discovery call request') and app.has_text(r'new corporate enquir') and app.has_text(r'newsletter subscriber'))
    check('overview: the learning card reads Drafts, Published and Archived', all(app.has_text(r'^%s$' % k) for k in ('DRAFTS|Drafts', 'PUBLISHED|Published', 'ARCHIVED|Archived')))
    shot(app, 'mod-a-overview-cards')
    clicked = app.js("(() => { const e = document.querySelector('[aria-label=\"Open Lab next steps\"]'); if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true; })()")
    check('overview: "Open" on the lab card opens /admin/lab-follow-ups', clicked and app.wait_text(r'^Lab follow-ups$', 30) and app.path().endswith('/admin/lab-follow-ups'), app.path())


def tabs_section(app, ctx):
    print('tabs: the module tabs of the member record (Ananya Rao)')
    mid = member_id(ctx, 'Ananya Rao')
    if not mid:
        check('tabs: Ananya Rao found through the API', False)
        return
    ctx['ananya'] = mid
    if not open_screen(app, '/admin/clients/%s' % mid, r'^Overview$', 'member record /admin/clients/:id'):
        return
    titles = tab_titles(app)
    want = ['Overview', 'Plan', 'Bloodwork', 'Appointments', 'Progress', 'Habits', 'Goals and check-ins', 'Billing', 'Support', 'Workouts', 'Lab next steps', 'Sessions', 'Learning', 'Notes', 'Account']
    check('tabs: the record lists the module tabs in the web\'s order between Progress and Notes', [t for t in titles if t in want] == want, str(titles))
    expect = {
        'Habits': [r'^Due days checked in as done$', r'^Evening walk$', r'Read only\. Coaches set and change the habits they set'],
        'Goals and check-ins': [r'^OPEN GOALS$|^Open goals$', r'^Set by the member or their coach$', r'^Statuses \(answers stay between the member and their coach\)$'],
        'Billing': [r'^Verified paid orders$', r'^PAY-1001 · Core$', r'^Refund requests$'],
        'Support': [r'^Requests from this member$', r'^SUP-0901$', r'^Data exports$'],
        'Workouts': [r'^Workout programmes$', r'^Three-week full body$', r'^Schedule and logs$'],
        'Lab next steps': [r'^\d+ open$|^Nothing open$', r'^Add a next step$', r'The team adds next steps only on a report it released itself'],
        'Sessions': [r'^Summaries for the client$', r'^Coaches’ follow-ups from consultations$', r'^Group classes, webinars and workshops$'],
        'Learning': [r'^Courses and progress$', r'^Getting started with courses$'],
    }
    for tab, rxs in expect.items():
        app.err_mark = len(app.b.errors)
        app.click_text(tab)
        ok = all(app.wait_text(rx, 20) for rx in rxs)
        check('tabs: %s renders the seed\'s data' % tab, ok, app.text()[-400:])
        screen_clean(app, 'tabs: ' + tab)
        shot(app, 'mod-a-tab-' + re.sub(r'\W+', '-', tab.lower()))
    app.click_text('Support')
    check('tabs: on the Support tab the request reference is a link', app.wait_js("Array.from(document.querySelectorAll('a,[role=link]')).some((e) => (e.innerText || '').trim() === 'SUP-0901')", 15))
    app.click_text('Workouts')
    if app.wait_clickable('View', 15):
        app.click_text('View')
        check('tabs: a logged session opens with its sets, effort and the coach\'s feedback (read only)', app.wait_text(r'self-rated\)$|^Not rated$', 20) and not app.find_clickable('Send feedback'), app.text()[-300:])
        shot(app, 'mod-a-tab-workouts-session')
        click_last(app, 'Close')


def report_section(app, ctx):
    print('report: "Next steps" on the report page (team mode)')
    s = owner_session(ctx)
    rid = None
    for f in s.get('/admin/lab-follow-ups?status=all&limit=50').get('items', []):
        if f.get('report'):
            rid = f['report']['id']
            break
    if not rid:
        check('report: a report with next steps found through the API', False)
        return
    if not open_screen(app, '/admin/reports/%s' % rid, r'^Next steps$', 'report page with the Next steps section'):
        return
    check('report: the section lists the coach\'s next steps with their links and status', app.has_text(r'^Retest · |^Consultation · |^Plan change · ') and app.has_text(r'^OPEN$|^DONE$'))
    check('report: on a coach-reviewed report the team is told the wording is the coach\'s', app.has_text(r'The member’s coach reviewed this report, so adding next steps and wording them is the coach’s job\.'))
    check('report: the member-notification footnote is the web\'s', app.has_text(r'^The member sees open and done next steps with the report\.'))
    if app.wait_clickable('Link', 10):
        app.click_text('Link')
        check('report: Link opens "Link this next step" with the linked record and a reason', app.wait_text(r'^Link this next step$', 10) and app.has_text(r'^Linked record$') and app.has_input('Reason (recorded in the audit log)'))
        shot(app, 'mod-a-report-link')
        click_last(app, 'Keep as is')
    shot(app, 'mod-a-report-next-steps')


def lab_section(app, ctx):
    print('lab: /admin/lab-follow-ups with its filters and the team\'s changes')
    if not open_screen(app, '/admin/lab-follow-ups', r'^Lab follow-ups$', 'screen /admin/lab-follow-ups'):
        return
    check('lab: the sub-line is the web\'s', app.has_text(r'^Next steps set after a report review: consultations, retests, plan changes and notes\.'))
    check('lab: four readouts Open, Past due, Done, Cancelled', all(app.has_text(r'^%s$' % k) for k in ('OPEN', 'PAST DUE', 'DONE', 'CANCELLED')))
    check('lab: the open list shows a member, the step and its report', app.wait_text(r'^Ananya Rao$', 20) and app.has_text(r'^Full Body Checkup, Advanced · BIO-\d+$'))
    shot(app, 'mod-a-lab-open')
    if app.click_text('Cancel', seconds=10):
        app.wait_text(r'^Cancel this next step$', 10)
        click_last(app, 'Cancel it')
        check('lab: cancelling without a reason is refused with "Say why, in a few words."', app.wait_text(r'^Say why, in a few words\.$', 10))
        app.type_into('Reason (recorded in the audit log)', REASON)
        click_last(app, 'Cancel it')
        check('lab: Cancel with a reason answers "Cancelled"', app.wait_text(r'^Cancelled$', 20), app.text()[:200])
    app.click_text('Cancelled')
    check('lab: the Cancelled filter lists the cancelled step with the list\'s "Cancelled: {reason}" line', app.wait_text(r'^Cancelled: ' + re.escape(REASON) + '$', 20), app.text()[-300:])
    check('lab: rows read the list\'s Due column ("Due: {date}" or "Due: None")', app.has_text(r'^Due: (None|\d{1,2} \w{3} \d{4}) · '), app.text()[-300:])
    if app.click_text('Reopen', seconds=10):
        app.wait_text(r'^Reopen this next step$', 10)
        app.type_into('Reason (recorded in the audit log)', REASON)
        click_last(app, 'Reopen')
        check('lab: Reopen with a reason answers "Reopened"', app.wait_text(r'^Reopened$', 20), app.text()[:200])
    app.click_text('Any status')
    check('lab: Any status lists open and done steps', app.wait_text(r'^DONE$', 20) and app.has_text(r'^OPEN$'))
    app.click_text('Plan change')
    check('lab: the kind filter narrows to plan changes', app.wait_js("!/^Retest · /m.test(document.body.innerText)", 20) and app.wait_text(r'^Plan change · ', 20), app.text()[-300:])
    screen_clean(app, 'lab')
    shot(app, 'mod-a-lab-filtered')


def billing_section(app, ctx):
    print('billing: /admin/billing documents and refund requests')
    if not open_screen(app, '/admin/billing', r'^Billing documents$', 'screen /admin/billing'):
        return
    check('billing: the setup notice names what is missing for tax invoices', app.has_text(r'^Tax invoices are pending configuration$') and app.has_text(r'^Missing: billing_entity'))
    check('billing: the GST line and the four readouts', app.has_text(r'^GST rate for new orders: \d') and all(app.has_text(r'^%s$' % k) for k in ('RECEIPTS', 'TAX INVOICES', 'CREDIT NOTES', 'REFUND REQUESTS')))
    check('billing: a receipt reads "Payment receipt · not a tax invoice" with the simulated payment note', app.has_text(r'^Payment receipt · not a tax invoice · Simulated payment$'))
    app.click_text('Credit notes')
    check('billing: the kind filter answers (no credit notes yet)', app.wait_text(r'^No documents$', 20) and app.has_text(r'^Nothing matches these filters\.$'))
    app.click_text('Every kind')
    app.type_into('Search documents', 'PAY-1001')
    app.click_text('Search')
    check('billing: searching a reference finds its receipt', app.wait_js("!document.body.innerText.includes('PAY-1002/')", 20) and app.wait_text(r'^PAY-1001/', 20), app.text()[-300:])
    shot(app, 'mod-a-billing-documents')
    app.click_text('Refund requests')
    if not app.wait_text(r'^Approving refunds the order in full through the payment provider', 20):
        check('billing: the Refund requests tab opens', False)
        return
    check('billing: the waiting request shows its order, member, reason and both decisions', app.wait_text(r'^PAY-1011$', 20) and app.has_text(r'^Starter · Activated$') and app.find_clickable('Approve') and app.find_clickable('Decline'))
    shot(app, 'mod-a-billing-requests')
    app.click_text('Decline')
    check('billing: Decline opens the web\'s sheet with the member\'s words', app.wait_text(r'^Decline the refund of PAY-1011\?$', 10) and app.has_text(r'^Nothing changes on the order\. The member reads your note\.$'))
    click_last(app, 'Decline')
    check('billing: a decision without a note is refused with the web\'s words', app.wait_text(r'^Write a note for the member, in a few words\.$', 10))
    app.type_into('Note to the member (recorded in the audit log)', 'The package can be changed instead; the team will write to you.')
    shot(app, 'mod-a-billing-decline')
    click_last(app, 'Decline')
    check('billing: declining answers "Declined" and the queue empties', app.wait_text(r'^Declined$', 20) and app.wait_text(r'^Nothing to decide$', 20), app.text()[:300])
    app.click_text('Declined')
    check('billing: the Declined filter shows the decision and its note', app.wait_text(r'The package can be changed instead', 20))
    screen_clean(app, 'billing')


def support_section(app, ctx):
    print('support: /admin/support queue and one request')
    if not open_screen(app, '/admin/support', r'^Support requests$', 'screen /admin/support'):
        return
    check('support: the sub-line is the web\'s', app.has_text(r'No response time is promised until Bioptime sets one\.$'))
    check('support: the queue filters read "Open or waiting (n)", topics and owners', app.has_text(r'^Open or waiting \(\d+\)$') and app.has_text(r'^Any topic$') and app.has_text(r'^Unowned$'))
    check('support: the queue lists both seeded requests', app.wait_text(r'^SUP-0902 · ', 20) and app.has_text(r'^SUP-0901 · '))
    app.type_into('Reference or subject', 'SUP-0902')
    app.click_text('Search')
    check('support: searching a reference narrows the queue', app.wait_js("!document.body.innerText.includes('SUP-0901 · ')", 20) and app.wait_text(r'^SUP-0902 · ', 20), app.text()[-300:])
    shot(app, 'mod-a-support-queue')
    app.click_text('SUP-0902 · Change the email on my coach account')
    if not app.wait_text(r'^THREAD$|^Thread$', 30):
        check('support: a request opens from the queue', False, app.text()[:200])
        return
    check('support: the request page shows the subject, reference, thread and the request facts', app.has_text(r'^Change the email on my coach account$') and app.has_text(r'^SUP-0902 · Account and sign-in · opened ') and app.has_text(r'^Asha Menon · Coach$'))
    app.set_checkbox('Internal note', True)
    app.type_into('Internal note text', 'Checked the account; the email change needs the coach to confirm by phone.')
    app.click_text('Add note')
    check('support: an internal note answers "Internal note added" and shows marked', app.wait_text(r'^Internal note added$', 20) and app.wait_text(r'^INTERNAL NOTE · THE REQUESTER NEVER SEES IT$|^Internal note · the requester never sees it$', 20))
    app.click_text('Resolved')
    check('support: a status change asks for a reason with the web\'s words', app.wait_text(r'^Mark SUP-0902 resolved\?$', 10) and app.has_text(r'^The requester sees the new status\. Changing it does not notify them'))
    app.type_into('Reason (recorded in the audit log)', REASON)
    click_last(app, 'Change status')
    check('support: the status changes with "Status changed"', app.wait_text(r'^Status changed$', 20) and app.wait_text(r'^RESOLVED$|^Resolved$', 20))
    shot(app, 'mod-a-support-request')
    screen_clean(app, 'support request')
    app.click_text('Back to the queue')
    app.type_into('Reference or subject', '')
    app.click_text('Search')
    app.wait_text(r'^SUP-0901 · ', 20)
    app.click_text('SUP-0901 · The app still shows yesterday’s tasks')
    if app.wait_text(r'^THREAD$', 30) and app.wait_clickable('Take it', 10):
        app.click_text('Take it')
        check('support: Take it answers "You own it" and the request is the signed-in owner\'s', app.wait_text(r'^You own it$', 20) and app.wait_js("!Array.from(document.querySelectorAll('[role=button]')).some((e) => (e.innerText || '').trim() === 'Take it')", 20) and app.has_text(r'^Bioptime owner$'), app.text()[-300:])
    else:
        skip('support: Take it', 'SUP-0901 is already the owner\'s on this server')
    check('support: the thread marks the team\'s internal note and names the member requester', app.has_text(r'^INTERNAL NOTE · THE REQUESTER NEVER SEES IT$') and app.has_text(r'^Ananya Rao \(Member\) · '))
    shot(app, 'mod-a-support-take')


def exports_section(app, ctx):
    print('exports: the Data exports tab')
    if not open_screen(app, '/admin/support?tab=exports', r'^What the team can and cannot see$', 'screen /admin/support?tab=exports'):
        return
    has = app.wait_text(r'^DATA EXPORT REQUESTS$|^No export requests$', 20)
    check('exports: the list or the web\'s empty state shows', has)
    if app.find_clickable('Generate now'):
        app.click_text('Generate now')
        app.wait_text(r'’s data export\?$', 10)
        app.type_into('Reason (recorded in the audit log)', REASON)
        click_last(app, 'Generate')
        check('exports: Generate now answers "Export generated; the member is notified"', app.wait_text(r'^Export generated; the member is notified$', 30), app.text()[:200])
    else:
        skip('exports: Generate now', 'no export request without a file on this server')
    shot(app, 'mod-a-exports')


def imports_section(app, ctx):
    print('imports: a CSV checked, staged, applied and withdrawn; the seeded members import applied and invited')
    if not open_screen(app, '/admin/imports', r'^Check a file$', 'screen /admin/imports'):
        return
    check('imports: the header row and the column rules for progress history', app.has_text(r'^member,metric,value,unit,at,note$') and app.has_text(r'^Required: member, metric, value, unit, at\. Optional: note\. At most \d+ rows and 1 MB\.'))
    check('imports: Check only and Check and stage wait for a file', app.is_disabled('Check only') and app.is_disabled('Check and stage'))
    give_file(app, 'progress-check.csv', 'member,metric,value,unit,at,note\nananya.rao@demo.bioptime.test,weight_kg,61.4,kg,2026-10-03,from the old app\nnobody@example.test,weight_kg,70,kg,2026-10-03,\n')
    app.click_text('Choose a CSV file')
    check('imports: the document picker hands the CSV to the screen', app.wait_text(r'^progress-check\.csv$', 15))
    app.click_text('Check only')
    check('imports: the dry run reports rows ready and the row with a problem', app.wait_text(r'^1 of 2 rows ready$', 30) and app.has_text(r'^Row 3$') and app.has_text(r'no member with this email address'), app.text()[:300])
    shot(app, 'mod-a-imports-dry-run')
    give_file(app, 'progress-apply.csv', 'member,metric,value,unit,at,note\nananya.rao@demo.bioptime.test,weight_kg,61.3,kg,2026-10-04,from the old app\n')
    app.click_text('Choose another file')
    app.wait_text(r'^progress-apply\.csv$', 15)
    app.click_text('Check and stage')
    check('imports: Check and stage opens the import with the web\'s toast', app.wait_text(r'^Review, apply, invite$|^REVIEW, APPLY, INVITE$', 30) and app.has_text(r'^Staged for review: nothing is created until you apply it$'), app.text()[:300])
    app.click_text('Apply 1 row')
    app.wait_text(r'^Apply 1 rows\?$', 10)
    check('imports: Apply asks for a reason with the web\'s words', app.has_text(r'^Each valid row becomes a progress value with the source “import”\.$'))
    app.type_into('Reason (recorded in the audit log)', REASON)
    click_last(app, 'Apply')
    check('imports: applying answers "Applied" and records the created row', app.wait_text(r'^Applied$', 20) and app.wait_text(r'^1 created · ', 20) and app.has_text(r'^CREATED$|^Created$'), app.text()[:300])
    shot(app, 'mod-a-imports-applied')
    app.click_text('All imports')
    app.wait_text(r'^Check a file$', 20)
    give_file(app, 'progress-withdraw.csv', 'member,metric,value,unit,at,note\nananya.rao@demo.bioptime.test,weight_kg,61.0,kg,2026-10-05,\n')
    app.click_text('Choose a CSV file')
    app.wait_text(r'^progress-withdraw\.csv$', 15)
    app.click_text('Check and stage')
    app.wait_text(r'^Withdraw this import$', 30)
    app.click_text('Withdraw this import')
    app.wait_text(r'^Withdraw this import\?$', 10)
    app.type_into('Reason (recorded in the audit log)', REASON)
    click_last(app, 'Withdraw')
    check('imports: withdrawing answers "Withdrawn" and the import reads cancelled', app.wait_text(r'^Withdrawn$', 20) and app.wait_text(r'^CANCELLED$|^Cancelled$', 20))
    app.click_text('All imports')
    if app.wait_text(r'^members-to-invite\.csv$', 20):
        app.click_text('members-to-invite.csv')
        check('imports: the seeded members import lists its rows with contact fields for the owner', app.wait_text(r'^Row 2$', 20) and app.has_text(r'@'), app.text()[:300])
        if app.wait_clickable('Apply 2 rows', 10):
            app.click_text('Apply 2 rows')
            app.wait_text(r'^Each valid row becomes an invited account\. No email is sent\.$', 10)
            app.type_into('Reason (recorded in the audit log)', REASON)
            click_last(app, 'Apply')
            check('imports: applying the members import creates invited accounts', app.wait_text(r'^Applied$', 20) and app.wait_text(r'^Send 2 invitations$', 20), app.text()[:300])
            app.click_text('Send 2 invitations')
            app.wait_text(r'single-use activation link that expires in 72 hours', 10)
            app.type_into('Reason (recorded in the audit log)', REASON)
            click_last(app, 'Send invitations')
            check('imports: sending answers "2 invitations sent"', app.wait_text(r'^2 invitations sent$', 20), app.text()[:300])
            shot(app, 'mod-a-imports-members')
        else:
            skip('imports: apply the members import', 'the seeded members import was already applied on this server')
    screen_clean(app, 'imports')


def help_section(app, ctx):
    print('help: /admin/help-articles editor')
    if not open_screen(app, '/admin/help-articles', r'^Words Bioptime supplies$', 'screen /admin/help-articles'):
        return
    check('help: the list shows the seeded articles with section, address and status', app.has_text(r'^Setting your working hours$') and app.has_text(r'^Coaching on Bioptime · /working-hours$') and app.has_text(r'^PUBLISHED$'))
    app.click_text('New article')
    check('help: New article opens the editor with Save draft disabled until there is a title and a body', app.wait_text(r'^New article$', 10) and app.is_disabled('Save draft'))
    title = 'Changing your reminder times %d' % (int(time.time()) % 100000)
    app.type_into('Title', title)
    app.click_text('Members and coaches')
    app.type_into('Section (optional)', 'Using Bioptime')
    app.type_into('Body', '<p>Open <strong>Habits</strong> and choose the habit.</p><ul><li>Pick a time</li></ul>')
    check('help: the preview reads the body back', app.wait_text(r'^• Pick a time$', 10))
    app.click_text('Save draft')
    check('help: saving answers "Draft saved" and the editor turns to the draft', app.wait_text(r'^Draft saved$', 20) and app.wait_text(r'^Edit article$', 20))
    app.click_text('Publish')
    app.wait_text(r'^Publish “', 10)
    check('help: Publish asks for a reason and names the readers', app.has_text(r'^Readers see it at once \(members and coaches\)\. Unsaved changes are not published; save first\.$'))
    app.type_into('Reason (recorded in the audit log)', REASON)
    click_last(app, 'Publish')
    check('help: publishing answers "Published"', app.wait_text(r'^Published$', 20) and app.wait_clickable('Withdraw', 10))
    shot(app, 'mod-a-help-published')
    app.click_text('Withdraw')
    app.wait_text(r'^It goes back to draft and disappears from Help\.$', 10)
    app.type_into('Reason (recorded in the audit log)', REASON)
    click_last(app, 'Withdraw')
    check('help: withdrawing answers "Withdrawn" and the article is a draft again', app.wait_text(r'^Withdrawn$', 20) and app.wait_clickable('Publish', 10))
    app.click_text('Close')
    check('help: the list shows the new article as a draft', app.wait_text(re.escape(title), 20) and app.has_text(r'^DRAFT$'))
    screen_clean(app, 'help')


def referrals_section(app, ctx):
    print('referrals: /admin/referrals')
    if not open_screen(app, '/admin/referrals', r'^Name, member ID or code$|^Referrals$', 'screen /admin/referrals'):
        return
    check('referrals: the four readouts', all(app.has_text(r'^%s$' % k) for k in ('REFERRALS', 'SIGNED UP', 'PAYING MEMBERS', 'MEMBERS REFERRING')))
    check('referrals: rows name the new member and who referred them with member IDs', app.wait_text(r'^New member: Priya Nair · BPM-\d+$', 20) and app.has_text(r'^Referred by: Ananya Rao · BPM-\d+$'))
    app.click_text('Became a paying member')
    check('referrals: the status filter keeps the paying member only', app.wait_text(r'^BECAME A PAYING MEMBER$|^Became a paying member$', 20) and app.wait_js("!document.body.innerText.includes('Rohan Das')", 20))
    app.click_text('All statuses')
    app.type_into('Name, member ID or code', 'Rohan')
    app.js("(() => { const i = document.querySelector('input[aria-label=\"Name, member ID or code\"]'); i && i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()")
    app.b.pump(0.5)
    shot(app, 'mod-a-referrals')
    screen_clean(app, 'referrals')


def ai_section(app, ctx):
    print('ai: /admin/ai (Coach AI usage)')
    if not open_screen(app, '/admin/ai', r'^Requests over the range$', 'screen /admin/ai'):
        return
    configured = app.has_text(r'^Coach AI is configured$')
    check('ai: readiness says configured or names exactly what is missing', configured or (app.has_text(r'^Coach AI is not configured$') and app.has_text(r'^• ')))
    check('ai: the four readouts with the web\'s sub-lines', app.has_text(r'^Not configured, or no client consent$') and app.has_text(r'^Edited and kept by the coach$') and app.has_text(r'^Text cleared at once$'))
    check('ai: by purpose lists every purpose with counts only', app.has_text(r'^Reply to a message$') and app.has_text(r'^Requests \d+ · Refused \d+ · Accepted \d+$'))
    check('ai: the footer names the stored drafts and the prompt version', app.has_text(r'Drafts stored now: .*Prompt version '))
    app.type_into('From', '2026-10-01')
    check('ai: changing From reloads the range', app.wait_text(r'^1 Oct 2026 to ', 20), app.text()[:300])
    shot(app, 'mod-a-ai')
    screen_clean(app, 'ai')


# the page's fetch, wrapped once: every URL is logged, and while `offline` is set a request to the API fails as it does
# without a network (the app's api module turns that into its offline error and useLoad falls back to the saved copy)
NET_JS = r"""(() => { if (!window.__e2eNet) { const of = window.fetch.bind(window); window.__e2eNet = { log: [], offline: false };
  window.fetch = (u, o) => { const url = String((u && u.url) || u); window.__e2eNet.log.push(url);
    if (window.__e2eNet.offline && /\/api\//.test(url)) return Promise.reject(new TypeError('Failed to fetch')); return of(u, o); }; }
  return true; })()"""
# pull to refresh as the gesture runs it: the onRefresh of the RefreshControl on the scroll view holding a visible text
PULL_JS = r"""((rx) => { const re = new RegExp(rx, 'i');
  const els = Array.from(document.querySelectorAll('div,span')).filter((e) => e.offsetParent !== null && !e.children.length && re.test((e.innerText || '').trim()));
  for (const el of els) { const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$')); let f = k ? el[k] : null;
    for (let i = 0; f && i < 400; i++, f = f.return) { const rc = f.memoizedProps && f.memoizedProps.refreshControl;
      if (rc && rc.props && typeof rc.props.onRefresh === 'function') { rc.props.onRefresh(); return true; } } }
  return false; })"""
STALE_COUNT_JS = r"""Array.from(document.querySelectorAll('div,span')).filter((e) => e.offsetParent !== null && !e.children.length && /^Showing what was saved .*Pull to refresh when you are back online\.$/.test((e.innerText || '').trim())).length"""
OFFLINE_NOTE = 'Failed to fetch'
# GET /admin/data-exports answers 500 while window.__e2eFailExports is set (the other requests go through)
FAIL_EXPORTS_JS = r"""(() => { if (!window.__e2eFailWrapped) { window.__e2eFailWrapped = true; const of = window.fetch.bind(window);
  window.fetch = (u, o) => { const url = String((u && u.url) || u);
    if (window.__e2eFailExports && /\/api\/admin\/data-exports$/.test(url)) return Promise.resolve(new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'The export list could not be read.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    return of(u, o); }; } window.__e2eFailExports = true; return true; })()"""


def net(app, offline=None, clear=False):
    app.js(NET_JS)
    if offline is not None:
        app.js('window.__e2eNet.offline = %s; true' % ('true' if offline else 'false'))
    if clear:
        app.js('window.__e2eNet.log.length = 0; true')


def fetched(app, rx, seconds=10):
    return app.wait_js("window.__e2eNet.log.some((u) => new RegExp(%s).test(u))" % json.dumps(rx), seconds)


def pull(app, anchor_rx):
    return bool(app.js('%s(%s)' % (PULL_JS, json.dumps(anchor_rx))))


def stale_count(app):
    return app.js(STALE_COUNT_JS) or 0


def wait_stale(app, want, seconds=15, at_least=False):
    """Wait until the visible stale banners number `want` (or at least `want`); returns the last count seen."""
    end = time.monotonic() + seconds
    n = stale_count(app)
    while time.monotonic() < end:
        n = stale_count(app)
        if (n >= want) if at_least else (n == want):
            return n
        app.b.pump(0.3)
    return n


def offline_round(app, name, anchor, want, at_least=False, keep=None):
    """Offline, pull: the stale banner shows (`want` of them) and the saved data stays; online, pull: it clears."""
    net(app, offline=True)
    pulled = pull(app, anchor)
    n = wait_stale(app, want, 20, at_least)
    kept = app.has_text(keep) if keep else True
    check('%s: offline, a pull shows the stale banner (%s%d, saw %d) over the saved data' % (name, 'at least ' if at_least else '', want, n), pulled and ((n >= want) if at_least else (n == want)) and kept, '' if pulled else 'no RefreshControl found')
    net(app, offline=False)
    pull(app, anchor)
    n = wait_stale(app, 0, 20)
    check('%s: back online, a pull clears the stale banner' % name, n == 0, '' if n == 0 else 'still %d' % n)


def fresh_errors(app):
    return [e for e in errors(app) if OFFLINE_NOTE not in e and 'data-exports' not in e and 'status of 500' not in e]


def fresh_section(app, ctx):
    print('fresh: pull to refresh reaches the record tabs and the report section; offline, every piece says it shows what was saved')
    mid = ctx.get('ananya') or member_id(ctx, 'Ananya Rao')
    if not mid:
        check('fresh: Ananya Rao found through the API', False)
        return
    try:
        # ---- the member record: each module tab reloads with the record's pull, and shows the stale banner offline
        if open_screen(app, '/admin/clients/%s' % mid, r'^Overview$', 'fresh: member record'):
            tabs = [('Habits', r'^Due days checked in as done$', r'/admin/members/[^/?]+/habits'),
                    ('Goals and check-ins', r'^Set by the member or their coach$', r'/admin/members/[^/?]+/progress'),
                    ('Billing', r'^Verified paid orders$', r'/admin/orders\?memberId='),
                    ('Support', r'^Requests from this member$', r'/admin/support-requests\?requesterId='),
                    ('Workouts', r'^Workout programmes$', r'/admin/members/[^/?]+/workouts'),
                    ('Lab next steps', r'^Add a next step$', r'/admin/lab-follow-ups\?memberId='),
                    ('Sessions', r'^Summaries for the client$', r'/admin/members/[^/?]+/sessions'),
                    ('Learning', r'^Courses and progress$', r'/admin/members/[^/?]+/learning')]
            for tab, anchor, endpoint in tabs:
                app.err_mark = len(app.b.errors)
                app.click_text(tab)
                if not app.wait_text(anchor, 20):
                    check('fresh: the %s tab opens' % tab, False, app.text()[-200:])
                    continue
                app.b.pump(0.8)
                net(app, offline=False, clear=True)
                pulled = pull(app, anchor)
                check('fresh: pull to refresh on the record reloads the %s tab (%s)' % (tab, endpoint.replace('\\', '')), pulled and fetched(app, endpoint, 15), '' if pulled else 'no RefreshControl found')
                app.wait_js("!/Bundling/.test(document.body.innerText)", 5)
                app.b.pump(1.0)
                # the record's own banner and the tab's
                offline_round(app, 'fresh: record tab %s' % tab, anchor, 2, keep=anchor)
                if tab == 'Habits':
                    shot(app, 'mod-a-fresh-tab-online')
                errs = fresh_errors(app)
                check('fresh: record tab %s: no console error' % tab, not errs, '; '.join(errs[:3]))
            # the Support tab's two cards load on their own: a failing exports list leaves the member's requests on screen
            app.click_text('Support')
            if app.wait_text(r'^SUP-0901$', 20):
                app.js(FAIL_EXPORTS_JS)
                pull(app, r'^Requests from this member$')
                check('fresh: record tab Support: a failing exports list shows its error in the Data exports card only', app.wait_text(r'^The export list could not be read\.$', 20) and app.has_text(r'^SUP-0901$') and not app.has_text(r'^No export requested\.$'), app.text()[-300:])
                app.js('window.__e2eFailExports = false; true')
                pull(app, r'^Requests from this member$')
                check('fresh: record tab Support: with the list readable again a pull clears the error', app.wait_js("!/The export list could not be read/.test(document.body.innerText)", 20))
            app.click_text('Habits')
            app.wait_text(r'^Due days checked in as done$', 20)
            net(app, offline=True)
            pull(app, r'^Due days checked in as done$')
            wait_stale(app, 2, 20)
            shot(app, 'mod-a-fresh-tab-offline')
            net(app, offline=False)
            pull(app, r'^Due days checked in as done$')
            wait_stale(app, 0, 20)

        # ---- the report page: the Next steps section reloads with the report's pull
        s = owner_session(ctx)
        rid = next((f['report']['id'] for f in s.get('/admin/lab-follow-ups?status=all&limit=50').get('items', []) if f.get('report')), None)
        if rid and open_screen(app, '/admin/reports/%s' % rid, r'^Next steps$', 'fresh: report page'):
            app.b.pump(1.0)
            net(app, offline=False, clear=True)
            pulled = pull(app, r'^Next steps$')
            check('fresh: pull to refresh on the report page reloads Next steps (/admin/lab-follow-ups?reportId=)', pulled and fetched(app, r'/admin/lab-follow-ups\?reportId=', 15))
            app.b.pump(1.0)
            offline_round(app, 'fresh: report Next steps', r'^Next steps$', 2, keep=r'^Next steps$')
            net(app, offline=True)
            pull(app, r'^Next steps$')
            wait_stale(app, 2, 20)
            app.js("(() => { const e = Array.from(document.querySelectorAll('div')).find((d) => d.offsetParent !== null && !d.children.length && /^Next steps$/.test((d.innerText || '').trim())); if (e) e.scrollIntoView({block: 'start'}); return true; })()")
            shot(app, 'mod-a-fresh-report-offline')
            net(app, offline=False)
            pull(app, r'^Next steps$')
            wait_stale(app, 0, 20)

        # ---- the Overview: its own banner and one per module card
        if open_screen(app, '/(admin)', HOME, 'fresh: Overview'):
            app.wait_text(r'^From the website$', 20)
            app.b.pump(1.0)
            offline_round(app, 'fresh: Overview and its six module cards', r'^Coming up$', 7, at_least=True, keep=r'^From the website$')

        # ---- the module screens: one banner each, fed by every piece
        sup = s.get('/admin/support-requests').get('items', [])
        routes = [('/admin/lab-follow-ups', r'^Lab follow-ups$', r'^Lab follow-ups$'),
                  ('/admin/billing', r'^Billing documents$', r'^Billing$'),
                  ('/admin/billing?tab=requests', r'^Approving refunds the order in full', r'^Billing$'),
                  ('/admin/support', r'^Support requests$', r'^Support$'),
                  ('/admin/support?tab=exports', r'^What the team can and cannot see$', r'^Support$'),
                  ('/admin/imports', r'^Check a file$', r'^Check a file$'),
                  ('/admin/help-articles', r'^Words Bioptime supplies$', r'^Help articles$'),
                  ('/admin/referrals', r'^REFERRALS$', r'^Referrals$'),
                  ('/admin/ai', r'^Requests over the range$', r'^Coach AI usage$')]
        if sup:
            routes.insert(5, ('/admin/support/%s' % sup[0]['id'], r'^THREAD$|^Thread$', r'^THREAD$|^Thread$'))
        for route, expect, anchor in routes:
            if not open_screen(app, route, expect, 'fresh: screen %s' % route):
                continue
            app.b.pump(1.0)
            offline_round(app, 'fresh: %s' % route, anchor, 1, keep=expect)
            errs = fresh_errors(app)
            check('fresh: %s: no console error' % route, not errs, '; '.join(errs[:3]))
        if open_screen(app, '/admin/billing', r'^Billing documents$', 'fresh: billing for the offline picture'):
            net(app, offline=True)
            pull(app, r'^Billing$')
            wait_stale(app, 1, 20)
            shot(app, 'mod-a-fresh-billing-offline')
            net(app, offline=False)
            pull(app, r'^Billing$')
            wait_stale(app, 0, 20)

        # ---- an import's rows carry contact fields: never saved on the device, so offline the screen says so
        jobs = s.get('/admin/imports').get('items', [])
        if jobs and open_screen(app, '/admin/imports/%s' % jobs[0]['id'], r'^Review, apply, invite$|^REVIEW, APPLY, INVITE$', 'fresh: an import'):
            net(app, offline=True)
            pull(app, r'^Review, apply, invite$|^REVIEW, APPLY, INVITE$')
            check('fresh: offline, an import\'s screen says No connection and shows no saved rows', app.wait_text(r'^No connection$', 20) and stale_count(app) == 0 and not app.has_text(r'^Row 2$'), app.text()[:200])
            net(app, offline=False)
            pull(app, r'^No connection$|^The import could not be loaded$')
            check('fresh: back online, the import loads again', app.wait_text(r'^Review, apply, invite$|^REVIEW, APPLY, INVITE$', 20))
    finally:
        try:
            net(app, offline=False)
        except Exception:
            pass


def gates_section(app, ctx):
    print('gates: every route answers for the owner; a part switched off shows the web\'s refusal and loads nothing')
    for route, expect in (('/admin/lab-follow-ups', r'^Lab follow-ups$'), ('/admin/billing', r'^Billing documents$'), ('/admin/support', r'^Support requests$'), ('/admin/imports', r'^Check a file$'), ('/admin/help-articles', r'^Words Bioptime supplies$'), ('/admin/referrals', r'^REFERRALS$'), ('/admin/ai', r'^Requests over the range$')):
        app.open_route(route, expect, 45)
        check('gates: %s renders for the owner' % route, app.wait_text(expect, 20) and not app.has_text(r'^No such page$|^Permission needed$'), app.text()[:120])
    s = owner_session(ctx)
    # a staged import nobody has opened in this run: its screen mounts fresh, so it reads the flags anew
    job = s.post('/admin/imports', {'kind': 'progress_history', 'fileName': 'gate-check.csv', 'csv': 'member,metric,value,unit,at,note\nananya.rao@demo.bioptime.test,weight_kg,60.9,kg,2026-10-06,\n', 'dryRun': False})
    st, j, _ = ah.api(ctx['base'], 'PATCH', '/admin/modules', {'key': 'imports', 'enabled': False, 'reason': 'End-to-end check of the imports part gate'}, token=s.token)
    if st != 200:
        check('gates: the imports part switched off through the API', False, '%s %s' % (st, json.dumps(j)[:160]))
        return
    try:
        print('  waiting 62 s for the app\'s flag cache (60 s) to lapse')
        app.open_route('/(admin)', HOME, 30)
        time.sleep(62)
        app.err_mark = len(app.b.errors)
        app.open_route('/admin/imports/%s' % job['id'], r'^No such page$', 45)
        check('gates: with the imports part off an import\'s screen shows "No such page" and loads nothing', app.wait_text(r'^No such page$', 30) and not app.has_text(r'^Review, apply, invite$|gate-check\.csv'), app.text()[:160])
        screen_clean(app, 'gates: imports off')
        shot(app, 'mod-a-gate-imports-off')
    finally:
        ah.api(ctx['base'], 'PATCH', '/admin/modules', {'key': 'imports', 'enabled': True, 'reason': 'End-to-end check of the imports part gate, restored'}, token=s.token)
        ah.api(ctx['base'], 'POST', '/admin/imports/%s/cancel' % job['id'], {'reason': 'End-to-end check, withdrawn'}, token=s.token)


SECTIONS = {'overview': overview_section, 'tabs': tabs_section, 'report': report_section, 'lab': lab_section, 'billing': billing_section, 'support': support_section, 'exports': exports_section,
            'imports': imports_section, 'help': help_section, 'referrals': referrals_section, 'ai': ai_section, 'fresh': fresh_section, 'gates': gates_section}


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
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4381 (never the live demo).')
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
                app.screenshot('mod-a-last-screen')
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
