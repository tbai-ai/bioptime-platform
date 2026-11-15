/* Round 8, the app (apps/mobile): the owner's decisions of 24 October 2026, as they stand after the client-app redesign
   the owner approved on 30 October 2026 (the earlier app's look and feel with the Bioptime mark, BUILD_PLAN §8.1).
   - No viewer-visible "demo" or "sample" labels anywhere in the app, except one small, plain "simulated" note on the
     payment and billing screens and on the lab booking and result screens; "sample" meaning a blood sample stays.
   - The sign-in offers a phone code (the red Email | Phone segment) only while the phone_sign_in flag is on (neutral
     wording: while texts go to the outbox, no text is promised).
   - The 3D layer of round 8 (src/motion: the 3D brand mark, motes, the rotateY entrance, scroll-linked depth) is frozen:
     its maths and wiring are pinned below and it stays with the staff screens; the client screens draw the kit in
     src/fx and take their colours from the `fx` tokens of src/theme.ts only.
   The app has no test runner of its own, so, as in motionLayer.test.ts, its files are read as text or loaded as they are
   through computed specifiers that keep them out of the API's typecheck. Only files with no React Native import are
   loaded (src/motion/depthMath.ts, values.ts, src/theme.ts). No server is needed. appFitterify.test.ts pins the rest of
   the new identity (tabs, fonts, photos, the open preview, no AI provider, no earlier-app name). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const SRC = path.join(PLATFORM, 'apps/mobile/src');
const load = (spec: string): Promise<any> => import(spec);
const mobile = (rel: string): Promise<any> => load(pathToFileURL(path.join(SRC, rel)).href);
const source = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** macOS keeps a folder's custom icon in a file named "Icon\r" (the Finder's, never part of the app): listings leave it out. */
const FOLDER_ICON = 'Icon\r';
const listDir = (dir: string): string[] => fs.readdirSync(dir).filter((n) => n !== FOLDER_ICON);
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);

/** The copy a viewer can see in a source file: string literals and JSX text, with comments removed. A heuristic, but
 *  strict enough: every quoted string counts, including type unions and keys. */
function visibleCopy(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1]);
  return out;
}

// what may carry the words: the 'sample' tone key (a colour pairing in the existing components, never shown as text),
// the blood-sample sense, and the API's internal status names
const ALLOWED_SAMPLE = [/^sample$/, /sample is collected/, /samples I book/, /^sample_collected$/];

test('app copy: no viewer-visible "demo" anywhere in the app', () => {
  const hits: string[] = [];
  for (const f of files(SRC)) {
    for (const s of visibleCopy(fs.readFileSync(f, 'utf8'))) if (/\bdemo\b/i.test(s)) hits.push(`${path.relative(SRC, f)}: ${s}`);
  }
  assert.deepEqual(hits, []);
});

test('app copy: no "Sample" or "sample data" labels; "sample" stays only as a blood sample or a tone key', () => {
  const hits: string[] = [];
  for (const f of files(SRC)) {
    for (const s of visibleCopy(fs.readFileSync(f, 'utf8'))) if (/\bsamples?\b/i.test(s) && !ALLOWED_SAMPLE.some((r) => r.test(s))) hits.push(`${path.relative(SRC, f)}: ${s}`);
  }
  assert.deepEqual(hits, []);
});

test('app copy: the demo banner, the demo build notice and the demo credentials are gone; the Profile footer says what Bioptime is', () => {
  const all = files(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(all, /DemoBanner|DEMO ·|Demo build|demo build|Demo payment|Demo prices|Demo mode|Sample data|\(sample\)/);
  const signIn = source('app/(auth)/sign-in.tsx');
  assert.doesNotMatch(signIn, /demoHint|config\?\.demo/, 'the sign-in screen shows no demo notice and no credentials');
  // the old Me tab became Profile (tab 9): its Settings sub-tab ends with the footer, word for word; /(tabs)/me redirects
  assert.ok(source('app/(tabs)/profile.tsx').includes('<P muted small>Bioptime app {APP_VERSION}. Bioptime offers general wellbeing guidance and coaching. It is not medical advice and does not diagnose, treat or prevent disease. If you are unwell, talk to a doctor; in an emergency call 112.</P>'));
  assert.match(source('app/(tabs)/me.tsx'), /<Redirect href="\/\(tabs\)\/profile" \/>/);
});

test('app copy: one small, plain "simulated" note stays on payment, billing, lab booking and lab result screens', () => {
  const simulatedNotes = (rel: string) => visibleCopy(source(rel)).filter((s) => /simulat/i.test(s) && !/^\/payments\/simulator|^simulator$|^sim$/.test(s));
  for (const [rel, note] of [
    ['app/packages.tsx', 'Checkout here is simulated; no money moves.'],
    ['app/billing.tsx', 'Payments here are simulated; no money moved.'],
    ['app/bespoke.tsx', 'Payments here are simulated; no money moves.'],
    ['app/(tabs)/tests.tsx', 'Bookings here are simulated; no laboratory is involved and no sample is collected.'],
    ['app/book-test.tsx', 'Slots and collections are simulated; no sample is collected.'],
  ] as const) {
    assert.ok(source(rel).includes(note), `${rel}: the note`);
    // the note itself, plus at most a title for it and the simulator's own buttons; no per-row "· simulated" labels
    assert.ok(!source(rel).includes("' · simulated'"), `${rel}: no per-row label`);
    assert.ok(simulatedNotes(rel).length <= 4, `${rel}: ${simulatedNotes(rel).join(' | ')}`);
  }
  assert.ok(source('app/report/[id].tsx').includes('{d.simulated ? <Pill tone="sample">Simulated result</Pill> : null}'));
  assert.ok(source('app/booking/[id].tsx').includes('{d.simulated ? <Pill tone="sample">Simulated</Pill> : null}'));
  // the simulated payment step keeps working, under a plain heading
  for (const rel of ['app/packages.tsx', 'app/bespoke.tsx']) {
    assert.ok(source(rel).includes('<Eyebrow>Payment</Eyebrow>'), rel);
    assert.ok(source(rel).includes("simulate('captured')") && source(rel).includes("simulate('failed')"), rel);
  }
});

test('sign-in: the Phone segment (a phone code) shows only while phone_sign_in is on; /(auth)/phone stays for links; no text is promised', () => {
  const s = source('app/(auth)/sign-in.tsx');
  assert.match(s, /import \{ useFeatures \} from '@\/lib\/features';/);
  assert.match(s, /const features = useFeatures\(true\);/);
  assert.ok(s.includes("const phoneOn = !!features?.has('phone_sign_in');"));
  assert.ok(s.includes("const shown: Mode = phoneOn ? mode : 'email';"), 'the phone form only while the switch is on');
  assert.ok(s.includes("{phoneOn ? <Reveal delay={280}>\n      <Segmented kind=\"red\" value={shown}"), 'the segment itself only while the switch is on');
  assert.ok(s.includes("items={[{ value: 'email', label: 'Email', icon: 'mail' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]}"));
  assert.ok(s.includes(": <PhoneCodeForm onSignedIn={() => setVerified(true)} />}"));
  assert.doesNotMatch(s, /Sign in with a phone code|\/\(auth\)\/phone|\?phone=/, 'no second way to the phone screen from here, and the number never goes in a URL');
  assert.doesNotMatch(s, /code sent to your phone|We text/, 'no wording that promises a text');
  // the screen of its own (old links, the tab-less flow) draws the same form, and says so while the switch is off
  const p = source('app/(auth)/phone.tsx');
  assert.ok(p.includes("!features.has('phone_sign_in') ? <>") && p.includes('<Notice kind="info" title="Not available here">'));
  assert.ok(p.includes('<PhoneCodeForm onSignedIn={() => setVerified(true)} />'));
  assert.doesNotMatch(p, /code sent to your phone|We text|\?phone=/);
  const form = source('flow/auth/PhoneCodeForm.tsx');
  assert.doesNotMatch(form, /code sent to your phone|We text/);
  assert.ok(form.includes("hint={delivered ? 'From the text message."), 'a text is named only when the server says one was sent');
});

/* ---------- the 3D layer's maths ---------- */

test('3D mark: flat means no shift; a turn moves the copies against it, further copies further and smaller', async () => {
  const { layerOffset, revealAmount } = await mobile('motion/depthMath.ts');
  const { motion } = await mobile('motion/values.ts');
  const flat = layerOffset(20, 0, 0, motion.perspective.mark);
  assert.equal(Math.abs(flat.x), 0); assert.equal(Math.abs(flat.y), 0);
  assert.ok(flat.scale < 1 && flat.scale > 0.9);
  assert.equal(revealAmount(0, 0), 0, 'no copy shows while the mark is flat');
  assert.equal(revealAmount(motion.mark.revealDeg, 0), 1);
  assert.equal(revealAmount(-40, 30), 1);
  const turnedRight = layerOffset(20, 0, 30, motion.perspective.mark);
  assert.ok(turnedRight.x < 0, 'turned right (right edge away), the copies behind shift left');
  const tippedBack = layerOffset(20, 25, 0, motion.perspective.mark);
  assert.ok(tippedBack.y > 0, 'tipped back at the top, the copies behind shift down');
  const near = layerOffset(8, 0, 30, motion.perspective.mark), far = layerOffset(32, 0, 30, motion.perspective.mark);
  assert.ok(Math.abs(far.x) > Math.abs(near.x) && far.scale < near.scale);
  assert.equal(motion.mark.opacity.length, motion.mark.layers);
  assert.ok(motion.mark.opacity.every((o: number, i: number, a: number[]) => o < 1 && (i === 0 || o < a[i - 1])), 'each copy further back is fainter');
});

test('motes: a seed gives the same field, in the app\'s own colours, and a drift cycle ends where it began', async () => {
  const { makeMotes, motePose, MOTE_PALETTE } = await mobile('motion/depthMath.ts');
  const { colors } = await mobile('theme.ts');
  assert.deepEqual(makeMotes(12, 7), makeMotes(12, 7));
  assert.notDeepEqual(makeMotes(12, 7), makeMotes(12, 8));
  assert.deepEqual([...new Set(MOTE_PALETTE)].sort(), [colors.text, colors.info, colors.brand].sort());
  for (const m of makeMotes(16, 0xb10a)) {
    assert.ok(MOTE_PALETTE.includes(m.color));
    assert.ok(m.x > 0 && m.x < 1 && m.y > 0 && m.y < 1);
    for (const k of [m.kx, m.ky, m.kz]) assert.ok(Number.isInteger(k));
    const a = motePose(m, 0.3, 0, 0), b = motePose(m, 1.3, 0, 0);
    for (const key of ['x', 'y', 'z', 'scale', 'opacity'] as const) assert.ok(Math.abs(a[key] - b[key]) < 1e-9, key);
    assert.ok(a.opacity > 0 && a.opacity < 0.6, 'light: never more than a faint dot');
    // the parallax: with the mark turned, a near mote and a far one shift opposite ways
    const near = { ...m, pz: 0.25, kz: 1 }, far = { ...m, pz: 0.75, kz: 1 }; // z = 1 and z = 0 at t = 0
    assert.ok(motePose(near, 0, 0, 30).x - motePose(near, 0, 0, 0).x > 0);
    assert.ok(motePose(far, 0, 0, 30).x - motePose(far, 0, 0, 0).x < 0);
  }
});

test('scroll depth: a still list is flat wherever it is; a moving one trails and bends, lower cards more', async () => {
  const { cardPose, leanFor } = await mobile('motion/depthMath.ts');
  const { motion } = await mobile('motion/values.ts');
  for (const centre of [-200, 0, 300, 700, 2000]) assert.equal(cardPose(0, centre, 800), null, 'no transform at rest');
  assert.equal(cardPose(0.0005, 400, 800), null);
  assert.equal(cardPose(1, 400, 0), null, 'not laid out yet: nothing');
  const top = cardPose(1, 0, 800), mid = cardPose(1, 400, 800), bottom = cardPose(1, 800, 800);
  assert.ok(top.rotateX > 0 && bottom.rotateX < 0 && Math.abs(mid.rotateX) < 1e-9, 'a shallow drum');
  assert.ok(bottom.translateY > mid.translateY && mid.translateY > top.translateY && top.translateY > 0, 'trails the scroll, lower cards more');
  assert.ok(Math.abs(bottom.translateY) <= motion.scroll.shift && Math.abs(top.rotateX) <= motion.scroll.tilt);
  assert.ok(bottom.scale < 1 && mid.scale === 1);
  assert.ok(cardPose(-1, 800, 800).translateY < 0, 'scrolling back up trails the other way');
  assert.equal(leanFor(0), 0); assert.equal(leanFor(100), 1); assert.equal(leanFor(-100), -1); assert.equal(leanFor(Number.NaN), 0);
  assert.ok(Math.abs(leanFor(motion.scroll.velocityFull / 2) - 0.5) < 1e-9);
});

test('screen entrance: starts turned about the vertical axis and ends flat and opaque', async () => {
  const { screenPose } = await mobile('motion/depthMath.ts');
  const { motion } = await mobile('motion/values.ts');
  assert.deepEqual(screenPose(1), { opacity: 1, translateX: 0, rotateY: 0, scale: 1 });
  const start = screenPose(0);
  assert.equal(start.rotateY, motion.screen.rotateYFrom); assert.equal(start.translateX, motion.screen.shiftFrom); assert.equal(start.opacity, 0);
  assert.ok(motion.screen.duration <= 500, 'short: it must not slow anyone down');
});

/* ---------- how the layer is wired (frozen with the staff screens) and what replaced it on the client screens ---------- */

const PNG_IMAGES = ['android-icon-foreground.png', 'android-icon-monochrome.png', 'favicon.png', 'icon.png', 'splash-icon.png'];

test('3D layer wiring: the mark is the unchanged image in front, copies of the same file behind; no new image files', () => {
  const mark = source('motion/BrandMark3D.tsx');
  // the front: the image as it was (source, size, radius, label), drawn last so it sits on top of the copies
  assert.match(mark, /<Image source=\{source\} style=\{\{ width: size, height: size, borderRadius: radius \}\} accessibilityLabel=\{accessibilityLabel\} \/>\n {2}<\/Animated\.View>;\n\}/);
  assert.match(mark, /function DepthLayer[\s\S]*?<Image source=\{source\} style=\{\{ width: size, height: size, borderRadius: radius \}\} accessible=\{false\} \/>/);
  assert.match(mark, /if \(a\.settled\) return \{ opacity: 0, transform: \[\] \};/, 'copies are transparent at rest');
  assert.match(mark, /if \(a\.settled\) return \{ opacity: 1, transform: \[\] \};/, 'the front has no transform at rest');
  assert.match(mark, /\{calm \? null : order\.map/, 'no copies with reduced motion');
  assert.doesNotMatch(mark, /tintColor|tint|backgroundColor|#[0-9a-fA-F]{3,6}\b/, 'never recoloured');
  // the staff sign-in chooser keeps it; the client sign-in's logo tile draws the Bioptime mark as vector paths (no image)
  assert.ok(source('app/(auth)/choose.tsx').includes('BrandMark3D'));
  const auth = source('flow/auth/AuthScreen.tsx');
  assert.ok(auth.includes('<View style={styles.tile} accessible accessibilityRole="image" accessibilityLabel="Bioptime">'));
  assert.ok(auth.includes('<MarkHandoff target="signin"><MarkPaths width={40} /></MarkHandoff>'));
  assert.doesNotMatch(source('fx/brand/MarkPaths.tsx'), /require\(|<Image\b/, 'the mark is drawn, not a new image file');
  // assets/images: still exactly the five PNGs; the native splash shows the mark on black, one image of its own (assets/splash/mark.png)
  assert.deepEqual(listDir(path.join(PLATFORM, 'apps/mobile/assets/images')).sort(), PNG_IMAGES);
  assert.deepEqual(listDir(path.join(PLATFORM, 'apps/mobile/assets/splash')).sort(), ['mark.png']);
});

test('photos: assets/photos holds only graded WebP photos (three sizes each), every one credited and in the manifest, 9 MB at most, no demo or sample name', () => {
  const dir = path.join(PLATFORM, 'apps/mobile/assets/photos');
  const names = listDir(dir).sort();
  const webp = names.filter((n) => n.endsWith('.webp'));
  assert.deepEqual(names.filter((n) => !n.endsWith('.webp')), ['CREDITS.json'], 'nothing else but the credits');
  assert.ok(webp.length > 0 && webp.every((n) => /^ph-[a-z0-9-]+-(64|1080|1600)\.webp$/.test(n)), 'ph-<slot>-<width>.webp');
  assert.ok(webp.every((n) => !/demo|sample/i.test(n)), 'no demo or sample name');
  const total = webp.reduce((sum, n) => sum + fs.statSync(path.join(dir, n)).size, 0);
  assert.ok(total <= 9 * 1024 * 1024, `${(total / 1048576).toFixed(1)} MB`);
  type Credit = { id: string; files: string[]; source: string; url: string; author: string; authorUrl: string; licence: string; downloaded: string };
  const credits = JSON.parse(fs.readFileSync(path.join(dir, 'CREDITS.json'), 'utf8')) as Credit[];
  const credited = credits.flatMap((c) => c.files).sort();
  assert.deepEqual(credited, webp, 'every file is credited, and only files that exist');
  for (const c of credits) {
    assert.deepEqual([...c.files].sort(), [`${c.id}-1080.webp`, `${c.id}-1600.webp`, `${c.id}-64.webp`], c.id);
    assert.ok(['unsplash', 'pexels'].includes(c.source) && c.author.trim() && /^https:\/\//.test(c.url) && /^https:\/\//.test(c.authorUrl), `${c.id}: source, author and links`);
    assert.ok(/^(Unsplash|Pexels) License$/.test(c.licence) && /^\d{4}-\d{2}-\d{2}$/.test(c.downloaded), `${c.id}: licence and date`);
  }
  const manifest = source('fx/media/photos.generated.ts');
  const required = [...manifest.matchAll(/require\('@\/assets\/photos\/([^']+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(required, webp, 'the manifest bundles exactly these files');
});

test('3D layer wiring: hidden starting states start at rest in pre-rendered HTML; reduced motion stands everything down', () => {
  for (const f of ['motion/BrandMark3D.tsx', 'motion/ScreenEnter.tsx']) {
    assert.match(source(f), /const inHtml = useInStaticHtml\(Platform\.OS === 'web'\);/, f);
  }
  assert.match(source('motion/BrandMark3D.tsx'), /const intro = useSharedValue\(calm \|\| inHtml \? 1 : 0\);\n\s+const introDone = useSharedValue\(calm \|\| inHtml \? 1 : 0\);/);
  assert.match(source('motion/ScreenEnter.tsx'), /const atRest = reduce \|\| inHtml;\n\s+const progress = useSharedValue\(atRest \? 1 : 0\);\n\s+const settled = useSharedValue\(atRest \? 1 : 0\);/);
  assert.match(source('motion/Motes.tsx'), /const calm = useCalmMotion\(\);\n\s+if \(calm\) return null;/, 'no motes with reduced motion');
  assert.match(source('motion/Motes.tsx'), /<View pointerEvents="none"/, 'motes never take a touch');
  assert.match(source('motion/ScrollDepth.tsx'), /if \(calm\) return;/, 'no lean with reduced motion');
  assert.match(source('motion/ScrollDepth.tsx'), /if \(!pose\) return \{ transform: \[\] \};/);
  assert.match(source('motion/useCalmMotion.ts'), /return reduce \|\| saveData;/);
  // the client kit takes the same two answers from src/motion: reduced motion (with Save-Data) and the pre-rendered HTML
  const tier = source('fx/motion/tier.ts');
  assert.ok(tier.includes("import { useCalmMotion, prefersSaveData } from '@/motion/useCalmMotion';") && tier.includes("import { useInStaticHtml } from '@/motion/staticHtml';"));
  assert.ok(tier.includes("return { tier, calm, lite: calm || tier === 'C', inHtml, still: calm || inHtml };"));
});

test('3D layer wiring: the staff kit keeps its depth; the client screens use the fx kit, with the milestone flip on the Train plan pills and CheckPop on Home', () => {
  const ui = source('components/ui.tsx');
  assert.match(ui, /const inner = <ScreenEnter fill=\{!scroll\}><View style=\{\[padded && styles\.padded, style\]\}>\{children\}<\/View><\/ScreenEnter>;/);
  assert.match(ui, /: <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle=\{styles\.scrollContent\} refreshControl=\{refreshControl\}>\{inner\}<\/ScrollView>\}/, 'screens without depth keep the plain scroll view');
  const press = source('motion/PressDepth.tsx');
  assert.match(press, /if \(scrollDepth\) return <ScrollDepth style=\{style\}><Enter index=\{index\} delay=\{delay\}><PressDepth disabled=\{!pressable\}>\{children\}<\/PressDepth><\/Enter><\/ScrollDepth>;\n\s+return <Enter index=\{index\} delay=\{delay\} style=\{style\}><PressDepth disabled=\{!pressable\}>\{children\}<\/PressDepth><\/Enter>;/);
  // Home is the kit's TabScreen with CheckPop ticks; the old Plan tab's status flip moved into Train › Plan
  assert.ok(source('app/(tabs)/index.tsx').includes('HomeScreen'));
  assert.doesNotMatch(source('app/(tabs)/index.tsx') + source('screens/home/HomeScreen.tsx'), /@\/components\/ui|<Screen\b/);
  assert.ok(source('screens/home/TasksCard.tsx').includes('<CheckPop checked={done} size={20} color={fx.hue.green500} />'));
  assert.ok(source('screens/train/PlanView.tsx').includes('<MilestoneReveal trigger={t.status} variant="flip" style={styles.pill}>'));
  assert.match(source('app/(tabs)/plan.tsx'), /<Redirect href="\/\(tabs\)\/train\?view=plan" \/>/);
});

/** Code without its comments (a comment may name a colour it describes). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** The client app's own files: every route file except the staff workspaces and the staff sign-ins. */
const STAFF_ROUTE = /^app\/(\(coach\)|\(admin\)|coach|admin)\/|^app\/\(auth\)\/(choose|coach-sign-in|admin-sign-in)\.tsx$/;
/** Route files that keep a staff body next to the member's (a coach or an administrator still opens them). */
const LEGACY_BODIES = ['app/notifications.tsx', 'app/settings/server.tsx', 'app/+not-found.tsx', 'app/index.tsx'];

test('3D layer: no design token changes: the staff theme is as it was, the motion files hold no colour; the client look is the fx tokens, and screens write no colour of their own', () => {
  const theme = source('theme.ts');
  for (const line of ["canvas: '#0B1120',", "brand: '#EE3324',", "text: '#FFFFFF',", "info: '#A3AEC2',", "export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;", "export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;", "export const font = { title: 26, h2: 20, h3: 17, body: 15, small: 13, tiny: 11 } as const;"]) assert.ok(theme.includes(line), line);
  for (const f of fs.readdirSync(path.join(SRC, 'motion'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'motion', f), 'utf8'), /#[0-9a-fA-F]{6}\b|rgba?\(/, `${f}: colours come from theme.ts only`);
  }
  // the earlier app's identity, with Bioptime red kept (BUILD §2.1)
  for (const line of ["deep: '#000000', base: '#080808',", "brand: '#EE3324', pressed: '#D42C1E', deep: '#C41C0D',", "gold: { base: '#C9A96E',",
    "white: '#FFFFFF', zinc200: '#E4E4E7', zinc300: '#D4D4D8', ink2: '#A1A1AA', ink3: '#71717A', ink4: '#52525B',",
    "a90: 'rgba(255,255,255,0.90)', a80: 'rgba(255,255,255,0.80)', a70: 'rgba(255,255,255,0.70)', a60: 'rgba(255,255,255,0.60)',",
    "a55: 'rgba(255,255,255,0.55)', a50: 'rgba(255,255,255,0.50)', a40: 'rgba(255,255,255,0.40)', a35: 'rgba(255,255,255,0.35)',",
    "radius: { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, toast: 14, card: 16, logo: 22, three: 24, tall: 28, hero: 32, pill: 999 },"]) assert.ok(theme.includes(line), line);
  const client = [...files(path.join(SRC, 'screens')), ...files(path.join(SRC, 'flow')), ...files(path.join(SRC, 'app'))]
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .filter((rel) => !STAFF_ROUTE.test(rel) && !LEGACY_BODIES.includes(rel) && rel !== 'screens/profile/SecurityLegacy.tsx');
  assert.ok(client.length > 150, `${client.length} client files`);
  const hits = client.filter((rel) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(code(source(rel))));
  assert.deepEqual(hits, [], 'colours come from the fx tokens only');
});
