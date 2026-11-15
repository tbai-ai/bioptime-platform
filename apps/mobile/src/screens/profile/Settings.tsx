/* Profile › Settings (the earlier app's shots 79, 84 and 85): glass rows (icon, title, small line, chevron or switch),
   grouped, entering one after another. Every row does something real:
   - Account: notifications (the inbox, channels and quiet hours), profile, password and devices, and what the modules
     add for this tab (useModuleEntries('me'): workout history, progress photos, billing...).
   - Privacy and data: privacy and sharing (every consent), Coach AI and your data (its whileOff rule kept), your data
     (export and deletion), and where the data lives (the earlier app's "Cloud sync" line, made true).
   - Help: help and support, refer a friend (module entries).
   - This phone (device settings, nothing sent): units (kg/cm or lb/in), language (English only), dark mode (always on),
     haptics, step counting (with the motion permission; not in a browser), reduce effects (forces the lightest motion).
   - About: photo credits, the privacy policy and terms (web pages), the server for testers (development builds).
   - Sign out (red glass, a warning haptic and a confirmation), then the footer the route passes (verbatim).
   There is no "video autoplay" row: no screen plays clips by itself yet, so the switch would change nothing. */
import { router } from 'expo-router';
import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { homeFor, useAuth } from '@/lib/auth';
import { apiBaseSync, SERVER_OVERRIDE_ALLOWED } from '@/lib/config';
import { useModuleEntries, type ModuleEntry } from '@/lib/modules';
import {
  Accordion, Button, fx, haptics, Icon, peekSetting, Reveal, setSetting, SettingsRow, T, Toggle, useDeviceSetting, useStepCounter,
  type DeviceSettingKey, type DeviceSettings, type IconName,
} from '@/fx';
import { GroupLabel, shared } from './parts';

type Group = 'account' | 'privacy' | 'help';
const GROUP_OF: Record<string, Group> = { '/workout-history': 'account', '/photos': 'account', '/billing': 'account', '/coach-ai': 'privacy', '/help': 'help', '/refer': 'help' };

export function SettingsPanel({ unread, footer }: { unread: number | null; footer: React.ReactNode }) {
  const { signOut } = useAuth();
  const entries = useModuleEntries('me');
  const of = (g: Group) => entries.filter((e) => (GROUP_OF[e.route] ?? 'help') === g);
  let n = 0;
  const row = (node: React.ReactNode, key: string) => <Reveal key={key} index={Math.min(n++, 8)} id={`profile.settings.${key}`}>{node}</Reveal>;
  const entry = (e: ModuleEntry) => row(<SettingsRow icon={(e.icon ?? 'circle') as IconName} title={e.title} sub={e.sub} onPress={() => router.push(e.route)} />, e.route);

  const out = () => {
    haptics.warning();
    Alert.alert('Sign out?', 'Saved copies of your data on this phone are removed.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { void signOut().then((next) => router.replace(next ? homeFor(next.role) : '/(auth)/sign-in')); } },
    ]);
  };

  return <View style={shared.gap8}>
    <GroupLabel>Account</GroupLabel>
    {row(<SettingsRow icon="bell" title="Notifications" sub={`${unread == null ? 'Your inbox' : unread ? `${unread} unread` : 'All read'} · channels and quiet hours`} onPress={() => router.push('/notifications')} />, 'notifications')}
    {row(<SettingsRow icon="user" title="Profile" sub="Name, phone, address, goals" onPress={() => router.push('/settings/profile')} />, 'profile')}
    {row(<SettingsRow icon="lock" title="Password and devices" sub="Change your password, sign out other devices" onPress={() => router.push('/settings/security')} />, 'security')}
    {of('account').map(entry)}

    <GroupLabel>Privacy and data</GroupLabel>
    {row(<SettingsRow icon="shield-check" title="Privacy and sharing" sub="What your coach and the laboratory can see" onPress={() => router.push('/settings/consents')} />, 'consents')}
    {of('privacy').map(entry)}
    {row(<SettingsRow icon="download" title="Your data" sub="Ask for a copy of your data or for deletion" onPress={() => router.push('/settings/data')} />, 'data')}
    {row(<SettingsRow icon="shield" title="Your data is stored by Bioptime" sub="On Bioptime’s service, not only on this phone. The phone keeps a saved copy to show while you are offline." />, 'stored')}

    {of('help').length ? <GroupLabel>Help</GroupLabel> : null}
    {of('help').map(entry)}

    <GroupLabel>This phone</GroupLabel>
    {row(<Units />, 'units')}
    {row(<SettingsRow icon="globe" title="Language" sub="English" right={<View style={styles.badge}><T v="mono12" color={fx.ink.a80}>EN</T></View>} />, 'language')}
    {row(<SettingsRow icon="moon" title="Dark mode" sub="Always on" right={<Toggle value label="Dark mode, always on" disabled onChange={() => undefined} />} />, 'dark')}
    {row(<HapticsRow />, 'haptics')}
    {row(<StepsRow />, 'steps')}
    {row(<EffectsRow />, 'effects')}

    <GroupLabel>About</GroupLabel>
    {row(<SettingsRow icon="images" title="Photo credits" sub="Who took the photographs in this app, and the exercise videos" onPress={() => router.push('/settings/credits')} />, 'credits')}
    {row(<SettingsRow icon="shield" title="Privacy policy" sub="Opens in your browser" right={<Icon name="external-link" size={16} color={fx.ink.a40} />} onPress={() => { void Linking.openURL(`${apiBaseSync()}/privacy`).catch(() => undefined); }} />, 'privacy-policy')}
    {row(<SettingsRow icon="file-text" title="Terms of use" sub="Opens in your browser" right={<Icon name="external-link" size={16} color={fx.ink.a40} />} onPress={() => { void Linking.openURL(`${apiBaseSync()}/terms`).catch(() => undefined); }} />, 'terms')}
    {SERVER_OVERRIDE_ALLOWED ? row(<SettingsRow icon="settings" title="Server (testers)" sub={apiBaseSync()} onPress={() => router.push('/settings/server')} />, 'server') : null}

    <View style={styles.signOut}>
      <Button title="Sign out" variant="redGlass" onPress={out} hint="Asks you to confirm" />
    </View>
    <View style={styles.footer}>{footer}</View>
  </View>;
}

/** A device setting that re-renders when it changes. The kit's useDeviceSetting subscribes, but under the React
 *  Compiler its returned value can stay memoised, so the value is read here, outside the compiler. */
function useSetting<K extends DeviceSettingKey>(key: K): DeviceSettings[K] | undefined {
  'use no memo';
  useDeviceSetting(key);
  return peekSetting(key);
}

/** Units (the earlier app's accordion, shot 84): metric or imperial for the loads typed in a workout and the weight and
 *  height typed while setting up. Bio, goals and logged values are in kg and cm whatever this says, and the row says
 *  so rather than promise a conversion it does not make. */
function Units() {
  'use no memo';
  const weight = useSetting('units.weight') ?? 'kg';
  const metric = weight === 'kg';
  const pick = (m: boolean) => { void setSetting('units.weight', m ? 'kg' : 'lb'); void setSetting('units.height', m ? 'cm' : 'in'); };
  return <Accordion icon="ruler" title={`Workout load units: ${metric ? 'Metric (kg)' : 'Imperial (lb)'}`}>
    <View style={shared.gap8} accessibilityRole="radiogroup">
      <UnitOption on={metric} title="Metric" sub="kg, cm" onPress={() => pick(true)} />
      <UnitOption on={!metric} title="Imperial" sub="lb, in" onPress={() => pick(false)} />
    </View>
    <T v="caption" color={fx.ink.a60} style={styles.unitNote}>For the loads you log in a workout, and your weight and height while you set up. Bio, your goals and the values you log stay in kg and cm.</T>
  </Accordion>;
}

function UnitOption({ on, title, sub, onPress }: { on: boolean; title: string; sub: string; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${title}, ${sub}`}
    onPress={() => { if (!on) { haptics.select(); onPress(); } }} style={[styles.unit, on ? styles.unitOn : null]}>
    <View style={shared.flex}>
      <T v="section" color={on ? fx.red.label : fx.ink.white}>{title}</T>
      <T v="caption" color={on ? fx.red.label : fx.ink.a55}>{sub}</T>
    </View>
    {on ? <Icon name="check" size={16} color={fx.red.label} /> : null}
  </Pressable>;
}

function HapticsRow() {
  'use no memo';
  const on = useSetting('haptics') !== false;
  return <SettingsRow icon="smartphone" title="Haptics" sub="Taps you can feel when you log, book or confirm"
    right={<Toggle value={on} label="Haptics" onChange={(v) => { void setSetting('haptics', v); }} />} />;
}

function StepsRow() {
  'use no memo';
  const counter = useStepCounter(false);
  const enabled = useSetting('steps.enabled') === true;
  const sub = counter.status === 'unavailable' ? 'Not available on this device or in a browser'
    : counter.status === 'denied' ? 'Motion access was refused; allow it in the phone settings'
      : enabled ? 'This phone counts your steps and sends the day’s total' : 'Count my steps on this phone';
  return <SettingsRow icon="footprints" title="Step counting" sub={sub}
    right={<Toggle value={enabled && counter.status !== 'unavailable'} label="Step counting" disabled={counter.status === 'unavailable'}
      onChange={(v) => { void (v ? counter.enable() : counter.disable()); }} />} />;
}

function EffectsRow() {
  'use no memo';
  const on = useSetting('reduceEffects') === true;
  return <SettingsRow icon="sparkles" title="Reduce effects" sub="Lighter motion, no blur or depth on this phone"
    right={<Toggle value={on} label="Reduce effects" onChange={(v) => { void setSetting('reduceEffects', v); }} />} />;
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: fx.radius.lg, backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10 },
  unit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: fx.radius.xl, minHeight: 52 },
  unitNote: { marginTop: 10 },
  unitOn: { backgroundColor: fx.red.a10 },
  signOut: { marginTop: 16 },
  footer: { marginTop: 16, paddingHorizontal: 4 },
});
