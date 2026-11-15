/* Operational exceptions: every one has an owner or an explicit unassigned state, a status, a timestamp and a resolution trail. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { audit } from './audit.js';
import { notifyPrivileged } from './notifications.js';

export function openTask(ctx: Ctx, input: { kind: string; title: string; detail?: string; refType?: string; refId?: string; dedupe?: boolean; ownerId?: string | null; notify?: boolean }): string {
  if (input.dedupe !== false && input.refType && input.refId) {
    const existing = ctx.db.get<{ id: string }>("SELECT id FROM support_tasks WHERE kind = ? AND ref_type = ? AND ref_id = ? AND status IN ('open','in_progress')", [input.kind, input.refType, input.refId]);
    if (existing) return existing.id;
  }
  const id = ids.supportTask();
  const now = ctx.now();
  ctx.db.insert('support_tasks', { id, kind: input.kind, status: 'open', title: input.title, detail: input.detail ?? '', ref_type: input.refType ?? null, ref_id: input.refId ?? null, owner_id: input.ownerId ?? null, created_by: ctx.actor?.id ?? 'system', created_at: now, updated_at: now });
  // a coach's own follow-up is a personal to-do: it is listed for administrators but not pushed to every one of them
  if (input.notify !== false) notifyPrivileged(ctx, { category: 'operations', title: input.title, body: input.detail ?? input.kind, data: { supportTaskId: id, kind: input.kind, refType: input.refType, refId: input.refId } });
  return id;
}

export function listTasks(ctx: Ctx, opts: { status?: string; kind?: string; limit: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.status) { where.push('t.status = ?'); params.push(opts.status); }
  if (opts.kind) { where.push('t.kind = ?'); params.push(opts.kind); }
  return ctx.db.all(`SELECT t.*, u.name AS owner_name FROM support_tasks t LEFT JOIN users u ON u.id = t.owner_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.created_at DESC LIMIT ?`, [...params, opts.limit]);
}

export function updateTask(ctx: Ctx, id: string, patch: { status?: 'open' | 'in_progress' | 'resolved' | 'dismissed'; ownerId?: string | null; resolution?: string }, reason?: string) {
  const task = ctx.db.get<{ id: string; status: string }>('SELECT * FROM support_tasks WHERE id = ?', [id]);
  if (!task) throw errors.notFound('Task');
  if ((patch.status === 'resolved' || patch.status === 'dismissed') && !patch.resolution && !reason) throw errors.badRequest('Say how it was resolved', 'RESOLUTION_REQUIRED');
  const now = ctx.now();
  ctx.db.update('support_tasks', id, {
    status: patch.status,
    owner_id: patch.ownerId === undefined ? undefined : patch.ownerId,
    resolution: patch.resolution ?? (patch.status === 'resolved' || patch.status === 'dismissed' ? reason : undefined),
    resolved_at: patch.status === 'resolved' || patch.status === 'dismissed' ? now : undefined,
    updated_at: now,
  });
  audit(ctx, 'support_task.update', { type: 'support_task', id }, reason ?? patch.resolution ?? null, patch as Record<string, unknown>);
  return ctx.db.get('SELECT * FROM support_tasks WHERE id = ?', [id]);
}
