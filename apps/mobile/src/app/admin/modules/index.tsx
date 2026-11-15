/* Admin › Modules (the web's /admin/modules, pages/admin/Modules.tsx; modules.manage or settings.manage). The feature
   flags behind every module (GET /admin/modules, modules.manage) with the switch-on and switch-off dialogs whose
   bodies are computed from the registry exactly as on the web (lib/admin/b2/moduleFlags), the audience of each switch
   (roles, packages from GET /packages), what each module registers on the server, and the settings the modules read
   (GET /admin/module-settings, settings.manage). Each card shows only to whoever holds its permission. Every change
   carries a reason (PATCH /admin/modules, PATCH /admin/module-settings) and drops the app's flag cache
   (lib/features refreshFeatures) so the tabs and the More screen follow at once. */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorText, get, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { refreshFeatures } from '@/lib/features';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { AUDIENCE_NOTE, audienceText, declaredSetting, flagTitle, inPortalText, isPartFlag, MODULE_ORDER, moduleOfFlag, moduleTitle, OFF_DETAIL, offBody, onBody, ROLES, settingText, sortFlags, type ApiModuleInfo, type Flag, type Setting } from '@/lib/admin/b2/moduleFlags';
import { MonoText, ReasonSheet, Toggle, useToast } from '@/components/adminB2/parts';
import { Button, Card, Check, Empty, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Row } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { colors, space } from '@/theme';

type ModulesPayload = { flags: Flag[]; modules: ApiModuleInfo[]; demo: boolean };

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminModules() {
  return <RoleGate workspace="admin"><AdminModulesScreen /></RoleGate>;
}

function AdminModulesScreen() {
  const { can } = useAuth();
  const [toast, showToast] = useToast();
  const canFlags = can('modules.manage'), canSettings = can('settings.manage');
  const mods = useLoad<ModulesPayload | null>(canFlags ? 'admin-modules' : null, () => (canFlags ? get<ModulesPayload>('/admin/modules') : Promise.resolve(null)), [canFlags]);
  const settings = useLoad<{ items: Setting[] } | null>(canSettings ? 'admin-module-settings' : null, () => (canSettings ? get<{ items: Setting[] }>('/admin/module-settings') : Promise.resolve(null)), [canSettings]);
  const catalogue = useLoad<{ items: Array<{ id: string; name: string }> } | null>('packages-public', () => (canFlags ? get<{ items: Array<{ id: string; name: string }> }>('/packages').catch(() => null) : Promise.resolve(null)), [canFlags]);
  const [toggle, setToggle] = useState<Flag | null>(null);
  const [audience, setAudience] = useState<{ flag: Flag; roles: string[]; packageIds: string[] } | null>(null);
  const [edit, setEdit] = useState<{ s: Setting; text: string } | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // module switches in registry order (M1 to M11, then LabStack operations), each followed by its part switches, then
  // the stored switches from settings.features
  const flags = sortFlags(mods.data?.flags ?? [], MODULE_ORDER);
  const apiModules = mods.data?.modules ?? [];
  const items = settings.data?.items ?? [];
  const packages = (catalogue.data?.items ?? []).map((p) => ({ id: String(p.id), name: String(p.name) }));
  const reload = () => { void mods.reload(); void settings.reload(); };

  const saveFlag = async (key: string, body: Record<string, unknown>, reason: string, done: string) => {
    setBusy(true); setErr(null);
    try { await patch('/admin/modules', { key, ...body, reason }); refreshFeatures(); showToast(done); setToggle(null); setAudience(null); void mods.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const saveSetting = async (s: Setting, text: string, reason: string) => {
    setBusy(true); setErr(null);
    try {
      let value: unknown = text.trim() === '' ? null : text.trim();
      if (value !== null && s.kind === 'seller') { try { value = JSON.parse(String(value)); } catch { throw new Error('Seller details are an object, for example {"legalName": "…", "gstin": "…", "address": "…"}'); } }
      else if (value !== null) value = Number(value);
      await patch('/admin/module-settings', { key: s.key, value, reason });
      showToast('Setting saved'); setEdit(null); void settings.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  return <WorkspaceScreen workspace="admin" title="Modules" sub="Each module is switched on here. While a module is off, its server routes refuse requests, the portal and the app hide it, and its background work stops; the note under the switches gives the exceptions. Production starts with every module off; every change needs a reason and is recorded in the audit log." refreshing={mods.loading || settings.loading} onRefresh={reload}>
    <Stack.Screen options={{ title: 'Modules', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission={['modules.manage', 'settings.manage']} any>
      <Enter index={1}><Row between><View style={{ flex: 1 }} /><Button title="Refresh" variant="ghost" small onPress={reload} /></Row></Enter>
      {toast}
      {mods.data?.demo ? <Notice kind="info" title="Modules in the seeded data">The seeded data on this server switched every module on when it was loaded. A module that has not been built yet adds nothing anywhere, even when its switch is on.</Notice> : null}

      {canFlags ? <MotionCard index={2} pressable={false}><Card>
        <Eyebrow>Feature flags</Eyebrow><H2>Switches</H2>
        <ErrorBox error={mods.error} onRetry={mods.reload} />
        {!mods.data && !mods.error ? <Loading /> : flags.map((f) => {
          const part = isPartFlag(f), parent = moduleOfFlag(f);
          return <View key={f.key} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs }}>
            <Row between>
              <View style={{ flex: 1, minWidth: 0 }}><P style={{ fontWeight: '600' }}>{flagTitle(f)}</P><MonoText small>{f.key}</MonoText></View>
              <Toggle value={f.enabled} onChange={() => setToggle(f)} label={`${flagTitle(f)} (${f.key})`} />
            </Row>
            {part ? <P muted small>{`Part of ${moduleTitle(parent)}: works only while ${moduleTitle(parent)} is on too`}</P> : null}
            <P small>{f.description || '—'}</P>
            <KeyValue rows={[['Audience', audienceText(f.audience, packages)], ['In the portal', inPortalText(f)], ['Changed', f.updatedAt ? fmtDateTime(f.updatedAt) : '—']]} />
            <Button title="Audience" variant="ghost" small onPress={() => { setErr(null); setAudience({ flag: f, roles: f.audience.roles ?? [], packageIds: f.audience.packageIds ?? [] }); }} style={{ alignSelf: 'flex-start' }} />
          </View>;
        })}
        <P muted small>{AUDIENCE_NOTE}</P>
        <Button title={showOff ? 'Hide what switching off does' : 'What switching off does'} variant="ghost" small onPress={() => setShowOff(!showOff)} style={{ alignSelf: 'flex-start' }} />
        {showOff ? <P muted small>{OFF_DETAIL}</P> : null}
      </Card></MotionCard> : null}

      {canFlags && apiModules.length > 0 ? <MotionCard index={3} pressable={false}><Card>
        <Eyebrow>Registry</Eyebrow><H2>What each module registers on the server</H2>
        {apiModules.map((m) => <View key={m.key} style={{ paddingVertical: space.sm, gap: space.xs }}>
          <P style={{ fontWeight: '600' }}>{moduleTitle(m.key)}</P>
          <KeyValue rows={[{ label: 'Switch', value: m.feature, mono: true }, ['Background jobs', m.jobs.join(', ') || '—'], ['Event handlers', m.events.join(', ') || '—'], ['Private file kinds', m.fileKinds.join(', ') || '—'], ['Adherence', m.adherence ? 'Yes' : '—'], ['Seeded rows', m.demoSeed ? 'Yes' : '—']]} />
        </View>)}
        <P muted small>A dash means the module has not added that part yet.</P>
      </Card></MotionCard> : null}

      {canSettings ? <MotionCard index={4} pressable={false}><Card>
        <Eyebrow>Settings</Eyebrow><H2>What the modules read</H2>
        <ErrorBox error={settings.error} onRetry={settings.reload} />
        {!settings.data && !settings.error ? <Loading /> : items.length ? items.map((s) => {
          const dec = declaredSetting(s.key);
          return <View key={s.key} style={{ paddingVertical: space.sm, gap: space.xs }}>
            <P style={{ fontWeight: '600' }}>{dec?.label ?? s.label}</P>
            <P muted small>{dec?.hint ?? s.hint}</P>
            <KeyValue rows={[['Module', moduleTitle(s.module)], ['Value', settingText(s)]]} />
            <Button title="Change" small onPress={() => { setErr(null); setEdit({ s, text: s.value === null || s.value === undefined ? '' : s.kind === 'seller' ? JSON.stringify(s.value, null, 2) : String(s.value) }); }} style={{ alignSelf: 'flex-start' }} />
          </View>;
        }) : <Empty title="No module settings" />}
        <P muted small>"Not decided" is deliberate: these are owner decisions, and the feature that reads one stays off until it is set.</P>
      </Card></MotionCard> : null}

      <ReasonSheet open={!!toggle} onClose={() => setToggle(null)} destructive={!!toggle?.enabled} title={toggle ? `${toggle.enabled ? 'Switch off' : 'Switch on'} ${flagTitle(toggle)}?` : ''} confirmLabel={toggle?.enabled ? 'Switch off' : 'Switch on'} busy={busy} error={err}
        body={toggle ? (toggle.enabled ? offBody(toggle) : onBody(toggle, flags)) : undefined}
        onConfirm={async (reason) => { if (toggle) await saveFlag(toggle.key, { enabled: !toggle.enabled }, reason, toggle.enabled ? 'Switched off' : 'Switched on'); }} />

      <ReasonSheet open={!!audience} onClose={() => setAudience(null)} title={audience ? `Audience for ${flagTitle(audience.flag)}` : ''} confirmLabel="Save audience" busy={busy} error={err}
        body="Choose nothing for everyone. Roles and packages narrow who the switch reaches while it is on."
        onConfirm={async (reason) => { if (audience) await saveFlag(audience.flag.key, { audience: { roles: audience.roles, packageIds: audience.packageIds } }, reason, 'Audience saved'); }}>
        {audience ? <View>
          <Field label="Roles"><View>{ROLES.map((r) => <Check key={r} checked={audience.roles.includes(r)} label={label(r)} onChange={(v) => setAudience({ ...audience, roles: v ? [...audience.roles, r] : audience.roles.filter((x) => x !== r) })} />)}</View></Field>
          <Field label="Members of these packages" hint="Coaches and administrators are not narrowed by packages.">{packages.length ? <View>{packages.map((p) => <Check key={p.id} checked={audience.packageIds.includes(p.id)} label={p.name} onChange={(v) => setAudience({ ...audience, packageIds: v ? [...audience.packageIds, p.id] : audience.packageIds.filter((x) => x !== p.id) })} />)}</View> : <P muted small>No packages to choose from.</P>}</Field>
        </View> : null}
      </ReasonSheet>

      <ReasonSheet open={!!edit} onClose={() => setEdit(null)} title={edit ? `Change "${declaredSetting(edit.s.key)?.label ?? edit.s.label}"` : ''} confirmLabel="Save setting" busy={busy} error={err}
        body={edit?.s.nullable ? 'Leave it empty for "not decided".' : undefined}
        onConfirm={async (reason) => { if (edit) await saveSetting(edit.s, edit.text, reason); }}>
        {edit ? (edit.s.kind === 'seller'
          ? <Field label="Seller details (JSON)" hint="Only what the owner and counsel confirm: legalName is required; gstin, address and other text fields as they apply."><Input value={edit.text} onChangeText={(v) => setEdit({ ...edit, text: v })} placeholder='{"legalName": "", "gstin": "", "address": ""}' multiline numberOfLines={6} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 130, textAlignVertical: 'top' }} accessibilityLabel="Seller details (JSON)" /></Field>
          : <Field label={edit.s.kind === 'basis_points' ? 'Basis points (1800 is 18%)' : 'Days'} hint={`A whole number from ${edit.s.min} to ${edit.s.max}`}><Input value={edit.text} onChangeText={(v) => setEdit({ ...edit, text: v.replace(/[^\d]/g, '') })} keyboardType="number-pad" accessibilityLabel={edit.s.kind === 'basis_points' ? 'Basis points (1800 is 18%)' : 'Days'} /></Field>) : null}
      </ReasonSheet>
    </RequirePermission>
  </WorkspaceScreen>;
}
