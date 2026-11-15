/* The client app's new identity (30 October 2026): the earlier app's look and feel with the Bioptime mark, approved by
   the owner (BUILD_PLAN §8.1 appFitterify, AMENDED_PLAN_NOTES §8). What is pinned here is what must hold from now on:
   - the nine tabs and their accessibility labels (the bar is icon-only), with plan and me kept as hidden redirects;
   - the typefaces (nine TTF files under the SIL Open Font License) and the photographs (real licensed photos only:
     no generated still, no video or animation bundled; the native splash is black and never plays a video);
   - no AI provider in the app: no key, no provider host; the Coach tab's "AI" slot is the human coach, and the member
     assistant is off on the server;
   - the earlier app's name never reaches a screen (the clips are credited as computer-generated demonstration clips, rights confirmed 30 Oct 2026);
   - the client screens are built from the kit (src/fx), take every colour from its tokens and draw at rest in the
     web build's pre-rendered HTML and with reduced motion; no motion sensor is reachable on the web;
   - the old addresses redirect to their new places (BUILD §7.1);
   - the open preview (owner decision D4): the client app never opens a session by itself; the sign-in offers a one-tap
     "Continue without signing in" card while the server says openPreview, and only that tap asks for a session;
   - the staff screens, the round-8 motion layer and the staff kit are byte for byte as they were before the redesign;
   - the honest notes and disclaimers the redesigned screens carry, word for word.
   The app has no test runner of its own: its files are read as text (as in appRound8.test.ts and motionLayer.test.ts);
   the server answers come from the API itself (helpers makeApp). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, client, DEMO_PASSWORDS } from '../helpers.js';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const MOBILE = path.join(PLATFORM, 'apps/mobile');
const SRC = path.join(MOBILE, 'src');
const source = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const codeFiles = (dir: string) => walk(dir).filter((f) => /\.tsx?$/.test(f));
/** Code without its comments (a comment may describe what is not done). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** The staff workspaces and the staff sign-ins (frozen; not the client app). */
const STAFF_ROUTE = /^app\/(\(coach\)|\(admin\)|coach|admin)\/|^app\/\(auth\)\/(choose|coach-sign-in|admin-sign-in)\.tsx$/;
/** Route files that keep a staff body next to the member's (a coach or an administrator still opens them), and the
 *  staff build's branch of the entry route: these may use the staff kit for that body. */
const LEGACY_BODIES = ['app/notifications.tsx', 'app/settings/server.tsx', 'app/+not-found.tsx', 'app/index.tsx', 'screens/profile/SecurityLegacy.tsx'];
const clientFiles = () => [...codeFiles(path.join(SRC, 'app')), ...codeFiles(path.join(SRC, 'screens')), ...codeFiles(path.join(SRC, 'flow'))].map(rel).filter((r) => !STAFF_ROUTE.test(r));

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });
const PRIYA = 'priya.nair@demo.bioptime.test'; // the open preview's member, with the showcase records

/* ---------- navigation ---------- */

const TAB_ORDER = [
  ['index', '/(tabs)', 'Home'], ['train', '/(tabs)/train', 'Train'], ['bio', '/(tabs)/bio', 'Bio'], ['life', '/(tabs)/life', 'Life'],
  ['fuel', '/(tabs)/fuel', 'Fuel'], ['coach', '/(tabs)/coach', 'Coach'], ['tests', '/(tabs)/tests', 'Tests'], ['store', '/(tabs)/store', 'Store'],
  ['profile', '/(tabs)/profile', 'Profile'],
] as const;

test('tabs: the nine tabs in order, icon-only with their names as accessibility labels; plan and me stay as hidden redirects', () => {
  const tabs = source('fx/nav/tabs.ts');
  const declared = [...tabs.matchAll(/\{ name: '([a-z]+)', href: '([^']+)', label: '([A-Za-z]+)', icon: '[a-z0-9-]+' \}/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(declared, TAB_ORDER.map((t) => [...t]));
  assert.ok(tabs.includes("export const HIDDEN_TABS = [\n  { name: 'plan', href: '/(tabs)/plan' },\n  { name: 'me', href: '/(tabs)/me' },\n] as const;"));
  // every tab is a route file of its own, and the group holds nothing else but the two redirects and the layout
  const files = fs.readdirSync(path.join(SRC, 'app/(tabs)')).sort();
  assert.deepEqual(files, ['_layout.tsx', ...TAB_ORDER.map((t) => `${t[0]}.tsx`), 'me.tsx', 'plan.tsx'].sort());
  // the layout draws exactly that list as triggers of the floating pill, the hidden two outside the bar
  const layout = source('app/(tabs)/_layout.tsx');
  assert.ok(layout.includes('{tabs.map((tab, i) => <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>'));
  assert.ok(layout.includes("<NavItem tab={tab} order={i} badge={tab.name === 'coach' && unread} badgeLabel=\"new messages\" />"));
  assert.ok(layout.includes('{hidden.map((tab) => <TabTrigger key={tab.name} name={tab.name} href={tab.href} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />)}'));
  assert.ok(layout.includes("hidden: { display: 'none' },"));
  // each tab is a tab for assistive technology, named by its label, and says whether it is the one shown
  const bar = source('fx/nav/PillTabBar.tsx');
  // (a tab with a dot says so after its name: "Coach, new messages"; the dot also rides the edge chevron while the tab
  // is scrolled out of the pill)
  for (const line of ['accessibilityRole="tab"', 'accessibilityLabel={badge ? `${tab.label}, ${badgeLabel}` : tab.label}', 'accessibilityState={{ selected: !!isFocused }}', 'aria-selected={!!isFocused}', 'accessibilityRole="tablist"']) assert.ok(bar.includes(line), line);
  assert.ok(bar.includes('const dotRight = showRight && badges.some((o) => mid(o) > viewW - EDGE);'));
  // the edge chevrons are decoration: hidden from screen readers and letting a tap through
  assert.match(bar, /<Animated\.View\n\s+pointerEvents="none"\n\s+accessible=\{false\}\n\s+accessibilityElementsHidden\n\s+importantForAccessibility="no-hide-descendants"\n\s+aria-hidden/);
});

test('redirects: every old address lands on its new place (BUILD §7.1), so old links and notifications keep working', () => {
  const redirects: Array<[string, RegExp]> = [
    ['app/(tabs)/plan.tsx', /<Redirect href="\/\(tabs\)\/train\?view=plan" \/>/],
    ['app/(tabs)/me.tsx', /<Redirect href="\/\(tabs\)\/profile" \/>/],
    ['app/workouts.tsx', /<Redirect href="\/\(tabs\)\/train(\?view=week)?" \/>/],
    ['app/workout-history.tsx', /<Redirect href="\/\(tabs\)\/train\?view=history" \/>/],
    ['app/sessions.tsx', /<Redirect href="\/\(tabs\)\/train\?section=live" \/>/],
    ['app/progress.tsx', /<Redirect href="\/\(tabs\)\/bio" \/>/],
    ['app/lab-follow-ups.tsx', /<Redirect href=\{\{ pathname: '\/\(tabs\)\/life', params: \{ section: 'next-steps' \} \}\} \/>/],
    ['app/nutrition.tsx', /<Redirect href=\{segment \? \{ pathname: '\/\(tabs\)\/fuel', params: \{ segment \} \} : '\/\(tabs\)\/fuel'\} \/>/],
    ['app/messages.tsx', /<Redirect href="\/\(tabs\)\/coach" \/>/],
    ['app/milestones.tsx', /<Redirect href="\/\(tabs\)\/profile\?tab=achievements" \/>/],
    ['app/packages.tsx', /if \(!slug\) return <Redirect href="\/\(tabs\)\/store" \/>;/],
    ['app/learn/index.tsx', /return course \? <CourseScreen id=\{String\(course\)\} \/> : <Redirect href="\/\(tabs\)\/store\?section=learn" \/>;/],
  ];
  for (const [file, rx] of redirects) assert.match(source(file), rx, file);
});

/* ---------- typefaces, photographs, media ---------- */

test('fonts: exactly nine TTF files (Bebas Neue, Montserrat, JetBrains Mono), each family with its SIL Open Font License text, all loaded', () => {
  const dir = path.join(MOBILE, 'assets/fonts');
  const names = fs.readdirSync(dir).sort();
  const ttf = names.filter((n) => n.endsWith('.ttf'));
  assert.deepEqual(ttf, ['BebasNeue-Regular.ttf', 'JetBrainsMono-Bold.ttf', 'JetBrainsMono-Medium.ttf', 'JetBrainsMono-Regular.ttf', 'Montserrat-Bold.ttf', 'Montserrat-Light.ttf', 'Montserrat-Medium.ttf', 'Montserrat-Regular.ttf', 'Montserrat-SemiBold.ttf']);
  assert.deepEqual(names.filter((n) => !n.endsWith('.ttf')), ['OFL-BebasNeue.txt', 'OFL-JetBrainsMono.txt', 'OFL-Montserrat.txt']);
  for (const f of ['OFL-BebasNeue.txt', 'OFL-JetBrainsMono.txt', 'OFL-Montserrat.txt']) assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /SIL OPEN FONT LICENSE/i, f);
  const appJson = fs.readFileSync(path.join(MOBILE, 'app.json'), 'utf8');
  for (const f of ttf) assert.ok(appJson.includes(`"./assets/fonts/${f}"`), `${f}: embedded by expo-font`);
});

test('media: the bundled exercise clips are exactly the served ones; no other video, animation or generated still is bundled (no fz-* photo); the native splash is the mark on black and nothing at launch plays a video', () => {
  const assets = walk(path.join(MOBILE, 'assets')).map((f) => path.relative(MOBILE, f).split(path.sep).join('/'));
  // release 1.0.0 (owner, 4 Nov 2026): the served clips and posters are bundled byte for byte under their served names
  // (src/fx/media/bundledMedia.ts); anything else the server serves still streams
  const served = JSON.parse(fs.readFileSync(path.join(PLATFORM, 'apps/api/media/exercises/manifest.json'), 'utf8')) as { items: { video: string; poster: string; sha256: string; posterSha256: string }[] };
  const want = new Map(served.items.flatMap((it) => [[it.video, it.sha256], [it.poster, it.posterSha256]] as [string, string][]));
  const bundled = assets.filter((f) => f.startsWith('assets/exercises/'));
  assert.deepEqual(bundled.map((f) => f.slice('assets/exercises/'.length)).sort(), [...want.keys()].sort(), 'assets/exercises holds exactly the served clips and posters');
  for (const f of bundled) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(MOBILE, f))).digest('hex'), want.get(f.slice('assets/exercises/'.length)), `${f}: the served file`);
  const map = code(source('fx/media/bundledMedia.ts'));
  for (const name of want.keys()) assert.ok(map.includes(`'${name}': require('@/assets/exercises/${name}'),`), `${name}: in the bundled map`);
  assert.ok(map.includes("if (!uri || Platform.OS === 'web') return null;"), 'the web build streams');
  assert.deepEqual(assets.filter((f) => !f.startsWith('assets/exercises/') && (/\.(mp4|m4v|mov|webm|gif|apng|lottie)$/i.test(f) || /\.json$/i.test(f) && f !== 'assets/photos/CREDITS.json')), [], 'no other clip or animation is bundled');
  assert.deepEqual(assets.filter((f) => /(^|\/)fz-|fitterify/i.test(f)), [], 'no earlier-app still or logo file');
  const fz = clientFiles().concat(codeFiles(path.join(SRC, 'fx')).map(rel)).filter((r) => /['"`]fz-/.test(code(source(r))));
  assert.deepEqual(fz, [], 'no slot or screen names a generated still');
  assert.doesNotMatch(source('fx/media/photos.generated.ts'), /generated imagery|\bai-generated\b/i);
  // the native splash: the mark (assets/splash/mark.png, 120 dp) on black; the in-app sting is drawn (vector paths), never a video
  const appJson = JSON.parse(fs.readFileSync(path.join(MOBILE, 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
  const splash = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as [string, Record<string, unknown>];
  assert.deepEqual([splash[1].backgroundColor, splash[1].image, splash[1].imageWidth], ['#000000', './assets/splash/mark.png', 120]);
  for (const f of ['app/index.tsx', 'fx/brand/SplashSting.tsx', 'fx/brand/MarkHandoff.tsx', 'fx/brand/MarkPaths.tsx', 'fx/brand/Wordmark.tsx']) {
    assert.doesNotMatch(code(source(f)), /expo-video|expo-av|VideoView|useVideoPlayer|RemoteVideo|\.mp4|\.mov/, `${f}: no video at launch`);
  }
  // a clip plays only inside the workout player and the exercise guide, from the server
  const video = clientFiles().concat(codeFiles(path.join(SRC, 'fx')).map(rel)).filter((r) => /from 'expo-video'|RemoteVideo/.test(code(source(r))));
  assert.deepEqual(video.sort(), ['fx/index.ts', 'fx/media/RemoteVideo.tsx', 'screens/train/player/Clip.tsx']);
});

/* ---------- no AI provider; the AI slot is the human coach ---------- */

const AI_PROVIDER = /gsk_[A-Za-z0-9]|api\.groq\.com|groq\.com|openai|anthropic|claude\.ai|generativelanguage|googleapis\.com\/v1beta|sk-ant-|\bsk-[A-Za-z0-9]{20,}|mistral\.ai|api\.cohere|huggingface\.co|replicate\.com|together\.xyz/i;
/** Every absolute address the app's code may name: the tester's Server screen examples and defaults, Apple's sign-in,
 *  the link relay, the photo credits' pages and, on the staff side, the laboratory's integration page. */
const HOSTS = ['10.0.2.2', '192.168.1.20', 'appleid.apple.com', 'integration.labstack.in', 'localhost', 'ntfy.sh', 'unsplash.com', 'www.pexels.com'];

test('no AI key or provider call anywhere in the app: no key, no provider host, no address outside the known few', () => {
  const texts = [...walk(SRC), path.join(MOBILE, 'app.json'), path.join(MOBILE, 'package.json'), ...walk(path.join(MOBILE, 'assets')).filter((f) => /\.(json|txt)$/.test(f))];
  const hits = texts.filter((f) => AI_PROVIDER.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(MOBILE, f));
  assert.deepEqual(hits, []);
  const hosts = new Map<string, string>();
  for (const f of codeFiles(SRC)) for (const m of code(fs.readFileSync(f, 'utf8')).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.set(m[1]!, rel(f));
  assert.deepEqual([...hosts.keys()].filter((x) => !HOSTS.includes(x)), [], 'a new address in the app needs a look (and a line here)');
  // no EXPO_PUBLIC_ variable can carry a key into the bundle: the app reads only its own few
  const vars = new Set(codeFiles(SRC).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z_]+)/g)].map((m) => m[1]!)));
  assert.deepEqual([...vars].filter((v) => /KEY|TOKEN|SECRET|GROQ|OPENAI|ANTHROPIC/.test(v)), []);
});

test('the AI slot is the human coach: the member assistant is off on the server, and the Coach tab shows its segment only when the server offers it', async () => {
  const priya = client(h.app);
  await priya.login(PRIYA, DEMO_PASSWORDS.member);
  const status = await priya.get('/api/me/assistant');
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(status.json.on, false);
  assert.equal(status.json.offer, false);
  const sent = await priya.post('/api/me/assistant/messages', { body: 'Hello' });
  assert.equal(sent.status, 409);
  assert.equal(sent.json.error?.code, 'ASSISTANT_OFF');
  const coach = source('screens/coach/CoachScreen.tsx');
  assert.ok(coach.includes('{assistant.offer ? <View style={styles.segment}>'));
  assert.ok(coach.includes("{pane === 'assistant' && assistant.offer ? <AssistantPane"));
});

/* ---------- the earlier app's name ---------- */

test('the earlier app\'s name never reaches a screen: not in the app, its assets or the answers a member gets; the clips are credited as computer-generated demonstration clips with the date their rights were confirmed', async () => {
  const texts = [...walk(SRC), path.join(MOBILE, 'app.json'), ...walk(path.join(MOBILE, 'assets')).filter((f) => /\.(json|txt)$/.test(f))];
  assert.deepEqual(texts.filter((f) => /fitterify|\bFWS\b/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(MOBILE, f)), []);
  assert.ok(source('app/settings/credits.tsx').includes("Computer-generated demonstration clips. The rights to use them were confirmed on 30 Oct 2026; filmed clips will replace them. An exercise without a clip is described in text only."));
  // the server's own media manifest names the source for the team; it is never served, and no member answer carries it
  const priya = client(h.app);
  await priya.login(PRIYA, DEMO_PASSWORDS.member);
  const library = await priya.get('/api/me/exercises');
  assert.equal(library.status, 200, JSON.stringify(library.json));
  assert.ok(JSON.stringify(library.json).includes('/public/media/exercises/'), 'the library carries the served clips');
  const week = await priya.get('/api/me/workouts');
  const first = ((week.json.items ?? []) as Array<{ id: string }>)[0];
  const answers = [library.json, week.json, first ? (await priya.get(`/api/me/workouts/${first.id}`)).json : null];
  for (const a of answers) assert.doesNotMatch(JSON.stringify(a), /fitterify/i);
  assert.equal((await client(h.app).get('/api/public/media/exercises/manifest.json')).status, 404, 'the manifest is not a served file');
});

/* ---------- the kit ---------- */

test('client screens are built from the kit (@/fx), never the staff kit; legacy staff bodies are the only exceptions', () => {
  const files = clientFiles();
  assert.deepEqual(files.filter((r) => !LEGACY_BODIES.includes(r) && /from '@\/components\/ui'/.test(source(r))), []);
  // every client route file draws with the kit, or hands over to a screen or flow built with it, or only redirects
  const routes = files.filter((r) => r.startsWith('app/') && !LEGACY_BODIES.includes(r));
  const drawsNothing = (s: string) => /^\s*import \{ Redirect(, useLocalSearchParams)? \} from 'expo-router';/m.test(s) && !/from '@\/fx/.test(s);
  const odd = routes.filter((r) => { const s = source(r); return !/from '@\/fx(\/[^']+)?'|from '@\/screens\/|from '@\/flow\//.test(s) && !drawsNothing(s); });
  assert.deepEqual(odd, []);
  // the staff build's branch of the entry route is the only staff-kit use left in it
  assert.match(source('app/index.tsx'), /if \(STAFF_APP\) \{\n\s+if \(!ready\) return <View style=\{\{ flex: 1, backgroundColor: colors\.canvas, justifyContent: 'center' \}\}><Loading \/><\/View>;/);
});

test('the kit draws at rest in the pre-rendered HTML and with reduced motion (or Save-Data); lite is calm or tier C; no motion sensor is reachable on the web', () => {
  const tier = source('fx/motion/tier.ts');
  assert.ok(tier.includes("return { tier, calm, lite: calm || tier === 'C', inHtml, still: calm || inHtml };"));
  assert.match(tier, /export function useLiteMotion\(\): boolean \{\n\s+return useMotion\(\)\.lite;\n\}/);
  assert.ok(tier.includes("const OVERRIDE_KEY = 'bp.fx.motionTier';"), 'E2E and support can pin the tier');
  assert.ok(tier.includes('return (navigator as Navigator & { webdriver?: boolean }).webdriver === true;'), 'no demotion probe under a webdriver');
  const atRest: Array<[string, string]> = [
    ['fx/motion/Reveal.tsx', 'const atRest = still || done;'],
    ['fx/motion/Reveal.tsx', 'const progress = useSharedValue(atRest ? 1 : 0);'],
    ['fx/motion/CountUp.tsx', 'const atRest = still || value == null || prior === value;'],
    ['fx/motion/Ring.tsx', 'const p = useSharedValue(still ? target : prior ?? 0);'],
    ['fx/motion/Bars.tsx', 'const v = useSharedValue(still ? target : 0);'],
    ['fx/motion/Chart.tsx', 'const progress = useSharedValue(still ? 1.5 : 0);'],
    ['fx/nav/PillTabBar.tsx', 'const still = calm || inHtml || entered;'],
    ['fx/FxScreen.tsx', "const still = calm || inHtml || !!off || (webOnly && Platform.OS !== 'web');"],
    ['fx/ScreenHeader.tsx', 'const still = calm || inHtml;'],
    ['fx/Notice.tsx', 'const still = calm || inHtml;'],
  ];
  for (const [f, line] of atRest) assert.ok(source(f).includes(line), `${f}: ${line}`);
  for (const f of ['fx/motion/Orbs.tsx', 'fx/motion/Marquee.tsx', 'fx/motion/LiveDot.tsx', 'fx/motion/Spinner.tsx']) assert.match(source(f), /!still/, `${f}: no loop at rest`);
  // the device-tilt sensor lives in the native file only; the web file has none
  const sensorUsers = codeFiles(SRC).filter((f) => /useAnimatedSensor/.test(code(fs.readFileSync(f, 'utf8')))).map(rel);
  assert.deepEqual(sensorUsers, ['fx/motion/GravitySensor.native.tsx']);
  assert.doesNotMatch(code(source('fx/motion/GravitySensor.tsx')), /useAnimatedSensor|SensorType/);
});

/* ---------- the open preview (D4) ---------- */

test('open preview: the client app never opens a session by itself; only the sign-in card\'s tap sends POST /auth/open-preview', async () => {
  const auth = source('lib/auth.tsx');
  const body = (from: string, to: string) => { const a = auth.indexOf(from); assert.ok(a >= 0, from); return auth.slice(a, auth.indexOf(to, a)); };
  // nobody signed in (a cold start, a dead session) and a chosen sign-out: a staff build only
  const nobody = body('const nobodySignedIn = useCallback(', '}, [openPreview, setUser]);');
  assert.ok(nobody.includes('if (STAFF_APP && c?.openPreview) {'));
  assert.equal((nobody.match(/openPreview\(/g) ?? []).length, 1);
  const out = body('const signOut = useCallback(', '}, [setUser, openPreview]);');
  assert.ok(out.includes('if (STAFF_APP && configRef.current?.openPreview) {'));
  assert.equal((out.match(/openPreview\(/g) ?? []).length, 1);
  assert.equal((code(auth).match(/[^.\w]openPreview\((?!workspace: Workspace)/g) ?? []).length, 2, 'no other caller in lib/auth');
  // the staff door does nothing in the client app; the client's offer asks only on open()
  const door = source('components/openPreview.tsx');
  assert.ok(door.includes('const on = STAFF_APP && !!config?.openPreview;'));
  assert.ok(door.includes("return { offer: ready && !!config?.openPreview && !user, busy, error, open };"));
  assert.ok(door.includes("try { await openPreview('member'); return true; }"));
  // the card: drawn on the client sign-in while offered; one white pill that calls open() and then goes Home
  const signIn = source('app/(auth)/sign-in.tsx');
  assert.ok(signIn.includes('{preview.offer ? <Reveal delay={240}><PreviewCard preview={preview} onOpened={home} /></Reveal> : null}'));
  assert.ok(signIn.includes("if (STAFF_APP) {\n    if (door.home)"), 'the door is the staff build\'s only');
  const card = source('flow/auth/PreviewCard.tsx');
  assert.ok(card.includes('title="Continue without signing in"'));
  assert.ok(card.includes('onPress={async () => { if (await preview.open()) onOpened(); }}'));
  assert.ok(card.includes('Look around with a prepared member account. Nothing you do here is real.'));
  // what the server offers: the flag in its settings and, on the tap, a session as Priya
  const off = client(h.app);
  assert.notEqual((await off.get('/api/public/config')).json.openPreview, true, 'not without OPEN_PREVIEW');
  const on = await makeApp({ env: { OPEN_PREVIEW: '1' } });
  try {
    const visitor = client(on.app);
    assert.equal((await visitor.get('/api/public/config')).json.openPreview, true);
    const r = await visitor.post('/api/auth/open-preview', { workspace: 'member' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((r.json.user as { email: string; role: string }).email, PRIYA);
  } finally { await on.app.close(); on.db.close(); }
});

/* ---------- words that stay ---------- */

test('honest notes and disclaimers stay word for word on the redesigned screens', () => {
  const verbatim: Array<[string, string]> = [
    // no score is calculated by Bioptime (CRITIQUE §7, Q2): the caption speaks of trends only, the empty card says so,
    // and the preview member's prepared score says it is prepared
    ['screens/home/ScoreCard.tsx', "const CAPTION = 'Trends come from what you log, never a diagnosis.';"],
    ['screens/home/ScoreCard.tsx', "const NO_SCORE = 'Bioptime does not calculate a Wellness Score yet.';"],
    ['screens/home/ScoreCard.tsx', "const PREPARED = 'Prepared for the preview: Bioptime does not calculate a Wellness Score yet.';"],
    ['screens/train/player/Clip.tsx', "export const TEXT_ONLY = 'Exercises are described in text only; demonstration media is not available yet.';"],
    ['flow/onboarding/Slides.tsx', "style={styles.strong}>Not medical advice.</T> A result outside a range is not a diagnosis. Medicines, supplements and further tests are a doctor's call.</T>"],
    ['fx/ErrorState.tsx', "title={offline ? 'No connection' : signedOut ? 'Signed out' : 'Something went wrong'}"],
    ['fx/ErrorState.tsx', "'The Bioptime service could not be reached. Check your connection; nothing you did was lost.'"],
    ['fx/ErrorState.tsx', '<Notice kind="warning" title="Offline">'],
    ['app/(auth)/sign-in.tsx', '<Notice kind="warning" title="Session ended">Your session on this device has ended, so you have been signed out. Sign in again to continue.</Notice>'],
    ['lib/auth.tsx', "export const CLIENTS_ONLY = 'This app is for Bioptime clients. Coaches sign in at bioptime.com/coach and the Bioptime team at bioptime.com/admin.';"],
    ['app/(tabs)/tests.tsx', '<Notice kind="sample" title="Simulated laboratory">Bookings here are simulated; no laboratory is involved and no sample is collected.</Notice>'],
    ['app/book-test.tsx', '<Notice kind="sample" title="Simulated laboratory">Slots and collections are simulated; no sample is collected.</Notice>'],
    ['screens/coach/CoachProfileSheet.tsx', 'Wellness and fitness coaching; not medical advice'],
  ];
  for (const [f, s] of verbatim) assert.ok(source(f).includes(s), `${f}: ${s}`);
  // the text-only sentence is shown where an exercise has no clip
  assert.ok(source('screens/train/player/Clip.tsx').includes('{TEXT_ONLY}</T>'));
});

/* ---------- frozen ---------- */

/** sha256 (first 16 hex digits) of every staff file the redesign must not touch, as they were before it (29 Oct 2026):
 *  the coach and administrator workspaces, the staff sign-ins, the round-8 motion layer and the staff kit. */
const FROZEN = `
  app/(admin)/_layout.tsx 6710f638a30048e6
  app/(admin)/index.tsx a4758c7d3873a8df
  app/(admin)/members.tsx 99dc9ca50b44e161
  app/(admin)/messages.tsx cbb402613e203023
  app/(admin)/more.tsx cd42a9e75a9ae2f1
  app/(admin)/operations.tsx 6284300a49c60625
  app/(auth)/admin-sign-in.tsx a66a0b1dbcf073ab
  app/(auth)/choose.tsx 152865385d72e97b
  app/(auth)/coach-sign-in.tsx fa1fe2ef4feec4ad
  app/(coach)/_layout.tsx ddaf8d956761dcab
  app/(coach)/calendar.tsx 67362d79a98ced09
  app/(coach)/clients.tsx f55661690d9e270f
  app/(coach)/index.tsx 01054498c6ed28a9
  app/(coach)/messages.tsx dcd479f6db7b66a6
  app/(coach)/more.tsx 5e833e66de238cf6
  app/admin/ai/index.tsx 8478abedfd3f441d
  app/admin/analytics/index.tsx 7d27be0a91b2c63c
  app/admin/announcements/[id].tsx 30ee7c17cadcf148
  app/admin/announcements/index.tsx 755726ea2f83ebc6
  app/admin/appointments/index.tsx 318efc59bf5ca7cd
  app/admin/approvals/index.tsx 520c4bae311409e2
  app/admin/assignments/index.tsx 887bf58a488fe33e
  app/admin/audit/index.tsx 8e9b413293f6db7a
  app/admin/billing/index.tsx 1ee3448363edfd86
  app/admin/bloodwork/index.tsx 874fcab80cd34cb3
  app/admin/checkin-templates/index.tsx 555cba2bdbd23fea
  app/admin/clients/[id].tsx c3526f83c265707b
  app/admin/coaches/[id].tsx c897d00222cfe8be
  app/admin/coaches/index.tsx 38f7b3bd66d5ed50
  app/admin/content/[key].tsx ff413efe7c8e5af2
  app/admin/content/index.tsx ef41baf1b97137ca
  app/admin/custom-plans/index.tsx 6e2859fff5c3c924
  app/admin/exercise-library/index.tsx 31b036e203be5a40
  app/admin/exercise-library/templates/[id].tsx e677cd205a4f53f1
  app/admin/growth/corporate/[id].tsx f3a3b5599a61c926
  app/admin/growth/corporate/index.tsx 412968d49834b391
  app/admin/growth/discovery-calls/[id].tsx 99f0655c1d7a4af9
  app/admin/growth/discovery-calls/index.tsx 4468c5c2a72f31e1
  app/admin/growth/newsletter/index.tsx 685451648b5cb3d2
  app/admin/help-articles/index.tsx 0b74552dd80017d8
  app/admin/imports/[id].tsx ab1672e66f54ba15
  app/admin/imports/index.tsx 593a588e21ee4c1b
  app/admin/integrations/index.tsx 500c8cc885f9deb2
  app/admin/integrations/labstack.tsx 3d0aeb4cd0602209
  app/admin/lab-follow-ups/index.tsx 75a8b0fac64cf886
  app/admin/learning/[id].tsx e584bf74c768610c
  app/admin/learning/index.tsx 3949d884a1eed6bb
  app/admin/messages/[id].tsx 78d0f538dd0c9e94
  app/admin/modules/index.tsx 4f5727d1b1203724
  app/admin/notifications.tsx 44c009c61f9a243a
  app/admin/nutrition-library/index.tsx 453eee852ae67dd4
  app/admin/operations/index.tsx 94195293963db069
  app/admin/orders/index.tsx df2ed2a17f90e785
  app/admin/packages/index.tsx f5c720f12fbfa1b8
  app/admin/referrals/index.tsx 80b3bd37cd4e9331
  app/admin/reports/[id].tsx 52084604aa69ccc2
  app/admin/sessions/[id].tsx 05550b56d5f111e3
  app/admin/sessions/index.tsx c31745cdb683521d
  app/admin/settings/index.tsx 3170b693fbf3856d
  app/admin/support/[id].tsx c2fbc2e9052401fb
  app/admin/support/index.tsx e2cf573f54d0b732
  app/admin/theme/index.tsx b4174f8a619d2036
  app/admin/users/[id].tsx cb273126a8e23308
  app/admin/users/index.tsx 9dc48b5c97333346
  app/coach/ai/index.tsx 4fa6996a1e0d017a
  app/coach/announcements/index.tsx 885b9940cf75369a
  app/coach/appointments/index.tsx 5d02cf10beccbf42
  app/coach/bloodwork.tsx 5059bf640d242d12
  app/coach/checkin-templates/index.tsx c389d2ed23ee52f0
  app/coach/clients/[id].tsx d82dfbf2e54a94a6
  app/coach/clients/index.tsx 4226ca566d9f4f94
  app/coach/courses/[courseId]/[lessonId].tsx 8c10100132a8d1db
  app/coach/courses/[courseId]/index.tsx 599de1d327b9949d
  app/coach/courses/index.tsx 7851ace339ca29de
  app/coach/discovery-calls/index.tsx 2538a3554039a3e4
  app/coach/exercise-library/index.tsx 963d065e526bafaf
  app/coach/help/articles/[slug].tsx f9fa344b52b2ef3c
  app/coach/help/index.tsx cb252af304c24ce5
  app/coach/help/requests/[id].tsx edf8696f70018ae9
  app/coach/meal-plans/[id].tsx d5027045e625d711
  app/coach/messages/[id].tsx 9c47499739f4aef5
  app/coach/messages/index.tsx 239436894c0a1d64
  app/coach/notifications.tsx b45edec9995f1920
  app/coach/nutrition-library/index.tsx d7a9d0b19698af6c
  app/coach/plans/[id].tsx abda53ea53590979
  app/coach/profile.tsx 82d115dfc893d68b
  app/coach/programs/[id].tsx 911f978d21ccd52d
  app/coach/reports/[id].tsx bd3a370277f267b2
  app/coach/sessions/[id].tsx 313f1573857599d5
  app/coach/sessions/index.tsx 7d5dae9ed523ab72
  app/coach/settings.tsx f2b52fa4c086afe7
  app/coach/templates/[id].tsx 576a070e2873dd90
  app/coach/training/[courseId]/[lessonId].tsx fcc1b7623d33f97a
  app/coach/training/[courseId]/index.tsx a3a7cf8839884612
  app/coach/training/index.tsx 9ab17f27ff93f9b9
  app/coach/workout-programs/[id].tsx 021b96a5f32d353d
  components/ui.tsx 54319f7a1bb909ba
  motion/BrandMark3D.tsx 808c5ba8335d0dd5
  motion/BrandStage.tsx 52d6fbdf107dcad7
  motion/BrandTilt.tsx 8d56a4d53f19e50b
  motion/Enter.tsx b2a0e1b41e78f18f
  motion/MilestoneReveal.tsx ddb78c8c8eaad50b
  motion/Motes.tsx 01cc3f6e2105514e
  motion/PressDepth.tsx fc4f9f7dc5ac05fe
  motion/ProgressReveal.tsx e94f5dc5607bb800
  motion/ScreenEnter.tsx c95f6a381e134cb7
  motion/ScrollDepth.tsx 1e47c7d01620aaeb
  motion/depthMath.ts 23fcb29f9d643945
  motion/index.ts 0f54b3b32cf55857
  motion/staticHtml.ts 11a47f2059227eed
  motion/tokens.ts ad0e26236a25ef7f
  motion/useCalmMotion.ts 9cafa025cac30f7d
  motion/usePointerTilt.ts 84c7f4013a9e3057
  motion/useReduceMotion.ts f46f7a7de266f2eb
  motion/values.ts 5e2e3d5cca18c798
`.trim().split('\n').map((l) => { const at = l.trim().lastIndexOf(' '); return [l.trim().slice(0, at), l.trim().slice(at + 1)] as const; });

test('frozen: the staff screens, the staff sign-ins, the round-8 motion layer and the staff kit are byte for byte as before the redesign', () => {
  const changed = FROZEN.filter(([f, sha]) => !fs.existsSync(path.join(SRC, f)) || createHash('sha256').update(fs.readFileSync(path.join(SRC, f))).digest('hex').slice(0, 16) !== sha).map(([f]) => f);
  assert.deepEqual(changed, [], 'a staff file changed: the client redesign does not touch them');
  // and nothing was added to those trees either
  const listed = new Set(FROZEN.map(([f]) => f));
  const trees = ['app/(coach)', 'app/(admin)', 'app/coach', 'app/admin', 'motion'];
  const extra = trees.flatMap((t) => walk(path.join(SRC, t)).map(rel)).filter((f) => !listed.has(f));
  assert.deepEqual(extra, []);
  assert.equal(FROZEN.length, 115);
});
