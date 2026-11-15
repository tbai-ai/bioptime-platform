#!/usr/bin/env python3
"""End-to-end check of the growth module: its website pages and its admin and coach pages (Python 3.9, stdlib, Chrome).

    BASE=http://r8growth.localhost:3960 python3 -I tools/e2e_growth.py      against a scratch server

The live demo's ports (3000, 3100, 3101) are refused: the check writes records (a discovery call request, a corporate
enquiry, newsletter sign-ups, a webinar registration, a status change). E2E_OUT and E2E_CDP_PORT give a run its own
screenshot folder, Chrome profile and DevTools port. Chrome runs with no network (check_site's --offline mode: fonts
and three.js are answered from local copies, every other outside host is refused); only the scratch server is reached.

What it does:
  pages        discovery-call, package-finder, calculators, corporate and webinars at 390, 768 and 1440 px: no console
               error, no sideways scroll, one h1, the header intact, WCAG AA text contrast (1440), no demo or sample
               label, linked from the footer
  discovery    the offered times load; an empty form is held back; a request with two times is received and the page
               promises no time; the team sees it and the confirmation is in the outbox
  finder       four answers give one or two packages from GET /api/packages, each linking to checkout or a call;
               the result never shows the catalogue's note for developers ("null"); nothing is stored
  calculators  BMI, energy, water and heart-rate zones give the expected numbers and make no request
  corporate    an enquiry is received and reaches the team's list
  webinars     the public webinar is listed and a registration is received
  newsletter   the footer sign-up, the emailed confirmation link (token taken out of the address bar) and the
               unsubscribe link; with the growth module switched off the block says the sign-up isn't open
  admin        the owner signs in, finds the request under Growth, marks it contacted with a note and assigns a coach;
               corporate enquiries and the newsletter list render, and the CSV download answers text/csv
  coach        the assigned coach sees the request without the email address or phone number

Exit status 1 if anything fails. The JSON report is printed at the end.
"""
import http.cookiejar
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
import check_site as cs  # noqa: E402  (reuses the headless Chrome driver of the website checks)

cs.OUT = os.environ.get('E2E_OUT') or os.path.join(PLATFORM, '.local', 'e2e-growth')
cs.PORT_CDP = int(os.environ.get('E2E_CDP_PORT') or 9560)
cs.OFFLINE = True
BASE = os.environ.get('BASE', 'http://r8growth.localhost:3960').rstrip('/')
API_BASE = os.environ.get('API_BASE') or BASE.replace('://r8growth.localhost', '://127.0.0.1')   # urllib cannot resolve *.localhost
LIVE_PORTS = (3000, 3100, 3101)
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
STAMP = time.strftime('%Y%m%d%H%M%S')
PROSPECT = 'growth-e2e-%s@example.org' % STAMP
COMPANY_EMAIL = 'growth-e2e-team-%s@example.org' % STAMP
READER = 'growth-e2e-reader-%s@example.org' % STAMP
VISITOR = 'growth-e2e-webinar-%s@example.org' % STAMP
PAGES = ['/discovery-call', '/package-finder', '/calculators', '/corporate', '/webinars']
results = []


def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('  ok   ' if ok else '  FAIL ') + name + (' — ' + detail if detail else ''))


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


def js_str(v):
    return json.dumps(v)


def fill(b, sel, value):
    return b.js("(function(){var el=document.querySelector(%s); if(!el) return false; el.focus(); el.value=%s; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()" % (js_str(sel), js_str(value)))


def tick(b, sel, on=True):
    return b.js("(function(){var el=document.querySelector(%s); if(!el) return false; el.checked=%s; el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()" % (js_str(sel), 'true' if on else 'false'))


def click(b, sel):
    return b.js("(function(){var el=document.querySelector(%s); if(!el) return false; el.click(); return true;})()" % js_str(sel))


def text(b, sel):
    return b.js("(document.querySelector(%s)||{}).textContent||''" % js_str(sel)) or ''


# the portal pages are React: values go through the native setter so React notices (as in e2e_dashboard.py)
SET_INPUT = '''(sel, v) => { const el = document.querySelector(sel); if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }'''


def react_fill(b, sel, value):
    return b.js('(%s)(%s, %s)' % (SET_INPUT, js_str(sel), js_str(value)))


# the owner removed "demo" and "sample" labels from every screen (24 October 2026); login emails stay @demo.bioptime.test
LABEL_JS = r"""(() => { const t = document.body.innerText.replace(/[a-z0-9._+-]+@demo\.bioptime\.test/gi, '');
  const m = t.match(/\bdemo\b|\bsample\b/i); return m ? t.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ') : ''; })()"""


def page_errors(b):
    return [e for e in b.errors if 'favicon' not in e and 'ERR_ABORTED' not in e]


def resources(b):
    return b.js("performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/api/'))") or []


# ---------------------------------------------------------------- the team's side, through the API
class Api:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, raw=False):
        req = urllib.request.Request(API_BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Bioptime-Client': 'e2e'})
        with self.opener.open(req, timeout=20) as r:
            data = r.read().decode()
            return (r.status, r.headers.get('content-type', ''), data) if raw else json.loads(data or 'null')

    def sign_in_owner(self):
        code = self.call('GET', '/auth/demo/totp?email=' + urllib.parse.quote(OWNER[0]))['code']
        self.call('POST', '/auth/login', {'email': OWNER[0], 'password': OWNER[1], 'workspace': 'admin', 'mfaCode': code})

    def outbox(self, to):
        return self.call('GET', '/admin/outbox?to=' + urllib.parse.quote(to))['items']


# ---------------------------------------------------------------- browser checks
def render_pages(b):
    footer_links = None
    for path in PAGES:
        for (w, h, mobile) in ((390, 844, True), (768, 1024, True), (1440, 900, False)):
            b.viewport(w, h, mobile)
            b.open(BASE + path, settle=1.0)
            if path == '/discovery-call':
                wait(b, "!/Loading/.test(document.querySelector('#dcSlotNote').textContent)")
            if path == '/webinars':
                wait(b, "document.querySelectorAll('#webList .tile').length > 0 || !/Loading/.test(document.querySelector('#webEmpty').textContent)")
            b.scroll_through()
            name = path.strip('/') + '-%d' % w
            b.shot(name)
            overflow = b.js('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            nav = b.js('''(() => { const i = document.querySelector('.navInner'), r = document.querySelector('.navRight'); const edge = i.getBoundingClientRect().right - parseFloat(getComputedStyle(i).paddingRight); return { over: Math.round(r.getBoundingClientRect().right - edge), wrapped: [...document.querySelectorAll('.navLinks .navLink')].filter(a => a.getBoundingClientRect().height > 48).length }; })()''')
            h1 = b.js("document.querySelectorAll('h1').length")
            errs = page_errors(b)
            ok = not errs and overflow <= 0 and nav['over'] <= 0 and nav['wrapped'] == 0 and h1 == 1
            check('render: %s at %dpx' % (path, w), ok, 'errors=%s overflow=%s nav=%s h1=%s' % (errs[:3], overflow, nav, h1))
            if w == 1440:
                c = b.js(cs.CONTRAST_JS)
                check('contrast: %s (%d text nodes)' % (path, c['checked']), not c['fails'], '; '.join(c['fails'][:6]))
                hit = b.js(LABEL_JS)
                check('labels: %s has no demo or sample label' % path, not hit, hit)
                if footer_links is None:
                    footer_links = b.js("Array.from(document.querySelectorAll('.footerCol a')).map(a => a.getAttribute('href'))")
    for p in ('package-finder.html', 'discovery-call.html', 'calculators.html', 'webinars.html', 'corporate.html'):
        check('footer links to %s' % p, p in (footer_links or []), '')
    b.viewport(1440, 900)


def discovery(b, api):
    b.open(BASE + '/discovery-call', settle=1.0)
    loaded = wait(b, "document.querySelectorAll('#dcSlotList [data-slot]').length > 0")
    check('discovery: the offered times load as choices', loaded, '%s times' % b.js("document.querySelectorAll('#dcSlotList [data-slot]').length"))
    click(b, '#discoveryForm button[type=submit]')
    held = b.js("({ invalid: document.querySelectorAll('#discoveryForm .isInvalid').length, focus: document.activeElement && document.activeElement.name })")
    check('discovery: an empty form is held back with field messages, focus on the name', held['invalid'] >= 4 and held['focus'] == 'name', json.dumps(held))
    fill(b, '#dcName', 'Growth E2E Prospect')
    fill(b, '#dcEmail', PROSPECT)
    fill(b, '#dcPhone', '+91 98450 00000')
    fill(b, '#dcGoals', 'E2E check: more energy in the afternoons and a first blood test.')
    b.js("Array.from(document.querySelectorAll('#dcSlotList [data-slot]')).slice(0, 2).forEach(x => x.click())")
    pressed = b.js("document.querySelectorAll('#dcSlotList [aria-pressed=true]').length")
    check('discovery: two times chosen', pressed == 2, str(pressed))
    tick(b, '#discoveryForm [name=consent]')
    consent = b.js("document.querySelector('#discoveryForm [name=consent]').closest('label').textContent") or ''
    check('discovery: the consent says the details are deleted 180 days after the request is closed', 'deleted 180 days after the request is closed' in consent, consent[:200])
    b.shot('discovery-filled')
    click(b, '#discoveryForm button[type=submit]')
    ok = wait(b, "/We have your request/.test(document.querySelector('#discoveryForm .formStatus').textContent)")
    status = text(b, '#discoveryForm .formStatus')
    check('discovery: the request is received and the page promises no time', ok and 'nothing is booked' in status and not re.search(r'\b\d{1,2}:\d\d\b', status), status[:200])
    b.shot('discovery-done')
    items = api.call('GET', '/admin/growth/discovery-calls?status=all')['items']
    mine = [x for x in items if x['email'] == PROSPECT]
    check('discovery: the team sees the request with its two times and the phone number', len(mine) == 1 and len(mine[0]['preferredSlots']) == 2 and mine[0].get('phone') == '+919845000000', json.dumps(mine[0])[:200] if mine else 'not found')
    mail = api.outbox(PROSPECT)
    check('discovery: the confirmation email is in the outbox with the reference, no time promised', bool(mail) and mine and mine[0]['reference'] in mail[0]['body'] and 'Nothing is booked' in mail[0]['body'], (mail[0]['subject'] if mail else 'none'))
    return mine[0] if mine else None


def finder(b, api):
    before = len(api.call('GET', '/admin/growth/discovery-calls?status=all')['items'])
    packages = [p for p in api.call('GET', '/packages')['items'] if p['kind'] != 'bespoke' and p.get('version')]
    b.open(BASE + '/package-finder', settle=1.0)
    start = len(resources(b))
    for q, v in (('goal', 'steady'), ('coaching', 'regular'), ('tests', 'one'), ('budget', 'any')):
        b.js("document.querySelector('[data-question=%s] [data-value=\"%s\"]').click()" % (q, v))
    click(b, '#finderForm button[type=submit]')
    shown = wait(b, "!document.getElementById('pfResult').hidden && document.querySelectorAll('#pfCards .tile').length > 0")
    names = b.js("Array.from(document.querySelectorAll('#pfCards .tile h3')).map(h => h.textContent)") or []
    real = set(p['name'] for p in packages)
    check('finder: one or two suggestions, each a package from GET /api/packages', shown and 1 <= len(names) <= 2 and all(n in real for n in names), json.dumps(names))
    links = b.js("Array.from(document.querySelectorAll('#pfCards .tile a.btn')).map(a => a.getAttribute('href'))") or []
    slugs = {p['name']: p['slug'] for p in packages}
    good = all(re.match(r'^(checkout\.html\?package=|discovery-call\.html\?from=package-finder&packages=)[a-z0-9-]+$', l or '') for l in links) and all(slugs[n] in links[i] for i, n in enumerate(names))
    check('finder: each suggestion links to its checkout (or a call when it has no price)', bool(links) and good, json.dumps(links))
    shown_text = b.js("document.getElementById('pfResult').innerText") or ''
    check('finder: the result shows no developer note ("null") and says plainly that prices include GST', not re.search(r'\bnull\b', shown_text, re.I) and 'Package prices in rupees include GST.' in shown_text, shown_text[-220:])
    ask = b.js("document.getElementById('pfAskLink').getAttribute('href')")
    check('finder: the call link carries only the suggested packages', ask.startswith('discovery-call.html?from=package-finder&packages='), ask)
    b.shot('finder-result')
    calls = [r for r in resources(b)[start:] if '/public/discovery' in r or '/public/newsletter' in r]
    after = len(api.call('GET', '/admin/growth/discovery-calls?status=all')['items'])
    check('finder: nothing is sent or stored', not calls and after == before, '%s %s' % (calls, after - before))
    # a budget below every price: the closest package is shown and the page says so
    b.js("document.querySelector('[data-question=budget] [data-value=\"0-10000\"]').click()")
    b.pump(0.3)
    lead = text(b, '#pfResultLead')
    check('finder: after a changed answer the result still has no "null"', not re.search(r'\bnull\b', b.js("document.getElementById('pfResult').innerText") or '', re.I))
    priced = [p for p in packages if p['version'].get('forSale') and p['version'].get('priceInr') is not None]
    if priced and min(p['version']['priceInr'] for p in priced) > 10000:
        check('finder: with a budget below every price it says so and shows the closest', 'above the budget' in lead and b.js("document.querySelectorAll('#pfCards .tile').length") == 1, lead)


def calculators(b):
    b.open(BASE + '/calculators', settle=1.0)
    start = len(resources(b))
    fill(b, '#bmiWeight', '70'); fill(b, '#bmiHeight', '175'); click(b, '[data-calc=bmi] button[type=submit]')
    bmi = text(b, '[data-calc=bmi] .formStatus')
    check('calculators: BMI 70 kg, 175 cm is 22.9', '22.9' in bmi and 'not a diagnosis' in bmi, bmi[:120])
    fill(b, '#enWeight', '70'); fill(b, '#enHeight', '175'); fill(b, '#enAge', '30')
    b.js("document.getElementById('enSex').value='male'"); b.js("document.getElementById('enActivity').value='1.2'")
    click(b, '[data-calc=energy] button[type=submit]')
    energy = text(b, '[data-calc=energy] .formStatus')
    # 10×70 + 6.25×175 − 5×30 + 5 = 1648.75 → 1,650; × 1.2 = 1978.5 → 1,980
    check('calculators: Mifflin-St Jeor resting energy 1,650 and daily 1,980 kcal', '1,650' in energy and '1,980' in energy, energy[:160])
    fill(b, '#waWeight', '70'); click(b, '[data-calc=water] button[type=submit]')
    water = text(b, '[data-calc=water] .formStatus')
    check('calculators: water for 70 kg is about 2.5 litres (2,450 ml)', '2.5' in water and '2,450' in water, water[:120])
    fill(b, '#hrAge', '40'); b.js("var s=document.getElementById('hrMethod'); s.value='reserve'; s.dispatchEvent(new Event('change',{bubbles:true}))")
    fill(b, '#hrRest', '60'); click(b, '[data-calc=zones] button[type=submit]')
    zones = text(b, '[data-calc=zones] .formStatus')
    # maximum 180; reserve 120; zone 1 = 120×0.5+60 … 120×0.6+60 = 120–132
    check('calculators: heart-rate reserve zones for 40 years, resting 60 (max 180, zone 1 120–132)', '180' in zones and '120–132' in zones and 'Karvonen' in zones, zones[:200])
    fill(b, '#hrAge', '12'); click(b, '[data-calc=zones] button[type=submit]')
    check('calculators: an age outside 18 to 100 is refused beside the field', bool(text(b, '[data-calc=zones] .field.isInvalid .fieldError')), text(b, '[data-calc=zones] .field.isInvalid .fieldError'))
    b.shot('calculators-results', full=True)
    sent = resources(b)[start:]
    check('calculators: nothing is sent', not sent, json.dumps(sent))


def corporate(b, api):
    b.open(BASE + '/corporate', settle=1.0)
    fill(b, '#ceCompany', 'E2E Studio'); fill(b, '#ceName', 'Growth E2E Contact'); fill(b, '#ceEmail', COMPANY_EMAIL)
    b.js("document.getElementById('ceSize').value='11-50'")
    tick(b, '#corporateForm input[value=coaching]'); tick(b, '#corporateForm input[value=live_sessions]')
    fill(b, '#ceMessage', 'E2E check: about thirty people, looking at next year.')
    click(b, '#corporateForm button[type=submit]')
    held = b.js("Array.from(document.querySelectorAll('#corporateForm .isInvalid')).map(x => (x.querySelector('[name]') || {}).name)")
    check('corporate: without consent the form is held back, only that box marked', held == ['consent'], json.dumps(held))
    consent = b.js("document.querySelector('#corporateForm [name=consent]').closest('label').textContent") or ''
    check('corporate: the consent says the details are deleted 180 days after the request is closed', 'deleted 180 days after the request is closed' in consent, consent[:200])
    tick(b, '#corporateForm [name=consent]')
    click(b, '#corporateForm button[type=submit]')
    ok = wait(b, "/We have your enquiry/.test(document.querySelector('#corporateForm .formStatus').textContent)")
    check('corporate: the enquiry is received', ok, text(b, '#corporateForm .formStatus')[:160])
    b.shot('corporate-done')
    items = api.call('GET', '/admin/growth/corporate?status=all')['items']
    mine = [x for x in items if x['email'] == COMPANY_EMAIL]
    check('corporate: it reaches the team with its size and interests', len(mine) == 1 and mine[0]['teamSize'] == '11-50' and sorted(mine[0]['interests']) == ['coaching', 'live_sessions'], json.dumps(mine)[:200])


def webinars(b, api):
    b.open(BASE + '/webinars', settle=1.0)
    listed = wait(b, "document.querySelectorAll('#webList .tile').length > 0")
    check('webinars: the public webinar is listed from GET /api/public/webinars', listed, text(b, '#webEmpty'))
    if not listed:
        return
    wid = b.js("document.querySelector('#webList .tile').getAttribute('data-webinar')")
    click(b, '#webList .tile button[aria-controls]')
    fill(b, '#web0Name', 'Growth E2E Visitor'); fill(b, '#web0Email', VISITOR)
    click(b, '#web0 button[type=submit]')
    ok = wait(b, "/Received/.test(document.querySelector('#web0 .formStatus').textContent)")
    check('webinars: the registration is received (the place itself is told by email)', ok, text(b, '#web0 .formStatus')[:160])
    b.shot('webinars-registered')
    regs = api.call('GET', '/admin/sessions/%s/registrations' % wid)['items']
    check('webinars: the team sees the registration', any((r.get('email') or '') == VISITOR for r in regs), '%d registrations' % len(regs))


def newsletter(b, api):
    b.open(BASE + '/calculators', settle=1.0)
    fill(b, '#nlEmail', READER)
    click(b, '#newsletter button[type=submit]')
    check('newsletter: the consent box is required', b.js("!!document.querySelector('#newsletter .checkField.isInvalid')"))
    tick(b, '#newsletter [name=consent]')
    click(b, '#newsletter button[type=submit]')
    ok = wait(b, "/Almost there/.test(document.querySelector('#newsletter .formStatus').textContent)")
    check('newsletter: the footer sign-up is answered in place', ok, text(b, '#newsletter .formStatus')[:200])
    mail = api.outbox(READER)
    link = re.search(r'(https?://\S+\?newsletter=confirm&token=[A-Za-z0-9_-]+#newsletter)', mail[0]['body']) if mail else None
    check('newsletter: the confirmation email carries a link to the website', bool(link), mail[0]['subject'] if mail else 'no email')
    subs = api.call('GET', '/admin/growth/newsletter?status=pending&q=' + urllib.parse.quote(READER))['items']
    check('newsletter: the sign-up waits for confirmation', len(subs) == 1, json.dumps(subs)[:160])
    if not link:
        return
    url = link.group(1).replace('http://r8growth.localhost:3960', BASE)
    b.open(url, settle=1.5)
    shown = wait(b, "!!document.querySelector('#newsletter [data-nl=confirm]')")
    check('newsletter: the link opens the confirm step in the footer block', shown, text(b, '#newsletter .formStatus')[:160])
    click(b, '#newsletter [data-nl=confirm]')
    done = wait(b, "/subscribed/.test(document.querySelector('#newsletter .formStatus').textContent)")
    check('newsletter: confirming works and the token leaves the address bar', done and 'token' not in b.js('location.href'), b.js('location.href'))
    b.shot('newsletter-confirmed')
    mail = api.outbox(READER)
    un = None
    for m in mail:
        un = un or re.search(r'(https?://\S+\?newsletter=unsubscribe&id=[^&\s]+&token=[0-9a-f]+#newsletter)', m['body'])
    check('newsletter: confirmed, with an unsubscribe link in the welcome email', bool(un) and api.call('GET', '/admin/growth/newsletter?status=confirmed&q=' + urllib.parse.quote(READER))['items'], '')
    if un:
        b.open(un.group(1).replace('http://r8growth.localhost:3960', BASE), settle=1.5)
        click(b, '#newsletter [data-nl=unsubscribe]')
        left = wait(b, "/left the newsletter/.test(document.querySelector('#newsletter .formStatus').textContent)")
        check('newsletter: the unsubscribe link works', left and api.call('GET', '/admin/growth/newsletter?status=unsubscribed&q=' + urllib.parse.quote(READER))['items'], text(b, '#newsletter .formStatus')[:160])


def newsletter_off(b, api):
    """The footer block with the growth module switched off (switched back on at once, whatever happens)."""
    api.call('PATCH', '/admin/modules', {'key': 'growth', 'enabled': False, 'reason': 'e2e: the footer sign-up while growth is off'})
    try:
        b.open(BASE + '/calculators', settle=1.0)
        fill(b, '#nlEmail', 'r')   # starting to type: a headless page has no window focus, so focus alone fires no event
        closed = wait(b, "document.getElementById('newsletter').getAttribute('data-closed') === 'true'")
        status = text(b, '#newsletter .formStatus')
        check('newsletter: with growth switched off the block says the sign-up is not open and its fields are disabled', closed and 'isn’t open' in status and b.js("document.getElementById('nlEmail').disabled"), status[:160])
        b.shot('newsletter-off')
    finally:
        api.call('PATCH', '/admin/modules', {'key': 'growth', 'enabled': True, 'reason': 'e2e: growth on again'})
    b.open(BASE + '/calculators', settle=1.0)
    fill(b, '#nlEmail', 'r')
    b.pump(1.0)
    check('newsletter: with growth on, the block stays open after the first focus', not b.js("document.getElementById('newsletter').hasAttribute('data-closed')") and not b.js("document.getElementById('nlEmail').disabled"))


def sign_in(b, creds, ws, mfa=False):
    b.open(BASE + '/login/' + ws, settle=1.0)
    wait(b, "!!document.querySelector('input[type=email]')")
    react_fill(b, 'input[type=email]', creds[0]); react_fill(b, 'input[type=password]', creds[1])
    b.js("document.querySelector('form').requestSubmit()")
    if mfa:
        wait(b, "!!document.querySelector('input[autocomplete=one-time-code]')")
        code = b.js("fetch('/api/auth/demo/totp?email=' + encodeURIComponent(%s)).then(r => r.json()).then(j => j.code)" % js_str(creds[0]))
        react_fill(b, 'input[autocomplete=one-time-code]', code)
        b.js("document.querySelector('form').requestSubmit()")
    arrived = wait(b, "location.pathname.startsWith('/%s') && !!document.querySelector('nav.side')" % ws, 15)
    check('signed in to the %s workspace as %s' % (ws, creds[0]), arrived, str(b.js('location.pathname')))
    return arrived


def sign_out(b):
    b.js("fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers: {'X-Bioptime-Client': 'e2e'}}).then(r => r.status)")
    b.js("document.cookie = 'bp_signed_in=; Max-Age=0; path=/'; true")


def admin(b, api, call):
    sign_out(b)
    if not sign_in(b, OWNER, 'admin', mfa=True):
        return
    nav = b.js("Array.from(document.querySelectorAll('nav.side .section')).map(s => s.textContent)") or []
    links = b.js("Array.from(document.querySelectorAll('nav.side a')).map(a => a.textContent.trim())") or []
    check('admin: a Growth heading with its three pages in the navigation', 'Growth' in nav and all(x in links for x in ('Discovery calls', 'Corporate enquiries', 'Newsletter')), json.dumps([nav, links[-6:]]))
    b.open(BASE + '/admin', settle=1.5)
    wait(b, "/From the website/.test(document.body.textContent)", 10)
    check('admin: the Overview has the Growth card', b.js("/From the website/.test(document.body.textContent)"))
    b.open(BASE + '/admin/growth/discovery-calls', settle=1.5)
    listed = wait(b, "document.body.textContent.includes(%s)" % js_str(call['reference'] if call else 'DC-'))
    check('admin: the request is listed under Discovery calls', listed and not page_errors(b), '; '.join(page_errors(b)[:2]))
    hit = b.js(LABEL_JS)
    check('admin: no demo or sample label on Discovery calls', not hit, hit)
    b.shot('admin-discovery-list')
    b.js("Array.from(document.querySelectorAll('[role=tab]')).find(t => /Offered times/.test(t.textContent)).click()")
    check('admin: the offered times tab lists the times', wait(b, "document.querySelectorAll('table tbody tr').length > 0"))
    if not call:
        return
    b.open(BASE + '/admin/growth/discovery-calls/' + call['id'], settle=1.5)
    wait(b, "!!document.querySelector('select')")
    coach_id = next(p['id'] for p in api.call('GET', '/admin/growth/assignees')['items'] if p['role'] == 'coach' and p['name'].startswith('Asha'))
    # the detail page's fields are found by their labels and set through the native setter, so React notices
    b.js("""(() => { const set = (label, v) => { const el = Array.from(document.querySelectorAll('.bp-field')).find(f => f.textContent.startsWith(label)).querySelector('select, textarea');
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
      set('Status', 'contacted'); set('Handled by', %s); set('Note', 'E2E check: emailed two evening options.'); return true; })()""" % js_str(coach_id))
    b.pump(0.3)
    b.js("Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Save').click()")
    saved = wait(b, "document.body.textContent.includes('E2E check: emailed two evening options.')")
    after = api.call('GET', '/admin/growth/discovery-calls/' + call['id'])
    check('admin: marked contacted, assigned to a coach, with the note', saved and after['status'] == 'contacted' and (after.get('assignedTo') or {}).get('id') == coach_id and any('emailed two evening' in n['body'] for n in after['notes']), json.dumps({k: after.get(k) for k in ('status', 'assignedTo')})[:200])
    b.shot('admin-discovery-detail')
    b.open(BASE + '/admin/growth/corporate', settle=1.5)
    check('admin: Corporate enquiries lists the enquiry', wait(b, "document.body.textContent.includes('E2E Studio')") and not page_errors(b), '; '.join(page_errors(b)[:2]))
    b.shot('admin-corporate')
    b.open(BASE + '/admin/growth/newsletter', settle=1.5)
    check('admin: the Newsletter page renders its counts and list', wait(b, "/Waiting to confirm/.test(document.body.textContent) && document.querySelectorAll('table tbody tr').length > 0") and not page_errors(b), '; '.join(page_errors(b)[:2]))
    csv = b.js("fetch(document.querySelector('a[download]').getAttribute('href'), {credentials: 'include'}).then(r => r.status + ' ' + r.headers.get('content-type') + ' ' + r.headers.get('content-disposition'))")
    check('admin: the CSV download answers text/csv as an attachment', csv.startswith('200 text/csv') and 'attachment' in csv, csv)
    hit = b.js(LABEL_JS)
    check('admin: no demo or sample label on the Newsletter page', not hit, hit)
    b.shot('admin-newsletter')
    b.viewport(390, 844, True)
    b.open(BASE + '/admin/growth/discovery-calls', settle=1.5)
    check('admin: Discovery calls has no sideways scroll at 390px', b.js('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'scrollWidth %s' % b.js('document.documentElement.scrollWidth'))
    b.viewport(1440, 900)
    sign_out(b)


def coach(b, call):
    if not call or not sign_in(b, COACH, 'coach'):
        return
    b.open(BASE + '/coach/discovery-calls', settle=1.5)
    shown = wait(b, "document.body.textContent.includes(%s)" % js_str(call['reference']))
    body = b.js('document.body.innerText') or ''
    check('coach: the assigned request is shown with the name and goals', shown and 'Growth E2E Prospect' in body and 'more energy in the afternoons' in body)
    check('coach: no email address or phone number of the prospect', PROSPECT not in body and '9845000000' not in body and '98450 00000' not in body)
    b.shot('coach-discovery')
    sign_out(b)


def main():
    port = urllib.parse.urlsplit(BASE).port
    if port in LIVE_PORTS:
        print('refusing to run against the live demo port %s: this check writes records' % port)
        sys.exit(2)
    os.makedirs(cs.OUT, exist_ok=True)
    api = Api()
    api.sign_in_owner()
    flags = api.call('GET', '/public/config')['features']
    check('the growth, sessions and public_webinars switches are on in this scratch copy', all(f in flags for f in ('growth', 'sessions', 'public_webinars')), json.dumps([f for f in flags if f in ('growth', 'sessions', 'public_webinars')]))
    b = cs.Browser()
    b.viewport(1440, 900)
    call = None
    try:
        b.open(BASE + '/login/client', settle=0.8)   # a signed-out browser: the Chrome profile keeps cookies between runs
        sign_out(b)
        render_pages(b)
        call = discovery(b, api)
        finder(b, api)
        calculators(b)
        corporate(b, api)
        webinars(b, api)
        newsletter(b, api)
        newsletter_off(b, api)
        admin(b, api, call)
        coach(b, call)
    except Exception as e:  # noqa: BLE001
        check('run finished without an exception', False, repr(e)[:300])
    finally:
        b.close()
    check('offline: nothing outside this machine was asked for that could not be answered locally', not b.offline_refused, str(sorted(set(b.offline_refused))[:6]))
    failed = [r for r in results if not r['ok']]
    report = {'base': BASE, 'checks': len(results), 'failed': len(failed), 'screenshots': cs.OUT, 'failures': failed}
    with open(os.path.join(cs.OUT, 'report.json'), 'w') as f:
        json.dump({'results': results, 'summary': report}, f, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'failures'}))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
