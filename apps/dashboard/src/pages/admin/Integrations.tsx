/* Integrations: what is connected and what is simulated: the payment provider, email, SMS and push. Secrets never reach
   this page: the server reports presence and mode, and the keys themselves stay in its environment. The laboratory
   integration (LabStack) is administered only under its own section, behind the labstack.manage permission.
   Once a module is in the portal and switched on, the providers it still needs (meetings, calendar, video, Coach AI,
   private file storage) are listed from the integrations registry (GET /admin/integrations) with what is missing. */
import React from 'react';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { label, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Pill, Skeleton, useApi } from '../../ui';
import { PORTAL_MODULES } from '../../modules';
import { featureOf, hasModuleUi, moduleHasUi, useFeatures } from '../../modules/runtime';

const MODULE_PROVIDERS = ['meetings', 'calendar', 'video', 'ai', 'storage'];

export function Integrations() {
  const { can } = useAuth();
  const s = useApi(() => api.get('/admin/settings'), []);
  // the outbox needs operations.manage; without it the page simply leaves the line out
  const outbox = useApi(() => (can('operations.manage') ? api.get('/admin/outbox?limit=8').catch(() => null) : Promise.resolve(null)), []);
  // the registry is read only once a module adds something to the portal; until then this page shows what it always did
  const withModules = hasModuleUi();
  const registry = useApi(() => (withModules ? api.get('/admin/integrations').catch(() => null) : Promise.resolve(null)), [withModules]);
  const features = useFeatures(withModules);
  const active = PORTAL_MODULES.filter((m) => moduleHasUi(m) && !!features?.has(featureOf(m))).map((m) => m.key as string);
  const pending = (((registry.data as any)?.items ?? []) as any[]).filter((i) => !i.restricted && MODULE_PROVIDERS.includes(i.key) && (i.usedBy ?? []).some((k: string) => active.includes(k)));
  const d = (s.data as any)?.integrations;
  const mode = (s.data as any)?.mode;
  const live = (name: string) => !['simulator', 'standin', 'outbox', 'none', 'console'].includes(String(name));
  return <div className="stack">
    <div className="pageHead"><div><h1>Integrations</h1><p className="sub">{(s.data as any)?.demo ? <>Payments, messages and the laboratory are simulated on this server. </> : mode ? <>Server mode <code>{mode}</code>. </> : null}Keys and secrets live in the server's environment and are never shown or editable here; this page shows which provider is configured for payments, email, SMS and push, and whether each is live or simulated.</p></div><div className="actions"><Button size="sm" variant="tertiary" onClick={() => s.reload()}>Refresh</Button></div></div>
    <p className="small">The laboratory integration is managed under the LabStack section by administrators who hold the “Manage the LabStack integration” permission.{can('labstack.manage') && <> <Link to="/integrations/labstack">Open LabStack</Link>.</>}</p>
    {s.error && <Alert kind="error">{s.error}</Alert>}
    {!s.error && !d && <Skeleton rows={8} />}
    {d && <div className="grid">
      <div className="span6"><Card><CardHead eyebrow="Payments" title={d.payments.provider} right={<Pill status={d.payments.simulated ? 'draft' : 'active'}>{d.payments.simulated ? 'simulated' : 'live'}</Pill>} /><p className="small">{d.payments.simulated ? 'The simulator answers checkouts and webhooks; no money moves and no card data exists.' : 'Checkouts and webhooks go through the provider; captures are signature-verified before anything activates.'}</p><p className="muted small">Going live: set the provider's key and webhook secret in the server environment, register the webhook address, then switch the provider. Refunds and reconciliation are under Orders.</p></Card></div>
      <div className="span6"><div className="stack">
        <Card><CardHead eyebrow="Messaging" title="Email, SMS, push" /><dl className="kv">
          <dt>Email</dt><dd>{d.email} <Pill status={live(d.email) ? 'active' : 'draft'}>{live(d.email) ? 'delivering' : 'recorded, not delivered'}</Pill></dd>
          <dt>SMS</dt><dd>{d.sms} <Pill status={live(d.sms) ? 'active' : 'draft'}>{live(d.sms) ? 'delivering' : 'recorded, not delivered'}</Pill></dd>
          <dt>Push</dt><dd>{d.push} <Pill status={live(d.push) ? 'active' : 'draft'}>{live(d.push) ? 'delivering' : 'recorded, not delivered'}</Pill></dd>
        </dl><p className="muted small" style={{ marginTop: 8 }}>Wording per category is under Settings, notification templates. The outbox (Operations) shows what would have been sent.</p>
        {outbox.data && <p className="muted small">Outbox, latest: {(((outbox.data as any)?.items ?? []) as any[]).slice(0, 3).map((m) => `${label(m.channel)} ${relative(m.created_at)}`).join(' · ') || 'empty'}</p>}</Card>
        <Card><CardHead eyebrow="Also" title="Not connected" /><p className="small">Analytics, CRM, accounting and calendar connectors are not part of this build. Nothing here pretends otherwise.</p></Card>
      </div></div>
    </div>}
    {pending.length > 0 && <Card><CardHead eyebrow="Modules" title="What the switched-on modules still need" />
      <dl className="kv">{pending.map((i) => <React.Fragment key={i.key}><dt>{i.label}</dt><dd><Pill status={i.status === 'local' ? 'active' : 'draft'}>{label(i.status)}</Pill> {(i.missing ?? []).join('; ') || 'Nothing missing'}<div className="muted small">{i.note} Reads <code>{(i.variables ?? []).join(', ')}</code>; values are never shown here.</div></dd></React.Fragment>)}</dl>
    </Card>}
  </div>;
}
