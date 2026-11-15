/* Audit: every consequential action writes who, what, which record and why. Domain events feed the outbox. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { j } from '../db/db.js';

export function audit(ctx: Ctx, action: string, target: { type: string; id: string } | null, reason?: string | null, data: Record<string, unknown> = {}): void {
  ctx.db.insert('audit_events', {
    id: ids.audit(),
    actor_id: ctx.actor?.id ?? null,
    actor_role: ctx.actor?.role ?? 'system',
    action,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    reason: reason ?? null,
    ip: ctx.ip ?? null,
    data: j.in(data),
    at: ctx.now(),
  });
}

export function emit(ctx: Ctx, type: string, aggregate: { type: string; id: string }, payload: Record<string, unknown> = {}): string {
  const id = ids.event();
  ctx.db.insert('domain_events', {
    id, type, aggregate_type: aggregate.type, aggregate_id: aggregate.id, payload: j.in(payload),
    created_at: ctx.now(), attempts: 0, next_attempt_at: ctx.now(),
  });
  return id;
}

/** opts.excludeViews leaves record views out (actions ending in ".viewed" or "_viewed": member.record_viewed,
 *  health.viewed), for a record's own History list: each opening of a record writes one, so they would otherwise fill
 *  the list and push the changes out of it (staff-6). The audit log (no excludeViews) keeps and lists every one. */
export function listAudit(ctx: Ctx, opts: { since?: string | null; until?: string | null; limit: number; targetType?: string; targetId?: string; action?: string; actorId?: string; excludeViews?: boolean }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.excludeViews) where.push("substr(a.action, -7) NOT IN ('.viewed', '_viewed')"); // not LIKE: '_' is a wildcard there
  if (opts.since) { where.push('at > ?'); params.push(opts.since); }
  if (opts.until) { where.push('at < ?'); params.push(opts.until); }
  if (opts.targetType) { where.push('target_type = ?'); params.push(opts.targetType); }
  if (opts.targetId) { where.push('target_id = ?'); params.push(opts.targetId); }
  if (opts.action) { where.push('action LIKE ?'); params.push(`${opts.action}%`); }
  if (opts.actorId) { where.push('actor_id = ?'); params.push(opts.actorId); }
  const rows = ctx.db.all(`SELECT a.*, u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT ?`, [...params, opts.limit]);
  return rows.map((r) => ({ ...r, data: j.out(r.data, {}) }));
}
