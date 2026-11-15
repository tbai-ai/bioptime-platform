#!/usr/bin/env python3
"""End-to-end check of the app's administrative portal, part B2 (apps/mobile: Integrations, LabStack, Users and
permissions, Settings, Modules, Website content, Theme), through the Expo web build in headless Chrome at 390x844
(Python 3.9, stdlib, Google Chrome; the shared driver is tools/app_harness.py).

    BASE=http://127.0.0.1:4331 APP_PORT=9331 E2E_CDP_PORT=9731 python3 -I tools/e2e_app_admin_b2.py
    BASE=… E2E_APP_ONLY=users,theme python3 -I tools/e2e_app_admin_b2.py          only the named sections

BASE is the scratch API (required; the usual recipe: reset-demo, then src/server.ts on its own port, started with
CORS_ORIGINS=http://localhost:<APP_PORT>). The check starts `npx expo start --web --port <APP_PORT> --clear` for
apps/mobile in its own process group and stops it at the end (APP_URL drives a server already running instead). As the
other e2e scripts: the live demo's ports (3000, 3100, 3101, 8081) are refused for BASE and APP_PORT; E2E_OUT (default
.local/e2e/app-admin-b2/) and E2E_CDP_PORT (default 9731) keep parallel runs apart.

One sign-in per run: the owner, through the app's own administrator sign-in with the server's preview authenticator
code (GET /auth/demo/totp exists only on a demo server). Every section opens its screens in the app, exercises the main
actions against the seeded data, reads the console for errors and screenshots the screen. A screen or control the tree
does not have is reported as a failure here: every route of this group must be built. Exit status 1 if anything fails;
the JSON summary is the last line.

What a run leaves in the scratch data. The settings, the template, the metric switch, the module switch and setting,
the website block and the theme are put back as they were. Three things stay, so run it against a scratch server only:
  - Operations admin keeps an explicit override for "Manage the LabStack integration": granted, then revoked, so it is
    not held (as by default) but the row reads "Revoked explicitly: <the check's reason>" and the account counts one
    explicit override. The API has no call that removes an override.
  - The 4x4 PNG uploaded through the image block stays in the image library (the library keeps every upload).
  - The audit log and the job log record every change, the catalogue sync and the safety-net run."""
import json
import os
import sys
import time
import traceback
import zlib
import struct

sys.dont_write_bytecode = True
os.environ['APP_STAFF'] = '1'   # coach and administrator screens exist only in the staff build: the harness starts Expo with EXPO_PUBLIC_STAFF_APP=1
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_harness as ah  # noqa: E402
from app_harness import check  # noqa: E402

BASE = os.environ.get('BASE', '').rstrip('/')
APP_PORT = os.environ.get('APP_PORT') or '9331'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-admin-b2')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9731'
SECTION_NAMES = ('integrations', 'labstack', 'users', 'settings', 'modules', 'content', 'theme')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
ADMIN_EMAIL = 'admin@demo.bioptime.test'
REASON = 'App end-to-end check; undone in the same run'


# ---------------------------------------------------------------- helpers
def blur_input(app, label):
    """Leave the input (its onBlur saves on several screens). Headless Chrome fires no focus events while the page is
    not focused, so the bubbling focusout React listens for is dispatched as well."""
    return bool(app.js("(() => { const el = (%s)(%s); if (!el) return false; el.focus(); el.blur(); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return true; })()" % (ah.FIND_INPUT, json.dumps(label))))


DIALOG_BUTTON = r'''(text) => { %s const t = norm(text);
  const all = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => norm(e.innerText || e.textContent) === t || norm(e.getAttribute('aria-label')) === t);
  return all.length ? all[all.length - 1] : null; }''' % ah._NORM


def click_dialog_button(app, text, seconds=10):
    """Press the button of the open sheet that reads `text`: the last one in the document, since the sheet (a Modal) is
    appended after the screen, whose own button may read the same (Reset, Save)."""
    if not app.wait_js("!!(%s)(%s)" % (DIALOG_BUTTON, json.dumps(text)), seconds):
        return False
    return bool(app.js("(() => { const el = (%s)(%s); if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })()" % (DIALOG_BUTTON, json.dumps(text))))


def type_and_blur(app, label, value):
    ok = app.type_into(label, value)
    app.b.pump(0.2)
    return ok and blur_input(app, label)


def wait_gone(app, rx, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not app.has_text(rx):
            return True
        app.b.pump(0.3)
    return False


def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def screen(app, name, route, expect, shot=None):
    """Open a route of this group and check it drew (never the not-found screen), with no console error."""
    ok = app.route_exists(route, expect, 45)
    app.page_ok('screen %s' % route, expect)
    if not ok:
        check('screen %s is built' % route, False, 'not drawn: ' + app.text()[:120].replace('\n', ' / '))
    no_labels(app, name)
    if shot:
        app.screenshot(shot)
    return ok


REASON_FIELD = 'Reason (recorded in the audit log)'

# the app's Pill text colours (components/ui.tsx Pill): the portal's success, warning and neutral (drawn as info)
GREEN, AMBER, GREY, RED = 'rgb(155, 224, 160)', 'rgb(255, 210, 122)', 'rgb(163, 174, 194)', 'rgb(255, 115, 102)'


def pill_colour(app, rx):
    """The text colour of the first element whose whole text matches `rx` and that has no element children: a Pill's
    label (None when there is none)."""
    return app.js("""(() => { const re = new RegExp(%s); for (const el of document.querySelectorAll('div,span')) {
      if (el.children.length) continue; const t = (el.textContent || '').trim(); if (!re.test(t)) continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue; return getComputedStyle(el).color; } return null; })()""" % json.dumps(rx))


def font_of(app, text):
    """The computed font-family of the element whose whole text is `text`."""
    return app.js("""(() => { for (const el of document.querySelectorAll('div,span,h1,h2')) { if (el.children.length) continue;
      if ((el.textContent || '').trim() === %s) return getComputedStyle(el).fontFamily; } return ''; })()""" % json.dumps(text)) or ''


def jump_counter(app, counter, heading_rx):
    """Press a LabStack counter (role=link, named "<counter>: <n>") and check that the screen scrolled its card's heading
    into the top part of the view."""
    app.js("(() => { const s = Array.from(document.querySelectorAll('div')).filter((d) => d.scrollHeight > d.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(d).overflowY)); s.forEach((d) => { d.scrollTop = 0; }); })()")
    app.b.pump(0.3)
    found = app.js("(() => { const el = Array.from(document.querySelectorAll('[role=link]')).find((e) => (e.getAttribute('aria-label') || '').startsWith(%s + ': ')); if (!el) return false; el.click(); return true; })()" % json.dumps(counter))
    if not found:
        return False
    return app.wait_js("""(() => { const re = new RegExp(%s); const el = Array.from(document.querySelectorAll('div,span')).find((e) => !e.children.length && re.test((e.textContent || '').trim()));
      if (!el) return false; const top = el.getBoundingClientRect().top; return top > 0 && top < 260; })()""" % json.dumps(heading_rx), 6)


def reason_and_confirm(app, confirm_label, field=REASON_FIELD):
    """Type the reason into the open dialog (the web's field label on every reason sheet) and press its confirm."""
    if not app.type_into(field, REASON):
        return False
    app.b.pump(0.2)
    return click_dialog_button(app, confirm_label)


def tiny_png(path):
    """A 4x4 red PNG written with the stdlib (for the image library upload)."""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\xee\x33\x24' * 4 for _ in range(4))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 4, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return path


def set_file_input(app, path):
    """Give the hidden <input type=file> that expo-image-picker created the file (CDP DOM.setFileInputFiles)."""
    b = app.b
    doc = b.call('DOM.getDocument', depth=1)
    root = doc['root']['nodeId']
    node = b.call('DOM.querySelector', nodeId=root, selector='input[type=file][data-testid=file-input]')
    nid = node.get('nodeId')
    if not nid:
        return False
    b.call('DOM.setFileInputFiles', files=[path], nodeId=nid)
    return True


# ---------------------------------------------------------------- sections
def integrations_section(app):
    screen(app, 'integrations', '/admin/integrations', r'^Integrations$', 'admin-integrations')
    check('integrations: the payments card names the provider and its mode', app.has_text(r'^Payments$') and app.has_text(r'simulated|^live$'), app.text()[:200])
    check('integrations: the messaging card lists email, SMS and push', app.has_text(r'^Email, SMS, push$') and app.has_text(r'recorded, not delivered|delivering'))
    check('integrations: the "Not connected" card in the web\'s words', app.has_text(r'^Not connected$') and app.has_text(r'Nothing here pretends otherwise'))
    check('integrations: the outbox line (the owner holds operations.manage)', app.has_text(r'^Outbox, latest: '))
    # as on the web: only the meetings, calendar, video, Coach AI and storage rows used by a switched-on module
    check('integrations: what the switched-on modules still need, from the registry', app.has_text(r'What the switched-on modules still need') and app.has_text(r'^Video meetings$') and app.has_text(r'^Coach AI$') and app.has_text(r'Reads MEETING_PROVIDER; values are never shown here\.'))
    check('integrations: nothing beyond the web page (no payments, email or identity rows from the registry)', not app.has_text(r'Sign in with Google / Apple') and not app.has_text(r'^Every integration$'))
    check('integrations: Open LabStack is offered to an owner', app.find_clickable('Open LabStack'))
    # the portal draws 'simulated' and 'recorded, not delivered' as its 'draft' status: amber, never grey
    check('integrations: simulated and recorded-only pills are amber, as on the web', pill_colour(app, r'^simulated$') == AMBER and pill_colour(app, r'^recorded, not delivered$') == AMBER, '%s / %s' % (pill_colour(app, r'^simulated$'), pill_colour(app, r'^recorded, not delivered$')))
    check('integrations: a module provider still pending is amber', pill_colour(app, r'^Pending configuration$|^Simulated$') == AMBER, str(pill_colour(app, r'^Pending configuration$|^Simulated$')))
    check('integrations: secrets never appear (no key values on the screen)', not app.has_text(r'sk_live|whsec_|BEGIN PRIVATE KEY'))


def labstack_section(app):
    screen(app, 'labstack', '/admin/integrations/labstack', r'^LabStack integration$', 'admin-labstack')
    check('labstack: the connection card shows the stand-in state and the webhook address', app.has_text(r'^Connection$') and app.has_text(r'^stand-in$|^live$') and app.has_text(r'^Webhook address$') and app.has_text(r'/api/integrations/labstack/webhook'))
    check('labstack: the pending-configuration warning names the variables to set', app.has_text(r'Pending configuration: the stand-in vendor is answering') and app.has_text(r'LABSTACK_API_KEY'))
    check('labstack: the console links exist only here, as external links', app.find_clickable('Open the LabStack console') and app.has_text(r'The link exists nowhere else in Bioptime'))
    check('labstack: the operations view is drawn while the labstackOps module is on', app.has_text(r'^Breaching now$') and app.has_text(r'^Escalations open$') and app.has_text(r'Orders by LabStack order type'))
    check('labstack: the breaching and escalation lists have their stream filters and empty states', app.has_text(r'All streams \(\d+\)') and app.has_text(r'Lab Orders \(\d+\)') and (app.has_text(r'Nothing breaching') or app.has_text(r'overdue')))
    check('labstack: catalogue, health and partner-key cards', app.has_text(r'Tests and packages') and app.has_text(r'Webhooks and safety net') and app.has_text(r'Partner key and widget'))
    # every line of a row shows (the web's table cells hold several): a breaching booking keeps its "Overdue" line
    check('labstack: a breaching booking shows its test, deadline and how long overdue', app.has_text(r'Nothing breaching') or app.has_text(r'^Overdue \d'), app.text()[app.text().find('Breaching now ('):][:300])
    check('labstack: an open escalation shows what, the booking and its age on lines of their own', app.has_text(r'No open escalations') or app.has_text(r'^\d+ (min|h|d)( \d+ (min|h))? ago · '), app.text()[app.text().find('Escalations open ('):][:300])
    check('labstack: the console sections open from here only', all(app.find_clickable(x) for x in ('Orders', 'Appointments', 'Escalations', 'Catalog', 'Widget configs')) and app.has_text(r'These links exist nowhere else in Bioptime'))
    check('labstack: stand-in and not configured are amber, as the web draws "draft"', pill_colour(app, r'^stand-in$') == AMBER and pill_colour(app, r'^not configured$') == AMBER, '%s / %s' % (pill_colour(app, r'^stand-in$'), pill_colour(app, r'^not configured$')))
    if app.has_text(r'^Open$'):
        check('labstack: an open escalation is amber', pill_colour(app, r'^Open$') == AMBER, str(pill_colour(app, r'^Open$')))
    check('labstack: the home order type is named from the server (eyebrow and streams note)', app.has_text(r'^Lab Orders · Home sample$') and app.has_text(r'^Every Bioptime booking is a home sample collection\. The other order types'))
    # the counters are links that bring their card to the top of the screen, as on the web
    for counter, heading in (('Escalations open', r'^Escalations open \(\d+\)$'), ('Breaching now', r'^Breaching now \(\d+\)$'), ('Lab orders today', r'^Orders by LabStack order type$')):
        ok = jump_counter(app, counter, heading)
        check('labstack: the "%s" counter is a link that scrolls to its card' % counter, ok, '' if ok else app.text()[:120])
    # the console opens in a new tab; this tab, whose session lives in memory, stays where it is
    app.js("window.__opened = []; window.open = function (u, t, f) { window.__opened.push([String(u), String(t), String(f)]); return null; }")
    here = app.js('location.href')
    app.click_text('Open the LabStack console')
    app.click_text('Orders')
    app.b.pump(0.6)
    opened = app.js('window.__opened') or []
    check('labstack: the console buttons open a new tab and keep this one', len(opened) == 2 and opened[0][0] == 'https://integration.labstack.in/dashboard' and opened[0][1] == '_blank' and 'noopener' in opened[0][2] and opened[1][0].endswith('/dashboard/orders') and app.js('location.href') == here, str(opened))
    # the safety net runs on demand (audited server-side; no reason, as on the web)
    app.err_mark = len(app.b.errors)
    ok = app.click_text('Run the safety net') and app.wait_text(r'Safety net: \d+ checked, \d+ applied, \d+ placed', 30)
    check('labstack: Run the safety net answers with the web toast', ok, app.text()[:160])
    ok = app.click_text('Sync catalogue now') and app.wait_text(r'Catalogue synced', 30)
    check('labstack: Sync catalogue now answers with the web toast', ok, app.text()[:160])
    # the test webhook: owner, not production; opened and closed, nothing sent
    ok = app.click_text('Send a test webhook') and app.wait_text(r'Send one test webhook', 10) and app.has_text(r'Owner only, never in production')
    check('labstack: the test webhook sheet opens for the owner with its fields', ok and app.has_input('Booking id') and app.has_input('Reason (recorded)'))
    check('labstack: Send stays disabled without a booking id and a reason', app.is_disabled('Send'))
    app.click_text('Cancel')
    app.page_ok('labstack: no console error after the actions')


def users_section(app):
    screen(app, 'users', '/admin/users', r'^Users and permissions$', 'admin-users')
    check('users: the safeguards notice and the accounts list', app.has_text(r'^Safeguards$') and app.has_text(r'Bioptime owner') and app.has_text(r'Operations admin'))
    check('users: the reference and roles cards', app.has_text(r'What each permission allows') and app.has_text(r'The five kinds of account'))
    check('users: each account shows its role, state and MFA', app.has_text(r'^owner$') and app.has_text(r'^admin$') and app.has_text(r'^MFA on$'))
    check('users: the module permissions are summarised per account', app.has_text(r'^Module permissions$') and app.has_text(r'^Permissions for the modules: libraries, courses'))
    # the portal's pill colours: an owner 'active' (green), an administrator 'draft' (amber), MFA on 'active'
    check('users: the role pills take the portal colours (owner green, admin amber)', pill_colour(app, r'^owner$') == GREEN and pill_colour(app, r'^admin$') == AMBER, '%s / %s' % (pill_colour(app, r'^owner$'), pill_colour(app, r'^admin$')))
    check('users: no line the web does not have (permission count, list title)', not app.has_text(r'workspace permissions and \d+ module permissions') and not app.has_text(r'^Accounts$') and not app.has_text(r'Open an account above'))
    ok = app.click_text(ADMIN_EMAIL, exact=False) and app.wait_text(r'^Operations admin$', 30) and app.wait_text(r'Manage the LabStack integration', 30)
    check('users: the administrator opens with every permission as a row', ok, app.text()[:200])
    app.page_ok('screen /admin/users/<id>', r'^Permissions$')
    app.screenshot('admin-user-permissions')
    check('users: the LabStack permission is not held by default', app.checkbox_state('Manage the LabStack integration') is False)
    check('users: the origin of a permission is shown (From the default set / Not held)', app.has_text(r'From the default set') and app.has_text(r'^Not held'))
    # grant with a reason, then revoke with a reason: not held afterwards, as by default, but the explicit override stays
    app.set_checkbox('Manage the LabStack integration', True)
    ok = app.wait_text(r'Grant "Manage the LabStack integration" for Operations admin\?', 10)
    check('users: toggling opens the Grant dialog with the web title and note', ok and app.has_text(r'Takes effect on their next request'))
    check('users: Grant waits for a reason of three characters, as on the web', app.is_disabled('Grant') and app.find_clickable('Cancel') and app.has_input(REASON_FIELD))
    ok = reason_and_confirm(app, 'Grant') and app.wait_text(r'Granted Manage the LabStack integration for Operations admin', 20)
    check('users: the grant is recorded and the toast names the permission and the person', ok, app.text()[:160])
    app.wait_js("(%s)('Manage the LabStack integration') && (%s)((%s)('Manage the LabStack integration'))" % (app._CHECKBOX, app._CHECKED, app._CHECKBOX), 15)
    check('users: the row now reads held, granted explicitly with the reason', app.checkbox_state('Manage the LabStack integration') is True and app.has_text(r'Granted explicitly: ' + REASON[:20]))
    app.js("(%s)('Manage the LabStack integration').click()" % app._CHECKBOX)
    ok = app.wait_text(r'Revoke "Manage the LabStack integration" for Operations admin\?', 10)
    check('users: toggling back opens the Revoke dialog', ok)
    ok = reason_and_confirm(app, 'Revoke') and app.wait_text(r'Revoked Manage the LabStack integration for Operations admin', 20)
    check('users: the revoke is recorded', ok, app.text()[:160])
    # the role change dialog (opened and closed; the role is never changed)
    check('users: an owner is offered the role change for the other account', app.find_clickable('Make owner'))
    ok = app.click_text('Make owner') and app.wait_text(r'Make Operations admin an owner\?', 10)
    check('users: the role change dialog carries the web wording', ok and app.has_text(r'Owners hold every permission, including managing other administrators'))
    app.click_text('Cancel')
    app.page_ok('users: no console error after the actions')


def settings_section(app):
    screen(app, 'settings', '/admin/settings', r'^Settings$', 'admin-settings')
    for card in (r'Password and MFA', r'Active sessions', r'^Policies$', r'^Limits$', r'Email wording per category', r'Payments and messaging', r'Metrics members can log'):
        check('settings: card %s' % card.strip('^$'), app.has_text(card))
    check('settings: MFA is on for the owner and can be switched off with a current code', app.has_text(r'^MFA on$') and app.has_input('Current code') and app.find_clickable('Disable MFA'))
    check('settings: this session is listed', app.has_text(r'this one'))
    check('settings: the runtime pill "simulated services" is amber, as the web\'s "draft"', pill_colour(app, r'^simulated services$') == AMBER, str(pill_colour(app, r'^simulated services$')))
    check('settings: no line the web does not have (range hints, the category prompt)', not app.has_text(r'^1 to 168$') and not app.has_text(r'^1 to 10$') and not app.has_text(r'Choose a category'))
    # runtime: a change without a reason is refused in the web's words; with one it is saved, then put back
    app.err_mark = len(app.b.errors)
    app.click_text('Auto')
    check('settings: a policy change without a reason toasts the web sentence', app.wait_text(r'Say why first: the reason is recorded with the change\.', 10))
    app.type_into('Reason for the next change (recorded, required)', REASON)
    app.click_text('Auto')
    check('settings: the policy change is saved with the reason', app.wait_text(r'^Setting saved$', 20))
    wait_gone(app, r'^Setting saved$', 8)
    app.type_into('Reason for the next change (recorded, required)', REASON)
    app.click_text('Manual')
    check('settings: the policy is put back', app.wait_text(r'^Setting saved$', 20))
    # a notification template: saved, then cleared
    app.click_text('Welcome')
    check('settings: choosing a category shows its subject, body and reason', app.wait_js("!!(%s)('Subject')" % ah.FIND_INPUT, 10) and app.has_input('Body'))
    check('settings: Save waits for a reason', app.is_disabled('Save'))
    app.type_into('Subject', 'Welcome to Bioptime, {{name}}')
    app.type_into('Reason (recorded)', REASON)
    app.click_text('Save')
    check('settings: the template is saved', app.wait_text(r'^Template saved$', 20))
    wait_gone(app, r'^Template saved$', 8)
    app.type_into('Subject', '')
    app.type_into('Reason (recorded)', REASON)
    app.click_text('Save')
    check('settings: clearing it returns the built-in wording', app.wait_text(r'Template cleared; the built-in wording applies', 20))
    # a metric switch, off and on again
    ok = app.click_text('Steps enabled') and app.wait_text(r'^Saved$', 20)
    check('settings: a metric switch saves', ok)
    wait_gone(app, r'^Saved$', 8)
    app.click_text('Steps enabled')
    app.wait_text(r'^Saved$', 20)
    app.page_ok('settings: no console error after the actions')


def modules_section(app):
    screen(app, 'modules', '/admin/modules', r'^Modules$', 'admin-modules')
    check('modules: the seeded-data notice and the three cards', app.has_text(r'Modules in the seeded data') and app.has_text(r'^Switches$') and app.has_text(r'What each module registers on the server') and app.has_text(r'What the modules read'))
    check('modules: a switch row carries its key, audience and the "In the portal" figures', app.has_text(r'^habits$') and app.has_text(r'^Everyone$') and app.has_text(r'1 page, 1 link, 2 client-record tabs, 1 card, 1 setting'))
    check('modules: a part switch says which module it narrows', app.has_text(r'Part of Support: works only while Support is on too'))
    check('modules: the long note is behind a disclosure', app.click_text('What switching off does') and app.wait_text(r'Switching a module off: its server routes refuse requests at once', 5))
    # switch Referrals off and on again, with the computed dialog bodies
    app.click_text('Referrals (referrals)')
    ok = app.wait_text(r'Switch off Referrals\?', 10)
    check('modules: the switch-off dialog has the computed body', ok and app.has_text(r'Its server routes refuse requests \(apart from the few listed under the switches\)') and app.has_text(r'Nothing it stored is deleted'))
    click_dialog_button(app, 'Switch off')
    check('modules: without a reason the dialog answers in the web\'s words', app.wait_text(r'^Say why, in a few words\.$', 5) and app.find_clickable('Keep as is'))
    ok = reason_and_confirm(app, 'Switch off') and app.wait_text(r'^Switched off$', 20)
    check('modules: the switch is off', ok, app.text()[:160])
    wait_gone(app, r'^Switched off$', 8)
    app.click_text('Referrals (referrals)')
    ok = app.wait_text(r'Switch on Referrals\?', 10)
    check('modules: the switch-on dialog has the computed body', ok and app.has_text(r'Its server routes answer again and the portal shows its pages, links, tabs and cards'))
    ok = reason_and_confirm(app, 'Switch on') and app.wait_text(r'^Switched on$', 20)
    check('modules: the switch is on again', ok, app.text()[:160])
    # the audience sheet, opened and kept as is
    ok = app.click_text('Audience') and app.wait_text(r'Audience for Habits', 10)
    check('modules: the audience sheet lists the roles and the packages', ok and app.has_text(r'Members of these packages') and app.checkbox_state('Member') is not None and app.checkbox_state('Starter') is not None)
    app.click_text('Keep as is')
    app.b.pump(0.8)
    # a module setting: a number set, then cleared again
    ok = app.click_text('Change') and app.wait_text(r'Change "Coach follow-up after missed habit days"', 10)
    check('modules: the setting dialog opens with the field and the empty-means-not-decided note', ok and app.has_input('Days') and app.has_text(r'Leave it empty for "not decided"'))
    app.type_into('Days', '7')
    ok = reason_and_confirm(app, 'Save setting') and app.wait_text(r'^Setting saved$', 20)
    shown = app.wait_text(r'7 days', 15)
    check('modules: the setting is saved', ok and shown, '' if shown else app.text()[app.text().find('What the modules read'):][:300])
    wait_gone(app, r'^Setting saved$', 8)
    app.b.pump(0.8)
    app.click_text('Change')
    app.wait_text(r'Change "Coach follow-up after missed habit days"', 10)
    app.type_into('Days', '')
    ok = reason_and_confirm(app, 'Save setting') and app.wait_text(r'^Setting saved$', 20)
    check('modules: the setting is back to not decided', ok and app.wait_text(r'^Not decided$', 10))
    app.page_ok('modules: no console error after the actions')


def content_section(app):
    screen(app, 'content', '/admin/content', r'^Website content$', 'admin-content')
    check('content: the pages are tabs and the sections cards', app.has_text(r'^Every page$') and app.has_text(r'^Announcement bar$') and app.has_text(r'^Navigation$'))
    check('content: preview and publish controls', app.find_clickable('Preview drafts on the website') and app.find_clickable('Publish') and app.is_disabled('Publish'))
    check('content: each block shows its summary and its state line', app.has_text(r'^Built-in default') and app.has_text(r'up to \d+ characters'))
    # a text block: draft saved, discarded, saved again, published, then reset
    app.click_text('Announcement text', exact=False)
    ok = app.wait_text(r'^Built-in default|^Published by|^Draft by', 30) and app.wait_js("!!(%s)('Announcement text')" % ah.FIND_INPUT, 10)
    check('content: a text block opens in its editor (the field named by the block, no caption of its own)', ok and not app.has_text(r'^Text$') and not app.has_text(r'^Up to \d+ characters\.$'), app.text()[:160])
    app.page_ok('screen /admin/content/<key>', r'Announcement text')
    check('content: the built-in state pill is amber, as the web\'s "pending"', pill_colour(app, r'^default$|^published$') == (AMBER if app.has_text(r'^default$') else GREEN), str(pill_colour(app, r'^default$|^published$')))
    app.type_into('Announcement text', 'Hello from the app check')
    ok = app.click_text('Save draft') and app.wait_text(r'^Draft saved$', 20)
    check('content: the draft is saved', ok and app.wait_text(r'^draft$', 10))
    check('content: the draft pill is amber', pill_colour(app, r'^draft$') == AMBER, str(pill_colour(app, r'^draft$')))
    app.screenshot('admin-content-block')
    ok = app.click_text('Discard draft') and app.wait_text(r'^Draft discarded$', 20)
    check('content: the draft is discarded', ok and app.wait_text(r'^default$|^published$', 10) and wait_gone(app, r'^draft$', 10))
    app.type_into('Announcement text', 'Hello again from the app check')
    app.click_text('Save draft')
    app.wait_text(r'^Draft saved$', 20)
    app.open_route('/admin/content', r'^Website content$', 45)
    ok = app.wait_text(r'Publish 1 draft', 20)
    check('content: the list counts the draft', ok and app.has_text(r'^draft$'))
    app.click_text('Publish 1 draft')
    ok = app.wait_text(r'Publish the drafts\?', 10) and app.has_text(r'1 block goes live at once: Announcement text')
    check('content: the publish sheet names the block', ok)
    check('content: the publish sheet has the web\'s buttons and waits for a reason', app.find_clickable('Not yet') and app.is_disabled('Publish to the website') and app.has_input('Why this change, in a few words'))
    ok = reason_and_confirm(app, 'Publish to the website') and app.wait_text(r'Published 1 block; the website shows them now', 20)
    check('content: published with a reason', ok, app.text()[:160])
    app.click_text('Announcement text', exact=False)
    app.wait_text(r'^Published by', 30)
    app.b.pump(0.5)
    ok = app.click_text('Reset') and app.wait_text(r'Return “Announcement text” to its built-in copy\?', 10)
    check('content: the reset dialog', ok)
    ok = reason_and_confirm(app, 'Reset') and app.wait_text(r'Back to the built-in copy', 20)
    check('content: back to the built-in copy', ok and app.wait_text(r'^Built-in default', 10))
    # an image block: the library, an upload from a file, the alternative text rule, then back to the built-in image
    app.open_route('/admin/content', r'^Website content$', 45)
    app.click_text('Home')
    app.wait_text(r'^Images$', 10)
    app.click_text('Ignite programme card image', exact=False)
    ok = app.wait_text(r'Upload an image', 30)
    check('content: an image block opens with the image library', ok and app.has_text(r'PNG, JPEG or WebP, up to 3 MB'))
    png = tiny_png(os.path.join(ah.cs.OUT, 'upload.png'))
    app.click_text('Upload an image')
    app.b.pump(0.6)
    ok = set_file_input(app, png) and app.wait_text(r'Image added to the library', 30)
    check('content: a picked image is uploaded to the library', ok, app.text()[:160])
    check('content: the alternative text is required before saving', app.has_text(r'Describe what the image shows'))
    app.click_text('Save draft')
    check('content: saving without alternative text is refused in the API\'s words', app.wait_text(r'Ignite programme card image: describe the image in the alternative text', 10))
    app.type_into('Alternative text', 'A red square from the app check')
    ok = app.click_text('Save draft') and app.wait_text(r'^Draft saved$', 20)
    check('content: the image draft saves once described', ok)
    app.screenshot('admin-content-image')
    app.click_text('Discard draft')
    app.wait_text(r'^Draft discarded$', 20)
    # the programmatic click on "Upload an image" opens Chrome's file chooser without a user gesture, which Chrome logs;
    # a real tap has the gesture, so that line is not an error of the screen
    errs = [e for e in app.errors_since() if 'File chooser dialog' not in e]
    check('content: no console error after the actions', not errs and not app.has_text(ah.NO_SUCH_SCREEN), '; '.join(errs[:3]))


def theme_section(app):
    screen(app, 'theme', '/admin/theme', r'^Theme and branding$', 'admin-theme')
    check('theme: the palette, the radii and font, and the preview', app.has_text(r'^Palette$') and app.has_text(r'Brand primary') and app.has_text(r'Radii and font') and app.has_text(r'Engineer your best years\.') and app.has_text(r'^Primary action$'))
    muted_before = app.input_value('Muted text value')
    brand_before = app.input_value('Brand primary value')
    check('theme: Save draft and Publish wait for a change and a saved draft', app.is_disabled('Save draft') and app.is_disabled('Publish'))
    # the colour picker sheet (the web's colour input): opened from the swatch, a channel typed, the colour used, then Default
    ok = app.click_text('Brand primary') and app.wait_text(r'^Use this colour$', 10) and app.has_input('Red, 0 to 255')
    check('theme: the swatch opens the colour picker with the channels', ok, app.text()[:200])
    app.type_into('Red, 0 to 255', '200')
    click_dialog_button(app, 'Use this colour')
    app.b.pump(0.6)
    picked = app.input_value('Brand primary value')
    check('theme: the picked colour fills the hex field', bool(picked) and picked != brand_before and picked.upper().startswith('#C8'), '%s -> %s' % (brand_before, picked))
    app.click_text('Default')
    app.b.pump(0.4)
    check('theme: Default puts the brand value back', app.input_value('Brand primary value') == brand_before)
    type_and_blur(app, 'Muted text value', '#333333')
    ok = app.wait_text(r'Contrast below WCAG AA', 10) and app.has_text(r'Muted text on the canvas: [\d.]+:1, needs 4\.5:1')
    check('theme: a failing colour shows the contrast gate message', ok, app.text()[:200])
    check('theme: Default appears for a changed colour', app.find_clickable('Default'))
    ok = app.click_text('Save draft') and app.wait_text(r'Draft saved with contrast warnings', 20)
    check('theme: the draft saves with its warnings', ok)
    app.screenshot('admin-theme-warning')
    app.click_text('Publish')
    ok = app.wait_text(r'Publish this theme\?', 10)
    check('theme: the publish dialog', ok)
    ok = reason_and_confirm(app, 'Publish') and app.wait_text(r'contrast|refused|WCAG', 20)
    check('theme: publishing below WCAG AA is refused by the server, in its words', ok and app.has_text(r'Publish this theme\?'), app.text()[:200])
    check('theme: the dialog has the web\'s "Not yet"', app.find_clickable('Not yet'))
    app.click_text('Not yet')
    app.click_text('Default')
    check('theme: Default restores the brand value', wait_gone(app, r'Contrast below WCAG AA', 10))
    ok = app.click_text('Save draft') and app.wait_text(r'^Draft saved$', 20)
    check('theme: the draft saves again', ok)
    app.click_text('Reset to brand defaults')
    ok = app.wait_text(r'Reset to the brand book\?', 10)
    check('theme: the reset dialog', ok)
    ok = reason_and_confirm(app, 'Reset') and app.wait_text(r'Back to the brand book defaults', 20)
    check('theme: back to the brand book defaults', ok)
    app.b.pump(1.0)
    check('theme: after the reset the fields show the brand book again', app.input_value('Muted text value') == muted_before, '%s vs %s' % (app.input_value('Muted text value'), muted_before))
    # the preview draws its texts in the draft's font, as the web's --bp-font-sans (not saved: nothing changes on the server)
    app.click_text('System font (the brand stack\'s fallback)')
    app.b.pump(0.4)
    sys_face = font_of(app, 'Engineer your best years.')
    app.click_text('Montserrat (the brand face)')
    montserrat = "Array.from(document.fonts || []).some((f) => f.family.replace(/[\"']/g, '') === 'Montserrat' && f.status === 'loaded')"
    loaded = app.wait_js(montserrat, 15)
    brand_face = font_of(app, 'Engineer your best years.')
    check('theme: the preview follows the font choice (system face, then Montserrat, loaded from the portal\'s font file)', sys_face.startswith('system-ui') and 'Montserrat' not in sys_face and brand_face.lstrip('"').startswith('Montserrat') and loaded, '%s | %s | loaded=%s' % (sys_face, brand_face, loaded))
    check('theme: the font choice applies to the preview only (the screen title keeps the app face)', 'Montserrat' not in font_of(app, 'Theme and branding'), font_of(app, 'Theme and branding'))
    # the refused publish above is a 409 the server answers on purpose; Chrome logs the failed request as an error
    errs = [e for e in app.errors_since() if not ('409' in e and '/api/admin/theme/publish' in e)]
    check('theme: no console error after the actions', not errs and not app.has_text(ah.NO_SUCH_SCREEN), '; '.join(errs[:3]))


SECTIONS = {'integrations': integrations_section, 'labstack': labstack_section, 'users': users_section, 'settings': settings_section, 'modules': modules_section, 'content': content_section, 'theme': theme_section}


def run(app, ctx=None):
    """For tools/e2e_app.py's admin section: the app is signed in as the owner already."""
    for name in SECTION_NAMES:
        SECTIONS[name](app)


def main():
    if not BASE:
        sys.exit('BASE is required: the scratch API, e.g. BASE=http://127.0.0.1:4331 (never the live demo).')
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
        r = app.sign_in('admin', OWNER[0], OWNER[1])
        check('the owner signs in through the administrator sign-in with the preview code', r['ok'], r['detail'])
        if r['ok']:
            for name in only:
                t1 = time.monotonic()
                try:
                    SECTIONS[name](app)
                except Exception as e:
                    traceback.print_exc()
                    check('section %s completed without an unexpected error' % name, False, repr(e)[:300])
                timings[name] = round(time.monotonic() - t1, 1)
                print('  (%s took %.0fs)' % (name, timings[name]))
            ok, detail = app.sign_out()
            check('sign out', ok, detail)
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
    timings['total'] = round(time.monotonic() - t0, 1)
    summary = ah.write_report({'base': BASE, 'app': app_url, 'sections': only, 'seconds': timings})
    print(json.dumps(summary))
    sys.exit(1 if summary['failed'] else 0)


if __name__ == '__main__':
    main()
