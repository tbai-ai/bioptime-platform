/* The kit gallery (development builds only): every component of src/fx in its states, for the screen packages and for
   the screenshots that compare the kit with the earlier app, the brand art and the scroll chrome, then the motion v2
   hub (src/fx/gallery/MotionGallery: the motion core, controls and feedback, navigation and overlays, and sheets,
   morph, brand and media sections). Nothing here reads or writes member data; the numbers are illustrations. */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { ApiError } from '@/lib/api';
import {
  Accordion, Avatar, BackHeader, Button, Check, COLUMN, ColorTab, CompactBar, ConsentCard, DateChip, EmptyState, ErrorState, Eyebrow, Field, FilterChip, FlowEnter, fx,
  GlassCard, GoalTile, H, Icon, IconButton, IconInput, IconTile, Input, KVRow, LargeTitle, Lockup, MarkPaths, Medallion, Notice, NumberInput, OptionCard, Orbs, OtpBoxes, Overlay, P,
  Photo, PhotoTag, Pill, PillTabs, RadialGlow, RemotePhoto, Reveal, RevealScope, RingSpinner, RowDivider, Scrim, ScreenHeader, ScrollAnchor, SearchInput, Segmented, SettingsRow,
  Sheet, StackRecede, StaleBanner, Stepper, StretchyHeader, SuggestionChip, SwitchView, T, TabScreen, Tag, Tagline, TitledDivider, Toggle, VerifiedOverlay, Wordmark, toast,
  useScrollToAnchor, useTabScroll, type ScrimKind, type TypeVariant,
} from '@/fx';
import { SplashSting } from '@/fx/brand/SplashSting';
import { MotionGallery } from '@/fx/gallery/MotionGallery';
import { NavItem, PillTabBar } from '@/fx/nav/PillTabBar';
import { TABS } from '@/fx/nav/tabs';

const VARIANTS: TypeVariant[] = ['auth56', 'quiz42', 'display36', 'h1', 'card24', 'small20', 'heading', 'cardTitle', 'section', 'body', 'bodySm', 'caption', 'eyebrowBrand', 'eyebrowGreeting', 'label', 'overline', 'micro', 'metric24', 'mono14', 'button', 'chip'];
const SCRIMS: ScrimKind[] = ['heroHome', 'login', 'trainHeader', 'headerBand', 'cardBottom', 'programme', 'banner', 'stickyCta', 'streakDay', 'coach', 'solidCard', 'navLeft'];
const ICONS = ['house', 'dumbbell', 'dna', 'clock', 'leaf', 'messages-square', 'microscope', 'shopping-bag', 'user', 'flame', 'droplets', 'moon', 'heart-pulse', 'footprints', 'target', 'clipboard-list', 'calendar', 'flask-conical', 'shield-check', 'bell', 'trophy', 'salad', 'barbell-outline', 'nutrition-outline', 'building-2', 'hash', 'signpost', 'skip-back', 'skip-forward'];

/** The gallery's chrome: the kit's Overlay, or with ?chrome=stack none of its own, so the root stack draws its header
 *  for it (src/fx/StackHeader: the look every screen without chrome of its own gets). */
function Frame({ stack, children }: { stack: boolean; children: React.ReactNode }) {
  if (stack) return <ScrollView contentContainerStyle={styles.plain}>{children}</ScrollView>;
  return <Overlay title="Kit" subtitle="Every component of src/fx, in its states" kind="back" fallback="/(tabs)">{children}</Overlay>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}>
    <Eyebrow kind="brand">{title}</Eyebrow>
    {children}
  </View>;
}

/** A small scrolling page: the stretchy photo header, the large title handing over to the compact bar, cards that
 *  reveal as they scroll in and recede as they leave. Mounted on demand (a Reveal places itself from where it is on
 *  screen when it mounts, so the frame must be in view then). Scroll inside the frame. */
function ScrollChrome() {
  const [shown, setShown] = useState(false);
  if (!shown) return <View style={[styles.scrollFrame, styles.centerAll]}><Button title="Show the scroll page" variant="soft" full={false} onPress={() => setShown(true)} /></View>;
  return <ScrollPage />;
}

function ScrollPage() {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const y = useScrollOffset(ref);
  return <View style={styles.scrollFrame}>
    <Animated.ScrollView ref={ref} nestedScrollEnabled scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <StretchyHeader scrollY={y} height={220} base={0.4} settle photo={<Photo slot="train.header.all" style={StyleSheet.absoluteFill} decorative />}>
        <Orbs preset="home" />
      </StretchyHeader>
      <View style={styles.scrollTitle}>
        <LargeTitle scrollY={y}><T v="h1">Store</T></LargeTitle>
      </View>
      <RevealScope scrollY={y}>
        <View style={styles.scrollCards}>
          {Array.from({ length: 8 }, (_, i) => <Reveal key={i} index={i % 2}>
            <StackRecede>
              <GlassCard><T v="cardTitle">{`Card ${i + 1}`}</T><P small muted>Reveals as it scrolls in; recedes as it leaves.</P></GlassCard>
            </StackRecede>
          </Reveal>)}
        </View>
      </RevealScope>
    </Animated.ScrollView>
    <CompactBar scrollY={y} title="Store" />
  </View>;
}

/** A TabScreen in a frame: "Go to card 9" scrolls to a <ScrollAnchor>; "Filter" drops the first eight cards, so the
 *  ones below move up into view without a scroll. */
function AnchorFrame() {
  const [shown, setShown] = useState(false);
  if (!shown) return <View style={[styles.scrollFrame, styles.centerAll]}><Button title="Show the anchor page" variant="soft" full={false} onPress={() => setShown(true)} /></View>;
  return <View style={styles.scrollFrame}><TabScreen><AnchorPage /></TabScreen></View>;
}

function AnchorPage() {
  const y = useTabScroll();
  const go = useScrollToAnchor();
  const [filtered, setFiltered] = useState(false);
  const cards = Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => !filtered || n > 8);
  const list = <View style={styles.scrollCards}>
    <View style={styles.wrap}>
      <Button title="Go to card 9" variant="soft" full={false} onPress={() => { go('card9'); }} />
      <Button title={filtered ? 'Show all' : 'Filter'} variant="soft" full={false} onPress={() => setFiltered((f) => !f)} />
    </View>
    {cards.map((n) => {
      const card = <Reveal key={n} index={n % 2}><GlassCard><T v="cardTitle">{`Card ${n}`}</T><P small muted>A section of a tab page.</P></GlassCard></Reveal>;
      return n === 9 ? <ScrollAnchor key={n} name="card9">{card}</ScrollAnchor> : card;
    })}
  </View>;
  return y ? <RevealScope scrollY={y}>{list}</RevealScope> : list;
}

export default function KitGallery() {
  const [seg, setSeg] = useState<'today' | 'search' | 'saved'>('today');
  const [auth, setAuth] = useState<'email' | 'phone'>('email');
  const [tab, setTab] = useState<'overview' | 'achievements' | 'reports' | 'orders' | 'settings'>('overview');
  const [dir, setDir] = useState<1 | -1>(1);
  const [chip, setChip] = useState('All');
  const [tags, setTags] = useState<string[]>(['Vegetarian']);
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [consent, setConsent] = useState(false);
  const [option, setOption] = useState('moderate');
  const [goals, setGoals] = useState<string[]>(['energy']);
  const [weight, setWeight] = useState(68);
  const [code, setCode] = useState('1234');
  const [codeError, setCodeError] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sheet, setSheet] = useState<null | 'default' | 'tall'>(null);
  const [sting, setSting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const stackChrome = useLocalSearchParams<{ chrome?: string }>().chrome === 'stack';
  if (!__DEV__) return <Redirect href="/" />;
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'achievements', label: 'Achievements' }, { value: 'reports', label: 'Reports' }, { value: 'orders', label: 'Orders' }, { value: 'settings', label: 'Settings' }] as const;
  const order = tabs.map((x) => x.value as string);
  return <View style={styles.fill}>
    <Frame stack={stackChrome}>
      <Section title="Type">
        {VARIANTS.map((v) => <T key={v} v={v} numberOfLines={1}>{v === 'label' || v.startsWith('eyebrow') || v === 'overline' || v === 'micro' ? `${v} label` : `${v} Priya 1,234`}</T>)}
        <P muted>A muted paragraph at white/60, Montserrat 300.</P>
        <H right={<Button title="See all" variant="link" />} icon={<Icon name="activity" size={15} color={fx.red.label} />}>Today’s activity</H>
      </Section>

      <Section title="Buttons">
        <Button title="Sign in" iconRight="arrow-right" commit busy={busy} onPress={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }} />
        <Button title="Continue" shape="flow" />
        <Button title="Sign in" disabled />
        <View style={styles.row}><Button title="Back" variant="ghost" /><Button title="Next" variant="white" style={styles.flex2} /></View>
        <Button title="Book a blood test" variant="whiteBlock" icon="calendar" />
        <Button title="View details" variant="soft" />
        <Button title="Join this programme" color={fx.map.programme[1].c} icon="shopping-bag" shape="flow" />
        <View style={styles.row}><Button title="Browse meals" variant="redTint" /><Button title="Log" variant="solidSm" /><Button title="See all" variant="link" /></View>
        <Button title="Sign out" variant="redGlass" />
        <Button title="Back" variant="back" />
        <View style={styles.row}>
          <IconButton icon="x" label="Close" />
          <IconButton icon="chevron-left" label="Back" kind="glass" />
          <IconButton icon="send" label="Send" kind="send" active />
          <IconButton icon="play" label="Play" kind="fab" />
          <IconButton icon="play" label="Start the timer" kind="fabLg" />
          <RingSpinner label="Loading" />
        </View>
      </Section>

      <Section title="Cards">
        <GlassCard><T v="cardTitle">Glass card</T><P>Radius 16, padding 20, white/5 border.</P></GlassCard>
        <GlassCard onPress={() => toast.info('Card pressed')} label="Pressable card"><T v="cardTitle">Pressable card</T><P>Press: .98 and a warm border.</P></GlassCard>
        <View style={styles.row}>
          <GlassCard variant="tile" onPress={() => undefined} label="Tile" style={styles.flex}><T v="label">HRV</T><T v="metric24">68</T></GlassCard>
          <GlassCard variant="tile" rule={{ color: fx.gold.base, width: 2 }} style={styles.flex}><T v="metric30">12</T><T v="caption">Workouts</T></GlassCard>
        </View>
        <GlassCard variant="hero" blur clip>
          <RadialGlow opacity={0.2} style={styles.orb} />
          <T v="score54" center>74</T>
          <T v="micro" color={fx.red.brand} center>Good</T>
        </GlassCard>
        <GlassCard rule={{ color: fx.red.vivid }}><T v="overline">From your coach</T><P>Insight card with the 4 pt red rule.</P></GlassCard>
        <View style={styles.row}>
          <IconTile icon="flask-conical" />
          <IconTile icon="heart-pulse" size={48} color={fx.status.optimal} />
          <IconTile icon="shield-check" size={36} color={fx.gold.base} />
          <IconTile icon="activity" solid />
          <IconTile icon="target" glow />
        </View>
      </Section>

      <Section title="Inputs">
        <Field label="Email" title="Email address" hint="The email of your Bioptime account."><Input value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" /></Field>
        <Field label="Password" error="That password is not right."><Input secureToggle placeholder="Your password" /></Field>
        <Field label="Full name"><IconInput icon="user" placeholder="As on your ID" /></Field>
        <SearchInput placeholder="Search foods" />
        <NumberInput unit="KG" placeholder="68.5" label="Weight" />
        <OtpBoxes value={code} onChange={(v) => { setCode(v); setCodeError(false); }} onComplete={(v) => { if (v === '000000') setCodeError(true); else setVerified(true); }} error={codeError} />
        <P small muted>Six digits verify; 000000 shows the error shake.</P>
      </Section>

      <Section title="Chips and segments">
        <View style={styles.wrap}>{['All', 'Strength', 'Conditioning', 'Mobility'].map((c) => <FilterChip key={c} label={c} selected={chip === c} onPress={() => setChip(c)} />)}</View>
        <View style={styles.wrap}>
          <ColorTab label="Purpose" color={fx.map.guide.purpose} selected icon="target" />
          <ColorTab label="Muscles" color={fx.map.guide.muscles} />
          <ColorTab label="Safety" color={fx.map.guide.safety} />
        </View>
        <View style={styles.wrap}>{['Vegetarian', 'Early riser', 'Desk job'].map((x) => <Tag key={x} label={x} selected={tags.includes(x)} onPress={() => setTags((t) => (t.includes(x) ? t.filter((y) => y !== x) : [...t, x]))} />)}</View>
        <View style={styles.wrap}><SuggestionChip label="How is my week going?" /><SuggestionChip label="Move my consultation" /></View>
        <View style={styles.wrap}>{[['Mon', 3], ['Tue', 4], ['Wed', 5]].map(([d, n]) => <DateChip key={d} weekday={String(d)} day={n} month="Nov" selected={n === 4} label={`${d} ${n} November`} />)}<PhotoTag>Strength</PhotoTag><PhotoTag mono>20:00</PhotoTag></View>
        <Segmented kind="red" value={auth} onChange={setAuth} items={[{ value: 'email', label: 'Email', icon: 'mail' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} />
        <Segmented value={seg} onChange={setSeg} items={[{ value: 'today', label: 'Today' }, { value: 'search', label: 'Search' }, { value: 'saved', label: 'Saved' }]} />
        <PillTabs items={[...tabs]} value={tab} onChange={(v) => { setDir(order.indexOf(v) > order.indexOf(tab) ? 1 : -1); setTab(v); }} />
        <SwitchView id={tab} direction={dir}><GlassCard><T v="cardTitle">{tabs.find((x) => x.value === tab)?.label}</T><P>The panel enters from the side of the change.</P></GlassCard></SwitchView>
      </Section>

      <Section title="Choices">
        <Toggle value={on} onChange={setOn} label="Haptics" showLabel />
        <Check checked={checked} onChange={setChecked} label="I agree to the terms and the privacy policy" hint="You can read both before agreeing." />
        <ConsentCard checked={consent} onChange={setConsent} title="Health data" note="Required. Bioptime stores what you log and your reports." icon="heart-pulse" />
        {[['light', 'Lightly active', 'Walks, light chores'], ['moderate', 'Moderately active', 'Exercise 3–4 days a week']].map(([v, title, d]) => <OptionCard key={v} title={title} description={d} icon={v === 'light' ? 'footprints' : 'activity'} selected={option === v} onPress={() => setOption(v)} />)}
        <View style={styles.row}>{[['energy', 'More energy', 'zap'], ['sleep', 'Better sleep', 'moon']].map(([v, title, icon]) => <GoalTile key={v} title={title} description="A goal tile" icon={icon as 'zap'} selected={goals.includes(v)} onPress={() => setGoals((g) => (g.includes(v) ? g.filter((x) => x !== v) : [...g, v]))} />)}</View>
        <Stepper value={weight} onChange={setWeight} min={30} max={200} unit="kg" label="Weight" />
      </Section>

      <Section title="Feedback">
        <View style={styles.wrap}>
          <Button title="Top toast" variant="soft" full={false} onPress={() => toast.info('Saved to your plan')} />
          <Button title="Success" variant="soft" full={false} onPress={() => toast.success('Booking confirmed')} />
          <Button title="Error" variant="soft" full={false} onPress={() => toast.error('That did not go through')} />
          <Button title="Bottom pill" variant="soft" full={false} onPress={() => toast.logged('250 ml added')} />
          <Button title="Sheet" variant="soft" full={false} onPress={() => setSheet('default')} />
          <Button title="Tall sheet" variant="soft" full={false} onPress={() => setSheet('tall')} />
          <Button title="Verified" variant="soft" full={false} onPress={() => setVerified(true)} />
          <Button title="Play the sting" variant="soft" full={false} onPress={() => setSting(true)} />
        </View>
        <Notice kind="info" title="Information">An information notice, as every verbatim notice reads.</Notice>
        <Notice kind="warning" title="Confirm your email">Blood test bookings wait until your email address is confirmed.</Notice>
        <Notice kind="success" title="Saved">Your answers reached your coach.</Notice>
        <Notice kind="sample" title="Simulated">Bookings here are simulated; no laboratory is involved and no sample is collected.</Notice>
        <Notice kind="error" title="Refused">The server said no.</Notice>
        <ErrorState error={new ApiError(0, null)} onRetry={() => undefined} />
        <ErrorState error={new ApiError(500, { error: { code: 'INTERNAL', message: 'The server could not finish this.' } })} onRetry={() => undefined} />
        <StaleBanner at={new Date(Date.now() - 3600_000).toISOString()} />
        <View style={styles.wrap}>
          <Pill tone="success">Done</Pill><Pill tone="warning">Pending</Pill><Pill tone="error">Cancelled</Pill><Pill>Info</Pill>
          <Pill color={fx.map.order.sample_collected}>Collected</Pill><Pill color={fx.map.marker.in_range} icon="check">In range</Pill>
        </View>
      </Section>

      <Section title="Empty states">
        <EmptyState icon="dumbbell" title="No sessions this week" body="Your coach is writing your plan. It appears here as soon as it is published." action={{ title: 'Message your coach', onPress: () => undefined }} />
        <EmptyState dashed icon="salad" title="Nothing logged today" body="Log a meal to see it here." action={{ title: 'Log a meal', onPress: () => undefined }} secondary={{ title: 'Search foods', onPress: () => undefined }} />
        <EmptyState photo="default" icon="inbox" title="Nothing here yet" body="A calm band above the empty tile." />
      </Section>

      <Section title="People, rows and dividers">
        <View style={styles.row}>
          <Avatar name="Priya Nair" size={60} ring />
          <Avatar name="Rohan Mehta" size={40} />
          <Medallion name="Asha Menon" size={40} follow />
          <Medallion name="Asha Menon" size={28} />
        </View>
        <TitledDivider text="Or continue with" />
        <SettingsRow icon="bell" title="Notifications" sub="Quiet hours and channels" onPress={() => undefined} />
        <SettingsRow icon="smartphone" title="Count my steps on this phone" sub="Counted while Bioptime is open" right={<Toggle value={on} onChange={setOn} label="Count my steps on this phone" />} />
        <SettingsRow icon="log-out" title="Sign out" danger onPress={() => undefined} />
        <RowDivider />
        <KVRow label="Blood test" value="₹2,999" />
        <KVRow label="Total" value="₹2,999" total divider={false} />
        <Accordion title="Units" icon="ruler"><P small>Weight in kilograms, height in centimetres. Change them here.</P></Accordion>
      </Section>

      <Section title="Photos and scrims">
        <Photo slot="home.hero.morning" opacity={0.4} tint="red" kenBurns style={styles.photo} radius={16} />
        <Photo slot="store.package.card.0" tint="programme" tintColor={fx.map.programme[0].dim} style={styles.photo} radius={16} />
        <RemotePhoto uri={null} fallbackSlot="tests.featured.card" style={styles.photoSmall} radius={16} />
        <View style={styles.wrap}>{SCRIMS.map((k) => <View key={k} style={styles.swatch}><Scrim kind={k} style={StyleSheet.absoluteFill} /><T v="micro" style={styles.swatchText}>{k}</T></View>)}</View>
        <View style={styles.wrap}>{ICONS.map((n) => <View key={n} style={styles.icon}><Icon name={n} size={22} color={fx.ink.a80} /></View>)}</View>
      </Section>

      <Section title="Tab bar (all nine)">
        <View style={styles.barFrame}>
          <PillTabBar count={TABS.length}>{TABS.map((tab, i) => <NavItem key={tab.name} tab={tab} order={i} badge={tab.name === 'coach'} />)}</PillTabBar>
        </View>
      </Section>

      <Section title="Screen chrome">
        <View style={styles.frame}><ScreenHeader title="Train" subtitle="Your coach's plan and your library." photo={{ slot: 'train.header.all' }} inset={false} /></View>
        <View style={styles.frame}><ScreenHeader eyebrow="Bioptime" title="Programs" subtitle="Coach-led packages." from="left" inset={false} /></View>
        <View style={styles.frame}><BackHeader title="Help and support" onBack={() => toast.info('Back')} inset={false} ownChrome={false} /></View>
        <P small muted>The stack's own header (above): what a screen without chrome of its own gets. Open /__fx?chrome=stack to see it in place.</P>
        <FlowEnter><GlassCard><P>FlowEnter: opacity and a 10 pt rise in 400 ms.</P></GlassCard></FlowEnter>
        <Button title="Open the tabs" variant="white" onPress={() => router.replace('/(tabs)')} />
      </Section>

      <Section title="Brand">
        <View style={styles.row}><MarkPaths width={24} /><MarkPaths width={40} /><MarkPaths width={64} /></View>
        <Wordmark width={180} />
        <Tagline width={240} />
        <Lockup width={220} accessibilityLabel="Bioptime. Your wellness, our passion." />
      </Section>

      <Section title="Scroll chrome">
        <P small muted>StretchyHeader, LargeTitle and CompactBar, RevealScope, StackRecede. Scroll inside the frame.</P>
        <ScrollChrome />
        <P small muted>TabScreen's ScrollAnchor, and Reveal on a list that is filtered.</P>
        <AnchorFrame />
      </Section>

      <MotionGallery />
    </Frame>

    <Sheet visible={sheet === 'default'} onClose={() => setSheet(null)} title="Log water">
      <P>A sheet drawn by the root SheetHost: drag the grabber down, tap the scrim, press Escape or Android back.</P>
      <View style={styles.sheetBody}><Button title="Add 250 ml" commit onPress={() => { setSheet(null); toast.logged('250 ml added'); }} /></View>
    </Sheet>
    <Sheet visible={sheet === 'tall'} onClose={() => setSheet(null)} tall closeButton title="Core programme"
      hero={<Photo slot="store.package.sheet.0" tint="programme" style={styles.sheetHero} radius={16} />}>
      {Array.from({ length: 12 }, (_, i) => <KVRow key={i} label={`Included ${i + 1}`} value="Yes" />)}
    </Sheet>
    <VerifiedOverlay visible={verified} onDone={() => setVerified(false)} />
    {sting ? <View style={StyleSheet.absoluteFill}><SplashSting ready replay onDone={() => setTimeout(() => setSting(false), 600)} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: fx.bg.base },
  plain: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  section: { gap: 12, paddingTop: 12, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  flex2: { flex: 2 },
  orb: { position: 'absolute', right: -60, top: -60, width: 220, height: 220 },
  photo: { height: 176 },
  photoSmall: { height: 120 },
  swatch: { width: 96, height: 56, borderRadius: fx.radius.lg, overflow: 'hidden', backgroundColor: fx.bg.card, justifyContent: 'flex-end', padding: 4 },
  swatchText: { fontSize: 8 },
  icon: { width: 40, height: 40, borderRadius: fx.radius.xl, backgroundColor: fx.fill.a05, alignItems: 'center', justifyContent: 'center' },
  frame: { borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.deep },
  sheetBody: { marginTop: 16 },
  barFrame: { height: 112, marginHorizontal: -20 },
  sheetHero: { height: 208, marginHorizontal: 16, marginBottom: 16 },
  centerAll: { alignItems: 'center', justifyContent: 'center' },
  scrollFrame: { height: 440, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.deep },
  scrollContent: { paddingBottom: 120 },
  scrollTitle: { paddingHorizontal: 20, paddingTop: 150 }, // the photo header is absolute: the title sits over its lower part
  scrollCards: { padding: 20, gap: 12 },
});
