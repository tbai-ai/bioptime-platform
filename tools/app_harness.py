#!/usr/bin/env python3
"""Drive the Bioptime app (apps/mobile, its Expo web build) in headless Chrome: the shared part of tools/e2e_app.py and of
the per-workspace files the next phase adds (tools/e2e_app_coach.py, tools/e2e_app_admin.py). Python 3.9, stdlib only,
plus the Chrome DevTools driver of the website checks (~/Desktop/drive/tools/check_site.py, as the other e2e_*.py use it).

    import app_harness as ah
    ah.configure(out='/tmp/e2e-app', cdp_port=9580)              # screenshots, report and Chrome profile; DevTools port
    expo = ah.ExpoWeb(port=8121, api_base='http://127.0.0.1:4121').start()   # own process group; waits until it answers
    app = ah.App(ah.start_browser(), base='http://127.0.0.1:4121', app_url=expo.url)   # Chrome on that DevTools port
    app.boot()                                                   # first load: Expo bundles the first route, slowly
    app.sign_in('member', 'priya.nair@demo.bioptime.test', 'Demo-Member-2026!')
    app.open_route('/(tabs)/plan', expect='Package')             # in-app navigation: the session lives in memory on the web
    app.click_text('Open the plan'); app.type_into('Email', 'x@y.test'); app.screenshot('plan')
    app.sign_out(); app.close(); expo.stop()

What the app renders on the web (React Native Web, read from the DOM on 29 October 2026; the client app's redesign of
30 October 2026 noted where it differs):
  - The client app's tab bar is a floating pill of nine icon-only tabs (Home, Train, Bio, Life, Fuel, Coach, Tests,
    Store, Profile): <div role="tab" aria-label="Home" aria-selected> with no text, inside role="tablist"; tabs() reads
    the aria-label where a tab has no text. Its edge chevrons are decoration (aria-hidden), never a control.
  - While an overlay or a sheet is open, the screen behind it stays in the DOM marked aria-hidden="true": visible_text()
    reads only what is not hidden that way (text() reads the whole page, the screen behind included).
  - The member's Home greets with an eyebrow ("Good morning", upper-cased by CSS: regexes are case-insensitive) above the
    first name; Profile (tab 9) holds what Me held, Sign out under its Settings sub-tab (?tab=settings).
  - Button and Pressable → <button role="button"> / <div role="button">; Link → <a role="link" href>; the tab bar → <a role="tab">;
    Check → <div role="checkbox"> without aria-checked (its state is read from the tick glyph); a Text with onPress → a
    plain div or span. innerText carries the icon glyphs (private-use code points) next to the tab titles, so matching
    strips them.
  - Field renders its label as a text element immediately before the input (ui.tsx Field), SearchBar sets the placeholder
    and the same aria-label (workspace.tsx), so inputs are found by aria-label, placeholder, or the label text before them.
  - Setting an input's value through the prototype setter and dispatching 'input' reaches React Native Web's onChangeText.
  - The bearer token is kept by expo-secure-store, which has no web implementation, so it lives in memory only: a full page
    load signs the person out. Screens are therefore opened with history.pushState + a popstate event, which expo-router
    follows (group segments such as /(tabs)/plan are accepted and dropped from the address bar). Metro bundles a screen the
    first time it is opened ("Bundling…"), so waits are generous.
  - Alert.alert on the web is window.confirm / window.alert (lib/alert.ts): the harness answers every dialog and replaces
    confirm with an accepting stub before Sign out.

Which app the Expo server builds: the client app by default (apps/mobile src/lib/config STAFF_APP off: one sign-in, no
chooser, no coach or administrator screen), the staff build with APP_STAFF=1 (EXPO_PUBLIC_STAFF_APP=1: the three doors,
the coach workspace and the administrative portal, as before). ExpoWeb passes EXPO_PUBLIC_STAFF_APP=1 or 0 to Expo, so
the shell's own value never decides it; the per-workspace files (tools/e2e_app_<group>.py) set APP_STAFF=1 themselves.
With APP_URL (an Expo server already running) the caller must start that server with the matching flag; App.sign_in
names the mismatch when a staff sign-in leads to the client sign-in.

Nothing here is a credential: every account comes from the caller, and the demo-only helpers (GET /auth/demo/totp,
POST /auth/demo/phone-code) exist only on a demo server (BIOPTIME_MODE=demo) and are asked for, never hard-coded.
Live-demo guard: the ports 3000, 3100, 3101 and 8081 are refused for the API and for the Expo server alike.

The link relay (apps/mobile src/lib/linkRelay, builds made with EXPO_PUBLIC_LINK_RELAY_TOPIC): ExpoWeb always passes
EXPO_PUBLIC_LINK_RELAY_TOPIC and EXPO_PUBLIC_LINK_RELAY_BASE, empty unless the caller gives them (extra_env), so a value
in the shell never reaches a test build. RelayStandIn answers like ntfy's /<topic>/json?poll=1 on a local port, and
App.route_quick_tunnels() answers the page's requests to https://<name>.trycloudflare.com inside Chrome (Fetch
interception) from the scratch API, so a check never posts to or reads the real relay, and with a no-network Chrome
(start_browser(no_network=True)) nothing leaves this machine."""
import base64
import http.client
import http.server
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLATFORM = os.path.dirname(HERE)
MOBILE_DIR = os.path.join(PLATFORM, 'apps', 'mobile')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(PLATFORM)), 'drive', 'tools'))
import check_site as cs  # noqa: E402  (the headless Chrome driver of the website checks)

LIVE_PORTS = (3000, 3100, 3101, 8081)   # the owner's live demo (API, portal, website) and its Expo dev server: never touched
LOCAL_HOSTS = ('127.0.0.1', 'localhost', '::1')
RESULTS = []                              # every check() and skip() of the run, in order
Browser = cs.Browser                      # re-exported so callers need only this module


# ---------------------------------------------------------------- configuration, refusals, reporting
def staff_app():
    """True when this run drives the staff build (APP_STAFF=1): the chooser, the coach and administrator sign-ins and
    workspaces. False (the default): the client app."""
    return os.environ.get('APP_STAFF', '').strip() == '1'


def configure(out=None, cdp_port=None):
    """Where screenshots, report.json and the Chrome profile go, and the DevTools port of the Chrome this run starts
    (parallel runs need their own of both, as the other e2e scripts do with E2E_OUT and E2E_CDP_PORT)."""
    if out:
        cs.OUT = out
    if cdp_port:
        cs.PORT_CDP = int(cdp_port)
    os.makedirs(cs.OUT, exist_ok=True)
    return cs.OUT


def live_refusal(base):
    """Why BASE (the API) must not be used, or None: a scratch server has an explicit port that is not the live demo's,
    on 127.0.0.1, localhost, [::1], *.localhost or *.test; anything else (a tunnel host, no port) is refused."""
    u = urllib.parse.urlsplit(base)
    host = (u.hostname or '').lower()
    try:
        port = u.port
    except ValueError:
        return 'its port is not a number'
    if u.scheme not in ('http', 'https'):
        return 'it is not an http(s) address'
    if port is None:
        return 'it names no port; scratch servers always run on an explicit port'
    if port in LIVE_PORTS:
        return 'port %s belongs to the live demo' % port
    if not (host in LOCAL_HOSTS or host.endswith('.localhost') or host.endswith('.test')):
        return 'host %s is not a local scratch server (127.0.0.1, localhost, *.localhost or *.test)' % (host or '(none)')
    return None


def port_refusal(port):
    """Why an Expo web port must not be used, or None."""
    try:
        port = int(port)
    except (TypeError, ValueError):
        return 'it is not a number'
    if port in LIVE_PORTS:
        return 'port %s belongs to the live demo' % port
    if not 1024 <= port <= 65535:
        return 'port %s is outside 1024-65535' % port
    return None


def port_in_use(port, host='127.0.0.1'):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        return s.connect_ex((host, int(port))) == 0
    finally:
        s.close()


def cdp_refusal(port):
    """Why the DevTools port of this run's Chrome cannot be used, or None: another process already answers there (a
    server, or the Chrome of a parallel run), so the Chrome started here could never be reached."""
    why = port_refusal(port)
    if why:
        return why
    if port_in_use(port):
        return 'port %s is already in use (another run\'s Chrome, or a server); choose another E2E_CDP_PORT' % port
    return None


def start_browser(no_network=False):
    """check_site.Browser on the configured DevTools port (cs.PORT_CDP). Browser.__init__ starts Chrome and then polls
    the port; when the port never answers it raises and would leave that Chrome running, so the half-made object's
    process is stopped here before the error goes on. no_network=True starts that Chrome unable to resolve any host
    but loopback (check_site.no_network_flags): requests answered through Fetch interception still work."""
    b = cs.Browser.__new__(cs.Browser)
    before = cs.NO_NETWORK
    cs.NO_NETWORK = bool(no_network) or before
    try:
        b.__init__()
    except BaseException:
        proc = getattr(b, 'proc', None)
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
        raise
    finally:
        cs.NO_NETWORK = before
    return b


def free_port():
    """A local port nothing listens on (for an address that must not answer), never one of the live demo's."""
    while True:
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
        s.close()
        if port not in LIVE_PORTS:
            return port


class RelayStandIn:
    """A local stand-in for the link relay (ntfy): GET /<topic>/json?poll=1&since=12h answers the messages set with
    publish() as one JSON object per line, as ntfy does; anything else is 404. Every request line is kept in `seen`.
    Runs in a thread of this process on 127.0.0.1:<port>; stop() closes it."""

    def __init__(self, port, topic):
        why = port_refusal(port)
        if why:
            raise ValueError('Refusing relay stand-in port %s: %s' % (port, why))
        self.port, self.topic = int(port), topic
        self.base = 'http://127.0.0.1:%d' % self.port
        self.messages = []
        self.seen = []
        self.last_poll = None       # time.monotonic() of the last poll
        stand_in = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                stand_in.seen.append('GET ' + self.path)
                u = urllib.parse.urlsplit(self.path)
                q = urllib.parse.parse_qs(u.query)
                if u.path == '/%s/json' % stand_in.topic and q.get('poll') == ['1']:
                    stand_in.last_poll = time.monotonic()
                    body = ''.join(json.dumps(m) + '\n' for m in stand_in.messages).encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
                else:
                    body = b'{"code":40401,"http":404,"error":"page not found"}'
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                stand_in.seen.append('POST ' + self.path)
                self.send_response(405)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def publish(self, text, age_seconds=0, event='message'):
        """Add a message as the relay would hold it, `age_seconds` old."""
        t = int(time.time()) - int(age_seconds)
        self.messages.append({'id': 'm%d' % len(self.messages), 'time': t, 'expires': t + 43200, 'event': event, 'topic': self.topic, 'message': text})

    def polls(self):
        return [s for s in self.seen if s.startswith('GET /%s/json' % self.topic)]

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def check(name, ok, detail=''):
    """One PASS/FAIL line, as the other e2e scripts print them. A long detail (a screen's text) is kept in the report
    and printed only when the check fails."""
    detail = re.sub(r'\s+', ' ', str(detail or '')).strip()
    RESULTS.append({'check': name, 'ok': bool(ok), 'detail': detail})
    shown = detail if (detail and (not ok or len(detail) <= 80)) else ''
    print(('  ok   ' if ok else '  FAIL ') + name + (' — ' + shown if shown else ''))
    return bool(ok)


def skip(name, why):
    """A check that cannot run on this tree (a screen the next phase builds): reported, never counted as a failure."""
    RESULTS.append({'check': name, 'ok': True, 'skipped': True, 'detail': why})
    print('  skip ' + name + ' — ' + why)


def write_report(extra=None):
    """report.json next to the screenshots; returns the summary that the scripts print as their last line."""
    failed = [r for r in RESULTS if not r['ok']]
    skipped = [r for r in RESULTS if r.get('skipped')]
    report = dict(extra or {})
    report.update({'checks': len(RESULTS), 'failed': len(failed), 'skipped': len(skipped), 'screenshots': cs.OUT, 'results': RESULTS})
    os.makedirs(cs.OUT, exist_ok=True)
    with open(os.path.join(cs.OUT, 'report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    return {k: v for k, v in report.items() if k != 'results'}


# ---------------------------------------------------------------- the API from Python (ids for screens, demo helpers)
def api(base, method, path, body=None, token=None, headers=None, timeout=20):
    """One JSON call to the scratch API as the mobile client. Returns (status, json_or_text, headers)."""
    h = {'Accept': 'application/json', 'X-Bioptime-Client': 'mobile'}
    if token:
        h['Authorization'] = 'Bearer ' + token
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(base.rstrip('/') + '/api' + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            status, hdrs = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        status, hdrs = e.code, dict(e.headers)
    try:
        return status, json.loads(raw.decode() or 'null'), hdrs
    except ValueError:
        return status, raw.decode(errors='replace'), hdrs


class ApiSession:
    """A signed-in mobile session from Python, for reading ids (which report, which booking) a screen needs. One
    POST /auth/login per session: the sign-in rate limit is about 20 per 10 minutes per server, shared with the app."""

    def __init__(self, base):
        self.base = base.rstrip('/')
        self.token = None
        self.user = None

    def login(self, email, password, workspace='member', mfa_code=None):
        body = {'email': email, 'password': password, 'workspace': workspace}
        if mfa_code:
            body['mfaCode'] = mfa_code
        status, j, _ = api(self.base, 'POST', '/auth/login', body)
        if status != 200:
            raise RuntimeError('sign-in as %s failed: %s %s' % (email, status, json.dumps(j)[:200]))
        self.token = j['session']['token']
        self.user = j['user']
        return self

    def get(self, path):
        status, j, _ = api(self.base, 'GET', path, token=self.token)
        if status != 200:
            raise RuntimeError('GET %s: %s %s' % (path, status, json.dumps(j)[:200]))
        return j

    def post(self, path, body=None):
        status, j, _ = api(self.base, 'POST', path, body or {}, token=self.token)
        if status >= 300:
            raise RuntimeError('POST %s: %s %s' % (path, status, json.dumps(j)[:200]))
        return j

    def logout(self):
        if self.token:
            api(self.base, 'POST', '/auth/logout', {}, token=self.token)
            self.token = None

    def first_id(self, path, keys=('items',)):
        """The id of the first record a list endpoint returns ({items: [...]}, a bare list, or a named key), or None."""
        try:
            j = self.get(path)
        except RuntimeError:
            return None
        rows = j if isinstance(j, list) else next((j[k] for k in keys if isinstance(j, dict) and isinstance(j.get(k), list)), [])
        for row in rows:
            if isinstance(row, dict) and row.get('id'):
                return str(row['id'])
        return None


def demo_totp(base, email):
    """The current authenticator code of a seeded privileged account: GET /auth/demo/totp exists only on a demo server."""
    status, j, _ = api(base, 'GET', '/auth/demo/totp?email=' + urllib.parse.quote(email))
    if status != 200 or not isinstance(j, dict) or not j.get('code'):
        raise RuntimeError('GET /auth/demo/totp answered %s (%s): the preview code exists only on a demo server' % (status, json.dumps(j)[:120]))
    return j['code']


def cors_allows(base, origin):
    """Whether the API answers a browser request from the app's origin (CORS_ORIGINS or PUBLIC_ORIGIN in apps/api/src/config.ts)."""
    status, _, hdrs = api(base, 'GET', '/public/config', headers={'Origin': origin})
    allowed = {k.lower(): v for k, v in hdrs.items()}.get('access-control-allow-origin', '')
    return status == 200 and allowed in (origin, '*')


# ---------------------------------------------------------------- the Expo web server
class ExpoWeb:
    """`npx expo start --web --port <port> --clear` for apps/mobile (or a copy of it: app_dir), in its own process group,
    with CI=1 (no file watching, no interactive prompts), BROWSER=none, EXPO_PUBLIC_API_BASE=<api_base> and
    EXPO_PUBLIC_STAFF_APP=1 for the staff build (staff=True, or APP_STAFF=1 when staff is None), else 0 (the client app).
    The flag is inlined into the bundle, so a server keeps the build it started with (--clear drops Metro's cache).
    start() waits until the page answers; a Metro error page (a route file that does not resolve) is reported with its
    message. stop() signals the whole group it started and nothing else."""

    def __init__(self, port, api_base, app_dir=None, log=None, clear=True, staff=None, extra_env=None):
        why = port_refusal(port)
        if why:
            raise ValueError('Refusing Expo web port %s: %s' % (port, why))
        self.port = int(port)
        self.api_base = api_base.rstrip('/')
        self.app_dir = app_dir or MOBILE_DIR
        self.log_path = log or os.path.join(cs.OUT, 'expo-web.log')
        self.clear = clear
        self.staff = staff_app() if staff is None else bool(staff)
        self.extra_env = dict(extra_env or {})
        self.proc = None
        self.url = 'http://localhost:%d' % self.port   # localhost for the app and the API alike, so their origins agree
        self.started_in = None

    def start(self, timeout=300):
        if port_in_use(self.port):
            raise RuntimeError('port %d is already in use: stop that server, choose another APP_PORT, or pass APP_URL to drive the running one' % self.port)
        if not os.path.exists(os.path.join(self.app_dir, 'package.json')):
            raise RuntimeError('no app at %s' % self.app_dir)
        env = dict(os.environ, CI='1', BROWSER='none', EXPO_PUBLIC_API_BASE=self.api_base, EXPO_PUBLIC_STAFF_APP='1' if self.staff else '0',
                   EXPO_PUBLIC_LINK_RELAY_TOPIC='', EXPO_PUBLIC_LINK_RELAY_BASE='')
        env.update(self.extra_env)
        cmd = ['npx', 'expo', 'start', '--web', '--port', str(self.port)] + (['--clear'] if self.clear else [])
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        self.log = open(self.log_path, 'ab')
        t0 = time.monotonic()
        self.proc = subprocess.Popen(cmd, cwd=self.app_dir, env=env, stdout=self.log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        deadline = t0 + timeout
        last = ''
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError('expo start exited with %s; see %s' % (self.proc.returncode, self.log_path))
            try:
                with urllib.request.urlopen(self.url + '/', timeout=10) as r:
                    body = r.read().decode(errors='replace')
                    if r.status == 200 and 'id="root"' in body and '_expo-static-error' not in body:
                        self.started_in = time.monotonic() - t0
                        return self
                    last = 'answered %s' % r.status
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors='replace')
                err = self.static_error(body)
                if err:
                    self.stop()
                    raise RuntimeError('Expo web cannot render the app: ' + err)
                last = 'answered %s' % e.code
            except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
                last = str(e)
            time.sleep(1.0)
        self.stop()
        raise RuntimeError('Expo web did not answer on %s within %ss (%s); see %s' % (self.url, timeout, last, self.log_path))

    @staticmethod
    def static_error(body):
        """The message of the error page Expo serves when a route cannot be bundled (a missing route file)."""
        m = re.search(r'<script id="_expo-static-error" type="application/json">(.*?)</script>', body, re.S)
        if not m:
            return None
        try:
            logs = json.loads(m.group(1)).get('logs', [])
            msg = logs[0]['message']['content'] if logs else 'unknown'
        except (ValueError, KeyError, TypeError, IndexError):
            msg = m.group(1)[:300]
        return str(msg).split('\n')[0][:400]

    def tail(self, lines=20):
        try:
            with open(self.log_path, 'rb') as f:
                return b''.join(f.readlines()[-lines:]).decode(errors='replace')
        except OSError:
            return ''

    def stop(self, seconds=10):
        """SIGTERM the process group this object started (npx, expo and Metro), SIGKILL what remains after `seconds`."""
        if not self.proc:
            return
        pgid = self.proc.pid   # start_new_session: the child's pid is its group id
        for sig, wait in ((signal.SIGTERM, seconds), (signal.SIGKILL, 5)):
            try:
                os.killpg(pgid, sig)
            except ProcessLookupError:
                break
            end = time.monotonic() + wait
            while time.monotonic() < end and self.proc.poll() is None:
                time.sleep(0.2)
            if self.proc.poll() is not None:
                break
        try:
            self.log.close()
        except Exception:
            pass
        self.proc = None


# ---------------------------------------------------------------- the app in the browser
# matching helpers shared by the JS below: whitespace collapsed, icon glyphs (private-use code points) removed
_NORM = "const norm = (s) => (s || '').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g, ' ').trim();"

FIND_CLICKABLE = r'''(text, exact) => { %s
  const t = norm(text), tl = t.toLowerCase();
  const hidden = (e) => !!e.closest('[aria-hidden="true"]');
  const matches = (e) => { const own = norm(e.innerText || e.textContent); const al = norm(e.getAttribute('aria-label'));
    return exact ? (own === t || al === t) : (own.toLowerCase().includes(tl) || al.toLowerCase().includes(tl)); };
  const shortest = (m) => m.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)[0] || null; // the innermost: a card is pressable too
  const pick = (list) => { const m = list.filter(matches); return shortest(m.filter((e) => !hidden(e))) || shortest(m); };
  let el = pick(Array.from(document.querySelectorAll('[role=button],[role=link],[role=tab],[role=checkbox],[role=menuitem],[role=switch],a,button')));
  if (!el) { // a Text with onPress (a link inside a sentence): the innermost element whose text is exactly the words
    const all = Array.from(document.querySelectorAll('div[dir=auto],span')).filter((e) => norm(e.innerText) === t && !hidden(e));
    el = all.length ? all[all.length - 1] : null; }
  return el; }''' % _NORM

FIND_INPUT = r'''(label) => { %s
  const t = norm(label);
  const inputs = Array.from(document.querySelectorAll('input,textarea')).filter((e) => e.type !== 'hidden');
  const shown = inputs.filter((e) => !e.closest('[aria-hidden="true"]'));
  const prev = (e) => { const a = e.previousElementSibling, b = e.parentElement && e.parentElement.previousElementSibling; return [a, b].filter(Boolean).map((x) => norm(x.innerText)); };
  const by = (list, f) => list.find(f) || null;
  for (const list of [shown, inputs]) {
    const el = by(list, (e) => norm(e.getAttribute('aria-label')) === t || norm(e.placeholder) === t)
      || by(list, (e) => prev(e).includes(t))
      || by(list, (e) => prev(e).some((p) => p.startsWith(t)));
    if (el) return el; }
  return null; }''' % _NORM

SET_VALUE = r'''(el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; }'''

# The owner removed the words "demo" and "sample" from every screen except the small "simulated" notes on payment and
# laboratory screens (the same rule as tools/e2e_dashboard.py): the sign-in emails (@demo.bioptime.test) and "sample"
# meaning the blood sample are set aside before looking. A no-break space (the app keeps a short word with its
# neighbour on one line with it: 'Sample on its way') reads as the space it is.
LABEL_JS = r"""(() => { const t = document.body.innerText.replace(/\u00a0/g, ' ').replace(/[a-z0-9._+-]+@demo\.bioptime\.test/gi, '')
  .replace(/\b(home|blood|your|the|no) sample\b|\bsample (is )?(collected|collection|on its way|drop-off|processed|rejected)\b|processing your sample/gi, '');
  const m = t.match(/\bdemo\b|\bsample\b|\(demo\)/i); return m ? t.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ') : ''; })()"""

# console noise of a development bundle that says nothing about the app
IGNORED_ERRORS = ('favicon', 'Download the React DevTools', 'React DevTools')
# a clip or poster request that navigation (leaving the player, a card scrolled away) cancels: Chrome logs it as a failed
# load, which says nothing about the app; any other failure, of these files included, still counts
MEDIA_ABORTED = re.compile(r'net::ERR_ABORTED.*?/api/public/media/|/api/public/media/.*?net::ERR_ABORTED')

SIGN_IN_ROUTES = {'member': '/(auth)/sign-in', 'coach': '/(auth)/coach-sign-in', 'admin': '/(auth)/admin-sign-in'}
SIGN_IN_BUTTON = {'member': 'Sign in', 'coach': 'Sign in to the workspace', 'admin': 'Continue'}
# the member's Home: the greeting eyebrow above the first name (sign_in() also waits for that name, see HOME_NAME)
HOME_TEXT = {'member': r'^Good (morning|afternoon|evening|night)$', 'coach': r'^Today\b|^Today,', 'admin': r'^Overview\b'}
SIGN_OUT_ROUTES = {'member': '/(tabs)/profile?tab=settings', 'coach': '/(coach)/more', 'admin': '/(admin)/more'}
MEMBER_TAB_LABELS = ['Home', 'Train', 'Bio', 'Life', 'Fuel', 'Coach', 'Tests', 'Store', 'Profile']
SIGN_IN_SCREEN = r'Forgotten your password\?|Three doors, one Bioptime'
NO_SUCH_SCREEN = r'No such screen|Unmatched Route'
# the client app's answer to a coach or an administrator on its sign-in (apps/mobile src/lib/auth.tsx CLIENTS_ONLY)
CLIENTS_ONLY = 'This app is for Bioptime clients. Coaches sign in at bioptime.com/coach and the Bioptime team at bioptime.com/admin.'
# what only a staff screen or a staff sign-in draws: in the client app none of it may appear, even for a moment. The
# native stack's default header title of a plain coach/admin screen is its route name ('admin/users/index').
STAFF_SCREEN_TEXT = (r'Three doors, one Bioptime|^Coach workspace$|^Administrative portal$|Sign in as a coach|Sign in as an administrator|'
                     r'Sign in to the workspace|^Authenticator code$|Not available for your account|^Go to your workspace$|^Permission needed$|'
                     r'^Users and permissions$|^Reports to review$|^Members$|^(coach|admin)/[\w\[\]/-]+$')
STAFF_API = r'/api/(coach|admin)(/|\?|$)'   # the coach and administrator endpoints a staff screen asks for on opening
QUICK_TUNNEL_URL = re.compile(r'^(https://[a-z0-9-]+\.trycloudflare\.com)(?:[/?#]|$)')   # App.route_quick_tunnels
# App.watch_text: records the lines matching a regex on every DOM change (observes the document, so it can be installed
# before the page has a body)
WATCH_JS = r"""(() => { const rx = new RegExp(%s, 'im'); window.__bpSeen = [];
  const look = () => { const b = document.body; if (!b) return;
    for (const line of (b.innerText || '').split('\n')) { const l = line.replace(/[\ue000-\uf8ff]/g, '').trim();
      if (l && rx.test(l) && !window.__bpSeen.includes(l)) window.__bpSeen.push(l); } };
  if (window.__bpObs) window.__bpObs.disconnect();
  window.__bpObs = new MutationObserver(look); window.__bpObs.observe(document, { subtree: true, childList: true, characterData: true });
  look(); return true; })()"""


# the text a person can see: every text node whose element is not hidden (display, visibility, opacity 0, or inside
# aria-hidden="true": the screen behind an overlay or a sheet), one line per element, icon glyphs removed
VISIBLE_TEXT_JS = r"""(() => { const out = []; const seen = new Set();
  const hidden = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true;
      const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return true; } return false; };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) { const el = tw.currentNode.parentElement; if (!el || seen.has(el) || !tw.currentNode.textContent.trim()) continue;
    seen.add(el); if (hidden(el)) continue;
    const t = (el.innerText || el.textContent || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
  return out.join('\n'); })()"""

# BUILD_PLAN §8.4 L1: what a screen at one scroll position must not do. Returns {sw, iw, texts, overlaps, cut, small,
# smallKey}: the page's scroll width against the window's (no sideways scroll); pairs of visible text boxes that
# intersect by more than 2 x 2 px (one not inside the other) where nothing opaque lies between them (a pinned header
# covers what scrolls under it; the hit stack is read with every element hit-testable for that moment); text cut
# sideways without an ellipsis; controls under 24 x 24 (WCAG 2.2), and tabs, Close and Back under 44 x 44. Only what
# is on the screen counts: boxes are clipped by every scrolling or clipping ancestor and by the window.
LAYOUT_AUDIT_JS = r"""(() => {
  const W = innerWidth, H = innerHeight;
  const norm = (s) => (s || '').replace(/[-]/g, '').replace(/\s+/g, ' ').trim();
  const csCache = new Map();
  const cs = (e) => { let c = csCache.get(e); if (!c) { c = getComputedStyle(e); csCache.set(e, c); } return c; };
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const hiddenUp = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true;
      const c = cs(e); if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) < 0.05) return true; } return false; };
  const clip = (el, r) => { let x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, W), y1 = Math.min(r.bottom, H);
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const c = cs(e);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const b = e.getBoundingClientRect();
        if (c.overflowX !== 'visible') { x0 = Math.max(x0, b.left); x1 = Math.min(x1, b.right); }
        if (c.overflowY !== 'visible') { y0 = Math.max(y0, b.top); y1 = Math.min(y1, b.bottom); } }
      if (c.position === 'fixed') break; }
    return x1 - x0 > 1 && y1 - y0 > 1 ? { left: x0, top: y0, right: x1, bottom: y1 } : null; };
  const leaves = Array.from(document.querySelectorAll('div,span,a,button,h1,h2,h3,p,label')).filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) && !hiddenUp(e));
  const boxes = [];
  for (const e of leaves) { const rg = document.createRange(); rg.selectNodeContents(e);
    for (const b of rg.getClientRects()) { if (b.width < 2 || b.height < 2) continue; const v = clip(e, b); if (v) boxes.push({ e, v }); } }
  const all = Array.from(document.querySelectorAll('body *'));
  const saved = all.map((e) => [e.style.getPropertyValue('pointer-events'), e.style.getPropertyPriority('pointer-events')]);
  all.forEach((e) => e.style.setProperty('pointer-events', 'auto', 'important'));
  const opaque = (e) => { const c = cs(e); return alpha(c.backgroundColor) >= 0.85 || (c.backgroundImage && c.backgroundImage !== 'none' && !/url\(/.test(c.backgroundImage)) || (c.backdropFilter && c.backdropFilter !== 'none') || e.tagName === 'IMG' || e.tagName === 'VIDEO'; };
  const overlaps = [];
  try {
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.e === B.e || A.e.contains(B.e) || B.e.contains(A.e)) continue;
      const w = Math.min(A.v.right, B.v.right) - Math.max(A.v.left, B.v.left), h = Math.min(A.v.bottom, B.v.bottom) - Math.max(A.v.top, B.v.top);
      if (w <= 2 || h <= 2) continue;
      const cx = (Math.max(A.v.left, B.v.left) + Math.min(A.v.right, B.v.right)) / 2, cy = (Math.max(A.v.top, B.v.top) + Math.min(A.v.bottom, B.v.bottom)) / 2;
      const stack = document.elementsFromPoint(cx, cy);
      const ia = stack.findIndex((x) => x === A.e || A.e.contains(x)), ib = stack.findIndex((x) => x === B.e || B.e.contains(x));
      if (ia < 0 || ib < 0) continue;
      const [lo, iu, il] = ia < ib ? [B.e, ia, ib] : [A.e, ib, ia];
      if (stack.slice(iu + 1, il).filter((x) => !x.contains(lo)).some(opaque)) continue;
      overlaps.push(norm(A.e.textContent).slice(0, 32) + ' / ' + norm(B.e.textContent).slice(0, 32) + ' @' + Math.round(cy));
    }
  } finally { all.forEach((e, i) => { if (saved[i][0]) e.style.setProperty('pointer-events', saved[i][0], saved[i][1]); else e.style.removeProperty('pointer-events'); }); }
  const cut = leaves.filter((e) => { const c = cs(e); return e.scrollWidth > e.clientWidth + 1 && c.overflowX !== 'visible' && c.textOverflow !== 'ellipsis' && (!c.webkitLineClamp || c.webkitLineClamp === 'none') && clip(e, e.getBoundingClientRect()); }).map((e) => norm(e.textContent).slice(0, 40));
  const controls = Array.from(document.querySelectorAll('[role=button],button,a[href],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch]')).filter((e) => !hiddenUp(e));
  const small = [], smallKey = [];
  for (const e of controls) { const r = e.getBoundingClientRect(); if (!clip(e, r)) continue;
    const name = norm(e.getAttribute('aria-label') || e.textContent).slice(0, 32) || e.tagName;
    const key = (e.getAttribute('role') === 'tab' && !!e.closest('[role=tablist]') && /^(Home|Train|Bio|Life|Fuel|Coach|Tests|Store|Profile)$/.test(name)) || /^(Close|Back)$/.test(name);
    if (r.width < 23.5 || r.height < 23.5) small.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    else if (key && (r.width < 43.5 || r.height < 43.5)) smallKey.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  const uniq = (a) => Array.from(new Set(a)).slice(0, 12);
  return { sw: document.documentElement.scrollWidth, iw: W, texts: boxes.length, overlaps: uniq(overlaps), cut: uniq(cut), small: uniq(small), smallKey: uniq(smallKey) };
})()"""

# the screen's main vertical scroller (the visible scrolling element with the largest area on the screen), kept in
# window.__bpScroller; step 'top', 'bottom' or a fraction of its height to scroll by. Returns where it is.
SCROLLER_JS = r"""((step) => {
  const hiddenUp = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return true; } return false; };
  const cands = Array.from(document.querySelectorAll('div')).filter((e) => { const c = getComputedStyle(e); return /(auto|scroll)/.test(c.overflowY) && e.scrollHeight > e.clientHeight + 8 && e.clientHeight > 120 && !hiddenUp(e); })
    .map((e) => { const r = e.getBoundingClientRect(); const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); return { e, area: w * h }; })
    .filter((x) => x.area > 0).sort((a, b) => b.area - a.area);
  const s = cands.length ? cands[0].e : document.scrollingElement;
  window.__bpScroller = s;
  if (step === 'top') s.scrollTop = 0; else if (step === 'bottom') s.scrollTop = s.scrollHeight; else if (step) s.scrollTop = s.scrollTop + Math.round(s.clientHeight * step);
  return { top: Math.round(s.scrollTop), max: s.scrollHeight - s.clientHeight, h: s.clientHeight, atEnd: s.scrollTop + s.clientHeight >= s.scrollHeight - 2 };
})"""

# at the bottom of a tab's page: how far the last visible content ends above the top of the floating tab pill
PILL_CLEARANCE_JS = r"""(() => {
  const tab = Array.from(document.querySelectorAll('[role=tab][aria-label]')).find((e) => e.getAttribute('aria-label') === 'Home' && !e.closest('[aria-hidden="true"]'));
  if (!tab) return null;
  let p = tab; for (let i = 0; i < 6 && p.parentElement; i++) { p = p.parentElement; if (getComputedStyle(p).borderRadius.startsWith('999') || parseFloat(getComputedStyle(p).borderTopLeftRadius) > 30) break; }
  const top = p.getBoundingClientRect().top;
  const s = window.__bpScroller; if (!s) return null;
  const sr = s.getBoundingClientRect();
  const hidden = (el) => { for (let e = el; e && e !== s; e = e.parentElement) { if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) < 0.05) return true; } return false; };
  let bottom = 0, what = '';
  for (const e of s.querySelectorAll('*')) { if (e.childElementCount && !(e.getAttribute('role') === 'button')) continue;
    const r = e.getBoundingClientRect(); if (r.height < 2 || r.width < 2 || r.bottom > sr.bottom + 1 || r.top < sr.top || hidden(e)) continue;
    if (!(e.textContent || '').trim() && !e.getAttribute('aria-label') && e.tagName !== 'IMG' && e.tagName !== 'svg') continue;
    if (r.bottom > bottom) { bottom = r.bottom; what = (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30); } }
  return { pillTop: Math.round(top), contentBottom: Math.round(bottom), gap: Math.round(top - bottom), what };
})()"""


class App:
    """The app in a Browser. `base` is the scratch API (for the demo helpers), `app_url` the Expo web server."""

    def __init__(self, browser, base, app_url):
        self.b = browser
        self.base = base.rstrip('/')
        self.app_url = app_url.rstrip('/')
        self.workspace = None       # which sign-in the current session came through
        self.err_mark = 0           # len(browser.errors) when the current screen was opened
        self.dialogs = []
        self.requests = []          # every request URL the page sent (Network.requestWillBeSent), in order
        self.request_log = []       # the same requests as (method, url)
        self.tunnels = None         # route_quick_tunnels(): {host: target base or None}
        self.tunnel_log = []        # what route_quick_tunnels() answered: (method, url, status, carried a session token)
        # answer every window.confirm / alert the app raises, so the page never blocks on one
        inner = browser._event

        def event(msg):
            if msg.get('method') == 'Page.javascriptDialogOpening':
                self.dialogs.append(msg.get('params', {}).get('message', ''))
                browser.send('Page.handleJavaScriptDialog', accept=True)
                return
            if msg.get('method') == 'Network.requestWillBeSent':
                req = (msg.get('params') or {}).get('request') or {}
                self.requests.append(req.get('url', ''))
                self.request_log.append((req.get('method', ''), req.get('url', '')))
            if msg.get('method') == 'Fetch.requestPaused' and self.tunnels is not None and QUICK_TUNNEL_URL.match(((msg.get('params') or {}).get('request') or {}).get('url', '')):
                self._answer_tunnel(msg['params'])
                return
            inner(msg)
        browser._event = event

    # ---- quick-tunnel addresses answered inside Chrome
    def route_quick_tunnels(self, routes):
        """Answer the page's requests to https://<name>.trycloudflare.com here instead of on the internet: `routes` maps
        a tunnel origin to the scratch API base that answers for it (the request is forwarded there with its method,
        headers and body, and the answer handed back), or to None for a tunnel that has gone (Cloudflare's 530 page).
        An origin not in `routes` is also answered 530. Call again to change the routes (a tunnel that moves)."""
        first = self.tunnels is None
        self.tunnels = {k.rstrip('/'): (v.rstrip('/') if v else None) for k, v in routes.items()}
        if first:
            self.b.call('Fetch.enable', patterns=[{'urlPattern': 'https://*.trycloudflare.com/*', 'requestStage': 'Request'}])

    def _answer_tunnel(self, p):
        req = p.get('request') or {}
        url, method = req.get('url', ''), req.get('method', 'GET')
        origin = QUICK_TUNNEL_URL.match(url).group(1)
        target = self.tunnels.get(origin)
        if not target:
            # a tunnel that has gone: Cloudflare's 530 page, readable by the page as a phone's app reads it (the browser's
            # preflight is let through, so the app sees the 530 itself rather than a failed preflight)
            hdrs = {k.lower(): v for k, v in (req.get('headers') or {}).items()}
            allow = [{'name': 'Access-Control-Allow-Origin', 'value': hdrs.get('origin', '*')}]
            if method == 'OPTIONS':
                body, status = b'', 204
                headers = allow + [{'name': 'Access-Control-Allow-Methods', 'value': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'},
                                   {'name': 'Access-Control-Allow-Headers', 'value': hdrs.get('access-control-request-headers', '*')}]
            else:
                body = b'<!DOCTYPE html><html><head><title>Cloudflare Tunnel error</title></head><body>Error 1033</body></html>'
                status, headers = 530, allow + [{'name': 'Content-Type', 'value': 'text/html; charset=UTF-8'}]
        else:
            h = {k: v for k, v in (req.get('headers') or {}).items() if k.lower() not in ('host', 'accept-encoding', 'content-length', 'connection')}
            data = req.get('postData')
            data = data.encode() if isinstance(data, str) else None
            fwd = urllib.request.Request(target + url[len(origin):], data=data, method=method, headers=h)
            try:
                with urllib.request.urlopen(fwd, timeout=30) as r:
                    status, raw, hdrs = r.status, r.read(), r.headers.items()
            except urllib.error.HTTPError as e:
                status, raw, hdrs = e.code, e.read(), e.headers.items()
            except (urllib.error.URLError, OSError):
                status, raw, hdrs = 502, b'', [('Content-Type', 'text/plain')]
            body = raw
            headers = [{'name': k, 'value': v} for k, v in hdrs if k.lower() not in ('content-length', 'transfer-encoding', 'connection', 'content-encoding')]
        self.tunnel_log.append((method, url, status, any(k.lower() == 'authorization' for k in (req.get('headers') or {}))))
        # a phrase always: Chrome refuses a fulfil without one for a code it has no phrase for (530), and the refusal of a
        # fire-and-forget command is never seen, which would leave the request waiting
        self.b.send('Fetch.fulfillRequest', requestId=p['requestId'], responseCode=status, responsePhrase=http.client.responses.get(status, 'Error'),
                    responseHeaders=headers, body=base64.b64encode(body).decode())

    # ---- the page
    def close_stray_tabs(self):
        """Close page targets Chrome opened by itself (headless Chrome sometimes opens chrome://settings/help): a page in
        front of the app's pauses its animation frames, so entrances stay at their start (opacity 0) and the screen
        reads as empty. Closing it does not show the app's page again (it stays hidden, its frames paused), so the app is
        brought back to the front. Returns how many were closed."""
        closed = 0
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json' % cs.PORT_CDP, timeout=3) as r:
                pages = json.loads(r.read().decode())
            for p in pages:
                if p.get('type') == 'page' and str(p.get('url', '')).startswith('chrome://'):
                    urllib.request.urlopen('http://127.0.0.1:%d/json/close/%s' % (cs.PORT_CDP, p['id']), timeout=3).read()
                    closed += 1
        except Exception:
            pass
        if closed:
            try:
                self.b.call('Page.bringToFront')
            except Exception:
                pass
        return closed

    def js(self, expr):
        return self.b.js(expr)

    def text(self):
        return self.js('document.body.innerText') or ''

    def has_text(self, rx):
        return bool(self.js("new RegExp(%s, 'im').test(document.body.innerText)" % json.dumps(rx)))

    def visible_text(self):
        """The text a person can see now: not the screen behind an open overlay or sheet (aria-hidden), nothing hidden."""
        return self.js(VISIBLE_TEXT_JS) or ''

    def has_visible(self, rx):
        return bool(re.search(rx, self.visible_text(), re.I | re.M))

    def wait_visible(self, rx, seconds=20):
        self.close_stray_tabs()
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                if self.has_visible(rx):
                    return True
            except Exception:
                pass
            self.b.pump(0.3)
        return False

    # ---- viewport, motion and layout (BUILD_PLAN §8.2)
    def set_viewport(self, w, h, dpr=2, mobile=True):
        """Emulate a device: CSS width and height, device pixel ratio and touch (mobile)."""
        self.b.call('Emulation.setDeviceMetricsOverride', width=int(w), height=int(h), deviceScaleFactor=dpr, mobile=bool(mobile))
        self.b.w, self.b.h = int(w), int(h)

    def reduced_motion(self, on=True):
        """prefers-reduced-motion: reduce (on) or no-preference; the app follows it without a reload."""
        self.b.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-reduced-motion', 'value': 'reduce' if on else 'no-preference'}])

    def set_motion_tier(self, tier):
        """The app's motion tier override (bp.fx.motionTier: 'A', 'B', 'C', or None to remove it); read at the next page
        load, so set it before boot() or a cold start."""
        if tier:
            self.js("localStorage.setItem('bp.fx.motionTier', %s); true" % json.dumps(json.dumps(tier)))
        else:
            self.js("localStorage.removeItem('bp.fx.motionTier'); true")

    def layout_audit(self):
        """LAYOUT_AUDIT_JS on the screen as it is now."""
        return self.js(LAYOUT_AUDIT_JS) or {}

    def scroll(self, step):
        """Scroll the screen's main scroller ('top', 'bottom' or a fraction of its height); returns where it is."""
        return self.js('(%s)(%s)' % (SCROLLER_JS, json.dumps(step))) or {}

    def pill_clearance(self):
        return self.js(PILL_CLEARANCE_JS)

    def press_key(self, key='Escape', code=None, keycode=27):
        """A key press sent to the page (Escape closes a sheet or a route sheet). No nativeVirtualKeyCode: on macOS
        headless Chrome reads one (27 is a key of the browser's own shortcuts there) and opens chrome://settings/help in
        front of the app, which hides the page and pauses its animation frames (every spring then stops where it is).
        Anything Chrome opened anyway is closed and the app brought back to the front."""
        for t in ('keyDown', 'keyUp'):
            self.b.call('Input.dispatchKeyEvent', type=t, key=key, code=code or key, windowsVirtualKeyCode=keycode)
        self.close_stray_tabs()

    def wait_text(self, rx, seconds=20):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                if self.has_text(rx):
                    return True
            except Exception:
                pass
            self.b.pump(0.3)
        return False

    def wait_js(self, expr, seconds=10):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                if self.js(expr):
                    return True
            except Exception:
                pass
            self.b.pump(0.25)
        return False

    def path(self):
        return self.js('location.pathname') or ''

    def settled(self, seconds=20):
        """Metro's "Bundling…" placeholder (a screen opened for the first time) gone and the body quiet for a moment."""
        ok = self.wait_js("!/Bundling/.test(document.body.innerText)", seconds)
        self.b.pump(0.4)
        return ok

    def boot(self, timeout=300):
        """The first load: Expo bundles the entry and the first route; returns the seconds it took until the app drew a
        screen. Raises with Metro's message when the server serves its error page instead of the app."""
        t0 = time.monotonic()
        self.close_stray_tabs()
        self.b.open(self.app_url + '/', settle=0.5)
        end = t0 + timeout
        while time.monotonic() < end:
            if self.js("!!document.getElementById('_expo-static-error')"):
                raise RuntimeError('Expo web served its error page: ' + (ExpoWeb.static_error(self.js('document.documentElement.outerHTML')) or '?'))
            if (self.text().strip()) and not self.has_text('Bundling'):
                self.err_mark = len(self.b.errors)
                return time.monotonic() - t0
            self.b.pump(0.5)
        raise RuntimeError('the app drew nothing within %ss (last text: %r)' % (timeout, self.text()[:80]))

    def open_route(self, route, expect=None, seconds=30):
        """Open an expo-router href ('/(tabs)/plan', '/settings/profile') without reloading the page, so the session
        stays; wait until the screen's text matches `expect` (a regex, case-insensitive) when given. Returns bool."""
        self.close_stray_tabs()
        if not self.js("!!document.getElementById('root') && document.getElementById('root').children.length > 0"):
            self.b.open(self.app_url + route, settle=0.5)
        else:
            self.js("history.pushState({}, '', %s); dispatchEvent(new PopStateEvent('popstate', { state: {} })); true" % json.dumps(route))
        self.err_mark = len(self.b.errors)
        self.settled(seconds)
        if expect is None:
            return True
        return self.wait_text(expect, seconds)

    def route_exists(self, route, expect, seconds=30):
        """True when the screen renders `expect`; False when the app shows its not-found screen (a route the next phase
        builds) or nothing recognisable. The not-found screen is looked for first: it has buttons and words of its own
        ("Start again"), so an `expect` that is not unique to the screen must not pass on it. A not-found screen that is
        still being replaced by the new route is given a moment before it counts."""
        self.open_route(route, None, seconds)
        end = time.monotonic() + seconds
        not_found_since = None
        while time.monotonic() < end:
            if self.has_text(NO_SUCH_SCREEN):
                not_found_since = not_found_since or time.monotonic()
                if time.monotonic() - not_found_since >= 1.5:
                    return False
            elif self.has_text(expect):
                return True
            self.b.pump(0.3)
        return False

    def watch_text(self, rx, next_load=False):
        """Start recording every distinct line of the page that matches `rx` (a regex, case-insensitive, per line) on
        each change of the DOM, so a screen that draws for a moment and is replaced is still seen; seen_text() reads it.
        next_load=True installs the watch for the next page load instead, before the app's first script runs (a cold
        start or a deep link opened with Browser.open)."""
        src = WATCH_JS % json.dumps(rx)
        if next_load:
            self._watch_script = self.b.call('Page.addScriptToEvaluateOnNewDocument', source=src).get('identifier')
            return True
        return self.js(src)

    def seen_text(self, stop=True):
        """The lines watch_text() recorded; stops watching (and drops a next-load watch) unless stop=False."""
        seen = self.js("(() => { const s = window.__bpSeen || []; if (%s && window.__bpObs) { window.__bpObs.disconnect(); window.__bpObs = null; } return s; })()" % ('true' if stop else 'false')) or []
        if stop and getattr(self, '_watch_script', None):
            self.b.call('Page.removeScriptToEvaluateOnNewDocument', identifier=self._watch_script)
            self._watch_script = None
        return seen

    # ---- elements
    def find_clickable(self, text, exact=True):
        return bool(self.js("!!(%s)(%s, %s)" % (FIND_CLICKABLE, json.dumps(text), 'true' if exact else 'false')))

    def wait_clickable(self, text, seconds=10, exact=True):
        return self.wait_js("!!(%s)(%s, %s)" % (FIND_CLICKABLE, json.dumps(text), 'true' if exact else 'false'), seconds)

    def click_text(self, text, exact=True, seconds=10):
        """Press the button, link, tab or pressable text that reads `text`. Returns False when nothing reads so."""
        if not self.wait_clickable(text, seconds, exact):
            return False
        return bool(self.js("(() => { const el = (%s)(%s, %s); if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()" % (FIND_CLICKABLE, json.dumps(text), 'true' if exact else 'false')))

    def is_disabled(self, text):
        return bool(self.js("(() => { const el = (%s)(%s, true); return !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true'); })()" % (FIND_CLICKABLE, json.dumps(text))))

    def has_input(self, label):
        return bool(self.js("!!(%s)(%s)" % (FIND_INPUT, json.dumps(label))))

    def input_value(self, label):
        return self.js("((e) => e ? e.value : null)((%s)(%s))" % (FIND_INPUT, json.dumps(label)))

    def type_into(self, label, value, seconds=10):
        """Fill the input labelled `label` (its Field label, placeholder or aria-label). Returns False when absent."""
        if not self.wait_js("!!(%s)(%s)" % (FIND_INPUT, json.dumps(label)), seconds):
            return False
        got = self.js("(() => { const el = (%s)(%s); el.focus(); return (%s)(el, %s); })()" % (FIND_INPUT, json.dumps(label), SET_VALUE, json.dumps(value)))
        return got == value

    # ui.tsx Check: a Pressable with role checkbox whose box shows a tick when checked (React Native Web writes no
    # aria-checked for it), so the state is read from the tick, or from aria-checked where a control sets it
    _CHECKBOX = r'''(label) => { %s const t = norm(label);
      return Array.from(document.querySelectorAll('[role=checkbox]')).find((e) => norm(e.innerText).replace(/^✓\s*/, '').startsWith(t)) || null; }''' % _NORM
    _CHECKED = "(el) => el.getAttribute('aria-checked') === 'true' || /^\\s*✓/.test(el.innerText || '')"

    def checkbox_state(self, label):
        """True / False, or None when no checkbox carries that label."""
        return self.js("((el) => el ? (%s)(el) : null)((%s)(%s))" % (self._CHECKED, self._CHECKBOX, json.dumps(label)))

    def set_checkbox(self, label, checked=True):
        state = self.checkbox_state(label)
        if state is None:
            return False
        if state != checked:
            self.js("(%s)(%s).click()" % (self._CHECKBOX, json.dumps(label)))
            self.b.pump(0.3)
        return self.checkbox_state(label) == checked

    def tabs(self):
        """The tab bar's titles, without their icon glyphs and badge counts (a badge reads '7' before 'Operations'). The
        client app's pill is icon-only: when it is on the screen its tabs are read by their aria-labels (member_tabs), so a
        screen's own segments (Email | Phone, This week | Plan | History), which are tabs too, are not counted."""
        pill = [label for label, _ in self.member_tabs()]
        if pill:
            return pill
        return self.js("Array.from(document.querySelectorAll('[role=tab]')).map((e) => (e.innerText || '').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g, ' ').trim().replace(/^\\d+ /, ''))") or []

    def member_tabs(self):
        """The client app's pill: [(label, selected)] for each tab named like a member tab, in order."""
        # a tab with a dot says so after its name ("Coach, new messages"): the name is the part before the comma
        return [tuple(x) for x in (self.js("Array.from(document.querySelectorAll('[role=tab][aria-label]')).filter((e) => !e.closest('[aria-hidden=\\'true\\']') && %s.includes(e.getAttribute('aria-label').split(', ')[0])).map((e) => [e.getAttribute('aria-label').split(', ')[0], e.getAttribute('aria-selected') === 'true'])" % json.dumps(MEMBER_TAB_LABELS)) or [])]

    def click_tab(self, label):
        """Press one tab of the client app's pill (from code: a tab scrolled out of the pill needs no scrolling first)."""
        return bool(self.js("(() => { const el = Array.from(document.querySelectorAll('[role=tab][aria-label]')).find((e) => e.getAttribute('aria-label').split(', ')[0] === %s && !e.closest('[aria-hidden=\\'true\\']')); if (!el) return false; el.click(); return true; })()" % json.dumps(label)))

    def tab_badges(self):
        """{title: count} for the tabs that show a badge."""
        return self.js("Object.fromEntries(Array.from(document.querySelectorAll('[role=tab]')).map((e) => (e.innerText || '').replace(/[\\ue000-\\uf8ff]/g, '').replace(/\\s+/g, ' ').trim()).filter((t) => /^\\d+ /.test(t)).map((t) => [t.replace(/^\\d+ /, ''), parseInt(t, 10)]))") or {}

    # ---- what the browser saw
    def errors_since(self):
        """Console errors, uncaught exceptions and failed requests since the current screen was opened (warnings are not
        errors: a development bundle warns about deprecations of its own)."""
        out = []
        for e in self.b.errors[self.err_mark:]:
            if e.startswith('warning:') or any(s in e for s in IGNORED_ERRORS) or MEDIA_ABORTED.search(e):
                continue
            out.append(e)
        return out

    def label_hit(self):
        return self.js(LABEL_JS) or ''

    def screenshot(self, name):
        return self.b.shot(name)

    def page_ok(self, name, expect=None, allow_error_box=False):
        """One check: the screen is not the not-found screen, shows no error box, raised no console error, and shows
        `expect` when given."""
        errs = self.errors_since()
        missing = self.has_text(NO_SUCH_SCREEN)
        box = self.has_text(r'^Something went wrong$|^No connection$|^Signed out$')
        want = expect is None or self.has_text(expect)
        ok = not errs and not missing and (allow_error_box or not box) and want
        detail = '; '.join(errs[:3] + (['not-found screen'] if missing else []) + (['error box shown'] if box and not allow_error_box else []) + (['expected %r, saw %r' % (expect, self.text()[:100])] if not want else []))
        return check(name, ok, detail)

    # ---- sessions
    def sign_in(self, workspace, email, password, mfa='preview', seconds=30):
        """Sign in through the app's own screen for the workspace ('member', 'coach', 'admin'). For 'admin', `mfa` is
        'preview' (press the screen's "Fill in the preview code", else fetch it from GET /auth/demo/totp), a six-digit
        code, or None to stop at the code step. Returns {'ok': bool, 'detail': str, 'mfa_asked': bool}."""
        route = SIGN_IN_ROUTES[workspace]
        if workspace != 'member' and not staff_app():
            return {'ok': False, 'detail': 'the client app has no %s sign-in (APP_STAFF=1 drives the staff build)' % workspace, 'mfa_asked': False, 'missing': True, 'client_app': True}
        if not self.route_exists(route, r'Email', seconds):
            return {'ok': False, 'detail': 'sign-in screen %s not built yet' % route, 'mfa_asked': False, 'missing': True}
        if workspace != 'member' and self.path().rstrip('/') == '/sign-in':
            return {'ok': False, 'detail': 'the app at %s is the client build: %s led to the client sign-in (start Expo with EXPO_PUBLIC_STAFF_APP=1; ExpoWeb does so under APP_STAFF=1)' % (self.app_url, route), 'mfa_asked': False}
        if not (self.type_into('Email', email) and self.type_into('Password', password)):
            return {'ok': False, 'detail': 'no Email / Password fields on %s' % route, 'mfa_asked': False}
        self.err_mark = len(self.b.errors)
        if not self.click_text(SIGN_IN_BUTTON[workspace]):
            return {'ok': False, 'detail': 'no "%s" button' % SIGN_IN_BUTTON[workspace], 'mfa_asked': False}
        home = HOME_TEXT[workspace]
        error = r'does not sign in here|This app is for Bioptime clients|Check the email and password|Too many attempts|suspended|could not be reached|not accepted|Sign-in failed|Something went wrong'
        mfa_asked = False
        if workspace == 'admin':
            # the server asks for the code (MFA_REQUIRED) before any administrator is let in
            self.wait_text(r'Authenticator code|' + error + '|' + home, seconds)
            mfa_asked = self.has_input('Authenticator code')
            if mfa_asked and mfa is not None:
                code = None
                if mfa == 'preview':
                    if self.click_text('Fill in the preview code', seconds=3):
                        self.wait_js("/^\\d{6}$/.test(((%s)('Authenticator code') || {}).value || '')" % FIND_INPUT, 10)
                        code = self.input_value('Authenticator code')
                    if not re.fullmatch(r'\d{6}', str(code or '')):
                        code = demo_totp(self.base, email)
                        self.type_into('Authenticator code', code)
                else:
                    self.type_into('Authenticator code', str(mfa))
                if not self.click_text('Verify and sign in'):
                    return {'ok': False, 'detail': 'no "Verify and sign in" button', 'mfa_asked': True}
            elif mfa_asked:
                return {'ok': False, 'detail': 'stopped at the authenticator code', 'mfa_asked': True}
        arrived = self.wait_text(home + '|' + error, seconds) and self.has_text(home)
        if arrived and workspace == 'member':
            # the greeting eyebrow, then the first name under it (the name of the account that signed in, read from a
            # first.last@ address; an address of another shape is not guessed at)
            local = email.split('@')[0]
            first = local.split('.')[0].capitalize() if re.fullmatch(r'[a-z]+\.[a-z]+', local) else ''
            arrived = self.wait_text('^%s$' % re.escape(first), seconds) if first else True
        if arrived:
            self.workspace = workspace
            self.err_mark = len(self.b.errors)
            self.settled(seconds)
            return {'ok': True, 'detail': self.path(), 'mfa_asked': mfa_asked}
        m = re.search(error, self.text(), re.I)
        return {'ok': False, 'detail': (m.group(0) if m else 'still at ' + self.path() + ': ' + self.text()[:120].replace('\n', ' / ')), 'mfa_asked': mfa_asked}

    def sign_out(self, seconds=20):
        """Sign out through the screen that offers it (Profile › Settings, or More in a workspace); when that cannot be found, reload,
        which drops the in-memory session on the web. Returns (ok, detail)."""
        self.js("window.confirm = () => true; window.alert = () => {}; true")
        if not self.find_clickable('Sign out'):
            workspaces = [w for w in SIGN_OUT_ROUTES if staff_app() or w == 'member']   # the client app has no staff More
            for ws in ([self.workspace] if self.workspace in workspaces else []) + [w for w in workspaces if w != self.workspace]:
                self.open_route(SIGN_OUT_ROUTES[ws], None, seconds)
                if self.wait_clickable('Sign out', 5):
                    break
        self.js("window.confirm = () => true; window.alert = () => {}; true")
        detail = 'through the Sign out button'
        if not self.click_text('Sign out', seconds=3) or not self.wait_text(SIGN_IN_SCREEN, seconds):
            self.b.open(self.app_url + '/', settle=0.5)
            detail = 'no Sign out button reached; reloaded instead'
            if not self.wait_text(SIGN_IN_SCREEN, 60):
                return False, 'still signed in after a reload: ' + self.text()[:80]
        self.workspace = None
        self.err_mark = len(self.b.errors)
        return True, detail

    # ---- a new member (registration, the email code, onboarding)
    def register_member(self, name, email, password, seconds=30):
        """Create an account through /(auth)/register (the policies ticked, nothing optional) and confirm the email with
        the code the demo server fills in (no email leaves it). Returns (ok, detail); ends on the confirmed screen's
        Continue, which leads into onboarding."""
        if not self.route_exists('/(auth)/register', r'^Create your account$', seconds):
            return False, 'no registration screen'
        ok = self.type_into('Your name', name) and self.type_into('Email', email) and self.type_into('Password', password)
        ok = ok and self.set_checkbox('I have read and accept', True)
        if not ok or not self.click_text('Create account'):
            return False, 'the form could not be filled: ' + self.text()[:160]
        if not self.wait_text(r'^Confirm your email$', seconds):
            return False, 'no email step after Create account: ' + self.text()[:200]
        filled = self.wait_js("((%s)('Code') || {}).value" % FIND_INPUT, 10)
        if not filled or not self.click_text('Confirm'):
            return False, 'the demo code was not filled in: ' + self.visible_text()[:200]
        if not self.wait_text(r'your address is confirmed|Your email is confirmed', seconds):
            return False, 'not confirmed: ' + self.visible_text()[:200]
        self.workspace = 'member'
        return True, self.path()

    def onboard(self, city='Pune', state='Maharashtra', seconds=30):
        """Onboarding after registration (BUILD_PLAN §6.1, AMENDED §2): the consent screen ("Process my health
        information" ticked, "Agree and continue"), the three slides (Next, Next, Start), the nine quiz steps (the
        second option of a choice, the first of a multiple choice; the dial steps as they stand) and "Send my answers"
        with a city and state, then Home. Returns (ok, steps seen, detail)."""
        if not self.click_text('Continue', seconds=10) and not self.path().startswith('/onboarding'):
            self.open_route('/onboarding', None, seconds)
        if not self.wait_text(r'^Your data, your control$', seconds):
            return False, [], 'no consent screen: ' + self.visible_text()[:200]
        if not (self.set_checkbox('Process my health information', True) and self.click_text('Agree and continue')):
            return False, [], 'consent could not be given'
        for word in ('Next', 'Next', 'Start'):
            if not (self.wait_clickable(word, seconds) and self.click_text(word)):
                return False, [], 'slides: no %s' % word
            self.b.pump(0.6)
        steps = []
        for _ in range(12):
            if not self.wait_text(r'STEP \d OF 9', seconds):
                break
            m = re.search(r'STEP (\d) OF 9', self.text(), re.I)
            n = int(m.group(1)) if m else 0
            if steps and steps[-1] == n:
                self.b.pump(0.5)
                continue
            steps.append(n)
            pick = "Array.from(document.querySelectorAll('[role=%s]')).filter((e) => !e.closest('[aria-hidden=\\'true\\']'))"
            if self.js(pick % 'radio' + '.length'):
                self.js(pick % 'radio' + '[1].click()')
            elif self.js(pick % 'checkbox' + '.length') and not self.js(pick % 'checkbox' + ".some((e) => e.getAttribute('aria-checked') === 'true')"):
                self.js(pick % 'checkbox' + '[0].click()')
            self.b.pump(0.4)
            if self.find_clickable('Send my answers'):
                self.type_into('City', city)
                self.type_into('State', state)
                self.click_text('Send my answers')
                break
            if not self.click_text('Continue', seconds=5):
                return False, steps, 'step %d: no Continue' % n
            self.wait_js("!/STEP %d OF 9/i.test(document.body.innerText)" % n, 10)
        home = self.wait_text(HOME_TEXT['member'], 60)
        return bool(home and steps == list(range(1, 10))), steps, self.path() + ' ' + self.visible_text()[:160]

    def close(self):
        self.b.close()
