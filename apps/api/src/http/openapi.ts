/* A route registry that doubles as the OpenAPI document. Every route declares its method, path, summary, tag, auth
   and (optionally) zod schemas; the walker below turns zod into JSON Schema for the common shapes. */
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';

export type RouteMeta = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; summary: string; tag: string; auth: 'none' | 'member' | 'coach' | 'admin' | 'owner' | 'any' | 'webhook'; body?: ZodTypeAny; query?: ZodTypeAny;
  /** Extra responses by status: a description (the document wraps it as { description }). */
  responses?: Record<string, string>;
  /** The feature flag the route needs: def() answers 403 FEATURE_DISABLED while it is off (api/domain/features.ts). */
  feature?: string;
};

const registry: RouteMeta[] = [];
export function register(meta: RouteMeta): void { registry.push(meta); }
export function routes(): RouteMeta[] { return registry.slice(); }

export function zodToJson(schema: ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def: { typeName: string } })._def;
  const t = def.typeName;
  if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') return zodToJson((schema as z.ZodOptional<ZodTypeAny>)._def.innerType);
  if (t === 'ZodEffects') return zodToJson((schema as z.ZodEffects<ZodTypeAny>)._def.schema);
  if (t === 'ZodString') return { type: 'string' };
  if (t === 'ZodNumber') return { type: 'number' };
  if (t === 'ZodBoolean') return { type: 'boolean' };
  if (t === 'ZodLiteral') return { const: (schema as z.ZodLiteral<unknown>)._def.value };
  if (t === 'ZodEnum') return { type: 'string', enum: (schema as z.ZodEnum<[string, ...string[]]>)._def.values };
  if (t === 'ZodArray') return { type: 'array', items: zodToJson((schema as z.ZodArray<ZodTypeAny>)._def.type) };
  if (t === 'ZodRecord') return { type: 'object', additionalProperties: true };
  if (t === 'ZodObject') {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJson(v as ZodTypeAny);
      const tn = (v as { _def: { typeName: string } })._def.typeName;
      if (tn !== 'ZodOptional' && tn !== 'ZodDefault' && tn !== 'ZodNullable') required.push(k);
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }
  return {};
}

export function buildOpenApi(origin: string, version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry) {
    const p = r.path.replace(/:([a-zA-Z]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const queryParams = r.query ? Object.entries((zodToJson(r.query).properties ?? {}) as Record<string, unknown>).map(([name, schema]) => ({ name, in: 'query', required: false, schema })) : [];
    const op: Record<string, unknown> = {
      summary: r.summary, tags: [r.tag], parameters: [...params, ...queryParams],
      security: r.auth === 'none' ? [] : r.auth === 'webhook' ? [{ webhookHeader: [] }] : [{ cookieAuth: [] }, { bearerAuth: [] }],
      'x-role': r.auth,
      ...(r.feature ? { 'x-feature': r.feature } : {}),
      responses: { '200': { description: 'OK' }, '400': { description: 'Validation failed: { error: { code, message, details } }' }, '401': { description: 'Sign in required' }, '403': { description: r.feature ? `Not allowed for this role or record, or FEATURE_DISABLED while the "${r.feature}" feature flag is off` : 'Not allowed for this role or record' }, ...Object.fromEntries(Object.entries(r.responses ?? {}).map(([status, description]) => [status, { description }])) },
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: zodToJson(r.body) } } };
    paths[p] = { ...(paths[p] ?? {}), [r.method.toLowerCase()]: op };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Bioptime platform API', version, description: 'Shared backend for the website, the member app, the coach dashboard and the admin dashboard. Errors are { error: { code, message, details? } }. Lists return { items, nextCursor }.' },
    servers: [{ url: origin }],
    components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'bp_session' }, bearerAuth: { type: 'http', scheme: 'bearer' }, webhookHeader: { type: 'apiKey', in: 'header', name: 'key' } } },
    paths,
  };
}
