#!/usr/bin/env python3
"""End-to-end check of the twelve feature-flagged modules through the real portal (Python 3.9, stdlib, Google Chrome).

    BASE=http://127.0.0.1:3870 python3 -I tools/e2e_modules.py

Scratch servers only. BASE is required; the live demo's ports (3000, 3100, 3101), a BASE without a port and any host but
127.0.0.1, localhost, *.localhost or *.test are refused, because the script
writes records (a habit check-in, a goal, check-in answers, a meal log, a workout log, a support request, a data export
request, a lesson completed, a session place taken and given back, an announcement marked read) and switches a module
off and on again. Seed the scratch database first (BIOPTIME_MODE=demo ... npx tsx src/cli.ts reset-demo with the scratch
DATABASE_PATH) and serve a portal build that includes the modules (DASHBOARD_DIR). Optional: PARTNER_KEY_CANARY, the
LABSTACK_PARTNER_KEY value the scratch server was started with, to check that it is never shown.

It signs in as the demo member, coaches, administrator and owner (MFA code from the demo-only endpoint) and checks:
  member  Home's module cards and links; Habits (a check-in); Progress (a goal, check-in answers); Nutrition (a meal
          logged); Workouts (the week, a session logged); Lab next steps on a released report; Live sessions (register,
          give the place back); Announcements (mark one read); Learn (a course, a lesson completed); Billing (documents,
          one opened in a new tab); Help and support (a request raised, a data export requested); the Coach AI consent
          wording (withdrawn and given again when the demo allows it, so the seeded consent stays as it was);
  coach   Today's module cards; every module tab of the client record for a client who shares health information and
          for one who does not (no health detail and no restricted contact field in the page text or in the API answers
          the page used); habits, goals, nutrition and workouts content; announcements; the sessions host page; Coach AI
          says it is not configured and refuses a request honestly;
  admin   the Modules page without switches, LabStack and Users and permissions refused, Billing, Support, Courses;
  owner   /admin/modules lists the twelve modules; switching Learning off (with a reason) hides the member's Learn link
          and refuses its page and API, switching it back on restores them; the LabStack page's operations sections with
          the partner key shown only as configured or not; Users and permissions with the module permissions; Coach AI
          usage;
  labels  no module page shows a "demo" or "sample" label (the owner removed them on 24 October 2026), the billing
          document keeps its small "Simulated payment" note and the lab screens their practice laboratory note;
  and at 390 px that module pages in each workspace do not scroll sideways. Learning is switched back on even when a
  check fails half way. Screenshots and report.json go to .local/e2e/modules/.

Exit status 1 if anything fails. The JSON report is printed at the end.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(PLATFORM)), 'drive', 'tools'))
import check_site as cs  # noqa: E402  (the headless Chrome driver of the website checks)

cs.OUT = os.environ.get('E2E_OUT') or os.path.join(PLATFORM, '.local', 'e2e', 'modules')   # E2E_OUT and E2E_CDP_PORT let
cs.PORT_CDP = int(os.environ.get('E2E_CDP_PORT') or 9470)                                   # parallel runs keep apart
BASE = os.environ.get('BASE', '').rstrip('/')
LIVE_PORTS = (3000, 3100, 3101)   # the owner's live demo: this check writes records, so it never runs there
PARTNER_KEY_CANARY = os.environ.get('PARTNER_KEY_CANARY', '')
MEMBER = ('ananya.rao@demo.bioptime.test', 'Demo-Member-2026!')        # shares health information with Asha
MEMBER_NO_SHARE = ('deepa.krishnan@demo.bioptime.test', 'Demo-Member-2026!')  # does not share with Meera
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
COACH_NO_SHARE = ('meera.iyer@demo.bioptime.test', 'Demo-Coach-2026!')
ADMIN = ('admin@demo.bioptime.test', 'Demo-Admin-2026!')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
MODULE_KEYS = ('habits', 'progress', 'billing', 'support', 'nutrition', 'workouts', 'labFollowups', 'sessions', 'messaging', 'learning', 'ai', 'labstackOps')
TOGGLED = 'learning'          # the module switched off and on again: member link "Learn", page /client/learn, API /me/courses
COACH_MODULE_TABS = ('habits', 'goals', 'nutrition', 'workouts', 'lab-follow-ups', 'sessions', 'learning', 'ai')
TAG = 'E2E modules %s' % time.strftime('%H%M%S')
results = []
state = {'toggled_off': False}

SET_INPUT = '''(sel, v) => { const el = document.querySelector(sel); if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }'''
CLICK_TEXT = '''(scope, text) => { const el = Array.from(document.querySelectorAll(scope)).find(x => x.textContent.trim() === text && !x.disabled);
  if (!el) return false; el.click(); return true; }'''
# the card whose heading (h3) is exactly this title
CARD = "(t => Array.from(document.querySelectorAll('.bp-card')).find(c => (c.querySelector('h3') || {}).textContent === t))"
WRITE = "{method: %s, credentials: 'include', headers: {'content-type': 'application/json', 'X-Bioptime-Client': 'e2e'}, body: JSON.stringify(%s)}"


def check(name, ok, detail=''):
    detail = ' '.join(str(detail).split()) if detail else ''
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('  PASS ' if ok else '  FAIL ') + name + (' — ' + detail if detail else ''))
    return bool(ok)


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


def body(b):
    return b.js('document.body.textContent') or ''


def has(b, pattern, flags='i'):
    return bool(b.js('/%s/%s.test(document.body.textContent)' % (pattern, flags)))


def page_ok(b, name, expect_h1=None, allow_alerts=False):
    errs = [e for e in b.errors if 'favicon' not in e]
    alerts = b.js("Array.from(document.querySelectorAll('.bp-alert-error')).map(e => e.textContent.trim().slice(0, 120))")
    h1 = b.js("(document.querySelector('h1') || {}).textContent || ''")
    crashed = b.js("!!document.querySelector('.crashed')")
    missing_h1 = expect_h1 is not None and expect_h1.lower() not in h1.lower()
    ok = not errs and not crashed and (allow_alerts or not alerts) and not missing_h1
    return check(name, ok, '; '.join(errs[:3] + (['alerts: ' + ' | '.join(alerts)] if alerts else []) + (['h1: ' + h1] if missing_h1 else []) + (['page crashed'] if crashed else [])))


PANEL = "(document.querySelector('[role=tabpanel]') || {textContent: ''})"   # the outer tab panel comes first in document order


def panel_has(b, text):
    """case-sensitive substring of the selected tab's own panel, never the rest of the page"""
    return bool(b.js('%s.textContent.includes(%s)' % (PANEL, json.dumps(text))))


TAB_STATE = '''(() => { const p = document.querySelector('[role=tabpanel]');
  return {selected: p ? ((p.getAttribute('aria-labelledby') || '').match(/-tab-(.+)$/) || [])[1] || '' : '',
          chars: p ? p.textContent.trim().length : -1, skel: !!(p && p.querySelector('.bp-skel')), crashed: !!document.querySelector('.crashed'),
          alerts: p ? Array.from(p.querySelectorAll('.bp-alert-error')).map(e => e.textContent.trim().slice(0, 120)) : []}; })()'''


def tab_rendered(b, tab, name, min_chars=20):
    """the panel shown is labelled by `tab`, has finished loading, holds text, has no error alert, and the page logged no error"""
    wait(b, "(s => s.selected === %s && !s.skel && s.chars >= %d)(%s)" % (json.dumps(tab), min_chars, TAB_STATE), 8)
    s = b.js(TAB_STATE) or {}
    errs = [e for e in b.errors if 'favicon' not in e]
    ok = s.get('selected') == tab and not s.get('skel') and (s.get('chars') or 0) >= min_chars and not s.get('crashed') and not s.get('alerts') and not errs
    detail = 'panel for %r, %s characters' % (s.get('selected'), s.get('chars'))
    if s.get('skel'):
        detail += '; still loading'
    if s.get('crashed'):
        detail += '; page crashed'
    if s.get('alerts'):
        detail += '; alerts: ' + ' | '.join(s['alerts'])
    if errs:
        detail += '; ' + '; '.join(errs[:3])
    return check(name, ok, detail)


def visit(b, path, name, expect_h1=None, allow_alerts=False):
    b.open(BASE + path, settle=0.8)
    settle(b)
    return page_ok(b, name, expect_h1, allow_alerts)


def js_gesture(b, expr):
    """evaluate as if the person clicked, so window.open is allowed (a new tab, as in a real browser)"""
    r = b.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True, userGesture=True)
    return r.get('result', {}).get('value')


def api_get(b, path):
    return b.js("fetch(%s, {credentials: 'include'}).then(async r => ({status: r.status, body: await r.text()}))" % json.dumps(path))


def api_write(b, method, path, payload):
    return b.js("fetch(%s, %s).then(async r => ({status: r.status, body: await r.text()}))" % (json.dumps(path), WRITE % (json.dumps(method), json.dumps(payload))))


def nav_links(b):
    return b.js("Array.from(document.querySelectorAll('nav.side a')).map(a => [a.textContent.trim().replace(/\\d+$/, ''), a.getAttribute('href')])") or []


def eyebrows(b):
    return b.js("Array.from(document.querySelectorAll('.bp-card-head .bp-eyebrow')).map(e => e.textContent.trim().toLowerCase())") or []


MOBILE_W = 390


def no_sideways(b, path, name):
    """document.documentElement.scrollWidth <= innerWidth, against the 390 px device width: with mobile emulation an
    overflowing page also widens innerWidth (the layout viewport grows to the content), so both must stay at 390"""
    b.open(BASE + path, settle=0.8)
    settle(b)
    w = b.js('[document.documentElement.scrollWidth, window.innerWidth]') or [None, None]
    ok = w[0] is not None and w[0] <= w[1] and w[1] <= MOBILE_W + 1
    detail = 'scrollWidth %s, innerWidth %s' % tuple(w)
    if not ok:
        detail += '; wider than %d px: %s' % (MOBILE_W, b.js('''(() => { const out = []; document.querySelectorAll('body *').forEach(el => {
          const r = el.getBoundingClientRect(); let p = el.parentElement, clipped = false;
          for (; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } }
          if (!clipped && r.right > %d && r.width > 0 && !Array.from(el.children).some(c => c.getBoundingClientRect().right > %d)) out.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 40) + '"'); });
          return Array.from(new Set(out)).slice(0, 3).join(' | '); })()''' % (MOBILE_W + 1, MOBILE_W + 1)))
    return check(name, ok, detail)


# The owner removed the word "demo" and the "sample" / "Sample data" labels from every screen (24 October 2026), except
# one small "simulated" note on payment and lab screens. A page passes when its visible text has neither, once the
# login emails (@demo.bioptime.test, unchanged) and "sample" meaning the blood sample are set aside.
LABEL_JS = r"""(() => { const t = document.body.innerText.replace(/[a-z0-9._+-]+@demo\.bioptime\.test/gi, '')
  .replace(/\b(home|blood|your|the|no) sample\b|\bsample (is )?(collected|collection|on its way|drop-off|processed|rejected)\b|processing your sample/gi, '');
  const m = t.match(/\bdemo\b|\bsample\b|\(demo\)/i); return m ? t.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ') : ''; })()"""


def no_labels(b, name):
    hit = b.js(LABEL_JS)
    check(name + ': no demo or sample label on the page', not hit, hit or '')


def labels_pass(b, paths, who):
    """each page at desktop width: no "demo" or "sample" label in its visible text"""
    for p in paths:
        b.open(BASE + p, settle=0.8)
        settle(b)
        no_labels(b, '%s %s' % (who, p))


def mobile_pass(b, paths, who):
    b.viewport(390, 844, mobile=True)
    try:
        for p in paths:
            no_sideways(b, p, '%s %s has no sideways scroll at 390px' % (who, p))
        b.shot(who + '-mobile')
    finally:
        b.viewport(1440, 900)


def sign_out(b):
    b.js("fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers: {'X-Bioptime-Client': 'e2e'}}).then(r => r.status)")
    b.js("document.cookie = 'bp_signed_in=; Max-Age=0; path=/'; true")
    b.pump(0.5)


def sign_in(b, creds, ws, mfa=False):
    b.open(BASE + '/login/' + ws, settle=1.0)
    wait(b, "!!document.querySelector('input[type=email]')")
    set_input(b, 'input[type=email]', creds[0])
    set_input(b, 'input[type=password]', creds[1])
    b.js("document.querySelector('form').requestSubmit()")
    arrived_expr = "location.pathname.startsWith('/%s') && !!document.querySelector('nav.side')" % ws
    if mfa:
        wait(b, "!!document.querySelector('input[autocomplete=one-time-code]')")
        for attempt in range(2):
            if attempt:   # a code is accepted once: wait for the next 30-second window and try once more
                time.sleep(31 - time.time() % 30)
            code = b.js("fetch('/api/auth/demo/totp?email=' + encodeURIComponent(%s)).then(r => r.json()).then(j => j.code)" % json.dumps(creds[0]))
            set_input(b, 'input[autocomplete=one-time-code]', code)
            b.js("document.querySelector('form').requestSubmit()")
            if wait(b, arrived_expr, 12):
                break
    arrived = wait(b, arrived_expr, 15)
    check('signed in as ' + creds[0], arrived, '' if arrived else 'still at %s %s' % (b.js('location.pathname'), b.js("(document.querySelector('.bp-alert-error')||{}).textContent||''")))
    settle(b)
    return arrived


def other_tab(url_part, seconds=12):
    """the DevTools entry of another tab whose address contains url_part (opened by the page), or None"""
    end = time.time() + seconds
    while time.time() < end:
        try:
            pages = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % cs.PORT_CDP, timeout=3))
            hit = next((p for p in pages if p.get('type') == 'page' and url_part in p.get('url', '')), None)
            if hit:
                return hit
        except Exception:
            pass
        time.sleep(0.3)
    return None


def tab_text(entry, seconds=10):
    """the visible text of another tab, read over its own DevTools connection"""
    ws = cs.WS(entry['webSocketDebuggerUrl'])
    try:
        end, n = time.time() + seconds, 0
        while time.time() < end:
            n += 1
            ws.send(json.dumps({'id': n, 'method': 'Runtime.evaluate', 'params': {'expression': "document.readyState === 'complete' ? document.body.innerText : ''", 'returnByValue': True}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get('id') == n:
                    break
            text = msg.get('result', {}).get('result', {}).get('value') or ''
            if text.strip():
                return text
            time.sleep(0.3)
        return ''
    finally:
        ws.sock.close()


def close_tab(entry):
    try:
        urllib.request.urlopen('http://127.0.0.1:%d/json/close/%s' % (cs.PORT_CDP, entry['id']), timeout=3).read()
    except Exception:
        pass


# ---------------------------------------------------------------- member
def member_flow(b):
    print('member (Ananya Rao, shares health information with her coach)')
    if not sign_in(b, MEMBER, 'client'):
        return None
    me = b.js("fetch('/api/auth/me').then(r => r.json()).then(j => j.user.id)")
    out = {'id': me}

    visit(b, '/client', 'member home', 'Hello')
    eb = eyebrows(b)
    for card in ('habits', 'nutrition', 'workouts', 'reports', 'live sessions', 'announcements', 'learn'):
        check('Home shows the %s module card' % card, card in eb, '' if card in eb else 'cards: ' + ', '.join(eb))
    labels = [l for l, _ in nav_links(b)]
    want = ('Habits', 'Nutrition', 'Workouts', 'Live sessions', 'Learn', 'Billing', 'Announcements', 'Help and support', 'Coach AI')
    missing = [w for w in want if w not in labels]
    check('the navigation links every member module page', not missing, 'missing: ' + ', '.join(missing) if missing else '')
    b.shot('client-home')

    # M1 habits
    visit(b, '/client/habits', 'member habits page', 'Habits')
    if click_text(b, 'Done'):
        check('a habit check-in shows as done today', wait(b, "/Done today/i.test(document.body.textContent)"))
    else:
        check('a due habit offers Done (or everything is checked in already)', has(b, 'Done today|Skipped today|Not due today'))

    # M2 progress: a goal and the waiting check-in
    visit(b, '/client/progress?tab=goals', 'member progress, Goals tab', 'Progress')
    goal = TAG + ': walk after lunch'
    set_input(b, 'input[placeholder="In your own words"]', goal)
    click_text(b, 'Set the goal')
    check('a goal can be set', wait(b, 'document.body.textContent.includes(%s)' % json.dumps(goal)))
    out['goal'] = goal
    visit(b, '/client/progress?tab=checkins', 'member progress, Check-ins tab', 'Progress')
    count = "((document.body.textContent.match(/%s/g) || []).length)"
    waiting_before, sent_before = b.js(count % 'Waiting for answers'), b.js(count % 'Sent, not reviewed')
    if click_text(b, 'Answer'):
        wait(b, "Array.from(document.querySelectorAll('form')).some(f => /Send to my coach/.test(f.textContent))")
        b.js('''(() => { const f = Array.from(document.querySelectorAll('form')).find(f => /Send to my coach/.test(f.textContent));
          f.querySelectorAll('.bp-seg[role=group]').forEach(g => { const bs = g.querySelectorAll('button'); (bs.length === 2 ? bs[0] : bs[Math.min(3, bs.length - 1)]).click(); });
          f.querySelectorAll('input[inputmode=decimal]').forEach(el => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '7.5'); el.dispatchEvent(new Event('input', {bubbles: true})); });
          f.querySelectorAll('textarea').forEach(el => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, %s); el.dispatchEvent(new Event('input', {bubbles: true})); });
          return true; })()''' % json.dumps(TAG + ': a steady week'))
        b.pump(0.4)
        click_text(b, 'Send to my coach')
        sent = wait(b, "%s === %d && %s === %d" % (count % 'Waiting for answers', waiting_before - 1, count % 'Sent, not reviewed', sent_before + 1))
        check('the waiting check-in is answered and sent', sent, 'waiting %s→%s, sent %s→%s; %s' % (waiting_before, b.js(count % 'Waiting for answers'), sent_before, b.js(count % 'Sent, not reviewed'), b.js("Array.from(document.querySelectorAll('.bp-alert-error, .bp-error')).map(e => e.textContent).join(' | ')")))
        out['checkin_note'] = TAG + ': a steady week'
    else:
        check('a check-in waits for answers', False, 'no Answer button')

    # M5 nutrition: log a meal
    visit(b, '/client/nutrition', 'member nutrition page', 'Nutrition')
    meal = TAG + ': oats with banana'
    click_text(b, 'Log a meal')
    if wait(b, "!!document.querySelector('dialog[open]')"):
        set_input(b, 'dialog[open] input:not([type=date]):not([type=checkbox]):not([type=file])', meal)
        click_text(b, 'Save', 'dialog[open] button')
        check('a meal can be logged', wait(b, "!document.querySelector('dialog[open]') && document.body.textContent.includes(%s)" % json.dumps(meal)), b.js("(document.querySelector('dialog[open] .bp-alert-error')||{}).textContent||''"))
        out['meal'] = meal
    else:
        check('the Log a meal dialog opens', False)
    b.shot('client-nutrition')

    # M6 workouts: the week, then log a session
    visit(b, '/client/workouts', 'member workouts, this week', 'Workouts')
    n = b.js("document.querySelectorAll('.taskList li').length")
    check('this week lists the planned sessions', n and n > 0, '%s sessions' % n)
    go = b.js("(() => { const a = Array.from(document.querySelectorAll('a.bp-btn')).find(a => a.textContent.trim() === 'Start') || Array.from(document.querySelectorAll('a.bp-btn')).find(a => a.textContent.trim() === 'Open'); if (!a) return ''; const h = a.getAttribute('href'); a.click(); return h; })()")
    if go and wait(b, "/\\/client\\/workouts\\/[a-z0-9_]+$/.test(location.pathname)"):
        settle(b)
        page_ok(b, 'member workout session page')
        out['workout_sub'] = b.js("(document.querySelector('.pageHead .sub') || {}).textContent || ''")
        b.js("(() => { const c = Array.from(document.querySelectorAll('.bp-check input[type=checkbox]')).find(x => !x.disabled && !x.checked); if (c) c.click(); return !!c; })()")
        b.js('''(() => { const f = Array.from(document.querySelectorAll('label.bp-field')).find(l => /^Duration/.test(l.textContent)); const el = f && f.querySelector('input'); if (!el) return false;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '35'); el.dispatchEvent(new Event('input', {bubbles: true})); return true; })()''')
        b.pump(0.3)
        clicked = click_text(b, 'Save log') or click_text(b, 'Update log')
        logged = clicked and wait(b, "Array.from(document.querySelectorAll('button')).some(x => x.textContent.trim() === 'Update log') && !/Scheduled/.test((document.querySelector('.pageHead .actions') || {}).textContent || '')")
        check('a workout session can be logged', logged, b.js("Array.from(document.querySelectorAll('.bp-alert-error')).map(e => e.textContent).join(' | ')"))
        b.shot('client-workout-session')
    else:
        check('a session of the week can be opened', False, 'no Start or Open link')

    # M7 lab follow-ups on a released report
    visit(b, '/client/bloodwork', 'member bloodwork page', 'Bloodwork')
    check('the bloodwork page keeps the practice laboratory note', has(b, 'Practice laboratory|simulated'))
    if b.js("!!document.querySelector('a[href*=\"/client/reports/\"]')"):
        b.js("document.querySelector('a[href*=\"/client/reports/\"]').click()")
        wait(b, "/\\/client\\/reports\\//.test(location.pathname)")
        settle(b)
        page_ok(b, 'member report page')
        steps = b.js("(() => { const c = %s('Next steps'); return c ? c.querySelectorAll('.taskList li').length : -1; })()" % CARD)
        check('the report shows the next steps set after review', steps and steps > 0, '%s next steps' % steps)
        check('the report shows a marker trend with the laboratory values', wait(b, "(() => { const c = %s('Marker trend'); return !!c && c.querySelectorAll('tbody tr').length > 0; })()" % CARD))
        b.shot('client-report-next-steps')
    else:
        check('a released report is listed', False)

    # M8 live sessions: register, then give the place back
    visit(b, '/client/sessions', 'member live sessions page', 'Live sessions')
    title = b.js('''(() => { const c = %s('Upcoming sessions'); if (!c) return '';
      const li = Array.from(c.querySelectorAll('li')).find(l => Array.from(l.querySelectorAll('button')).some(x => x.textContent.trim() === 'Register'));
      if (!li) return ''; const t = li.querySelector('span').textContent.replace(/Sample data/i, '').trim();
      Array.from(li.querySelectorAll('button')).find(x => x.textContent.trim() === 'Register').click(); return t; })()''' % CARD)
    if title:
        joined = "(() => { const c = %s('Sessions you joined'); return !!c && c.textContent.includes(%s); })()" % (CARD, json.dumps(title[:40]))
        check('registering moves the session to Sessions you joined', wait(b, joined), title)
        b.js('''(() => { const c = %s('Sessions you joined'); const li = Array.from(c.querySelectorAll('li')).find(l => l.textContent.includes(%s));
          const x = li && Array.from(li.querySelectorAll('button')).find(x => x.textContent.trim() === 'Give my place back'); if (x) x.click(); return !!x; })()''' % (CARD, json.dumps(title[:40])))
        wait(b, "!!document.querySelector('dialog[open]')")
        click_text(b, 'Give it back', 'dialog[open] button')
        back = "(() => { const c = %s('Upcoming sessions'); const j = %s('Sessions you joined'); return !!c && c.textContent.includes(%s) && !(j && j.textContent.includes(%s)); })()" % (CARD, CARD, json.dumps(title[:40]), json.dumps(title[:40]))
        check('giving the place back returns it to the open sessions', wait(b, back))
    else:
        check('an open session offers Register', False)

    # M9 announcements: mark one read (the coach's, so the coach sees it read)
    visit(b, '/client/announcements', 'member announcements page', 'Announcements')
    unread = b.js("document.querySelectorAll('.annList li .bp-btn').length")
    picked = b.js('''(() => { const lis = Array.from(document.querySelectorAll('.annList li')).filter(li => Array.from(li.querySelectorAll('button')).some(x => x.textContent.trim() === 'Mark read'));
      const li = lis.find(l => !/The Bioptime team/.test((l.querySelector('.annMeta') || {}).textContent || '')) || lis[0]; if (!li) return '';
      Array.from(li.querySelectorAll('button')).find(x => x.textContent.trim() === 'Mark read').click(); return (li.querySelector('.annTitle') || {}).textContent || '?'; })()''')
    if picked:
        check('an announcement can be marked read', wait(b, "document.querySelectorAll('.annList li .bp-btn').length === %d" % (unread - 1)), picked)
        n_unread = json.loads(api_get(b, '/api/me/announcements')['body']).get('unread')
        check('the unread count drops by one', n_unread == unread - 1, 'unread %s, was %s' % (n_unread, unread))
        out['announcement_read'] = picked
    else:
        check('an unread announcement is listed', False)

    # M10 learning: open a course, complete a lesson
    visit(b, '/client/learn', 'member Learn page', 'Learn')
    course = b.js("(() => { const a = Array.from(document.querySelectorAll('a')).find(a => /^\\/client\\/learn\\/[^/]+$/.test(a.getAttribute('href') || '')); if (!a) return ''; const h = a.getAttribute('href'); a.click(); return h; })()")
    if course and wait(b, "/^\\/client\\/learn\\/[^/]+$/.test(location.pathname)"):
        settle(b)
        page_ok(b, 'member course outline')
        lesson = b.js("(() => { const a = Array.from(document.querySelectorAll('.pageHead a.bp-btn')).find(a => /^(Continue|Start)$/.test(a.textContent.trim())) || document.querySelector('.lrnOutline a'); if (!a) return ''; const h = a.getAttribute('href'); a.click(); return h; })()")
        if lesson and wait(b, "/^\\/client\\/learn\\/[^/]+\\/[^/]+$/.test(location.pathname)"):
            settle(b)
            page_ok(b, 'member lesson page')
            if click_text(b, 'Mark as complete'):
                check('a lesson can be completed', wait(b, "/Done/.test((document.querySelector('.pageHead .actions') || {}).textContent || '')"))
            else:
                check('the lesson is complete already', has(b, 'Done'), 'no Mark as complete button')
            b.shot('client-lesson')
        else:
            check('the course offers its next lesson', False)
    else:
        check('a course is listed', False)

    # M3 billing: documents, one opened in a new tab
    visit(b, '/client/billing', 'member billing page', 'Billing')
    first = b.js("(() => { const r = document.querySelector('table tbody tr'); return r ? r.textContent : ''; })()")
    ref = re.search(r'PAY-\d+', first or '')
    check('the billing documents are listed', bool(ref), (first or '')[:80])
    js_gesture(b, "(() => { const x = Array.from(document.querySelectorAll('table tbody button')).find(x => x.textContent.trim() === 'Open'); if (x) x.click(); return !!x; })()")
    doc = other_tab('/api/billing/documents/file')
    if doc:
        text = tab_text(doc)
        check('a billing document opens in a new tab', bool(text.strip()), doc['url'].split('?')[0])
        check('the document carries its order reference', bool(ref) and ref.group(0) in text, (ref.group(0) if ref else '?') + ' in the document')
        check('the document opens through a short-lived token, not a lasting address', 'token=' in doc['url'] and '/me/' not in doc['url'])
        check('the document keeps its small "Simulated payment" note, with no "Sample data" or demo label', 'Simulated payment' in text and not re.search(r'sample data|\bdemo\b', re.sub(r'[a-z0-9._+-]+@demo\.bioptime\.test', '', text), re.I), text[:80])
        close_tab(doc)
    else:
        check('a billing document opens in a new tab', False, 'no tab with /api/billing/documents/file; toast: ' + str(b.js("(document.querySelector('.bp-toast')||{}).textContent||''")))

    # M4 support: raise a request, ask for a data export
    visit(b, '/client/help?tab=requests', 'member Help and support, My requests', 'Help and support')
    subject = TAG + ': the app shows old tasks'
    click_text(b, 'New request')
    if wait(b, "!!document.querySelector('dialog[open] input')"):
        set_input(b, 'dialog[open] input', subject)
        set_input(b, 'dialog[open] textarea', 'Written by the end-to-end check of the modules. Nothing is wrong.')
        b.pump(0.3)
        click_text(b, 'Send', 'dialog[open] button')
        opened = wait(b, "/\\/client\\/help\\/requests\\//.test(location.pathname)")
        settle(b)
        check('a support request can be raised and opens its thread', opened and subject in (b.js("(document.querySelector('h1')||{}).textContent") or ''), str(b.js('location.pathname')))
        out['support_subject'] = subject
    else:
        check('the New request dialog opens', False)
    visit(b, '/client/profile?tab=data', 'member Profile, Your data', 'Profile')
    click_text(b, 'Request my data')
    if wait(b, "!!document.querySelector('dialog[open]')"):
        click_text(b, 'Request', 'dialog[open] button')
        check('a data export can be requested', wait(b, "!document.querySelector('dialog[open]') && Array.from(document.querySelectorAll('.bp-toast')).some(t => /Request recorded/.test(t.textContent))"), b.js("(document.querySelector('dialog[open] .bp-alert-error')||{}).textContent||''"))
    else:
        check('the data request dialog opens', False)
    visit(b, '/client/help?tab=export', 'member Help and support, Your data export', 'Help and support')
    check('the export request is listed as being prepared', has(b, 'Being prepared'), 'rows: %s' % b.js("document.querySelectorAll('table tbody tr').length"))

    # M11 Coach AI consent: the wording; withdrawn and given again, so the seeded consent stays
    visit(b, '/client/coach-ai', 'member Coach AI consent page', 'Coach AI and your data')
    check('the consent wording says it is a draft pending counsel', has(b, 'pending review by counsel'))
    check('the wording lists what a draft may send and what is never taken', has(b, 'never taken from your profile') and b.js("document.querySelectorAll('.taskList li').length") >= 3)
    check('the page says no AI provider is configured, and does not claim Coach AI is in use', has(b, 'No AI provider is configured') and not has(b, 'Coach AI is in use'))
    st = json.loads(api_get(b, '/api/me/ai/consent')['body'])
    if st.get('granted') and st.get('canGrant'):
        click_text(b, 'Withdraw consent')
        wait(b, "!!document.querySelector('dialog[open]')")
        click_text(b, 'Withdraw', 'dialog[open] button')
        check('the consent can be withdrawn', wait(b, "/Not given/.test(document.body.textContent) && Array.from(document.querySelectorAll('button')).some(x => x.textContent.trim() === 'I agree')"))
        click_text(b, 'I agree')
        check('the consent can be given again, as the demo seeded it', wait(b, "/Agreed/.test(document.body.textContent) && /Given /.test(document.body.textContent)"))
    elif not st.get('granted') and st.get('canGrant'):
        click_text(b, 'I agree')
        check('the consent can be given', wait(b, "/Agreed/.test(document.body.textContent)"))
        click_text(b, 'Withdraw consent')
        wait(b, "!!document.querySelector('dialog[open]')")
        click_text(b, 'Withdraw', 'dialog[open] button')
        check('the consent can be withdrawn again', wait(b, "/Not given/.test(document.body.textContent)"))
    else:
        check('the consent cannot be given here, and the page names what is missing', has(b, 'Missing:|switched off'), 'canGrant false: left as it was')
    b.shot('client-coach-ai')

    member_pages = ['/client', '/client/habits', '/client/progress?tab=goals', '/client/progress?tab=checkins', '/client/nutrition', '/client/workouts', '/client/bloodwork', '/client/sessions', '/client/announcements', '/client/learn', '/client/billing', '/client/help', '/client/coach-ai']
    labels_pass(b, member_pages, 'member')
    mobile_pass(b, member_pages[1:], 'member')
    sign_out(b)
    return out


def no_share_canaries(b):
    """the no-sharing member's own contact fields and health notes, read as that member, to look for in the coach's view"""
    print('member without health sharing (Deepa Krishnan): her own fields, to look for later')
    if not sign_in(b, MEMBER_NO_SHARE, 'client'):
        return None
    p = json.loads(api_get(b, '/api/me/profile')['body'])
    prof = p.get('profile') or {}
    restricted = [p.get('email'), p.get('phone'), (p.get('phone') or '')[3:] or None, prof.get('pincode'), prof.get('address'), prof.get('dateOfBirth')]
    dob = prof.get('dateOfBirth') or ''
    if re.match(r'\d{4}-\d{2}-\d{2}$', dob):
        y, m, d = dob.split('-')
        restricted.append('%d %s %s' % (int(d), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][int(m) - 1], y))
    health = []
    w = json.loads(api_get(b, '/api/me/workouts/history')['body'])
    health += [x.get('memberNote') for x in w.get('items', [])] + [x.get('skipReason') for x in w.get('items', [])]
    ml = json.loads(api_get(b, '/api/me/meal-logs')['body'])
    health += [x.get('note') for x in (ml.get('items') or [])]
    restricted = [s for s in restricted if s and len(s) >= 5]
    health = [s for s in health if s and len(s) >= 8]
    check('the member without sharing has contact fields and health notes to look for', len(restricted) >= 5 and len(health) >= 1, '%d contact values, %d health notes' % (len(restricted), len(health)))
    sign_out(b)
    # plus her own habit check-in note from the seed, which her coach never sees while she does not share
    return {'name': p.get('name'), 'restricted': restricted, 'health': health + ['Travelling, hotel breakfast.']}


# ---------------------------------------------------------------- coach
def coach_flow(b, m):
    print('coach (Asha Menon) and her client who shares health information')
    if not sign_in(b, COACH, 'coach'):
        return
    # the coach home (pages/coach/wz/dashboard) greets by time of day and keeps the Today cards below
    visit(b, '/coach', 'coach home (Today cards)', 'Good ')
    eb = eyebrows(b)
    for card, title in (('needs you', 'Check-ins to review'), ('onboarding', None), ('workouts', 'Logged this week, awaiting feedback'), ('lab next steps', None), ('consultations', 'Summaries to write')):
        ok = card in eb and (title is None or has(b, re.escape(title)))
        check('Today shows the %s card' % (title or card), ok, '' if ok else 'cards: ' + ', '.join(eb))
    b.shot('coach-today')
    me = (m or {}).get('id') or b.js("fetch('/api/coach/clients?q=Ananya').then(r => r.json()).then(j => ((j.items || [])[0] || {}).id || '')")
    base = '/coach/clients/%s' % me
    visit(b, base, 'coach client record (sharing client)')
    tabs = b.js("Array.from(document.querySelectorAll('[role=tab]')).map(t => (t.id.match(/-tab-(.+)$/) || [])[1])") or []
    missing = [t for t in COACH_MODULE_TABS if t not in tabs]
    check('the client record offers every coach module tab', not missing, 'missing: %s (tabs %s)' % (missing, tabs) if missing else ', '.join(COACH_MODULE_TABS))
    contact = "!/@demo\\.bioptime\\.test|\\+91\\d{10}|9700000011|560001|Lake View Road|1992-03-14|14 Mar 1992/.test(document.querySelector('[role=tabpanel]') ? document.querySelector('[role=tabpanel]').textContent : document.body.textContent)"
    for t in COACH_MODULE_TABS:
        visit(b, '%s?tab=%s' % (base, t), 'coach client record, %s tab' % t)
        rendered = tab_rendered(b, t, 'coach record (sharing): %s tab renders its own panel' % t)
        check('the %s tab shows no contact field of the client' % t, rendered and b.js(contact), '' if rendered else 'the tab did not render, so the scan proves nothing')
        no_labels(b, 'coach client record, %s tab' % t)
        if t == 'habits':
            check('Habits: weekly adherence and the client’s own habits', has(b, 'Due days checked in as done') and has(b, 'Client’s own'))
        elif t == 'goals':
            check('Goals: the goal the client set is listed', bool(m and m.get('goal')) and m['goal'] in body(b))
            check('Goals: the check-in the client answered shows their answers', bool(m and m.get('checkin_note')) and m['checkin_note'] in body(b))
        elif t == 'nutrition':
            check('Nutrition: the meal plan and the meal the client logged', has(b, 'Meal plans|meal plan') and bool(m and m.get('meal')) and m['meal'] in body(b), 'meal log shown while the client shares')
        elif t == 'workouts':
            check('Workouts: the programme and its schedule', has(b, 'Schedule and logs') and has(b, 'Workout programmes'))
            sub = (m or {}).get('workout_sub') or ''
            day = re.search(r'\d{1,2} [A-Z][a-z]{2} \d{4}', sub)
            if day:
                status = b.js("(() => { const r = Array.from(document.querySelectorAll('tbody tr')).find(r => r.textContent.includes(%s)); return r ? r.textContent : ''; })()" % json.dumps(day.group(0)))
                check('Workouts: the session the client logged shows as done', bool(re.search(r'completed|partly done', status or '', re.I)), (status or 'no row for ' + day.group(0))[:120])
        elif t == 'lab-follow-ups':
            check('Lab next steps: the report’s next steps are listed', has(b, 'Go through this report together at the next appointment'))
        elif t == 'learning':
            check('Learning: the client’s course progress', has(b, 'Getting started with courses'))
        elif t == 'ai':
            check('Coach AI tab: says it is not configured and shows the client’s consent', has(b, 'Coach AI is not configured') and has(b, 'Coach AI consent'))
    b.shot('coach-client-tabs')

    visit(b, '/coach/announcements', 'coach announcements page', 'Announcements')
    check('the coach’s announcement is listed with its reach', has(b, 'A note from your coach') and has(b, '\\d+ clients · \\d+ read'))
    no_labels(b, 'coach announcements page')
    if m and m.get('announcement_read') and 'coach' in m['announcement_read'].lower():
        check('the client’s read shows on the coach’s announcement', has(b, '[1-9]\\d* read'), b.js("(document.body.textContent.match(/\\d+ clients · \\d+ read/) || [''])[0]"))

    visit(b, '/coach/sessions', 'coach live sessions host page', 'Live sessions')
    check('the host page says video meetings are pending configuration', has(b, 'Video meetings: pending configuration'))
    link = b.js("(document.querySelector('a[href*=\"/coach/sessions/lvs_\"]') || {}).getAttribute ? document.querySelector('a[href*=\"/coach/sessions/lvs_\"]').getAttribute('href') : ''")
    if link:
        visit(b, link, 'coach session detail')
        check('registrations are listed by name only', has(b, 'Registrations \\(names only\\)') and not has(b, '@demo\\.bioptime\\.test|\\+91\\d{10}', ''))
    else:
        check('a hosted session is listed', False)

    visit(b, '/coach/ai', 'coach Coach AI page', 'Coach AI')
    check('Coach AI says it is not configured and names what is missing', has(b, 'Coach AI is not configured') and has(b, 'AI_PROVIDER') and has(b, 'Nothing is generated in the meantime'))
    b.js('''(() => { const s = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'plan_outline')); if (!s) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'plan_outline'); s.dispatchEvent(new Event('change', {bubbles: true})); return true; })()''')
    b.pump(0.3)
    click_text(b, 'Ask for a draft')
    refused = wait(b, "/Request refused/.test(document.body.textContent) && /nothing was generated/.test(document.body.textContent)")
    check('asking for a draft is refused honestly and nothing is generated', refused and not has(b, 'Draft ready to review') and has(b, 'No drafts yet'))
    b.shot('coach-ai')

    b.viewport(390, 844, mobile=True)
    try:
        for p in ('/coach', '/coach/announcements', '/coach/sessions', '/coach/ai', base + '?tab=workouts', base + '?tab=goals'):
            no_sideways(b, p, 'coach %s has no sideways scroll at 390px' % p)
        b.shot('coach-mobile')
    finally:
        b.viewport(1440, 900)
    sign_out(b)


# What each tab's own panel says when the client does not share, matched case-sensitively inside [role=tabpanel] only:
# the page-wide "Health records not shared" alert (pages/ClientDetail.tsx) sits outside the panel on every tab, so a
# whole-page match would pass on any tab. Each phrase is one only that tab renders.
WITHHELD_NOTE = 'has not shared health information (measurements, progress log, blood tests and reports) with their coach'  # ClientDetail withheldNote
NO_SHARE_EXPECT = {
    'overview': 'Blood tests not shared with you',                    # pages/ClientDetail.tsx, overview "What is coming"
    'bloodwork': WITHHELD_NOTE, 'progress': WITHHELD_NOTE,
    'habits': 'Health information not shared',                        # modules/habits/HabitsTab.tsx:34
    'goals': 'Goal titles and check-in dates show',                   # modules/progress/CoachGoalsTab.tsx:30
    'nutrition': 'Meal log and preferences are private',              # modules/nutrition/CoachNutritionTab.tsx:29
    'workouts': 'Workout logs not shared',                            # modules/workouts/WorkoutsTab.tsx:26
    'lab-follow-ups': 'Next steps come from the client’s reports',    # modules/labFollowups/ClientRecordTab.tsx:18
    'ai': 'Not shared: no values or check-in answers are included',   # modules/ai/shared.tsx:153
}


def coach_no_share_flow(b, canaries):
    print('coach (Meera Iyer) and her client who does not share health information')
    if not canaries or not sign_in(b, COACH_NO_SHARE, 'coach'):
        return
    cid = b.js("fetch('/api/coach/clients?q=Deepa').then(r => r.json()).then(j => ((j.items || [])[0] || {}).id || '')")
    check('the client without sharing is found', bool(cid))
    if not cid:
        sign_out(b)
        return
    base = '/coach/clients/%s' % cid
    visit(b, base, 'coach client record (client without sharing)')
    tabs = [t for t in (b.js("Array.from(document.querySelectorAll('[role=tab]')).map(t => (t.id.match(/-tab-(.+)$/) || [])[1])") or []) if t]
    check('the client record offers the module tabs', all(t in tabs for t in COACH_MODULE_TABS), ', '.join(tabs))
    needles = json.dumps(canaries['restricted'] + canaries['health'])
    find = "((n) => { const t = document.body.textContent; return n.filter(s => t.includes(s)); })(%s)" % needles
    used = set()
    for t in ([] if 'overview' in tabs else [None]) + tabs:
        path = base if t is None else '%s?tab=%s' % (base, t)
        b.open(BASE + path, settle=0.8)
        settle(b)
        label = t or 'overview'
        # anchor first: this tab's panel is the one shown, has loaded and has content, so an empty or broken tab cannot pass the scan
        rendered = tab_rendered(b, label, 'coach record (no sharing): %s tab renders its own panel' % label)
        found = b.js(find) or []
        check('%s tab: no health detail and no restricted contact field in the page text' % label, rendered and not found,
              'found: ' + ', '.join(found) if found else ('' if rendered else 'the tab did not render, so the scan proves nothing'))
        if label in NO_SHARE_EXPECT:
            check('%s tab says what is not shared (in its own panel)' % label, panel_has(b, NO_SHARE_EXPECT[label]), NO_SHARE_EXPECT[label])
        used.update(u for u in (b.js("performance.getEntriesByType('resource').map(e => e.name).filter(u => u.includes('/api/'))") or []))
    b.shot('coach-client-not-shared')
    leaks = []
    for u in sorted(used):
        path = urllib.parse.urlsplit(u)
        if '/token' in path.path or '/files/' in path.path:
            continue
        r = api_get(b, path.path + ('?' + path.query if path.query else ''))
        hits = [s for s in canaries['restricted'] + canaries['health'] if s in (r or {}).get('body', '')]
        if hits:
            leaks.append('%s: %s' % (path.path, ', '.join(hits)))
    check('no API answer the coach’s pages used carries her contact fields or health notes', not leaks, '; '.join(leaks)[:400] if leaks else '%d API answers read' % len(used))
    sign_out(b)


# ---------------------------------------------------------------- admin and owner
def admin_flow(b, m):
    print('administrator (default permissions)')
    if not sign_in(b, ADMIN, 'admin', mfa=True):
        return
    links = [h for _, h in nav_links(b)]
    check('an administrator has no LabStack link', '/admin/integrations/labstack' not in links)
    visit(b, '/admin/modules', 'admin Modules page (settings only)', 'Modules')
    check('the module switches are not offered without modules.manage', b.js("document.querySelectorAll('input[role=switch]').length") == 0 and has(b, 'What the modules read'))
    visit(b, '/admin/integrations/labstack', 'admin LabStack page refused', allow_alerts=True)
    check('LabStack is refused without labstack.manage', has(b, 'Permission needed') and has(b, 'labstack.manage') and not has(b, 'LabStack operations'))
    visit(b, '/admin/billing', 'admin Billing page', 'Billing')
    check('Billing lists the documents and says tax invoices are pending configuration', b.js("document.querySelectorAll('table tbody tr').length") > 0 and has(b, 'Tax invoices are pending configuration'))
    b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.startsWith('Refund requests')).click()")
    settle(b, 0.5)
    page_ok(b, 'admin Billing, Refund requests tab')
    visit(b, '/admin/support', 'admin Support page', 'Support')
    if m and m.get('support_subject'):
        check('the member’s new support request is in the queue', m['support_subject'] in body(b))
    b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => t.textContent.startsWith('Data exports')).click()")
    settle(b, 0.5)
    page_ok(b, 'admin Support, Data exports tab')
    check('the member’s export request is listed for the team', has(b, 'Ananya Rao'), 'the team sees that it exists, never its contents')
    visit(b, '/admin/learning', 'admin Courses page', 'Courses')
    check('Courses lists the introduction to Learn and says video lessons are pending configuration', has(b, 'Getting started with courses') and has(b, 'Video lessons: pending configuration'))
    visit(b, '/admin/users', 'admin Users and permissions refused', allow_alerts=True)
    check('Users and permissions is refused without permissions.manage', has(b, 'Permission needed') and has(b, 'permissions.manage'))
    labels_pass(b, ['/admin/billing', '/admin/support', '/admin/learning', '/admin/sessions', '/admin/announcements', '/admin/exercise-library'], 'admin')
    mobile_pass(b, ['/admin/billing', '/admin/support', '/admin/learning'], 'admin')
    sign_out(b)


def switch(b, key, on, reason):
    """flip a module's switch on /admin/modules through its dialog; True once the page shows the new state"""
    sel = 'input[role=switch][aria-label$=%s]' % json.dumps('(%s)' % key)
    b.open(BASE + '/admin/modules', settle=0.8)
    settle(b)
    now = b.js("(document.querySelector(%s) || {}).checked" % json.dumps(sel))
    if now is None:
        return False
    if bool(now) == on:
        return True
    b.js("document.querySelector(%s).click()" % json.dumps(sel))
    if not wait(b, "!!document.querySelector('dialog[open] textarea')"):
        return False
    set_input(b, 'dialog[open] textarea', reason)
    click_text(b, 'Switch on' if on else 'Switch off', 'dialog[open] button')
    return wait(b, "!document.querySelector('dialog[open]') && document.querySelector(%s).checked === %s" % (json.dumps(sel), 'true' if on else 'false'))


def owner_modules_flow(b):
    print('owner: the Modules page, and Learning switched off and on again')
    if not sign_in(b, OWNER, 'admin', mfa=True):
        return
    visit(b, '/admin/modules', 'owner Modules page', 'Modules')
    labels = b.js("Array.from(document.querySelectorAll('input[role=switch]')).map(x => x.getAttribute('aria-label'))") or []
    missing = [k for k in MODULE_KEYS if not any(l.endswith('(%s)' % k) for l in labels)]
    check('the Modules page lists the twelve module switches', not missing, 'missing: %s' % missing if missing else '%d switches' % len(labels))
    check('every module switch is on in the demo', all(b.js("(document.querySelector('input[role=switch][aria-label$=\"(%s)\"]') || {}).checked" % k) for k in MODULE_KEYS))
    b.shot('admin-modules')
    off = switch(b, TOGGLED, False, 'End-to-end check: switching Learning off to see it hidden; it is switched on again at once.')
    state['toggled_off'] = off or state['toggled_off']
    check('Learning can be switched off with a reason', off)
    feats = json.loads(api_get(b, '/api/public/config')['body']).get('features', [])
    check('the switch is off for everyone at once (public config)', TOGGLED not in feats)
    b.open(BASE + '/admin', settle=0.8)
    settle(b)
    check('the admin Courses link is hidden while Learning is off', '/admin/learning' not in [h for _, h in nav_links(b)])
    audit = api_get(b, '/api/admin/audit?targetType=feature_flag&targetId=%s&limit=5' % TOGGLED)
    check('the switch is in the audit log with its reason', audit['status'] == 200 and 'switching Learning off' in audit['body'], 'GET /api/admin/audit status %s' % audit['status'])
    sign_out(b)


def member_toggle_flow(b, expect_on):
    word = 'on' if expect_on else 'off'
    print('member with Learning %s' % word)
    if not sign_in(b, MEMBER, 'client'):
        return
    b.open(BASE + '/client', settle=0.8)
    settle(b)
    labels = [l for l, _ in nav_links(b)]
    learn_card = 'learn' in eyebrows(b)
    if expect_on:
        check('with Learning on again the Learn link is back', 'Learn' in labels)
        check('with Learning on again the Home card is back', learn_card)
        visit(b, '/client/learn', 'with Learning on again /client/learn renders', 'Learn')
        check('the course is listed again', has(b, 'Getting started with courses'))
        r = api_get(b, '/api/me/courses')
        check('the Learning API answers again', r['status'] == 200, 'status %s' % r['status'])
    else:
        check('with Learning off the member has no Learn link', 'Learn' not in labels, ', '.join(labels))
        check('with Learning off the Home card is gone', not learn_card)
        b.open(BASE + '/client/learn', settle=0.8)
        settle(b)
        check('with Learning off /client/learn is refused', has(b, 'No such page') and not has(b, 'Courses you are taking'), str(b.js("(document.querySelector('.content') || document.body).innerText.slice(0, 120)")))
        r = api_get(b, '/api/me/courses')
        code = (json.loads(r['body'] or '{}').get('error') or {}).get('code')
        check('with Learning off its API refuses (FEATURE_DISABLED)', r['status'] in (403, 404) and code == 'FEATURE_DISABLED', 'status %s %s' % (r['status'], code))
        b.shot('client-learning-off')
    sign_out(b)


def owner_flow(b):
    print('owner: Learning back on, LabStack, Users and permissions, Coach AI usage')
    if not sign_in(b, OWNER, 'admin', mfa=True):
        return False
    on = switch(b, TOGGLED, True, 'End-to-end check: switching Learning back on after checking it hidden.')
    if on:
        state['toggled_off'] = False
    check('Learning can be switched on again with a reason', on)
    visit(b, '/admin', 'owner Overview with module cards', 'Overview')
    eb = eyebrows(b)
    for card in ('billing', 'reports', 'learning', 'live sessions', 'exercise library'):
        check('Overview shows the %s module card' % card, card in eb, '' if card in eb else 'cards: ' + ', '.join(eb))

    visit(b, '/admin/integrations/labstack', 'owner LabStack page', 'LabStack integration')
    wait(b, "/Partner key and widget/.test(document.body.textContent)", 8)
    for section in ('LabStack operations', 'Orders by LabStack order type', 'Breaching now', 'Escalations open', 'Recent activity', 'By status', 'Tests and packages', 'Webhooks and safety net', 'Partner key and widget'):
        check('LabStack operations section: %s' % section, has(b, re.escape(section)))
    shown = b.js("(() => { const dt = Array.from(document.querySelectorAll('dt')).find(d => d.textContent.trim() === 'Partner key'); return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : null; })()")
    check('the partner key is shown only as configured or not', shown in ('not configured', 'configured in the server environment'), 'shown: %s' % shown)
    ops = api_get(b, '/api/admin/integrations/labstack/operations')
    pk = (json.loads(ops['body'] or '{}').get('partnerKey') or {})
    check('the operations API sends only whether the key is set', ops['status'] == 200 and set(pk) <= {'variable', 'configured', 'widget', 'generatedIn'} and isinstance(pk.get('configured'), bool), 'keys %s' % sorted(pk))
    if PARTNER_KEY_CANARY:
        check('the partner key value is in neither the page nor the API', PARTNER_KEY_CANARY not in body(b) and PARTNER_KEY_CANARY not in ops['body'] and pk.get('configured') is True)
    check('the LabStack page shows no secret', not has(b, 'sk_|secret[:=]\\s*\\w{8,}|api[_ -]?key[:=]\\s*\\w'))
    b.shot('admin-labstack')

    visit(b, '/admin/users', 'owner Users and permissions', 'Users and permissions')
    card = b.js("(() => { const c = %s('Module permissions'); return c ? c.textContent : ''; })()" % CARD) or ''
    heads = ('Libraries', 'Courses', 'Live sessions', 'Announcements', 'Bulk imports', 'Coach AI usage', 'Module switches')
    check('the module permissions are listed', all(h in card for h in heads), ', '.join(h for h in heads if h not in card))
    perms = ('library.manage', 'learning.manage', 'sessions.manage', 'announcements.manage', 'imports.manage', 'ai.manage', 'modules.manage')
    named = b.js("(() => { const t = document.body.textContent; return %s.filter(p => !t.includes(p)); })()" % json.dumps(perms))
    check('the reference names each module permission, marked as a module one', not named and b.js("(document.body.textContent.match(/\\(module\\)/g) || []).length") >= len(perms), 'missing: %s' % named if named else '')
    row = b.js("(() => { const c = %s('Module permissions'); const r = c && Array.from(c.querySelectorAll('tbody tr')).find(r => /Operations admin/.test(r.textContent)); return r ? Array.from(r.querySelectorAll('td')).slice(1).map(td => td.textContent.trim()) : []; })()" % CARD) or []
    check('an administrator holds the four default module permissions and not the other three', row[:4] == ['✓'] * 4 and row[4:7] == ['–'] * 3, ' '.join(row))
    b.shot('admin-users')

    visit(b, '/admin/ai', 'owner Coach AI usage', 'Coach AI usage')
    check('Coach AI usage says it is not configured and shows counts only', has(b, 'Coach AI is not configured') and has(b, 'Counts only'))
    mobile_pass(b, ['/admin/modules', '/admin/integrations/labstack', '/admin/users', '/admin/ai'], 'owner')
    sign_out(b)
    return True


def public_features(b):
    try:
        return json.loads(api_get(b, '/api/public/config')['body']).get('features', [])
    except Exception:  # noqa: BLE001
        return []


def restore(b):
    """switch Learning back on if a failure left it off (it was on when the run started)"""
    if not state['toggled_off'] and not (state.get('was_on') and TOGGLED not in public_features(b)):
        return
    print('restore: switching Learning back on')
    try:
        sign_out(b)
        if sign_in(b, OWNER, 'admin', mfa=True):
            r = api_write(b, 'PATCH', '/api/admin/modules', {'key': TOGGLED, 'enabled': True, 'reason': 'End-to-end check: restoring Learning after a failed run.'})
            check('Learning switched back on after the failure', r['status'] == 200, 'status %s' % r['status'])
            sign_out(b)
    except Exception as e:  # noqa: BLE001  (report, never hide)
        check('Learning switched back on after the failure', False, repr(e)[:200])



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


def main():
    if not BASE:
        sys.exit('BASE is required, for example BASE=http://127.0.0.1:3870: this check writes records and switches a module off and on, so it runs against a scratch server only.')
    why = live_demo_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Start a scratch server (see the docstring).' % (BASE, why))
    os.makedirs(cs.OUT, exist_ok=True)
    b = cs.Browser()
    b.viewport(1440, 900)
    try:
        b.open(BASE + '/login/client', settle=0.8)
        sign_out(b)
        state['was_on'] = TOGGLED in public_features(b)
        check('the %s module is on before the run' % TOGGLED, state['was_on'], 'seed the scratch database with reset-demo in demo mode')
        m = member_flow(b)
        canaries = no_share_canaries(b)
        coach_flow(b, m)
        coach_no_share_flow(b, canaries)
        admin_flow(b, m)
        owner_modules_flow(b)
        if state['toggled_off']:
            member_toggle_flow(b, expect_on=False)
        if owner_flow(b) and not state['toggled_off']:
            member_toggle_flow(b, expect_on=True)
    except Exception as e:  # noqa: BLE001  (a crash is a failure with its reason, and Learning is still restored)
        check('the run completed', False, repr(e)[:300])
    finally:
        try:
            restore(b)
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
