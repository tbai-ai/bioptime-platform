#!/usr/bin/env python3
"""End-to-end check of the public website served by the API (Python 3.9, stdlib, Google Chrome).

    BASE=http://127.0.0.1:3870 python3 -I tools/e2e_website.py      against a scratch server

Only a scratch server on this machine is accepted: the live demo's ports (3000, 3100, 3101), a BASE without a port and
any host but 127.0.0.1, localhost, *.localhost or *.test are refused, because the check registers a member and pays an
order. E2E_OUT and E2E_CDP_PORT give a run its own screenshot folder, Chrome profile and DevTools port.

The member journey as a visitor meets it: live package prices, the test catalogue, registration, email confirmation
(demo token), account setup, checkout with the payment simulator, the account page, a bespoke request, the contact
form, sign-out and sign-in. Then the API is asked, as the demo owner, whether the enquiry and the bespoke request
arrived. No page may show a "demo" or "sample" label (the owner removed them on 24 October 2026); the checkout keeps
its small simulated-payment note. Screenshots go to .local/e2e-web/. Exit status 1 if anything fails.
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(PLATFORM)), 'drive', 'tools'))
import check_site as cs  # noqa: E402

cs.OUT = os.environ.get('E2E_OUT') or os.path.join(PLATFORM, '.local', 'e2e-web')
cs.PORT_CDP = int(os.environ.get('E2E_CDP_PORT') or 9345)
BASE = os.environ.get('BASE', 'http://localhost:3000').rstrip('/')
LIVE_PORTS = (3000, 3100, 3101)   # the owner's live demo: this check writes records, so it never runs there
STAMP = time.strftime('%Y%m%d%H%M%S')
EMAIL = 'web-e2e-%s@demo.bioptime.test' % STAMP
PASSWORD = 'Web-E2E-%s!' % STAMP
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


def wait(b, expr, seconds=12):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if b.js(expr):
                return True
        except Exception:
            pass
        b.pump(0.2)
    return False


# the portal pages are React: values go through the native setter so React notices (same helper as e2e_dashboard.py)
SET_INPUT = '''(sel, v) => { const el = document.querySelector(sel); if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }'''


def react_fill(b, sel, value):
    return b.js('(%s)(%s, %s)' % (SET_INPUT, json.dumps(sel), json.dumps(value)))


def fill(b, sel, value):
    return b.js("(function(){var el=document.querySelector(%s); if(!el) return false; el.focus(); el.value=%s; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()" % (json.dumps(sel), json.dumps(value)))


def tick(b, sel, on=True):
    return b.js("(function(){var el=document.querySelector(%s); if(!el) return false; el.checked=%s; el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()" % (json.dumps(sel), 'true' if on else 'false'))


def click(b, sel):
    return b.js("(function(){var el=document.querySelector(%s); if(!el) return false; el.click(); return true;})()" % json.dumps(sel))


def status_text(b):
    return b.js("(document.querySelector('#formStatus')||{}).textContent||''")


def open_page(b, path, name, shot=None):
    b.open(BASE + path, settle=1.0)
    errs = [e for e in b.errors if 'favicon' not in e]
    h1 = b.js("(document.querySelector('h1')||{}).textContent||''")
    check(name, not errs and h1.strip() != '', '; '.join(errs[:3]) or ('h1: ' + h1.strip()[:60]))
    if shot:
        b.shot(shot)


def main():
    why = live_demo_refusal(BASE)
    if why:
        sys.exit('Refusing BASE %s: %s. Run against a scratch server (BASE=http://127.0.0.1:<port>).' % (BASE, why))
    os.makedirs(cs.OUT, exist_ok=True)
    b = cs.Browser()
    b.viewport(1440, 900)
    try:
        # public pages fed by the API
        # start from a signed-out browser: the Chrome profile persists cookies between runs
        b.open(BASE + '/login/client', settle=0.8)
        b.js("fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers: {'X-Bioptime-Client': 'e2e'}}).then(r => r.status)")
        b.js("document.cookie = 'bp_signed_in=; Max-Age=0; path=/'; true")
        open_page(b, '/packages', 'packages page renders')
        live = wait(b, "document.querySelectorAll('.pkgChoose').length >= 3")
        check('live prices and choose buttons from the API', live, '%s choose buttons' % b.js("document.querySelectorAll('.pkgChoose').length"))
        no_labels(b, 'packages page (no "Demo price" label on the prices)')
        check('bespoke tile links to the bespoke page', b.js("!!document.querySelector('#package-bespoke a[href=\"bespoke.html\"]')"))
        b.shot('packages')
        open_page(b, '/bloodwork', 'bloodwork page renders')
        cat = wait(b, "document.querySelectorAll('#testCatalogue .tile').length > 0")
        check('test catalogue loaded from the API', cat, '%s tests' % b.js("document.querySelectorAll('#testCatalogue .tile').length"))
        no_labels(b, 'bloodwork page')
        b.shot('bloodwork')
        for path, name in (('/how-it-works', 'how it works'), ('/terms', 'terms'), ('/privacy', 'privacy'), ('/legal', 'legal index')):
            open_page(b, path, name + ' page renders')
        open_page(b, '/login', 'sign-in chooser renders')
        check('/login offers the three doors, pointing at the portal', b.js("Array.from(document.querySelectorAll('[data-portal-link]')).map(a => a.getAttribute('href')).join(',') === '/login/client,/login/coach,/login/admin'"), b.js("Array.from(document.querySelectorAll('[data-portal-link]')).map(a => a.getAttribute('href')).join(',')"))
        b.open(BASE + '/login/client', settle=1.0)
        check('/login/client is the member sign-in page', wait(b, "!!document.querySelector('input[type=email]') && /Welcome back/.test(document.body.textContent)"))
        for path, h1 in (('/login/coach', 'Coach workspace'), ('/login/admin', 'Administrative portal')):
            b.open(BASE + path, settle=1.0)
            check(path + ' renders its own sign-in', wait(b, "(document.querySelector('h1')||{}).textContent === %s" % json.dumps(h1)), b.js("(document.querySelector('h1')||{}).textContent"))
        for path, h1 in (('/faq', 'Before you begin.'), ('/coaching', 'A coach who sees the whole picture.')):
            open_page(b, path, path + ' page renders')
            check(path + ' has its headline', b.js("(document.querySelector('h1')||{}).textContent === %s" % json.dumps(h1)))
        check('every page links the published theme stylesheet', b.js("!!document.querySelector('link#bpTheme') && document.querySelector('link#bpTheme').sheet !== null"))
        check('the content overlay applied the published version', wait(b, "document.documentElement.hasAttribute('data-cms-version')"))

        # register
        open_page(b, '/register', 'register page renders')
        fill(b, '#rName', 'Web E2E Member'); fill(b, '#rEmail', EMAIL); fill(b, '#rPassword', PASSWORD); tick(b, '[name=acceptPolicies]')
        click(b, '#registerForm button[type=submit]')
        ok = wait(b, "/Your account exists/.test((document.querySelector('#formStatus')||{}).textContent||'')")
        check('registration succeeds', ok, status_text(b)[:160])
        b.shot('register-done')
        no_labels(b, 'registration result')
        demo_link = b.js("(document.querySelector('#demoVerify')||{}).getAttribute ? document.querySelector('#demoVerify').getAttribute('href') : ''")
        check('the verification link is offered (no email is sent from this copy)', bool(demo_link), demo_link[:60])
        if demo_link:
            b.open(BASE + '/' + demo_link, settle=1.0)
            ok = wait(b, "/confirmed/.test((document.querySelector('#formStatus')||{}).textContent||'')")
            check('email confirmed via the link', ok, status_text(b)[:120])
            b.shot('verify-done')

        # account setup (web onboarding)
        b.open(BASE + '/account', settle=1.0)
        check('/account goes to the member portal, which starts with setup', wait(b, "location.pathname === '/client/welcome' && !!document.querySelector('form')", 15), b.js('location.pathname'))
        react_fill(b, 'input[autocomplete=address-level2]', 'Bengaluru')
        b.js("Array.from(document.querySelectorAll('.bp-chip')).find(c => c.textContent.trim() === 'Strength').click()")
        click(b, 'input[required][type=checkbox]')
        click(b, 'button[type=submit]')
        ok = wait(b, "location.pathname === '/client' && /Hello/.test((document.querySelector('h1')||{}).textContent||'')", 15)
        check('web onboarding completes and opens the member home', ok, b.js('location.pathname'))
        no_labels(b, 'member home after setup')
        b.shot('portal-home-after-setup')

        # checkout with the simulator
        open_page(b, '/checkout?package=core', 'checkout page renders')
        form = wait(b, "!document.querySelector('#checkoutForm').hidden")
        check('checkout shows the package and the pay form', form, b.js("(document.querySelector('.coSummary')||{}).textContent||''")[:100])
        b.shot('checkout')
        tick(b, '[name=confirm]')
        click(b, '#payBtn')
        no_labels(b, 'checkout page')
        sim = wait(b, "!document.querySelector('#coSimulator').hidden")
        check('order created and the payment simulator offered', sim, status_text(b)[:120])
        check('the checkout keeps its small simulated-payment note', b.js("/simulat/i.test(document.body.innerText)"))
        click(b, '#simOk')
        paid = wait(b, "/Payment confirmed/.test((document.querySelector('#formStatus')||{}).textContent||'')", 15)
        check('simulated payment activates the package', paid, status_text(b)[:160])
        b.shot('checkout-done')

        # account after purchase
        b.open(BASE + '/client', settle=1.0)
        wait(b, "/Core/.test((document.querySelector('.heroBand .sub, .pageHead .sub')||{}).textContent||'')", 15)
        check('member home shows the Core package', b.js("/Core/.test((document.querySelector('.heroBand .sub, .pageHead .sub')||{}).textContent||'')"), b.js("(document.querySelector('.heroBand .sub, .pageHead .sub')||{}).textContent||''"))
        check('coach status explained', b.js("/matched|choosing|assigned|[A-Z][a-z]+ [A-Z][a-z]+/.test(document.body.textContent)"))
        b.open(BASE + '/client/program?tab=packages', settle=1.0)
        b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => /Packages/.test(t.textContent)).click()")
        rows = wait(b, "/Activated/i.test(document.body.textContent) && /Core/.test(document.body.textContent)", 15)
        check('orders list shows the activated Core order', rows)
        b.shot('portal-program')
        open_page(b, '/packages', 'packages page while signed in')
        check('nav link reads My account when signed in', wait(b, "Array.from(document.querySelectorAll('[data-account-link]')).some(a => a.textContent.trim() === 'My account' && a.getAttribute('href') === '/client')"))
        b.shot('account-member')

        # bespoke request
        open_page(b, '/bespoke', 'bespoke page renders')
        fill(b, '#bName', 'Web E2E Member'); fill(b, '#bEmail', EMAIL); fill(b, '#bGoals', 'E2E check: a longer plan around strength and sleep with two tests.'); fill(b, '#bBudget', '30000')
        click(b, '#bespokeForm button[type=submit]')
        ok = wait(b, "/has been received/.test((document.querySelector('#formStatus')||{}).textContent||'')")
        check('bespoke request recorded with a reference', ok and b.js("/CPL-\\d+/.test(document.querySelector('#formStatus').textContent)"), status_text(b)[:140])
        b.shot('bespoke-done')

        # contact form through the API
        open_page(b, '/contact', 'contact page renders')
        fill(b, '#cName', 'Web E2E Visitor'); fill(b, '#cEmail', EMAIL); fill(b, '#cMessage', 'E2E check: a contact message sent through the API-served website.')
        b.pump(3.2)  # the form refuses submissions faster than three seconds
        click(b, '#contactForm button[type=submit]')
        ok = wait(b, "/has been received/.test((document.querySelector('#formStatus')||{}).textContent||'')")
        check('contact form submits to the API', ok, status_text(b)[:140])

        # sign out and back in
        b.open(BASE + '/client/profile', settle=1.0)
        wait(b, "!!document.querySelector('.who button')", 15)
        b.js("Array.from(document.querySelectorAll('.who button')).find(x => x.textContent.trim() === 'Sign out').click()")
        check('sign-out returns to the member sign-in page', wait(b, "location.pathname === '/login/client'"), b.js('location.pathname'))
        b.open(BASE + '/client/program', settle=1.0)
        check('signed-out portal link goes to the member sign-in', wait(b, "location.pathname === '/login/client'"), b.js('location.pathname'))
        react_fill(b, 'input[type=email]', EMAIL); react_fill(b, 'input[type=password]', PASSWORD)
        b.js("document.querySelector('form').requestSubmit()")
        ok = wait(b, "location.pathname === '/client/program'", 15)
        check('sign-in returns to the page that was asked for', ok, b.js('location.pathname'))
        b.shot('login-done')
        b.js("fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers: {'X-Bioptime-Client': 'e2e'}}).then(r => r.status)")
        b.open(BASE + '/login/client', settle=1.0)
        wait(b, "!!document.querySelector('input[type=email]')")
        react_fill(b, 'input[type=email]', 'asha.menon@demo.bioptime.test'); react_fill(b, 'input[type=password]', 'Demo-Coach-2026!')
        b.js("document.querySelector('form').requestSubmit()")
        wrong = wait(b, "/coach workspace/.test((document.querySelector('.bp-alert-error')||{}).textContent||'')")
        check('a coach is sent to the coach workspace, not signed in here', wrong, b.js("(document.querySelector('.bp-alert-error')||{}).textContent||''")[:120])

        # phone width
        b.viewport(390, 844, mobile=True)
        b.open(BASE + '/packages', settle=1.0)
        check('packages page has no sideways scroll at 390px', b.js('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'scrollWidth %s' % b.js('document.documentElement.scrollWidth'))
        b.open(BASE + '/login/client', settle=1.0)
        wait(b, "!!document.querySelector('input[type=email]')")
        check('member sign-in has no sideways scroll at 390px', b.js('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'scrollWidth %s' % b.js('document.documentElement.scrollWidth'))
        b.shot('login-mobile')
        b.viewport(1440, 900)
    finally:
        b.close()

    # the operations side: did the enquiry and the bespoke request reach the team?
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method, path, body=None):
        req = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Bioptime-Client': 'e2e'})
        with opener.open(req, timeout=20) as r:
            return json.loads(r.read().decode() or 'null')
    try:
        code = call('GET', '/auth/demo/totp?email=owner@demo.bioptime.test')['code']
        call('POST', '/auth/login', {'email': 'owner@demo.bioptime.test', 'password': 'Demo-Owner-2026!', 'workspace': 'admin', 'mfaCode': code})
        enq = call('GET', '/admin/enquiries')['items']
        check('the contact message is in the admin enquiries list', any(EMAIL == e['email'] and 'E2E check' in e['message'] for e in enq), '%d enquiries' % len(enq))
        cps = call('GET', '/admin/custom-plans')['items']
        check('the bespoke request is in the admin custom-plans list', any(e.get('contact_email') == EMAIL for e in cps), '%d requests' % len(cps))
        members = call('GET', '/admin/members?q=' + EMAIL)['items']
        check('the new member appears in the admin directory as active with Core', bool(members) and members[0]['state'] == 'active' and members[0].get('package_name') == 'Core', json.dumps({k: members[0].get(k) for k in ('state', 'package_name', 'coach_name')}) if members else 'not found')
        reqs = call('GET', '/admin/assignments/requests?status=open')['items']
        check('an assignment request opened for the new member', any(r['member_id'] == members[0]['id'] for r in reqs) if members else False, '%d open requests' % len(reqs))
    except Exception as e:  # noqa: BLE001
        check('admin cross-check', False, str(e)[:200])

    failed = [r for r in results if not r['ok']]
    report = {'base': BASE, 'email': EMAIL, 'checks': len(results), 'failed': len(failed), 'screenshots': cs.OUT, 'results': results}
    with open(os.path.join(cs.OUT, 'report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
