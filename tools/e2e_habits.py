#!/usr/bin/env python3
"""End-to-end check of M1 Habits and reminders in the portal served by the API (Python 3.9, stdlib, Google Chrome).

    BASE=http://127.0.0.1:3870 python3 -I tools/e2e_habits.py      against a scratch server

Only a scratch server on this machine is accepted: the live demo's ports (3000, 3100, 3101), a BASE without a port and
any host but 127.0.0.1, localhost, *.localhost or *.test are refused, because the check writes a check-in and two
habits. E2E_OUT and E2E_CDP_PORT give a run its own screenshot folder, Chrome profile and DevTools port.

Needs the demo data (reset-demo against the scratch database) with the habits flag on, and a portal build that
includes the module.
It signs in as the demo member, coach and owner and checks:
  member  /client/habits renders the seeded habits in plain words (no demo or sample label), a check-in on a due habit
          sticks, an own habit can be added,
          reminder times can be set; the Home card lists today's habits;
  coach   the Habits tab on the client record shows completion and weekly adherence, the client's own habits (she
          shares health information), and a habit can be set; for a client who does not share (Meera with Deepa) the
          tab says so and lists only the habits a coach set;
  owner   /admin/modules lists the follow-up threshold as "Not decided"; the admin client record shows the tab read only.
It writes nothing outside the demo database and saves screenshots to .local/e2e/habits/.

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
import check_site as cs  # noqa: E402  (the headless Chrome driver of the website checks)

cs.OUT = os.environ.get('E2E_OUT') or os.path.join(PLATFORM, '.local', 'e2e', 'habits')
cs.PORT_CDP = int(os.environ.get('E2E_CDP_PORT') or 9351)
BASE = os.environ.get('BASE', 'http://localhost:3000').rstrip('/')
LIVE_PORTS = (3000, 3100, 3101)   # the owner's live demo: this check writes records, so it never runs there
DEEPA_NOTE = 'Travelling, hotel breakfast.'   # Deepa's own check-in note in the seed: her coach never sees it
MEMBER = ('ananya.rao@demo.bioptime.test', 'Demo-Member-2026!')
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
COACH_NO_SHARE = ('meera.iyer@demo.bioptime.test', 'Demo-Coach-2026!')  # Deepa, her client, does not share health information
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

SET_INPUT = '''(sel, v) => { const el = document.querySelector(sel); if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }'''
CLICK_TEXT = '''(scope, text) => { const el = Array.from(document.querySelectorAll(scope)).find(x => x.textContent.trim() === text && !x.disabled);
  if (!el) return false; el.click(); return true; }'''


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


def set_input(b, sel, value):
    return b.js('(%s)(%s, %s)' % (SET_INPUT, json.dumps(sel), json.dumps(value)))


def click_text(b, text, scope='button'):
    return b.js('(%s)(%s, %s)' % (CLICK_TEXT, json.dumps(scope), json.dumps(text)))


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
    wait(b, "!document.querySelector('.bp-skel')", 8)
    b.pump(seconds)


def page_ok(b, name, expect_h1=None):
    errs = [e for e in b.errors if 'favicon' not in e]
    alerts = b.js("Array.from(document.querySelectorAll('.bp-alert-error')).map(e => e.textContent.trim().slice(0, 120))")
    h1 = b.js("(document.querySelector('h1') || {}).textContent || ''")
    crashed = b.js("!!document.querySelector('.crashed')")
    ok = not errs and not crashed and not alerts and (expect_h1 is None or expect_h1.lower() in h1.lower())
    check(name, ok, '; '.join(errs[:3] + (['alerts: ' + ' | '.join(alerts)] if alerts else []) + (['page crashed'] if crashed else [])))
    return ok


def sign_in(b, creds, ws, mfa=False):
    b.open(BASE + '/login/' + ws, settle=1.0)
    wait(b, "!!document.querySelector('input[type=email]')")
    set_input(b, 'input[type=email]', creds[0])
    set_input(b, 'input[type=password]', creds[1])
    b.js("document.querySelector('form').requestSubmit()")
    if mfa:
        wait(b, "!!document.querySelector('input[autocomplete=one-time-code]')")
        code = b.js("fetch('/api/auth/demo/totp?email=' + encodeURIComponent(%s)).then(r => r.json()).then(j => j.code)" % json.dumps(creds[0]))
        set_input(b, 'input[autocomplete=one-time-code]', code)
        b.js("document.querySelector('form').requestSubmit()")
    arrived = wait(b, "location.pathname.startsWith('/%s') && !!document.querySelector('nav.side')" % ws, 15)
    check('signed in as ' + creds[0], arrived)
    settle(b)
    return arrived


def sign_out(b):
    b.js("fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers: {'X-Bioptime-Client': 'e2e'}}).then(r => r.status)")
    b.pump(0.5)


def member_id(b):
    return b.js("fetch('/api/auth/me').then(r => r.json()).then(j => j.user.id)")


def member_flow(b):
    print('member')
    if not sign_in(b, MEMBER, 'client'):
        return None
    me = member_id(b)
    b.open(BASE + '/client', settle=1.0)
    settle(b)
    check('Home shows the habits card', wait(b, "/to check in today|All checked in today|Nothing due today/.test(document.body.textContent)"))
    check('the navigation links to Habits', b.js("!!Array.from(document.querySelectorAll('nav.side a')).find(a => a.textContent.trim() === 'Habits')"))
    b.open(BASE + '/client/habits', settle=1.0)
    settle(b)
    page_ok(b, 'member habits page', 'Habits')
    check('the seeded habits read as plain habits', b.js("/Evening walk/.test(document.body.textContent) && /An easy walk after dinner/.test(document.body.textContent)"))
    no_labels(b, 'member habits page')
    check('a coach-set habit says so', b.js("/From your coach/i.test(document.body.textContent)"))
    b.shot('client-habits')
    if click_text(b, 'Done'):
        check('a check-in shows as done today', wait(b, "/Done today/i.test(document.body.textContent)"))
    else:
        check('a due habit offers Done (or everything is already checked in)', b.js("/Done today|Skipped today|Not due today/i.test(document.body.textContent)"))
    click_text(b, 'Add a habit')
    wait(b, "!!document.querySelector('dialog[open] input')")
    set_input(b, 'dialog[open] input', 'E2E: stretch after work')
    click_text(b, 'Add habit')
    check('an own habit can be added', wait(b, "/E2E: stretch after work/.test(document.body.textContent) && !document.querySelector('dialog[open]')"))
    status = b.js("fetch('/api/me/habits').then(r => r.json()).then(j => { const h = j.items.find(x => x.title === 'E2E: stretch after work'); return fetch('/api/me/habits/' + h.id, {method: 'PATCH', credentials: 'include', headers: {'content-type': 'application/json', 'X-Bioptime-Client': 'e2e'}, body: JSON.stringify({reminderTimes: ['18:30'], remindersOn: true})}).then(r => r.status); })")
    check('reminder times can be set', status == 200, 'status %s' % status)
    b.open(BASE + '/client/habits', settle=1.0)
    settle(b)
    check('the reminder time shows', b.js("/Reminders at 18:30/.test(document.body.textContent)"))
    b.viewport(390, 844, mobile=True)
    b.open(BASE + '/client/habits', settle=1.0)
    settle(b)
    check('habits page has no sideways scroll at 390px', b.js('document.documentElement.scrollWidth <= window.innerWidth + 1 && window.innerWidth <= 391'))
    b.shot('client-habits-mobile')
    b.viewport(1440, 900)
    sign_out(b)
    return me


def coach_flow(b, me):
    print('coach')
    if not me or not sign_in(b, COACH, 'coach'):
        return
    b.open(BASE + '/coach/clients/%s?tab=habits' % me, settle=1.0)
    settle(b)
    page_ok(b, 'coach client record, Habits tab')
    check('weekly adherence is listed', b.js("/Due days checked in as done/.test(document.body.textContent)"))
    check('no contact fields in the tab', b.js("!/@demo\\.bioptime\\.test|\\+91\\d{10}/.test(document.querySelector('[role=tabpanel]').textContent)"))
    check('a sharing client\'s own habits are listed', b.js("/Lights out by 23:00/.test(document.body.textContent) && /Client’s own/.test(document.body.textContent)"))
    b.shot('coach-habits-tab')
    click_text(b, 'Set a habit')
    wait(b, "!!document.querySelector('dialog[open] input')")
    set_input(b, 'dialog[open] input', 'E2E: morning light')
    click_text(b, 'Set habit')
    check('a coach can set a habit', wait(b, "/E2E: morning light/.test(document.body.textContent) && !document.querySelector('dialog[open]')"))
    sign_out(b)


def coach_no_share_flow(b):
    print('coach, client without health sharing')
    if not sign_in(b, COACH_NO_SHARE, 'coach'):
        return
    cid = b.js("fetch('/api/coach/clients?q=Deepa').then(r => r.json()).then(j => ((j.items || [])[0] || {}).id || '')")
    check('the client without sharing is found', bool(cid))
    if cid:
        b.open(BASE + '/coach/clients/%s?tab=habits' % cid, settle=1.0)
        settle(b)
        page_ok(b, 'coach client record without sharing, Habits tab')
        check('the tab says health information is not shared', b.js("/Health information not shared/.test(document.body.textContent)"))
        check('only habits a coach set are listed, without her notes', b.js("!/Client’s own/.test(document.body.textContent) && !document.body.textContent.includes(%s)" % json.dumps(DEEPA_NOTE)))
        b.shot('coach-habits-tab-not-shared')
    sign_out(b)


def owner_flow(b, me):
    print('owner')
    if not sign_in(b, OWNER, 'admin', mfa=True):
        return
    b.open(BASE + '/admin/modules', settle=1.0)
    settle(b)
    page_ok(b, 'admin modules page', 'Modules')
    check('the habit follow-up threshold is listed and undecided', b.js("/Coach follow-up after missed habit days/.test(document.body.textContent) && /Not decided/.test(document.body.textContent)"))
    if me:
        b.open(BASE + '/admin/clients/%s?tab=habits' % me, settle=1.0)
        settle(b)
        page_ok(b, 'admin client record, Habits tab')
        check('the admin tab is read only', b.js("/Read only/.test(document.body.textContent) && !Array.from(document.querySelectorAll('button')).some(x => x.textContent.trim() === 'Set a habit')"))
        b.shot('admin-habits-tab')
    sign_out(b)


def main():
    why = live_demo_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server (BASE=http://127.0.0.1:<port>).' % (BASE, why))
    os.makedirs(cs.OUT, exist_ok=True)
    b = cs.Browser()
    b.viewport(1440, 900)
    try:
        b.open(BASE + '/login/client', settle=0.8)
        sign_out(b)
        me = member_flow(b)
        coach_flow(b, me)
        coach_no_share_flow(b)
        owner_flow(b, me)
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
