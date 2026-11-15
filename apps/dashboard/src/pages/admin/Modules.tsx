/* Modules: the feature flags behind every module and the settings the modules read. A module's pages, navigation, tabs
   and cards show only while its flag is on, and its API routes answer FEATURE_DISABLED while it is off; production
   starts with every module off. Switching a flag needs modules.manage (not an administrator default); the settings need
   settings.manage. Every change carries a reason and is recorded in the audit log. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Input, ReasonDialog, Skeleton, Table, Textarea, useApi, useToast } from '../../ui';
import { PORTAL_MODULES } from '../../modules';
import { moduleHasUi, refreshFeatures } from '../../modules/runtime';
import { FILES_WHILE_OFF, JOBS_WHILE_OFF, STORED_SWITCH_NARROWS, STORED_SWITCH_READS, isPartFlag, jobsWhileOff, moduleOfFlag, sortFlags } from './moduleFlags';

type Audience = { roles?: string[]; packageIds?: string[] };
type Flag = { key: string; enabled: boolean; audience: Audience; description: string; updatedAt: string | null; module: string | null; stored: boolean };
type ApiModuleInfo = { key: string; feature: string; jobs: string[]; events: string[]; fileKinds: string[]; adherence: boolean; demoSeed: boolean };
type Setting = { key: string; module: string; label: string; hint: string; kind: 'days' | 'basis_points' | 'seller'; min?: number; max?: number; nullable: boolean; value: unknown };

const ROLES = ['member', 'coach', 'admin', 'owner'];

/* What switching a module off does, as the server and the clients behave today (api/http/route.ts and the modules'
   `ungated` lists; the shared file link in api/domain/files.ts with each module's fileAccess rule, FILES_WHILE_OFF in
   ./moduleFlags.ts; api/jobs.ts moduleJobs and runWhenDisabled; api/domain/events.ts handlersFor and processPending;
   api/domain/reminders.ts dispatchDue; the clients' flag caches in modules/runtime.tsx and the app's lib/features.ts).
   The jobs that keep running are JOBS_WHILE_OFF in ./moduleFlags.ts. apps/api/tests/integration/portalShared.test.ts
   checks each claim against the server. */
const OFF_REMINDERS = 'The reminder queue skips its reminders while it is off, and they are not sent later; those due after it is back on go out as usual.';
const moduleTitle = (key: string) => PORTAL_MODULES.find((m) => m.key === key)?.title ?? label(key);
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
const OFF_FILES = `Private files open through a file link of their own, not through the module's routes, and a page already open can still use it; the link follows each module's own file rule: ${[...FILES_WHILE_OFF].map(([key, what]) => `with ${moduleTitle(key)} off, ${what}`).join('; ')}.`;
const jobKeyModule = (key: string) => key.slice(0, key.indexOf('.'));
const OFF_JOBS = `Its background jobs stop, except the clean-up that privacy needs, which keeps running: ${[...JOBS_WHILE_OFF].map(([key, what]) => `with ${moduleTitle(jobKeyModule(key))} off, ${what}`).join('; ')}.`;
const OFF_DETAIL = `Switching a module off: its server routes refuse requests at once, apart from the few that let people see or withdraw a consent or delete their own records, and the file links described below. The portal and the app hide its pages, links, tabs and cards; a portal or app already open may keep showing some of them until it is reloaded, and the module's routes refuse what they ask for. ${OFF_FILES} ${OFF_JOBS} Its event handlers do not run while it is off, and events dealt with in that time are not passed to them later. ${OFF_REMINDERS} Switching off deletes nothing it stored.`;

function portalParts(key: string | null): string {
  const m = PORTAL_MODULES.find((x) => x.key === key);
  if (!m || !moduleHasUi(m)) return '—';
  return countText([m.routes?.length ?? 0, m.nav?.length ?? 0, m.clientTabs?.length ?? 0, m.cards?.length ?? 0, m.settings?.length ?? 0]);
}

const PART_NAMES: Array<[string, string]> = [['page', 'pages'], ['link', 'links'], ['client-record tab', 'client-record tabs'], ['card', 'cards'], ['setting', 'settings']];
/** "2 pages, 1 link": the counts in PART_NAMES order, zeros left out. */
function countText(counts: number[]): string {
  return counts.map((n, i) => (n ? `${n} ${n === 1 ? PART_NAMES[i]![0] : PART_NAMES[i]![1]}` : '')).filter(Boolean).join(', ');
}

const NOT_READ = 'Not read by the portal';

/** What a part switch narrows in the portal: the module's pages, links, tabs and cards that name it, or NOT_READ when
 *  none does (public_webinars: the public listing is an API, and no portal page reads the switch). */
function partPortalParts(moduleKey: string | null, flagKey: string): string {
  const m = PORTAL_MODULES.find((x) => x.key === moduleKey);
  const count = (items?: Array<{ feature?: string }>) => (items ?? []).filter((x) => x.feature === flagKey).length;
  return (m && countText([count(m.routes), count(m.nav), count(m.clientTabs), count(m.cards)])) || NOT_READ;
}

function audienceText(a: Audience, packages: Array<{ id: string; name: string }>): string {
  const parts: string[] = [];
  if (a.roles?.length) parts.push(a.roles.map(label).join(', '));
  if (a.packageIds?.length) parts.push(`members of ${a.packageIds.map((id) => packages.find((p) => p.id === id)?.name ?? id).join(', ')}`);
  return parts.length ? parts.join(' · ') : 'Everyone';
}

function settingText(s: Setting): string {
  if (s.value === null || s.value === undefined) return 'Not decided';
  if (s.kind === 'seller') return Object.entries(s.value as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (s.kind === 'basis_points') return `${s.value} (${Number(s.value) / 100}%)`;
  return `${s.value} days`;
}

export function Modules() {
  const { can } = useAuth();
  const toast = useToast();
  const canFlags = can('modules.manage'), canSettings = can('settings.manage');
  const mods = useApi(() => (canFlags ? api.get('/admin/modules') : Promise.resolve(null)), [canFlags]);
  const settings = useApi(() => (canSettings ? api.get('/admin/module-settings') : Promise.resolve(null)), [canSettings]);
  const catalogue = useApi(() => (canFlags ? api.get('/packages').catch(() => null) : Promise.resolve(null)), [canFlags]);
  const [toggle, setToggle] = useState<Flag | null>(null);
  const [audience, setAudience] = useState<{ flag: Flag; roles: string[]; packageIds: string[] } | null>(null);
  const [edit, setEdit] = useState<{ s: Setting; text: string } | null>(null);
  // module switches in registry order (M1 to M11, then LabStack operations), each followed by its part switches, then
  // the stored switches from settings.features
  const flags = sortFlags(((mods.data as any)?.flags ?? []) as Flag[], PORTAL_MODULES.map((m) => m.key));
  const apiModules = ((mods.data as any)?.modules ?? []) as ApiModuleInfo[];
  const items = ((settings.data as any)?.items ?? []) as Setting[];
  const packages = (((catalogue.data as any)?.items ?? []) as any[]).map((p) => ({ id: String(p.id), name: String(p.name) }));
  const titleOf = (key: string | null) => PORTAL_MODULES.find((m) => m.key === key)?.title ?? (key ? label(key) : '—');
  const flagTitle = (f: Flag) => (f.module ? titleOf(f.module) : label(f.key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()));
  const declared = (key: string) => PORTAL_MODULES.flatMap((m) => m.settings ?? []).find((x) => x.key === key);
  // what the switch-off dialog says: a module, a part of one, or a stored switch outside the modules
  const offBody = (f: Flag) => isPartFlag(f)
    ? `What it covers in ${titleOf(moduleOfFlag(f))} stops: its server routes refuse requests and the portal hides anything it shows for it. The rest of ${titleOf(moduleOfFlag(f))} keeps working. Nothing is deleted.`
    : f.module
      ? `Its server routes refuse requests (apart from the few listed under the switches), the portal and the app hide it, and its background jobs and event handlers stop${jobsWhileOff(f.module).length ? `, except the clean-up that privacy needs, which keeps running: ${jobsWhileOff(f.module).join('; ')}` : ''}. ${f.module && FILES_WHILE_OFF.has(f.module) ? `Its private files keep their own link: ${sentence(FILES_WHILE_OFF.get(f.module)!)} ` : ''}${OFF_REMINDERS} Nothing it stored is deleted.`
      : 'Whatever reads this switch treats it as off. Nothing is deleted.';
  // and the switch-on dialog. A part's routes and portal items need the module's switch as well (the server checks
  // both), so a part switched on while its module is off brings nothing back by itself. A part no portal page reads
  // (the same test as the "In the portal" column) changes server routes only. A module's parts, and the stored
  // switches that narrow it (STORED_SWITCH_NARROWS), stay off while they are off.
  const onBody = (f: Flag) => {
    if (isPartFlag(f)) {
      const m = titleOf(moduleOfFlag(f)), moduleOn = flags.some((x) => x.key === moduleOfFlag(f) && x.enabled);
      const inPortal = partPortalParts(moduleOfFlag(f), f.key);
      const read = inPortal !== NOT_READ;
      return moduleOn
        ? read
          ? `What it covers in ${m} works again for the people both this switch and ${m} reach: its server routes answer and the portal shows what needs it (${inPortal}); a portal already open may show it only once it is reloaded. The rest of ${m} is unchanged.`
          : `What it covers in ${m} works again for the people both this switch and ${m} reach: its server routes answer. No portal page reads this switch, so the portal looks the same either way. The rest of ${m} is unchanged.`
        : `This switch alone brings nothing back: what it covers also needs ${m} switched on, and ${m} is off now. Until ${m} is on too, its server routes keep refusing requests${read ? ' and the portal keeps hiding it' : ''}.${read ? '' : ' No portal page reads this switch, so the portal looks the same either way.'}`;
    }
    if (f.module) {
      const narrowedOff = flags.filter((x) => !x.enabled && (isPartFlag(x) ? moduleOfFlag(x) === f.module : STORED_SWITCH_NARROWS.get(x.key) === f.module)).map((x) => flagTitle(x));
      const except = narrowedOff.length ? `, except what ${narrowedOff.join(', ')} ${narrowedOff.length === 1 ? 'covers: that switch is off, and what it covers stays' : 'cover: those switches are off, and what they cover stays'} off until it is switched on too` : '';
      const pm = PORTAL_MODULES.find((x) => x.key === f.module);
      const shows = pm && moduleHasUi(pm) ? ` and the portal shows its pages, links, tabs and cards, for the switch's audience${except}. A portal or app already open may show them only once it is reloaded` : ` for the switch's audience${except}. It adds nothing to the portal yet`;
      return `Its server routes answer again${shows}. Its background jobs and event handlers run again; events dealt with while it was off are not passed to them, and reminders it skipped are not sent.`;
    }
    return 'Whatever reads this switch treats it as on. Nothing else changes.';
  };

  const saveFlag = async (key: string, body: Record<string, unknown>, reason: string, done: string) => {
    await api.patch('/admin/modules', { key, ...body, reason });
    refreshFeatures();
    toast(done);
    mods.reload();
  };
  const saveSetting = async (s: Setting, text: string, reason: string) => {
    let value: unknown = text.trim() === '' ? null : text.trim();
    if (value !== null && s.kind === 'seller') { try { value = JSON.parse(String(value)); } catch { throw new Error('Seller details are an object, for example {"legalName": "…", "gstin": "…", "address": "…"}'); } }
    else if (value !== null) value = Number(value);
    await api.patch('/admin/module-settings', { key: s.key, value, reason });
    toast('Setting saved');
    settings.reload();
  };

  return <div className="stack">
    <div className="pageHead"><div><h1>Modules</h1><p className="sub">Each module is switched on here. While a module is off, its server routes refuse requests, the portal and the app hide it, and its background work stops; the note under the switches gives the exceptions. Production starts with every module off; every change needs a reason and is recorded in the audit log.</p></div><div className="actions"><Button size="sm" variant="tertiary" onClick={() => { mods.reload(); settings.reload(); }}>Refresh</Button></div></div>
    {(mods.data as any)?.demo && <Alert kind="info" title="Modules in the seeded data">The seeded data on this server switched every module on when it was loaded. A module that has not been built yet adds nothing anywhere, even when its switch is on.</Alert>}

    {canFlags && <Card><CardHead eyebrow="Feature flags" title="Switches" />
      {mods.error && <Alert kind="error">{mods.error}</Alert>}
      {!mods.data && !mods.error ? <Skeleton rows={6} /> : <Table label="Feature flags" head={<><th>Switch</th><th>Covers</th><th>Audience</th><th>In the portal</th><th>Changed</th><th>On</th><th /></>}>
        {flags.map((f) => { const part = isPartFlag(f), parent = moduleOfFlag(f); return <tr key={f.key}>
          <td><b>{flagTitle(f)}</b><div className="muted small"><code>{f.key}</code></div>{part && <div className="muted small">Part of {titleOf(parent)}: works only while {titleOf(parent)} is on too</div>}</td>
          <td className="small">{f.description || '—'}</td>
          <td className="small">{audienceText(f.audience, packages)}</td>
          <td className="small">{part ? partPortalParts(parent, f.key) : f.module ? portalParts(f.module) : STORED_SWITCH_READS.get(f.key) ?? NOT_READ}</td>
          <td className="small">{f.updatedAt ? fmtDateTime(f.updatedAt) : '—'}</td>
          {/* position: relative keeps the switch's visually hidden checkbox inside the table's scroll area, so a narrow
              window scrolls the table, not the page */}
          <td><label className="bp-switch" style={{ position: 'relative' }}><input type="checkbox" role="switch" checked={f.enabled} onChange={() => setToggle(f)} aria-label={`${flagTitle(f)} (${f.key})`} /><span className="bp-switch-track" /></label></td>
          <td><Button size="sm" variant="tertiary" onClick={() => setAudience({ flag: f, roles: f.audience.roles ?? [], packageIds: f.audience.packageIds ?? [] })}>Audience</Button></td>
        </tr>; })}
      </Table>}
      <p className="muted small" style={{ marginTop: 8 }}>An audience narrows a switch that is on: to some roles, or to members with an active programme of chosen packages (coaches and administrators are not narrowed by packages). A part switch narrows one piece of its module and works only while the module's own switch is on too.</p>
      <p className="muted small" style={{ marginTop: 8 }}>{OFF_DETAIL}</p>
    </Card>}

    {canFlags && apiModules.length > 0 && <Card><CardHead eyebrow="Registry" title="What each module registers on the server" />
      <Table label="Registered modules" head={<><th>Module</th><th>Switch</th><th>Background jobs</th><th>Event handlers</th><th>Private file kinds</th><th>Adherence</th><th>Seeded rows</th></>}>
        {apiModules.map((m) => <tr key={m.key}><td>{titleOf(m.key)}</td><td><code>{m.feature}</code></td><td className="small">{m.jobs.join(', ') || '—'}</td><td className="small">{m.events.join(', ') || '—'}</td><td className="small">{m.fileKinds.join(', ') || '—'}</td><td>{m.adherence ? 'Yes' : '—'}</td><td>{m.demoSeed ? 'Yes' : '—'}</td></tr>)}
      </Table>
      <p className="muted small" style={{ marginTop: 8 }}>A dash means the module has not added that part yet.</p>
    </Card>}

    {canSettings && <Card><CardHead eyebrow="Settings" title="What the modules read" />
      {settings.error && <Alert kind="error">{settings.error}</Alert>}
      {!settings.data && !settings.error ? <Skeleton rows={4} /> : items.length ? <Table label="Module settings" head={<><th>Setting</th><th>Module</th><th>Value</th><th /></>}>
        {items.map((s) => { const d = declared(s.key); return <tr key={s.key}>
          <td><b>{d?.label ?? s.label}</b><div className="muted small">{d?.hint ?? s.hint}</div></td>
          <td className="small">{titleOf(s.module)}</td>
          <td className="small">{settingText(s)}</td>
          <td><Button size="sm" onClick={() => setEdit({ s, text: s.value === null || s.value === undefined ? '' : s.kind === 'seller' ? JSON.stringify(s.value, null, 2) : String(s.value) })}>Change</Button></td>
        </tr>; })}
      </Table> : <Empty title="No module settings" />}
      <p className="muted small" style={{ marginTop: 8 }}>"Not decided" is deliberate: these are owner decisions, and the feature that reads one stays off until it is set.</p>
    </Card>}

    <ReasonDialog open={!!toggle} onClose={() => setToggle(null)} danger={!!toggle?.enabled} title={toggle ? `${toggle.enabled ? 'Switch off' : 'Switch on'} ${flagTitle(toggle)}?` : ''} confirmLabel={toggle?.enabled ? 'Switch off' : 'Switch on'}
      body={toggle ? (toggle.enabled ? offBody(toggle) : onBody(toggle)) : undefined}
      onConfirm={async (reason) => { if (toggle) await saveFlag(toggle.key, { enabled: !toggle.enabled }, reason, toggle.enabled ? 'Switched off' : 'Switched on'); }} />

    <ReasonDialog open={!!audience} onClose={() => setAudience(null)} title={audience ? `Audience for ${flagTitle(audience.flag)}` : ''} confirmLabel="Save audience"
      body="Choose nothing for everyone. Roles and packages narrow who the switch reaches while it is on."
      extra={audience && <div className="form" style={{ marginTop: 12 }}>
        <Field label="Roles"><div className="row">{ROLES.map((r) => <label key={r} className="bp-check"><input type="checkbox" checked={audience.roles.includes(r)} onChange={(e) => setAudience({ ...audience, roles: e.target.checked ? [...audience.roles, r] : audience.roles.filter((x) => x !== r) })} /> {label(r)}</label>)}</div></Field>
        <Field label="Members of these packages" hint="Coaches and administrators are not narrowed by packages.">{packages.length ? <div className="row">{packages.map((p) => <label key={p.id} className="bp-check"><input type="checkbox" checked={audience.packageIds.includes(p.id)} onChange={(e) => setAudience({ ...audience, packageIds: e.target.checked ? [...audience.packageIds, p.id] : audience.packageIds.filter((x) => x !== p.id) })} /> {p.name}</label>)}</div> : <span className="muted small">No packages to choose from.</span>}</Field>
      </div>}
      onConfirm={async (reason) => { if (audience) await saveFlag(audience.flag.key, { audience: { roles: audience.roles, packageIds: audience.packageIds } }, reason, 'Audience saved'); }} />

    <ReasonDialog open={!!edit} onClose={() => setEdit(null)} title={edit ? `Change "${declared(edit.s.key)?.label ?? edit.s.label}"` : ''} confirmLabel="Save setting"
      body={edit?.s.nullable ? 'Leave it empty for "not decided".' : undefined}
      extra={edit && <div style={{ marginTop: 12 }}>{edit.s.kind === 'seller'
        ? <Field label="Seller details (JSON)" hint="Only what the owner and counsel confirm: legalName is required; gstin, address and other text fields as they apply."><Textarea rows={6} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} placeholder='{"legalName": "", "gstin": "", "address": ""}' /></Field>
        : <Field label={edit.s.kind === 'basis_points' ? 'Basis points (1800 is 18%)' : 'Days'} hint={`A whole number from ${edit.s.min} to ${edit.s.max}`}><Input type="number" min={edit.s.min} max={edit.s.max} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></Field>}</div>}
      onConfirm={async (reason) => { if (edit) await saveSetting(edit.s, edit.text, reason); }} />
  </div>;
}
