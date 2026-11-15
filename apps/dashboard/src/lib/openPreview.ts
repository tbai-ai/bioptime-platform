/* What the server's settings (GET /public/config) say about the open preview and the staff preview helpers, read in one
   place for lib/auth.tsx and the sign-in pages. Plain functions without React, so the API's tests load this file as it is.
   - openPreviewWorkspaces (beside openPreview: true): the workspaces the open preview opens. A server that does not send
     the list opens all three, as before; one that sends it opens only those it lists (the shared link: member and coach,
     owner decision of 15 November 2026), and the others show their sign-in form as usual.
   - demoStaffHelpers (demo mode): false while the server withholds the preview helpers of administrator and owner
     accounts, so no "Fill in the preview code" is offered for them. Absent = on, as before. */
import type { Workspace } from './nav';

export type PreviewWorkspace = 'member' | 'coach' | 'admin';
export const PREVIEW_WORKSPACES: readonly PreviewWorkspace[] = ['member', 'coach', 'admin'];
/** The open preview's name for each portal workspace (the member workspace is the portal's client workspace). */
export const PREVIEW_WORKSPACE: Record<Workspace, PreviewWorkspace> = { client: 'member', coach: 'coach', admin: 'admin' };

/** The workspaces the open preview opens, from GET /public/config: all three when the list is absent; only the known
    names it lists otherwise (anything that is not a list opens none). */
export function previewWorkspacesFrom(config: unknown): PreviewWorkspace[] {
  const list = config && typeof config === 'object' ? (config as { openPreviewWorkspaces?: unknown }).openPreviewWorkspaces : undefined;
  if (list === undefined) return [...PREVIEW_WORKSPACES];
  if (!Array.isArray(list)) return [];
  return PREVIEW_WORKSPACES.filter((w) => list.includes(w));
}

/** Whether a portal workspace opens without signing in: the open preview is on and lists it. */
export function previewOpens(openPreview: boolean, workspaces: readonly PreviewWorkspace[], ws: Workspace): boolean {
  return openPreview && workspaces.includes(PREVIEW_WORKSPACE[ws]);
}

/** Whether the preview helpers of administrator and owner accounts are on (GET /public/config demoStaffHelpers; absent = on). */
export function staffHelpersFrom(config: unknown): boolean {
  return !(config && typeof config === 'object' && (config as { demoStaffHelpers?: unknown }).demoStaffHelpers === false);
}
