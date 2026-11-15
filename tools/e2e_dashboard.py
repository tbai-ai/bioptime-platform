#!/usr/bin/env python3
"""End-to-end check of the coach and admin workspaces (/coach, /admin) and their sign-in pages served by the API (Python 3.9, stdlib, Google Chrome).

    BASE=http://127.0.0.1:3870 python3 -I tools/e2e_dashboard.py      against a scratch server

Only a scratch server on this machine is accepted: the live demo's ports (3000, 3100, 3101), a BASE without a port and
any host but 127.0.0.1, localhost, *.localhost or *.test are refused, because the check writes records (a coach note,
a message, a setting).
E2E_OUT and E2E_CDP_PORT give a run its own screenshot folder, Chrome profile and DevTools port.

It signs in as the demo coach and the demo owner (MFA code fetched from the demo-only endpoint), opens every
section, checks for console errors, failed requests and error alerts, exercises a few actions (a coach note,
a message, an operations task owner, a setting change), checks that no page shows a "demo" or "sample" label (the
owner removed them on 24 October 2026) while the payment and lab screens keep their small simulated note, and saves
screenshots to .local/e2e/.

Exit status 1 if anything fails. The JSON report is printed at the end.
"""
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(PLATFORM)), 'drive', 'tools'))
import check_site as cs  # noqa: E402  (reuses the headless Chrome driver of the website checks)

cs.OUT = os.environ.get('E2E_OUT') or os.path.join(PLATFORM, '.local', 'e2e')   # E2E_OUT and E2E_CDP_PORT let parallel runs
cs.PORT_CDP = int(os.environ.get('E2E_CDP_PORT') or 9343)                          # keep their own Chrome profile and port
BASE = os.environ.get('BASE', 'http://localhost:3000').rstrip('/')
LIVE_PORTS = (3000, 3100, 3101)   # the owner's live demo: this check writes records, so it never runs there
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
MEMBER = ('priya.nair@demo.bioptime.test', 'Demo-Member-2026!')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
results = []


def live_demo_refusal(base):
    """Why BASE must not be used, or None. This check writes records, so it runs only against a scratch server on this
    machine: an explicit port that is not the live demo's (3000, 3100, 3101) on 127.0.0.1, localhost, [::1], *.localhost
    or *.test. A host without a port (such as the tunnel that serves the live demo) is refused too."""
    u = urllib.parse.urlsplit(base)
    host = (u.hostname or '').lower()
    try:
        port = u.port
    except ValueError:
        return 'its port is not a number'
    if port is None:
        return 'it names no port; scratch servers always run on an explicit port'
    if port in LIVE_PORTS:
        return 'port %s belongs to the live demo' % port
    if not (host in ('127.0.0.1', 'localhost', '::1') or host.endswith('.localhost') or host.endswith('.test')):
        return 'host %s is not a local scratch server (127.0.0.1, localhost, *.localhost or *.test)' % (host or '(none)')
    return None


def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('  ok   ' if ok else '  FAIL ') + name + (' — ' + detail if detail else ''))


# The owner removed the word "demo" and the "sample" / "Sample data" labels from every screen (24 October 2026), except
# one small "simulated" note on payment and lab screens. A page passes when its visible text has neither, once the
# login emails (@demo.bioptime.test, unchanged) and "sample" meaning the blood sample are set aside.
LABEL_JS = r"""(() => { const t = document.body.innerText.replace(/[a-z0-9._+-]+@demo\.bioptime\.test/gi, '')
  .replace(/\b(home|blood|your|the|no) sample\b|\bsample (is )?(collected|collection|on its way|drop-off|processed|rejected)\b|processing your sample/gi, '');
  const m = t.match(/\bdemo\b|\bsample\b|\(demo\)/i); return m ? t.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ') : ''; })()"""


def no_labels(b, name):
    hit = b.js(LABEL_JS)
    check(name + ': no demo or sample label on the page', not hit, hit or '')


SET_INPUT = '''(sel, v) => { const el = document.querySelector(sel); if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }'''


def set_input(b, sel, value):
    return b.js('(%s)(%s, %s)' % (SET_INPUT, json.dumps(sel), json.dumps(value)))


def wait(b, expr, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if b.js(expr):
                return True
        except Exception:
            pass
        b.pump(0.2)
    return False


def settle(b, seconds=1.0):
    """wait until no skeletons remain and the page has been quiet for a moment"""
    wait(b, "!document.querySelector('.bp-skel')", 8)
    b.pump(seconds)


def page_ok(b, name, expect_h1=None, allow_alerts=False):
    errs = [e for e in b.errors if 'favicon' not in e]
    alerts = b.js("Array.from(document.querySelectorAll('.bp-alert-error')).map(e => e.textContent.trim().slice(0, 120))")
    h1 = b.js("(document.querySelector('h1') || {}).textContent || ''")
    crashed = b.js("!!document.querySelector('.crashed')")
    ok = not errs and not crashed and (allow_alerts or not alerts) and (expect_h1 is None or expect_h1.lower() in h1.lower())
    detail = '; '.join(errs[:3] + (['alerts: ' + ' | '.join(alerts)] if alerts else []) + (['h1: ' + h1] if expect_h1 and expect_h1.lower() not in h1.lower() else []) + (['page crashed'] if crashed else []))
    check(name, ok, detail)
    return ok


WS = {'coach': '/coach', 'admin': '/admin', 'client': '/client'}
CURRENT = {'ws': '/coach', 'login': '/login/coach'}


def sign_in(b, creds, mfa=False, ws='coach'):
    ws = 'admin' if mfa else ws
    CURRENT['ws'] = WS[ws]
    CURRENT['login'] = '/login/' + ws
    b.open(BASE + CURRENT['login'], settle=1.0)
    wait(b, "!!document.querySelector('input[type=email]')")
    set_input(b, 'input[type=email]', creds[0])
    set_input(b, 'input[type=password]', creds[1])
    b.js("document.querySelector('form').requestSubmit()")
    if mfa:
        got = wait(b, "!!document.querySelector('input[autocomplete=one-time-code]')")
        check('MFA step shown for ' + creds[0], got)
        code = b.js("fetch('/api/auth/demo/totp?email=' + encodeURIComponent(%s)).then(r => r.json()).then(j => j.code)" % json.dumps(creds[0]))
        set_input(b, 'input[autocomplete=one-time-code]', code)
        b.js("document.querySelector('form').requestSubmit()")
    arrived = wait(b, "location.pathname.startsWith(%s) && !!document.querySelector('nav.side')" % json.dumps(CURRENT['ws']), 15)
    check('signed in as ' + creds[0], arrived, '' if arrived else 'still at ' + str(b.js('location.pathname')) + ' ' + str(b.js("(document.querySelector('.bp-alert-error')||{}).textContent||''")))
    settle(b)
    return arrived


def sign_out(b):
    b.js("Array.from(document.querySelectorAll('.who button')).find(x => x.textContent.trim() === 'Sign out').click()")
    wait(b, "location.pathname === %s" % json.dumps(CURRENT['login']))


def visit(b, path, name, expect_h1=None, shot=None, allow_alerts=False):
    b.open(BASE + CURRENT['ws'] + path, settle=0.8)
    settle(b)
    ok = page_ok(b, name, expect_h1, allow_alerts)
    if shot:
        b.shot(shot)
    return ok


def coach_flow(b):
    print('coach workspace')
    if not sign_in(b, COACH):
        return
    # the coach home (pages/coach/wz/dashboard): a time-of-day greeting with the coach ID and
    # the small 3D brand mark on its right; the identity card itself lives on /coach/profile (checked below)
    visit(b, '/', 'coach home', 'Good ', shot='coach-home')
    check('coach home greets by time of day', b.js("/^Good (morning|afternoon|evening)\\b/.test((document.querySelector('h1') || {}).textContent || '')"), str(b.js("(document.querySelector('h1') || {}).textContent")))
    no_labels(b, 'coach home')
    check('coach home shows the coach ID', b.js("!!document.querySelector('.wzPageHead') && /BPC-\\d{4}/.test(document.querySelector('.wzPageHead').textContent)"))
    check('coach home carries the 3D brand mark', b.js("!!document.querySelector('.wzPageHead .brandMark3d')"))
    visit(b, '/profile', 'coach profile page', shot='coach-profile')
    check('coach profile shows code, designation block and working hours', b.js("/BPC-\\d{4}/.test(document.body.textContent) && /Professional record/.test(document.body.textContent) && /Working hours/.test(document.body.textContent)"))
    visit(b, '/calendar', 'coach calendar route', 'Appointments')
    visit(b, '/clients', 'coach clients', 'My clients', shot='coach-clients')
    # the client grid (pages/coach/wz/clients): one .wzdClientRow per client with the member ID and a facts line
    n = b.js("document.querySelectorAll('.wzdClientRow').length")
    check('coach sees assigned clients only', 0 < n < 12, '%s rows' % n)
    check('client list shows member IDs, package, progress and engagement', b.js("(() => { const rows = Array.from(document.querySelectorAll('.wzdClientRow')); return rows.length > 0 && rows.every(r => /BPM-\\d{5}/.test((r.querySelector('code') || {}).textContent || '') && /package|·/i.test(r.querySelector('.wzdClientSub').textContent) && /% of due|No plan yet/.test(r.textContent) && /this week|New/.test(r.textContent)); })()"))
    check('client list never shows an email address', b.js("!/@demo\\.bioptime\\.test/.test(document.querySelector('.wzdClientGrid').textContent)"))
    no_labels(b, 'coach clients')
    # first client → every tab
    b.js("document.querySelector('.wzdClientRow a.wzdClientName').click()")
    wait(b, "/\\/clients\\/[a-z0-9_]+$/.test(location.pathname)")
    settle(b)
    page_ok(b, 'client detail overview')
    check('client record shows the member ID and no phone, email or address rows', b.js("/BPM-\\d{5}/.test(document.body.textContent) && !/@demo\\.bioptime\\.test/.test(document.body.textContent) && !Array.from(document.querySelectorAll('dt')).some(d => /^(Phone|Email|Address|PIN)/.test(d.textContent)) && !/\\+91/.test(document.body.textContent)"))
    check('client record shows milestones derived from records', b.js("!!document.querySelector('.milestones')"))
    no_labels(b, 'coach client record')
    b.shot('coach-client-overview')
    for tab in ('plan', 'bloodwork', 'appointments', 'progress', 'notes'):
        found = wait(b, "Array.from(document.querySelectorAll('.wzdTabGrid [role=tab]')).some(t => t.textContent.toLowerCase().startsWith(%s))" % json.dumps(tab), 5)
        check('client tab %s is offered' % tab, found, str(b.js("Array.from(document.querySelectorAll('.wzdTabGrid [role=tab]')).map(t => t.textContent)")))
        if not found:
            continue
        b.js("Array.from(document.querySelectorAll('.wzdTabGrid [role=tab]')).find(t => t.textContent.toLowerCase().startsWith(%s)).click()" % json.dumps(tab))
        settle(b, 0.5)
        page_ok(b, 'client tab ' + tab)
    # add a note
    set_input(b, 'textarea', 'E2E check: note written from the dashboard test run.')
    b.js("Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Save note').click()")
    saved = wait(b, "Array.from(document.querySelectorAll('.timeline li')).some(li => li.textContent.includes('E2E check'))")
    check('coach note saved and listed', saved)
    b.shot('coach-client-notes')
    # schedule dialog opens and lists slots (no booking made)
    b.js("Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Schedule consultation').click()")
    opened = wait(b, "!!document.querySelector('dialog[open]')")
    check('schedule dialog opens', opened)
    if opened:
        has_slots = wait(b, "document.querySelectorAll('dialog[open] select option').length > 2", 8)
        check('schedule dialog lists free slots from the API', has_slots, '%s options' % b.js("document.querySelectorAll('dialog[open] select option').length"))
        b.shot('coach-schedule-dialog')
        b.js("document.querySelector('dialog[open]') && Array.from(document.querySelectorAll('dialog[open] button')).find(x => x.textContent.trim() === 'Cancel').click()")
    visit(b, '/appointments', 'coach appointments', 'Appointments', shot='coach-appointments')
    visit(b, '/messages', 'coach messages list', 'Messages')
    b.js("document.querySelector('.bp-sideitem[style]') ? document.querySelector('.bp-sideitem[style]').click() : null")
    wait(b, "/\\/messages\\/[a-z0-9_]+$/.test(location.pathname)")
    settle(b)
    page_ok(b, 'coach conversation thread')
    before = b.js("document.querySelectorAll('.thread .msg').length")
    set_input(b, 'textarea', 'E2E check: message sent from the dashboard test run.')
    b.js("Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Send').click()")
    sent = wait(b, "document.querySelectorAll('.thread .msg').length === %d" % (before + 1))
    check('coach message sent and shown in thread', sent)
    b.shot('coach-messages')
    visit(b, '/bloodwork', 'coach bloodwork', 'Bloodwork', shot='coach-bloodwork')
    if b.js("!!document.querySelector('a[href*=\"/coach/reports/\"]')"):
        b.js("document.querySelector('a[href*=\"/coach/reports/\"]').click()")
        wait(b, "/\\/reports\\//.test(location.pathname)")
        settle(b)
        page_ok(b, 'coach report view')
        vals = b.js("document.querySelectorAll('table tbody tr').length")
        check('report shows laboratory values', vals > 3, '%s rows' % vals)
        b.shot('coach-report')
    visit(b, '/settings', 'coach settings', 'Settings', shot='coach-settings')
    rules = b.js("document.querySelectorAll('input[type=time]').length")
    check('coach availability rules loaded', rules >= 2, '%s time inputs' % rules)
    # admin-only route must be refused for a coach
    visit(b, '/coaches', 'admin route refused for coach', allow_alerts=True)
    refused = b.js("location.pathname !== '/coach/coaches' || /no such page|not available for your (role|account)/i.test(document.body.textContent)")
    check('coach cannot open the coaches section', refused, str(b.js('location.pathname')))
    # mobile drawer
    b.viewport(390, 844, mobile=True)
    visit(b, '/', 'coach home at 390px', 'Good ')
    b.js("document.querySelector('.menuBtn').click()")
    b.pump(0.5)
    opened = b.js("document.querySelector('nav.side').classList.contains('open')")
    check('mobile sections drawer opens', opened)
    b.shot('coach-mobile-drawer')
    no_x = b.js('document.documentElement.scrollWidth <= window.innerWidth + 1 && window.innerWidth <= 391')
    check('no sideways scroll at 390px', no_x, 'scrollWidth %s' % b.js('document.documentElement.scrollWidth'))
    b.viewport(1440, 900)
    sign_out(b)
    check('coach signed out', b.js("location.pathname === '/login/coach'"))


def admin_flow(b):
    print('admin workspace (owner with MFA)')
    if not sign_in(b, OWNER, mfa=True):
        return
    visit(b, '/', 'admin overview', 'Overview', shot='admin-overview')
    no_labels(b, 'admin overview')
    visit(b, '/clients', 'admin members', 'Members', shot='admin-members')
    n = b.js("document.querySelectorAll('table tbody tr').length")
    check('admin sees every member', n >= 12, '%s rows' % n)
    b.js("document.querySelector('table tbody tr a').click()")
    wait(b, "/\\/clients\\/[a-z0-9_]+$/.test(location.pathname)")
    settle(b)
    page_ok(b, 'admin member detail')
    b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.toLowerCase().startsWith('account')).click()")
    settle(b, 0.5)
    page_ok(b, 'admin member account tab')
    b.shot('admin-member-account')
    visit(b, '/coaches', 'admin coaches', 'Coaches', shot='admin-coaches')
    c = b.js("document.querySelectorAll('table tbody tr').length")
    check('four coaches listed', c >= 4, '%s rows' % c)
    b.js("document.querySelector('table tbody tr a').click()")
    wait(b, "/\\/coaches\\/[a-z0-9_]+$/.test(location.pathname)")
    settle(b)
    page_ok(b, 'admin coach detail')
    b.shot('admin-coach-detail')
    visit(b, '/assignments', 'admin assignments', 'Assignments', shot='admin-assignments')
    b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.toLowerCase().startsWith('all')).click()")
    settle(b, 0.5)
    page_ok(b, 'admin assignments list')
    a = b.js("document.querySelectorAll('table tbody tr').length")
    check('assignments listed', a >= 4, '%s rows' % a)
    visit(b, '/packages', 'admin packages', 'Packages', shot='admin-packages')
    no_labels(b, 'admin packages (no "Demo price" label)')
    visit(b, '/custom-plans', 'admin custom plans', 'Custom plans', shot='admin-custom-plans')
    no_labels(b, 'admin custom plans')
    visit(b, '/orders', 'admin orders', 'Orders', shot='admin-orders')
    no_labels(b, 'admin orders')
    o = b.js("document.querySelectorAll('table tbody tr').length")
    check('orders listed in several states', o >= 6, '%s rows' % o)
    visit(b, '/appointments', 'admin appointments', 'Appointments')
    visit(b, '/bloodwork', 'admin bloodwork', 'Bloodwork', shot='admin-bloodwork')
    check('admin bloodwork links to the LabStack page instead of carrying its controls', b.js("!!document.querySelector('a[href=\"/admin/integrations/labstack\"]') && !/Sync catalogue/.test(document.body.textContent)"))
    for tab in ('bookings', 'catalogue'):
        b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.toLowerCase().startsWith(%s)).click()" % json.dumps(tab))
        settle(b, 0.5)
        page_ok(b, 'admin bloodwork tab ' + tab)
    b.shot('admin-bloodwork-integration')
    visit(b, '/analytics', 'admin analytics', 'Analytics', shot='admin-analytics')
    visit(b, '/operations', 'admin operations', 'Operations', shot='admin-operations')
    for tab in ('audit', 'enquiries', 'outbox', 'jobs'):
        b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.toLowerCase().startsWith(%s)).click()" % json.dumps(tab))
        settle(b, 0.5)
        page_ok(b, 'admin operations tab ' + tab)
        if tab in ('audit', 'enquiries'):
            no_labels(b, 'admin operations tab ' + tab)
    b.shot('admin-operations-outbox')
    visit(b, '/messages', 'admin messages (read-only)', 'Messages')
    visit(b, '/approvals', 'admin approvals route', 'Custom plans')
    visit(b, '/audit', 'admin audit log page', 'Audit log', shot='admin-audit')
    check('audit page lists rows with actor and action', b.js("document.querySelectorAll('table tbody tr').length > 5"))
    visit(b, '/integrations/labstack', 'admin LabStack page', 'LabStack integration', shot='admin-labstack')
    check('LabStack page shows the connection state and the console link opens elsewhere', b.js("/stand-in|live|pending/.test(document.body.textContent) && !!document.querySelector('a[href=\"https://integration.labstack.in/dashboard\"][target=_blank]')"))
    check('LabStack page shows no secret', b.js("!/sk_|secret[:=]\\s*\\w{8,}|api[_ -]?key[:=]\\s*\\w/i.test(document.body.textContent)"))
    visit(b, '/clients', 'admin members with invite', 'Members')
    check('admin can invite a member', b.js("Array.from(document.querySelectorAll('button')).some(x => x.textContent.trim() === 'Invite a member')"))
    visit(b, '/content', 'admin website content', 'Website content', shot='admin-content')
    check('content editor includes section visibility and image blocks', b.js("/Section visibility/.test(document.body.textContent) || Array.from(document.querySelectorAll('[role=tab]')).some(t => /Home/.test(t.textContent))"))
    n_blocks = b.js("document.querySelectorAll('.cmsBlock').length")
    check('content editor lists the editable blocks', n_blocks >= 5, '%s blocks' % n_blocks)
    visit(b, '/theme', 'admin theme editor', 'Theme and branding', shot='admin-theme')
    check('theme editor shows the colour tokens and a live preview', b.js("document.querySelectorAll('.tokenRow input[type=color]').length >= 10 && !!document.querySelector('.themePreview')"))
    visit(b, '/users', 'admin users and permissions', 'Users and permissions', shot='admin-users')
    check('permissions matrix lists administrators and owners', b.js("document.querySelectorAll('.permBtn').length >= 15"))
    visit(b, '/integrations', 'admin integrations', 'Integrations', shot='admin-integrations')
    check('integrations page never shows a secret', b.js("!/sk_|secret[:=]\\s*\\w{8,}|api[_ -]?key[:=]/i.test(document.body.textContent)"))
    visit(b, '/analytics', 'admin analytics with the report runner', 'Analytics')
    b.js("const s = document.querySelector('select'); s.value = 'enrolments'; s.dispatchEvent(new Event('change', {bubbles: true}));")
    b.js("Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Run').click()")
    ran = wait(b, "!!document.querySelector('a[href*=\"/api/admin/analytics/enrolments.csv\"]')", 10)
    check('a report runs and offers a CSV download', ran)
    visit(b, '/settings', 'admin settings', 'Settings', shot='admin-settings')
    mfa_on = b.js("document.body.textContent.includes('MFA on')")
    check('owner shows MFA on', mfa_on)
    # coach-only route must be refused for admin
    visit(b, '/plans/new', 'coach route refused for admin', allow_alerts=True)
    refused = b.js("location.pathname !== '/admin/plans/new' || /no such page|not available for your (role|account)/i.test(document.body.textContent)")
    check('admin cannot open the plan editor', refused, str(b.js('location.pathname')))
    sign_out(b)


def client_flow(b):
    print('member portal')
    if not sign_in(b, MEMBER, ws='client'):
        return
    visit(b, '/', 'member home', 'Hello', shot='client-home')
    no_labels(b, 'member home')
    check('member home shows milestones from records', b.js("!!document.querySelector('.milestones') && document.querySelectorAll('.milestone').length >= 8"))
    check('member home shows the package and the coach', b.js("/Core|Starter|Advanced/.test((document.querySelector('.heroBand .sub, .pageHead .sub')||{}).textContent||'') && /Coach/.test(document.body.textContent)"))
    visit(b, '/program', 'member program', 'My program', shot='client-program')
    no_labels(b, 'member program, Plan tab')
    b.js("(Array.from(document.querySelectorAll('[role=tab]')).find(t => /^Packages/.test(t.textContent.trim())) || {click() {}}).click()")
    wait(b, "/What you paid/.test(document.body.innerText)", 8)
    no_labels(b, 'member program, Packages and orders tab (no "Demo prices" label)')
    check('the packages tab keeps the small simulated-payment note', b.js("/simulated/i.test(document.body.innerText)"), b.js("document.body.innerText.slice(0, 160)"))
    visit(b, '/progress', 'member progress', 'Progress', shot='client-progress')
    visit(b, '/appointments', 'member appointments', 'Appointments', shot='client-appointments')
    visit(b, '/bloodwork', 'member bloodwork', 'Bloodwork', shot='client-bloodwork')
    no_labels(b, 'member bloodwork')
    check('member bloodwork keeps the practice laboratory note', b.js("/practice laboratory|simulated/i.test(document.body.innerText)"))
    if b.js("!!document.querySelector('a[href*=\"/client/reports/\"]')"):
        b.js("document.querySelector('a[href*=\"/client/reports/\"]').click()")
        wait(b, "/\\/client\\/reports\\//.test(location.pathname)")
        settle(b)
        page_ok(b, 'member report: laboratory values, coach note, limits')
        check('report shows the three sections in order', b.js("const t = document.body.textContent; t.indexOf('Section 1') < t.indexOf('Section 2') && t.indexOf('Section 2') < t.indexOf('Section 3')"))
        b.shot('client-report')
    visit(b, '/messages', 'member messages', 'Messages', shot='client-messages')
    visit(b, '/profile', 'member profile', 'Profile', shot='client-profile')
    for tab in ('privacy', 'notifications', 'security', 'your data'):
        b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.toLowerCase().startsWith(%s)).click()" % json.dumps(tab))
        settle(b, 0.5)
        page_ok(b, 'member profile tab ' + tab)
    visit(b, '/clients', 'coach route refused for member', allow_alerts=True)
    check('member cannot reach coach pages', b.js("/no such page/i.test(document.body.textContent)"))
    b.open(BASE + '/coach', settle=1.0)
    check('member at /coach sees a clear refusal, not a silent redirect', wait(b, "/not available for your account/i.test(document.body.textContent)"), b.js('location.pathname'))
    b.viewport(390, 844, mobile=True)
    visit(b, '/', 'member home at 390px', 'Hello')
    check('member home has no sideways scroll at 390px', b.js('document.documentElement.scrollWidth <= window.innerWidth + 1 && window.innerWidth <= 391'))
    b.shot('client-home-mobile')
    b.viewport(1440, 900)
    sign_out(b)
    check('member signed out', b.js("location.pathname === '/login/client'"))


def unauthenticated(b):
    print('unauthenticated')
    b.open(BASE + '/coach/clients', settle=1.0)
    at_login = wait(b, "location.pathname === '/login/coach'")
    check('deep link without a session goes to sign-in', at_login, str(b.js('location.pathname')))
    b.open(BASE + '/admin/content', settle=1.0)
    check('an admin deep link goes to the admin sign-in', wait(b, "location.pathname === '/login/admin'"), str(b.js('location.pathname')))
    b.open(BASE + '/dashboard/login', settle=1.0)
    check('the old /dashboard/login redirects to the coach sign-in', wait(b, "location.pathname === '/login/coach'"), str(b.js('location.pathname')))
    b.open(BASE + '/login', settle=1.0)
    check('/login is the sign-in chooser with three doors', wait(b, "document.querySelectorAll('[data-portal-link]').length === 3"), str(b.js('location.pathname')))
    b.open(BASE + '/login/client/activate', settle=1.0)
    check('the member activation page explains a missing link token', wait(b, "/activation link from your email again|activation link is incomplete|cannot be used/i.test(document.body.textContent)"), b.js("document.body.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160)"))
    for door in ('client', 'coach', 'admin'):
        b.open(BASE + '/login/' + door, settle=1.5)
        mode = b.js("(document.querySelector('.brandMark3d')||{}).getAttribute ? document.querySelector('.brandMark3d').getAttribute('data-mode') : 'missing'")
        check('%s sign-in carries the 3D mark host (mode %s)' % (door, mode), mode in ('live', 'loading', 'flat', 'reduced', 'unsupported', 'error'), mode)
    b.shot('login')
    status = b.js("fetch('/api/admin/members').then(r => r.status)")
    check('API refuses admin data without a session', status == 401, 'status %s' % status)


def main():
    why = live_demo_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server (BASE=http://127.0.0.1:<port>).' % (BASE, why))
    os.makedirs(cs.OUT, exist_ok=True)
    b = cs.Browser()
    b.viewport(1440, 900)
    try:
        # start signed out: the Chrome profile keeps cookies from a crashed run
        b.open(BASE + '/login/client', settle=0.8)
        b.js("fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers: {'X-Bioptime-Client': 'e2e'}}).then(r => r.status)")
        b.js("document.cookie = 'bp_signed_in=; Max-Age=0; path=/'; true")
        unauthenticated(b)
        coach_flow(b)
        admin_flow(b)
        client_flow(b)
    finally:
        b.close()
    failed = [r for r in results if not r['ok']]
    report = {'base': BASE, 'checks': len(results), 'failed': len(failed), 'screenshots': cs.OUT, 'results': results}
    with open(os.path.join(cs.OUT, 'report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
