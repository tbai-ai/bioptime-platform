import type { ZodTypeAny, z } from 'zod';
import { errors } from './errors.js';

/** Parse with zod; a failure becomes a 400 with field-level details the clients can show beside each input. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = fields[0];
  throw errors.validation(fields, first && first.path ? `${first.path}: ${first.message}` : (first?.message ?? 'Some fields need attention'));
}

/** Pagination from the query string: cursor (opaque, ISO or id) and limit. */
export function pageParams(query: Record<string, unknown>, defaultLimit = 50, maxLimit = 200): { limit: number; cursor: string | null } {
  const raw = Number(query.limit ?? defaultLimit);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(maxLimit, Math.floor(raw))) : defaultLimit;
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : null;
  return { limit, cursor };
}
