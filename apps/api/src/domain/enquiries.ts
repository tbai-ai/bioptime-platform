/* Website enquiries and the admin's handling of them. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { audit } from './audit.js';
import { notifyPrivileged } from './notifications.js';

export function create(ctx: Ctx, input: { name: string; email: string; phone?: string; purpose: string; message: string }) {
  const id = ids.enquiry();
  ctx.db.insert('enquiries', { id, name: input.name, email: input.email.toLowerCase(), phone: input.phone ?? null, purpose: input.purpose, message: input.message, status: 'new', created_at: ctx.now() });
  notifyPrivileged(ctx, { category: 'operations', title: `New ${input.purpose} enquiry`, body: `${input.name}: ${input.message.slice(0, 120)}`, data: { enquiryId: id } });
  audit(ctx, 'enquiry.create', { type: 'enquiry', id }, null, { purpose: input.purpose });
  return { id, received: true, note: 'Recorded on the server; an email reply follows from the team (no automated email is sent in this prototype).' };
}

export function list(ctx: Ctx, opts: { status?: string; limit: number }) {
  return ctx.db.all(`SELECT e.*, u.name AS handled_by_name FROM enquiries e LEFT JOIN users u ON u.id = e.handled_by ${opts.status ? 'WHERE e.status = ?' : ''} ORDER BY e.created_at DESC LIMIT ?`, opts.status ? [opts.status, opts.limit] : [opts.limit]);
}

export function update(ctx: Ctx, id: string, status: 'new' | 'in_progress' | 'closed', reason?: string) {
  const n = ctx.db.run('UPDATE enquiries SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?', [status, ctx.actor?.id ?? null, ctx.now(), id]).changes;
  if (!n) throw errors.notFound('Enquiry');
  audit(ctx, 'enquiry.update', { type: 'enquiry', id }, reason ?? null, { status });
  return ctx.db.get('SELECT * FROM enquiries WHERE id = ?', [id]);
}
