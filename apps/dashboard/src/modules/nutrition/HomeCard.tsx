/* M5 Nutrition: the member Home card. Today's planned meals and how many are logged; a link to Nutrition. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Card, CardHead, Skeleton, useApi } from '../../ui';
import { SLOT_LABEL } from './shared';

export function NutritionHomeCard() {
  const r = useApi(() => api.get('/me/nutrition'), []);
  const d = r.data as any;
  if (r.error) return null; // the rest of Home stays as it is
  if (!d) return <Card><Skeleton rows={3} /></Card>;
  const slots: any[] = d.todaySlots ?? [];
  const logged = new Set((d.todayLogs ?? []).map((l: any) => l.slotId).filter(Boolean));
  const next = slots.find((s) => !logged.has(s.id));
  return <Card><CardHead eyebrow="Nutrition" title="Today’s meals" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/nutrition">Open</Link>} />
    {!d.plan ? <p className="small">No meal plan yet. Your coach writes it with you; you can already log what you eat.</p>
      : !slots.length ? <p className="small">No planned meals today.</p>
        : <><p className="small">{slots.filter((s) => logged.has(s.id)).length} of {slots.length} planned meals logged.</p>{next && <p className="muted small" style={{ marginTop: 6 }}>Next: {SLOT_LABEL[next.slot]} · {next.title}</p>}</>}
  </Card>;
}
