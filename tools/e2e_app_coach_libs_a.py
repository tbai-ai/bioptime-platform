#!/usr/bin/env python3
"""End-to-end check of the coach's libraries, part A, in the app (apps/mobile, group coach-libs-a): check-in templates,
the nutrition library and the meal plan editor, through the app's Expo web build in headless Chrome at 390x844
(Python 3.9, stdlib, Google Chrome), on the shared harness tools/app_harness.py.

    BASE=http://127.0.0.1:4361 APP_PORT=9361 E2E_CDP_PORT=9761 python3 -I tools/e2e_app_coach_libs_a.py
    BASE=… APP_URL=http://localhost:9361 E2E_APP_ONLY=meal-plans python3 -I tools/e2e_app_coach_libs_a.py

BASE is a scratch API (required; the usual recipe: reset-demo, then src/server.ts on its own port, started with
CORS_ORIGINS=http://localhost:<APP_PORT>). The check starts `npx expo start --web --port <APP_PORT> --clear` for
apps/mobile with EXPO_PUBLIC_API_BASE=<BASE> in its own process group and stops it at the end (APP_URL drives a server
that is already running instead). As tools/e2e_app.py: the live demo's ports (3000, 3100, 3101 and 8081) are refused for
BASE, APP_PORT and APP_URL, BASE must be an explicit port on 127.0.0.1, localhost, *.localhost or *.test, and E2E_OUT
and E2E_CDP_PORT keep parallel runs apart (defaults .local/e2e/app-coach-libs-a/ and 9761).

Sections (E2E_APP_ONLY, default all but switched-off, in this order). One sign-in through the app's coach screen as
Asha, one coach sign-in from Python for record ids and to confirm what the screens wrote:
  checkin-templates   the list as on the web, a row's questions, "Write your own" (Save disabled until ready, the key
                      derived from the wording, the web's toast), "Use with a client": a weekly check-in set for Priya,
                      Ananya's existing schedule replaced, a check-in asked for now (each confirmed through the API)
  nutrition-library   the notices, Foods and Recipes, search and the Draft filter through the API, the food form's own
                      validation and the source rule, a saved food and a saved recipe with an ingredient
  meal-plans          Priya's draft plan (head, Basics, Week, Totals, History, Save draft, the library link), a new plan
                      without a client refused, a new plan for Priya with a target and a meal published, then archived
                      through the web's reason dialog (its copy and its three-character rule)
  record-links        "Open the client’s check-ins" (templates sheet) and "← Client" (meal plan) land on the client's
                      record at ?tab=goals / ?tab=nutrition (kept last: the record is another group's screen)
  switched-off        (only when named) the owner switches nutrition and progress off from Python (two owner sign-ins),
                      and after the app's one-minute flag cache the three screens show "No such page"; then both go
                      back on

Every screen must raise no console error, not be the not-found screen, show no error box and no "demo" / "sample"
label. Exit status 1 if anything fails; the JSON summary is the last line. Every record written here carries an E2E
marker in its title and lives only in the scratch database."""
import json
import os
import re
import sys
import time
import traceback

sys.dont_write_bytecode = True   # no tools/__pycache__ from importing the harness (python -I does not prevent it)
os.environ['APP_STAFF'] = '1'   # coach and administrator screens exist only in the staff build: the harness starts Expo with EXPO_PUBLIC_STAFF_APP=1
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import app_harness as ah  # noqa: E402
from app_harness import check, skip  # noqa: E402

BASE = os.environ.get('BASE', '').rstrip('/')
APP_PORT = os.environ.get('APP_PORT') or '9361'
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
APP_DIR = os.environ.get('APP_DIR') or None
OUT = os.environ.get('E2E_OUT') or os.path.join(ah.PLATFORM, '.local', 'e2e', 'app-coach-libs-a')
CDP_PORT = os.environ.get('E2E_CDP_PORT') or '9761'
SECTION_NAMES = ('checkin-templates', 'nutrition-library', 'meal-plans', 'record-links', 'switched-off')
DEFAULT_SECTIONS = ('checkin-templates', 'nutrition-library', 'meal-plans', 'record-links')

COACH = ('asha.menon@demo.bioptime.test', 'Demo-Coach-2026!')
OWNER = ('owner@demo.bioptime.test', 'Demo-Owner-2026!')
STAMP = time.strftime('%H%M%S')
E2E = 'E2E %s' % STAMP   # the marker every record written here carries
SHOT = 'coach-libs-a-'


def no_labels(app, name):
    hit = app.label_hit()
    check(name + ': no demo or sample label on the screen', not hit, hit)


def open_screen(app, route, expect, name, shot=None, seconds=45):
    """Open a route, check it drew (`expect` over the body), no console error, no error box, no label; screenshot."""
    app.open_route(route, expect, seconds)
    ok = app.page_ok(name, expect)
    no_labels(app, name)
    if shot:
        app.screenshot(SHOT + shot)
    return ok


def wait_path(app, rx, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if re.search(rx, app.path() + (app.js('location.search') or '')):
            return True
        app.b.pump(0.3)
    return False


LAST_BUTTON = r"""(text) => { %s const t = norm(text);
  const all = Array.from(document.querySelectorAll('[role=button],button')).filter((e) => norm(e.innerText) === t || norm(e.getAttribute('aria-label')) === t);
  return all.length ? all[all.length - 1] : null; }""" % ah._NORM


def last_button_disabled(app, text):
    """Whether the LAST button of that name is disabled (a bottom sheet is appended to the body, so its button comes
    after the screen's button of the same name)."""
    return bool(app.js("((el) => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true'))((%s)(%s))" % (LAST_BUTTON, json.dumps(text))))


def click_last(app, text):
    """Press the LAST button of that name (the one in the open sheet)."""
    return bool(app.js("((el) => { if (!el) return false; el.scrollIntoView({block: 'center'}); el.click(); return true; })((%s)(%s))" % (LAST_BUTTON, json.dumps(text))))


def pick(app, control, option):
    """Open a SelectField (its accessibility label) and choose an option by its label (an includes match: the option
    row also carries its detail line)."""
    if not app.click_text(control):
        return False
    app.b.pump(1.0)   # the sheet slides in
    if not app.click_text(option, exact=False):
        return False
    app.b.pump(0.6)
    return True


class Ids:
    """Record ids the sections open, read from the scratch API with one coach sign-in (kept for confirming writes)."""

    def __init__(self):
        self.coach = ah.ApiSession(BASE).login(*COACH, workspace='coach')
        clients = self.coach.get('/coach/clients?limit=100')['items']
        self.priya = next((c['id'] for c in clients if c['name'].startswith('Priya')), None)
        self.ananya = next((c['id'] for c in clients if c['name'].startswith('Ananya')), None)
        self.priya_plan = None
        if self.priya:
            plans = self.coach.get('/coach/clients/%s/nutrition' % self.priya).get('plans') or []
            self.priya_plan = next((p for p in plans if p['status'] == 'draft'), plans[0] if plans else None)

    def schedules(self, member):
        return self.coach.get('/coach/clients/%s/checkin-schedules' % member).get('items') or []

    def checkins(self, member):
        return self.coach.get('/coach/clients/%s/checkins' % member).get('items') or []

    def close(self):
        self.coach.logout()


def checkin_templates(app, ids):
    print('checkin-templates')
    if not open_screen(app, '/coach/checkin-templates', r'^Check-in templates$', 'check-in templates list', 'checkin-templates'):
        return
    check('check-in templates: the sub-line reads as on the web', app.has_text(r'The published library and your own templates\. Yours are usable at once, by you alone\.'))
    check('check-in templates: "Weekly check-in" is listed as Library · 4 questions, Published', app.has_text(r'^Weekly check-in$') and app.has_text(r'Library · 4 questions · updated \d+ \w+ \d{4}') and app.has_text(r'^PUBLISHED$|^Published$'), app.text()[:300])
    check('check-in templates: the footnote about self-reported values', app.has_text(r'Select a row to see its questions\. Answers tied to a measure are logged as the member’s self-reported values\.'))
    app.click_text('Weekly check-in', exact=False)
    shown = app.wait_text(r'^1\. .+ · (1 to 5|Number|Free text|Yes or no)', 10)
    check('check-in templates: pressing a row opens its questions with their answer types', shown, app.text()[:400])
    check('check-in templates: a question that logs a measure names it ("· logs …")', app.has_text(r' · logs [A-Z]'), app.text()[:400])
    app.screenshot(SHOT + 'checkin-template-open')

    # "Write your own": the web's TemplateDialog
    app.click_text('Write your own')
    sheet = app.wait_text(r'^Write a check-in template$', 10)
    check('check-in templates: "Write your own" opens "Write a check-in template"', sheet)
    if sheet:
        check('check-in templates: Save is disabled until the title and a question are written', app.is_disabled('Save'))
        title = '%s sleep check' % E2E
        app.type_into('Title', title)
        app.type_into('Question 1', 'How did you sleep this week?')
        app.b.pump(0.4)
        key = app.input_value('Key 1')
        check('check-in templates: the key is derived from the wording', key == 'how_did_you_sleep_this_week', str(key))
        check('check-in templates: the answer types are the web\'s', app.has_text(r'^1 to 5$'))
        check('check-in templates: Save is enabled once the title and the question are ready', not app.is_disabled('Save'))
        app.screenshot(SHOT + 'checkin-template-write')
        app.click_text('Save')
        saved = app.wait_text(r'^Template saved; only you can use it$', 20)
        check('check-in templates: the template is saved with the web\'s toast', saved, app.text()[:200])
        check('check-in templates: the new template is listed as Asha\'s own', app.wait_text(re.escape(title), 20) and app.has_text(r'Asha Menon’s own'), app.text()[:400])

    # "Use with a client": the web's weekly check-in card with this template chosen
    if not (ids.priya and ids.ananya):
        skip('check-in templates: use with a client', 'the seed gives Asha no Priya or Ananya')
        return
    app.click_text('Weekly check-in', exact=False)   # closes the open row (it was left open)
    app.b.pump(0.4)
    if not app.has_text(r'^1\. '):
        app.click_text('Weekly check-in', exact=False)
    app.wait_text(r'^1\. ', 10)
    if not app.click_text('Use with a client'):
        check('check-in templates: an opened published template offers "Use with a client"', False, app.text()[:300])
        return
    check('check-in templates: "Use with a client" opens its sheet', app.wait_text(r'^Use with a client$', 10) and app.has_text(r'“Weekly check-in” · 4 questions'))
    check('check-in templates: Set weekly waits for a client', last_button_disabled(app, 'Set weekly'))
    before = [s for s in ids.schedules(ids.priya) if s['active']]
    pick(app, 'Client', 'Priya Nair')
    check('check-in templates: Priya has no weekly check-in yet (as the web words it)', app.wait_text(r'^No weekly check-in yet\.$', 10) or bool(before), app.text()[-300:])
    pick(app, 'Every', 'Friday')
    app.screenshot(SHOT + 'checkin-use-sheet')
    click_last(app, 'Replace weekly' if before else 'Set weekly')
    toast = 'Weekly check-in replaced' if before else 'Weekly check-in set'
    check('check-in templates: setting Priya\'s weekly check-in answers with the web\'s toast', app.wait_text(r'^%s$' % toast, 20), app.text()[:200])
    after = [s for s in ids.schedules(ids.priya) if s['active']]
    check('check-in templates: the API now holds Priya\'s weekly "Weekly check-in" on Friday', any(s['templateTitle'] == 'Weekly check-in' and s['weekday'] == 5 for s in after), json.dumps(after)[:300])

    # Ananya already has a weekly check-in: the sheet says so and replaces it; then a check-in is asked for now
    app.click_text('Use with a client')
    app.wait_text(r'^Use with a client$', 10)
    pick(app, 'Client', 'Ananya Rao')
    line = app.wait_text(r'^Every \w+day: “.+”, set by .+ on \d+ \w+ \d{4}\.$', 10)
    check('check-in templates: Ananya\'s current weekly check-in is shown with the web\'s line', line, app.text()[-300:])
    check('check-in templates: with a schedule in place the button reads "Replace weekly"', app.wait_clickable('Replace weekly', 5))
    pick(app, 'Every', 'Monday')
    click_last(app, 'Replace weekly')
    check('check-in templates: Ananya\'s weekly check-in replaced with the web\'s toast', app.wait_text(r'^Weekly check-in replaced$', 20), app.text()[:200])
    act = [s for s in ids.schedules(ids.ananya) if s['active']]
    check('check-in templates: the API holds one active schedule for Ananya, on Monday', len(act) == 1 and act[0]['weekday'] == 1, json.dumps(act)[:300])
    # "Ask for one now": the server lets a client have at most five check-ins waiting (TOO_MANY_OPEN_CHECKINS), so a
    # client under that cap is asked (repeated runs fill Ananya's), and one at the cap shows the server's refusal
    waiting = {name: len([c for c in ids.checkins(mid) if c['status'] == 'requested']) for name, mid in (('Ananya Rao', ids.ananya), ('Priya Nair', ids.priya))}
    under = next((n for n in ('Ananya Rao', 'Priya Nair') if waiting[n] < 5), None)
    full = next((n for n in ('Ananya Rao', 'Priya Nair') if waiting[n] >= 5), None)
    if under:
        app.click_text('Use with a client')
        app.wait_text(r'^Use with a client$', 10)
        pick(app, 'Client', under)
        app.wait_clickable('Ask for one now', 10)
        click_last(app, 'Ask for one now')
        check('check-in templates: "Ask for one now" (%s) answers with the web\'s toast' % under, app.wait_text(r'^Asked; the member was told$', 20), app.text()[:200])
        mid = ids.ananya if under == 'Ananya Rao' else ids.priya
        now_waiting = len([c for c in ids.checkins(mid) if c['status'] == 'requested'])
        check('check-in templates: the API holds one more check-in waiting for %s\'s answers' % under, now_waiting == waiting[under] + 1, '%s → %s' % (waiting[under], now_waiting))
    else:
        skip('check-in templates: "Ask for one now" succeeds', 'both clients already have five check-ins waiting (repeated runs on one scratch database)')
    if full:
        app.click_text('Use with a client')
        app.wait_text(r'^Use with a client$', 10)
        pick(app, 'Client', full)
        app.wait_clickable('Ask for one now', 10)
        click_last(app, 'Ask for one now')
        check('check-in templates: a client with five check-ins waiting gets the server\'s refusal in the sheet', app.wait_text(r'already has five check-ins waiting', 15), app.text()[-300:])
        app.err_mark = len(app.b.errors)   # the refused request (409) is logged by the browser; it is the expected answer
        app.click_text('Close')
        app.b.pump(0.8)
    app.page_ok('check-in templates after the actions', r'^Check-in templates$')
    app.screenshot(SHOT + 'checkin-used')


def nutrition_library(app, ids):
    print('nutrition-library')
    if not open_screen(app, '/coach/nutrition-library', r'^Nutrition library$', 'nutrition library', 'nutrition-library'):
        return
    check('nutrition library: the sub-line reads as on the web', app.has_text(r'Published foods and recipes, and your own drafts\. Your drafts are usable in your plans; the Bioptime team publishes them for everyone\.'))
    check('nutrition library: the source notice and the pending licensed dataset', app.has_text(r'^Nutrient values need a source$') and app.has_text(r'^Pending configuration: licensed food dataset$'))
    check('nutrition library: Foods lists the seeded foods with Asha\'s draft marked "my draft"', app.has_text(r'^Ragi dosa$') and app.has_text(r'^my draft$|^MY DRAFT$') and app.has_text(r'^Moong dal$'), app.text()[:400])
    lib = ids.coach.get('/coach/nutrition-library')
    nf, nr = len(lib['foods']), len(lib['recipes'])
    check('nutrition library: the tabs count Foods (%d) and Recipes (%d) as the API lists them' % (nf, nr), app.has_text(r'Foods\s*%d' % nf) and app.has_text(r'Recipes\s*%d' % nr), app.text()[:400])
    app.click_text('Ragi dosa', exact=False)
    check('nutrition library: a food row opens its details (Values per serving, Source)', app.wait_text(r'^Values per serving$', 10) and app.has_text(r'^Source$'))
    app.click_text('Recipes', exact=False)
    check('nutrition library: the Recipes tab lists "Dal and rice bowl" with its ingredients', app.wait_text(r'^Dal and rice bowl$', 10) and app.has_text(r'Moong dal|Steamed rice'), app.text()[:300])
    app.click_text('Foods', exact=False)
    app.type_into('Name or title', 'Ragi')
    found = app.wait_js("!/Moong dal/.test(document.body.innerText) && /Ragi dosa/.test(document.body.innerText)", 15)
    check('nutrition library: searching filters the library through the API (only "Ragi dosa" stays)', found, app.text()[-300:])
    app.type_into('Name or title', '')
    app.wait_text(r'^Moong dal$', 15)
    app.click_text('Draft')
    drafts = app.wait_js("!/Moong dal/.test(document.body.innerText) && /Ragi dosa/.test(document.body.innerText)", 15)
    check('nutrition library: the Draft filter shows only drafts (Asha\'s "Ragi dosa")', drafts, app.text()[-300:])
    app.click_text('Any')
    app.wait_text(r'^Moong dal$', 15)
    # the food form: its own checks, then the source rule, then a saved draft
    app.click_text('Add food (draft)')
    sheet = app.wait_text(r'^Add a food \(draft\)$', 10)
    check('nutrition library: "Add food (draft)" opens "Add a food (draft)"', sheet)
    if sheet:
        check('nutrition library: the food sheet has the web\'s fields', all(app.has_input(f) for f in ('Name', 'Serving', 'Serving weight (g)', 'Energy (kcal)', 'Protein (g)', 'Carbohydrate (g)', 'Fat (g)', 'Fibre (g)', 'Source', 'Tags (comma separated)')))
        app.click_text('Save')
        check('nutrition library: an empty food is refused by the form (name)', app.wait_text(r'^At least 2 characters\.$', 5))
        food = '%s oats' % E2E
        app.type_into('Name', food)
        app.type_into('Energy (kcal)', '150')
        app.click_text('Save')
        check('nutrition library: a value without its source is refused as the schema and the server say', app.wait_text(r'^Required with any value: the label, publication or table the values were read from\.$', 5), app.text()[:200])
        app.type_into('Source', 'Packet label')
        app.type_into('Tags (comma separated)', 'breakfast, e2e')
        app.screenshot(SHOT + 'nutrition-food-form')
        app.click_text('Save')
        check('nutrition library: the draft food is saved with the web\'s toast', app.wait_text(r'^Draft food added: usable in your plans$', 20), app.text()[:200])
        app.type_into('Name or title', 'E2E')
        check('nutrition library: the new food is listed as my draft with its values', app.wait_text(re.escape(food), 20) and app.has_text(r'energy 150 kcal'), app.text()[-300:])
        app.screenshot(SHOT + 'nutrition-food-saved')
        app.type_into('Name or title', '')
        app.wait_text(r'^Moong dal$', 15)
    # the recipe form with an ingredient linked to a library food
    app.click_text('Add recipe (draft)')
    sheet = app.wait_text(r'^Add a recipe \(draft\)$', 10)
    check('nutrition library: "Add recipe (draft)" opens "Add a recipe (draft)"', sheet)
    if sheet:
        app.click_text('Save')
        check('nutrition library: an empty recipe is refused by the form (title)', app.wait_text(r'^At least 2 characters\.$', 5))
        recipe = '%s porridge' % E2E
        app.type_into('Title', recipe)
        app.type_into('Servings', '2')
        app.type_into('Preparation (minutes)', '10')
        app.click_text('Add an ingredient')
        pick(app, 'Food of ingredient 1', 'Plain curd')
        check('nutrition library: choosing a library food fills the ingredient\'s name', app.input_value('Ingredient 1') == 'Plain curd', str(app.input_value('Ingredient 1')))
        app.type_into('Quantity 1', '1')
        app.type_into('Unit 1', 'serving')
        app.screenshot(SHOT + 'nutrition-recipe-form')
        app.click_text('Save')
        check('nutrition library: the draft recipe is saved with the web\'s toast', app.wait_text(r'^Recipe added as a draft$', 20), app.text()[:200])
        app.click_text('Recipes', exact=False)
        check('nutrition library: the new recipe is listed with its ingredient', app.wait_text(re.escape(recipe), 20) and app.has_text(r'Plain curd 1 serving'), app.text()[:400])
        app.page_ok('nutrition library after the drafts', r'^Nutrition library$')
        app.screenshot(SHOT + 'nutrition-recipe-saved')


def meal_plans(app, ids):
    print('meal-plans')
    if not ids.priya or not ids.priya_plan:
        skip('meal plan editor', 'the seed gives Asha no plan for Priya')
        return
    title = ids.priya_plan['title']
    if not open_screen(app, '/coach/meal-plans/%s' % ids.priya_plan['id'], r'^%s$' % re.escape(title), 'meal plan editor (existing)', 'meal-plan'):
        return
    check('meal plan: the head names the client, the version and the status', app.has_text(r'^Priya Nair · version \d+ · draft'), app.text()[:200])
    check('meal plan: Basics, Week, Totals per day and History are drawn', all(app.has_text(t) for t in (r'^Basics$', r'^WEEK$|^Week$', r'^Totals per day$', r'^History$')), app.text()[:400])
    check('meal plan: the days with meals show them, the others read "No meals planned."', app.has_text(r'^No meals planned\.$') and app.has_text(r'^Monday$'))
    check('meal plan: History prints the version status as the web does ("Version 1 · draft")', app.has_text(r'^Version \d+ · draft'), app.text()[-300:])
    check('meal plan: the scope note and the library footnote', app.has_text(r'Within your coaching scope: no diet-for-condition claims') and app.has_text(r'Foods and recipes come from the nutrition library: published items and your own drafts\.'))
    app.click_text('Save draft')
    check('meal plan: Save draft keeps the draft and says so', app.wait_text(r'^Draft saved$', 20), app.text()[:200])
    app.click_text('nutrition library')
    check('meal plan: the footnote\'s "nutrition library" opens the library', wait_path(app, r'^/coach/nutrition-library', 15) and app.wait_text(r'^Nutrition library$', 30), app.path())
    # a new plan without a client is refused with the web's words
    if not open_screen(app, '/coach/meal-plans/new', r'^New meal plan$', 'meal plan editor (new, no client)'):
        return
    app.type_into('Title', '%s no client' % E2E)
    app.click_text('Save draft')
    check('meal plan (new): without a client the web\'s "Choose the client first"', app.wait_text(r'^Choose the client first$', 5), app.text()[:300])
    # a new plan for Priya: the form's validation, a target, a meal, publish, archive
    if not open_screen(app, '/coach/meal-plans/new?member=%s' % ids.priya, r'^New meal plan$', 'meal plan editor (new)', 'meal-plan-new'):
        return
    check('meal plan (new): the sub-line as on the web', app.has_text(r'A draft until you publish it\. Publishing shows it to the client and tells them\.'))
    check('meal plan (new): the client comes from ?member=', app.has_text(r'^Priya Nair$'), app.text()[:300])
    app.click_text('Save draft')
    check('meal plan (new): an empty title is refused by the form', app.wait_text(r'^At least 2 characters\.$', 5))
    plan = '%s plan' % E2E
    app.type_into('Title', plan)
    check('meal plan (new): the Energy target field takes a number', app.type_into('Energy target', '1800'))
    app.click_text('Add meal')
    added = app.wait_js("!!(%s)('Meal 1 name')" % ah.FIND_INPUT, 5)
    check('meal plan (new): Add meal adds a meal row to Monday', added)
    if added:
        app.type_into('Meal 1 name', 'Oats with fruit')
        app.type_into('Meal 1 time', '08:00')
        pick(app, 'Meal 1 food or recipe', 'Moong dal')
        check('meal plan (new): the food is chosen from the library picker', app.has_text(r'^Moong dal$'), app.text()[:600])
        app.click_text('Copy Monday to every day')
        check('meal plan (new): "Copy Monday to every day" copies the meal to all seven days', app.wait_text(r'^7 meals$', 5), app.text()[:600])
    app.screenshot(SHOT + 'meal-plan-new-filled')
    app.click_text('Publish')
    published = app.wait_text(r'^Meal plan published: the client has been told$', 25)
    check('meal plan (new): Publish saves and publishes with the web\'s toast', published, app.text()[:200])
    check('meal plan (new): the screen moves to the saved plan\'s route', wait_path(app, r'^/coach/meal-plans/mpl_', 15), app.path())
    check('meal plan (new): the published plan shows its totals with the target row', app.wait_text(r'^Totals per day$', 20) and app.has_text(r'^Target$') and app.has_text(r'Energy 1800'), app.text()[:600])
    check('meal plan (new): the totals per day come from the library values', app.has_text(r'All entered|meals without values'), app.text()[-600:])
    app.page_ok('meal plan (published)', r'^Totals per day$')
    app.screenshot(SHOT + 'meal-plan-published')
    app.click_text('Archive')
    sheet = app.wait_text(r'^Archive this meal plan\?$', 10)
    check('meal plan: Archive asks for a reason with the web\'s words', sheet and app.has_text(r'The client no longer sees it\. The history stays\.') and app.has_text(r'^Reason \(recorded in the audit log\)$') and app.find_clickable('Keep as is'), app.text()[-300:])
    app.type_into('Reason', 'ok')
    click_last(app, 'Archive')
    check('meal plan: a reason under three characters is refused with "Say why, in a few words."', app.wait_text(r'^Say why, in a few words\.$', 5))
    app.type_into('Reason', 'Written by the app check')
    app.screenshot(SHOT + 'meal-plan-archive-sheet')
    click_last(app, 'Archive')
    check('meal plan: archived with the web\'s toast and notice', app.wait_text(r'^Meal plan archived$', 20) and app.wait_text(r'This plan is archived and no longer shown to the client', 20), app.text()[:300])
    check('meal plan: an archived plan offers no Save draft or Publish', not app.find_clickable('Save draft') and not app.find_clickable('Publish'))
    app.page_ok('meal plan (archived)', r'^Archived$')
    app.screenshot(SHOT + 'meal-plan-archived')


def record_links(app, ids):
    """The two ways these screens lead into a client's record (another group's screen), kept last because they leave
    this group's screens: "Open the client’s check-ins" on the templates sheet and "← Client" on the meal plan editor.
    The route each one lands on is this group's; what the record then draws is checked separately."""
    print('record-links')
    if not (ids.ananya and ids.priya_plan):
        skip('record links', 'the seed gives Asha no Ananya or no plan for Priya')
        return
    open_screen(app, '/coach/checkin-templates', r'^Check-in templates$', 'check-in templates (for the record link)')
    app.click_text('Weekly check-in', exact=False)
    app.wait_text(r'^1\. ', 10)
    app.click_text('Use with a client')
    app.wait_text(r'^Use with a client$', 10)
    pick(app, 'Client', 'Ananya Rao')
    app.click_text('Open the client’s check-ins', seconds=10)
    check('check-in templates: "Open the client’s check-ins" opens /coach/clients/<Ananya>?tab=goals', wait_path(app, r'^/coach/clients/%s\?tab=goals' % re.escape(ids.ananya), 20), app.path() + (app.js('location.search') or ''))
    app.settled(90)
    check('client record (coach-core\'s screen) draws the goals tab after the link', app.wait_text(r'Weekly check-in|Set a goal for the client', 60) and not app.errors_since(), '; '.join(app.errors_since()[:2]) or app.text()[:200])
    app.screenshot(SHOT + 'record-goals')
    app.open_route('/coach/checkin-templates', r'^Check-in templates$|Sign in to the workspace', 30)
    if not app.has_text(r'^Check-in templates$'):   # a crash in the record can drop the in-memory session on the web
        app.workspace = None
        r = app.sign_in('coach', *COACH)
        check('Asha signs in again after the record screen', r['ok'], r['detail'])
    open_screen(app, '/coach/meal-plans/%s' % ids.priya_plan['id'], r'^%s$' % re.escape(ids.priya_plan['title']), 'meal plan editor (for the record link)')
    app.click_text('← Client')
    check('meal plan: "← Client" opens /coach/clients/<Priya>?tab=nutrition', wait_path(app, r'^/coach/clients/%s\?tab=nutrition' % re.escape(ids.priya), 20), app.path() + (app.js('location.search') or ''))
    app.settled(90)
    check('client record (coach-core\'s screen) draws the Nutrition tab after the link', app.wait_text(r'^Meal plans$|^MEAL PLANS$', 60) and not app.errors_since(), '; '.join(app.errors_since()[:2]) or app.text()[:200])
    app.screenshot(SHOT + 'record-nutrition')


def switched_off(app, base):
    """The flag gates: the owner switches nutrition and progress off (PATCH /admin/modules, one owner sign-in), and after
    the app's one-minute flag cache the nutrition library, the meal plan editor and the check-in templates show the web's
    "No such page" with the server's own sentence instead of their bodies; then both modules go back on."""
    def toggle(enabled):
        owner = ah.ApiSession(base)
        try:
            owner.login(*OWNER, workspace='admin', mfa_code=ah.demo_totp(base, OWNER[0]))
            ok = True
            for key in ('nutrition', 'progress'):
                st, j, _ = ah.api(base, 'PATCH', '/admin/modules', {'key': key, 'enabled': enabled, 'reason': 'Switched by the app check (coach-libs-a)'}, token=owner.token)
                ok = check('owner switches %s %s' % (key, 'on' if enabled else 'off'), st == 200, '%s %s' % (st, json.dumps(j)[:120])) and ok
            return ok
        except RuntimeError as e:
            return check('owner switches nutrition and progress %s' % ('on' if enabled else 'off'), False, str(e))
        finally:
            owner.logout()
    print('switched-off')
    if not toggle(False):
        toggle(True)
        return
    try:
        time.sleep(61)   # lib/features keeps the flags for a minute
        for route, body, name in (('/coach/nutrition-library', r'^Nutrient values need a source$', 'nutrition library'),
                                  ('/coach/meal-plans/new', r'^Basics$', 'meal plan editor'),
                                  ('/coach/checkin-templates', r'^Write your own$', 'check-in templates')):
            app.open_route(route, r'^No such page$|' + body, 45)
            gated = app.wait_text(r'^No such page$', 45)
            check('%s with its module off: the web\'s "No such page" with the server\'s sentence' % name, gated and app.has_text(r'^This part of Bioptime is not switched on\.$') and not app.has_text(body), app.text()[:300])
            app.page_ok('%s (module off)' % name, r'^No such page$')
            app.screenshot(SHOT + 'switched-off-' + route.split('/')[2])
    finally:
        toggle(True)


def run(app, ctx, only=None):
    """The sections, on a signed-in coach (ctx['base'] is the scratch API). Also callable from tools/e2e_app.py."""
    global BASE
    BASE = ctx.get('base', BASE)
    sections = [s for s in SECTION_NAMES if (s in only if only else s in DEFAULT_SECTIONS)]
    if app.workspace != 'coach':
        if app.workspace:
            app.sign_out()
        r = app.sign_in('coach', *COACH)
        check('Asha signs in through the coach sign-in', r['ok'], r['detail'])
        if not r['ok']:
            return
    ids = Ids()
    try:
        for name in sections:
            try:
                if name == 'checkin-templates':
                    checkin_templates(app, ids)
                elif name == 'nutrition-library':
                    nutrition_library(app, ids)
                elif name == 'meal-plans':
                    meal_plans(app, ids)
                elif name == 'record-links':
                    record_links(app, ids)
                elif name == 'switched-off':
                    switched_off(app, BASE)
            except Exception as e:  # one section's crash never hides the others
                check('section %s ran without an exception' % name, False, '%s: %s' % (type(e).__name__, e))
                traceback.print_exc()
    finally:
        ids.close()


def main():
    if not BASE:
        print('BASE (the scratch API, e.g. http://127.0.0.1:4361) is required')
        return 2
    why = ah.live_refusal(BASE)
    if why:
        print('Refusing BASE %s: %s' % (BASE, why))
        return 2
    why = ah.port_refusal(APP_PORT)
    if why and not APP_URL:
        print('Refusing APP_PORT %s: %s' % (APP_PORT, why))
        return 2
    if APP_URL:
        why = ah.live_refusal(APP_URL)
        if why:
            print('Refusing APP_URL %s: %s' % (APP_URL, why))
            return 2
    why = ah.cdp_refusal(CDP_PORT)
    if why:
        print('Refusing E2E_CDP_PORT %s: %s' % (CDP_PORT, why))
        return 2
    only = [s.strip() for s in os.environ.get('E2E_APP_ONLY', '').split(',') if s.strip()]
    bad = [s for s in only if s not in SECTION_NAMES]
    if bad:
        print('Unknown section(s) %s; choose from %s' % (', '.join(bad), ', '.join(SECTION_NAMES)))
        return 2
    ah.configure(out=OUT, cdp_port=CDP_PORT)
    print('coach-libs-a app check: API %s, screenshots in %s' % (BASE, OUT))
    origin = APP_URL or ('http://localhost:%s' % APP_PORT)
    if not ah.cors_allows(BASE, origin):
        print('The API at %s does not allow the browser origin %s (start it with CORS_ORIGINS=%s)' % (BASE, origin, origin))
        return 2
    expo = None
    app = None
    t0 = time.monotonic()
    try:
        if APP_URL:
            app_url = APP_URL
        else:
            expo = ah.ExpoWeb(port=APP_PORT, api_base=BASE, app_dir=APP_DIR).start()
            app_url = expo.url
            print('expo web answered after %.0fs' % expo.started_in)
        browser = ah.start_browser()
        browser.viewport(390, 844, mobile=True)   # a phone, as tools/e2e_app.py checks the app
        app = ah.App(browser, base=BASE, app_url=app_url)
        booted = app.boot()
        check('the app draws its first screen', True, '%.0fs' % booted)
        run(app, {'base': BASE, 'app_url': app_url, 'out': OUT, 'accounts': {'coach': COACH, 'owner': OWNER}}, only or None)
        ok, d = app.sign_out()
        check('Asha signs out', ok, d)
    except Exception as e:
        check('the run finished without an exception', False, '%s: %s' % (type(e).__name__, e))
        traceback.print_exc()
    finally:
        if app:
            try:
                app.close()
            except Exception:
                pass
        if expo:
            expo.stop()
    summary = ah.write_report({'base': BASE, 'app': APP_URL or ('http://localhost:%s' % APP_PORT), 'seconds': round(time.monotonic() - t0)})
    print(json.dumps(summary))
    return 1 if summary['failed'] else 0


if __name__ == '__main__':
    sys.exit(main())
