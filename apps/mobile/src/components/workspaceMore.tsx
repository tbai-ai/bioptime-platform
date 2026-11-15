/* The More tab of a workspace: the rest of the web navigation for that workspace (lib/workspaceNav), each link gated by
   the person's permissions and the module flags exactly as the web Shell gates it, with the badge counts the web shows;
   then sign out. The routes under src/app/coach/… and src/app/admin/… are the next phase's screens. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { Alert } from '../lib/alert';
import { CHOOSER, homeFor, useAuth } from '../lib/auth';
import { apiBaseSync, APP_VERSION, SERVER_OVERRIDE_ALLOWED } from '../lib/config';
import { useWorkspaceNav, type NavLink, type WorkspaceKey } from '../lib/workspaceNav';
import { Button, Card, Eyebrow, ListItem, Loading, P, Screen } from './ui';
import { Badge } from './workspace';
import { useWorkspaceHome } from './workspaceShell';
import { colors, space } from '../theme';
import { Enter, MotionCard } from '../motion';

const TITLE: Record<WorkspaceKey, string> = { coach: 'Coach workspace', admin: 'Admin workspace' };

export function WorkspaceMore({ workspace }: { workspace: WorkspaceKey }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const nav = useWorkspaceNav(workspace);
  const home = useWorkspaceHome(workspace);
  const out = () => Alert.alert('Sign out?', 'Saved copies of data on this phone are removed.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void signOut().then((next) => router.replace(next ? homeFor(next.role) : CHOOSER)); } }]); // in the open preview a fresh session comes back: its home
  const item = (l: NavLink) => {
    const n = l.badge?.(home);
    return <ListItem key={l.key} title={l.label} sub={l.sub} onPress={() => router.push(l.route)} right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{n ? <Badge count={n} /> : null}<Ionicons name={l.icon as React.ComponentProps<typeof Ionicons>['name']} size={18} color={colors.muted} /></View>} />;
  };
  return <Screen>
    <Enter><View><Text style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>{user?.name}</Text><Text style={{ color: colors.muted }}>{user?.email} · {workspace === 'admin' && user?.role === 'owner' ? 'Owner workspace' : TITLE[workspace]}{user?.mfaEnabled ? ' · MFA on' : ''}</Text></View></Enter>
    <MotionCard index={1} pressable={false}><Card><Eyebrow>Sections</Eyebrow>
      {nav.loading && !nav.main.length ? <Loading /> : nav.main.map(item)}
    </Card></MotionCard>
    {nav.groups.map((g, i) => <MotionCard key={g.title} index={2 + i} pressable={false}><Card><Eyebrow>{g.title}</Eyebrow>{g.links.map(item)}</Card></MotionCard>)}
    <MotionCard index={2 + nav.groups.length} pressable={false}><Card><Eyebrow>Account</Eyebrow>
      <ListItem title="Password and devices" sub="Change your password, sign out other devices" onPress={() => router.push('/settings/security')} />
      {SERVER_OVERRIDE_ALLOWED ? <ListItem title="Server (testers)" sub={apiBaseSync()} onPress={() => router.push('/settings/server')} /> : null}
    </Card></MotionCard>
    <Button title="Sign out" variant="secondary" onPress={out} />
    <P muted small>Bioptime app {APP_VERSION}. Hiding a section is a courtesy: the server checks every permission and module switch again.</P>
  </Screen>;
}
