/* What the coach's library screens of part A share (check-in templates, the nutrition library and the meal plan
   editor): small helpers over the API's shapes and the app's primitives. Nothing here fetches; the screens load with
   lib/useLoad and pass what they got. */
import { useCallback, useState, type ComponentProps } from 'react';
import { ApiError, errorText } from '@/lib/api';
import type { Pill } from '@/components/ui';

export type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

/** A module screen while its flag is off: the web's ModuleRouteGate title (apps/dashboard/src/modules/runtime.tsx:121-131)
 *  with the API's own sentence for a switched-off module (FEATURE_DISABLED, apps/api/src/domain/features.ts), as the
 *  other coach module screens of the app word it. */
export const SWITCHED_OFF_TITLE = 'No such page';
export const SWITCHED_OFF_BODY = 'This part of Bioptime is not switched on.';

/** "1 exercise" / "3 exercises". */
export function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }

/** A typed number from a form field, null when empty; NaN never leaves (the field keeps digits only). */
export function num(s: string | undefined | null): number | null { const t = (s ?? '').trim(); return t === '' ? null : Number(t); }
/** Keep a decimal number's characters as they are typed. */
export function decimal(v: string): string { return v.replace(/[^0-9.]/g, ''); }
/** Keep a whole number's digits as they are typed. */
export function digits(v: string): string { return v.replace(/\D/g, ''); }
/** "a, b ,c" → ['a', 'b', 'c']. */
export function commaList(s: string): string[] { return s.split(',').map((x) => x.trim()).filter(Boolean); }

/** The library statuses (draft → published → archived) as the web's pills read them. */
export const LIBRARY_PILL: Record<string, { label: string; tone: PillTone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'info' },
};
export function libraryPill(status?: string | null): { label: string; tone: PillTone } {
  return LIBRARY_PILL[status ?? ''] ?? { label: status ?? '', tone: 'info' };
}

/** A notice the screen shows after an action (the web's toast): kept until the next action or dismissed. */
export type Flash = { kind: 'success' | 'error'; text: string } | null;
export function useFlash(): { flash: Flash; ok: (text: string) => void; fail: (e: unknown) => void; clear: () => void } {
  const [flash, setFlash] = useState<Flash>(null);
  const ok = useCallback((text: string) => setFlash({ kind: 'success', text }), []);
  const fail = useCallback((e: unknown) => setFlash({ kind: 'error', text: errorText(e) }), []);
  const clear = useCallback(() => setFlash(null), []);
  return { flash, ok, fail, clear };
}

/** The API's field errors ({ field: message }) from a failed write, or {} when the error carries none. */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.fieldErrors() : {};
}
