/* Admin › Integrations (the web's /admin/integrations, pages/admin/Integrations.tsx; settings.manage). What is connected
   and what is simulated: the payment provider, email, SMS and push (GET /admin/settings → integrations), the outbox's
   latest line (GET /admin/outbox, operations.manage) and, as on the web, what the switched-on modules still need: the
   meetings, calendar, video, Coach AI and private-storage rows of the integrations registry (GET /admin/integrations)
   used by a module that is on, with what is missing and the variable names each reads. Secrets never reach this
   screen: the server reports presence and mode only. The laboratory integration is administered under LabStack,
   behind labstack.manage. Pills take the portal's colours (lib/admin/b2/pill pillTone): simulated and recorded-only
   providers are the web's 'draft' (amber). Nothing is requested without settings.manage. */
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { moduleHasUi, PORTAL_REGISTRY } from '@/lib/admin/b2/moduleFlags';
import { gated, pillTone, useAllowed } from '@/lib/admin/b2/pill';
import { RightPill } from '@/components/adminB2/parts';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, P, Pill, Row, StaleBanner } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { space } from '@/theme';

type SettingsPayload = { settings: Record<string, unknown>; integrations: { labstack: { restricted: true; managedUnder: string; permission: string }; payments: { provider: string; simulated: boolean }; email: string; sms: string; push: string }; mode: string; demo: boolean };
type OutboxRow = { id: string; channel: string; created_at: string };
type Registry = { key: string; label: string; mode?: string; status?: 'live' | 'simulated' | 'local' | 'pending_configuration'; configured?: boolean; variables?: string[]; missing?: string[]; note?: string; usedBy?: string[]; restricted?: boolean };

const MODULE_PROVIDERS = ['meetings', 'calendar', 'video', 'ai', 'storage'];
const live = (name: string) => !['simulator', 'standin', 'outbox', 'none', 'console'].includes(String(name));

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminIntegrations() {
  return <RoleGate workspace="admin"><AdminIntegrationsScreen /></RoleGate>;
}

function AdminIntegrationsScreen() {
  const { can } = useAuth();
  const router = useRouter();
  const allowed = useAllowed('settings.manage');
  const s = useLoad<SettingsPayload | null>(allowed ? 'admin-integrations-settings' : null, gated(allowed, () => get<SettingsPayload>('/admin/settings')), [allowed]);
  // the outbox needs operations.manage; without it the screen simply leaves the line out
  const outbox = useLoad<{ items: OutboxRow[] } | null>(null, gated(allowed && can('operations.manage'), () => get<{ items: OutboxRow[] }>('/admin/outbox?limit=8').catch(() => null)), [allowed]);
  const registry = useLoad<{ items: Registry[]; mode: string; demo: boolean } | null>(allowed ? 'admin-integrations-registry' : null, gated(allowed, () => get<{ items: Registry[]; mode: string; demo: boolean }>('/admin/integrations').catch(() => null)), [allowed]);
  const features = useFeatures(allowed);
  const active = PORTAL_REGISTRY.filter((m) => moduleHasUi(m) && !!features?.has(m.key)).map((m) => m.key);
  const rows = registry.data?.items ?? [];
  const pending = rows.filter((i) => !i.restricted && MODULE_PROVIDERS.includes(i.key) && (i.usedBy ?? []).some((k) => active.includes(k)));
  const d = s.data?.integrations;
  const mode = s.data?.mode;
  const reload = () => { void s.reload(); void outbox.reload(); void registry.reload(); };
  const simulatedServer = s.data?.demo === true; // the server's own flag for its seeded, simulated set-up
  const sub = `${simulatedServer ? 'Payments, messages and the laboratory are simulated on this server. ' : mode ? `Server mode ${mode}. ` : ''}Keys and secrets live in the server's environment and are never shown or editable here; this page shows which provider is configured for payments, email, SMS and push, and whether each is live or simulated.`;
  const latest = (outbox.data?.items ?? []).slice(0, 3).map((m) => `${label(m.channel)} ${relative(m.created_at)}`).join(' · ') || 'empty';

  return <WorkspaceScreen workspace="admin" title="Integrations" sub={sub} refreshing={s.loading} onRefresh={reload}>
    <Stack.Screen options={{ title: 'Integrations', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="settings.manage">
      <Enter index={1}><View style={{ gap: space.sm }}>
        <Button title="Refresh" variant="ghost" small onPress={reload} style={{ alignSelf: 'flex-end' }} />
        <P small muted>The laboratory integration is managed under the LabStack section by administrators who hold the “Manage the LabStack integration” permission.</P>
        {can('labstack.manage') ? <Button title="Open LabStack" variant="secondary" small onPress={() => router.push('/admin/integrations/labstack' as never)} style={{ alignSelf: 'flex-start' }} /> : null}
      </View></Enter>
      <StaleBanner at={s.stale} /><ErrorBox error={s.error} onRetry={s.reload} />
      {s.loading && !d ? <Loading /> : d ? <>
        <MotionCard index={2} pressable={false}><Card>
          <Row between><Eyebrow>Payments</Eyebrow><Pill tone={pillTone(d.payments.simulated ? 'draft' : 'active')}>{d.payments.simulated ? 'simulated' : 'live'}</Pill></Row>
          <H2>{d.payments.provider}</H2>
          <P small>{d.payments.simulated ? 'The simulator answers checkouts and webhooks; no money moves and no card data exists.' : 'Checkouts and webhooks go through the provider; captures are signature-verified before anything activates.'}</P>
          <P muted small>Going live: set the provider's key and webhook secret in the server environment, register the webhook address, then switch the provider. Refunds and reconciliation are under Orders.</P>
        </Card></MotionCard>
        <MotionCard index={3} pressable={false}><Card>
          <Eyebrow>Messaging</Eyebrow><H2>Email, SMS, push</H2>
          <KeyValue rows={([['Email', d.email], ['SMS', d.sms], ['Push', d.push]] as Array<[string, string]>).map(([k, v]) => ({ label: k, value: <View style={{ alignItems: 'flex-end', gap: space.xs }}><P small>{v}</P><RightPill tone={pillTone(live(v) ? 'active' : 'draft')}>{live(v) ? 'delivering' : 'recorded, not delivered'}</RightPill></View> }))} />
          <P muted small>Wording per category is under Settings, notification templates. The outbox (Operations) shows what would have been sent.</P>
          {outbox.data ? <P muted small>{`Outbox, latest: ${latest}`}</P> : null}
        </Card></MotionCard>
        <MotionCard index={4} pressable={false}><Card>
          <Eyebrow>Also</Eyebrow><H2>Not connected</H2>
          <P small>Analytics, CRM, accounting and calendar connectors are not part of this build. Nothing here pretends otherwise.</P>
        </Card></MotionCard>
        {pending.length > 0 ? <MotionCard index={5} pressable={false}><Card>
          <Eyebrow>Modules</Eyebrow><H2>What the switched-on modules still need</H2>
          {pending.map((i) => <View key={i.key} style={{ gap: space.xs, paddingVertical: space.sm }}>
            <Row between><P>{i.label}</P><Pill tone={pillTone(i.status === 'local' ? 'active' : 'draft')}>{label(i.status ?? '')}</Pill></Row>
            <P small>{(i.missing ?? []).join('; ') || 'Nothing missing'}</P>
            <P muted small>{`${i.note ?? ''} Reads ${(i.variables ?? []).join(', ')}; values are never shown here.`}</P>
          </View>)}
        </Card></MotionCard> : null}
      </> : null}
    </RequirePermission>
  </WorkspaceScreen>;
}
