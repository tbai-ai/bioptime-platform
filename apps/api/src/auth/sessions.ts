/* Sessions: random token, stored hashed, bound to a role snapshot, expiring, revocable, one row per device. */
import type { Ctx, Actor } from '../context.js';
import type { Role } from '@bioptime/domain';
import { ids } from '../lib/ids.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { addDays, addHours } from '../lib/time.js';

export type SessionKind = 'web' | 'mobile';

export function createSession(ctx: Ctx, user: { id: string; role: Role }, kind: SessionKind, meta: { ip?: string; userAgent?: string } = {}): { token: string; sessionId: string; expiresAt: string } {
  const token = randomToken(32);
  const id = ids.session();
  const now = ctx.now();
  const privileged = user.role === 'admin' || user.role === 'owner';
  const expiresAt = privileged ? addHours(now, ctx.config.ADMIN_SESSION_HOURS) : addDays(now, ctx.config.SESSION_DAYS);
  ctx.db.insert('sessions', { id, user_id: user.id, token_hash: sha256(token), role: user.role, kind, ip: meta.ip ?? null, user_agent: (meta.userAgent ?? '').slice(0, 300), created_at: now, expires_at: expiresAt, last_seen_at: now, revoked_at: null });
  ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);
  return { token, sessionId: id, expiresAt };
}

export function resolveSession(ctx: Ctx, token: string | null | undefined): Actor {
  if (!token) return null;
  const row = ctx.db.get<{ id: string; user_id: string; role: Role; expires_at: string; revoked_at: string | null; email: string; name: string; state: string; user_role: Role; mfa_enabled: number }>(
    'SELECT s.id, s.user_id, s.role, s.expires_at, s.revoked_at, u.email, u.name, u.state, u.role AS user_role, u.mfa_enabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha256(token)]);
  if (!row || row.revoked_at || row.expires_at < ctx.now()) return null;
  if (row.state === 'suspended' || row.state === 'deactivated' || row.state === 'closed') return null;
  if (row.user_role !== row.role) return null; // role changed since sign-in: sign in again
  ctx.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?', [ctx.now(), row.id, addHours(ctx.now(), -1)]);
  return { id: row.user_id, role: row.role, email: row.email, name: row.name, sessionId: row.id, mfaEnrolled: !!row.mfa_enabled };
}

export function revokeSession(ctx: Ctx, sessionId: string): void {
  ctx.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [ctx.now(), sessionId]);
}

export function revokeAllSessions(ctx: Ctx, userId: string, exceptSessionId?: string): number {
  return ctx.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?', [ctx.now(), userId, exceptSessionId ?? '']).changes;
}

export function listSessions(ctx: Ctx, userId: string) {
  return ctx.db.all('SELECT id, kind, ip, user_agent, created_at, expires_at, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC', [userId, ctx.now()]);
}
