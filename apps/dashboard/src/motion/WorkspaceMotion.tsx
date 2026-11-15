/* Mounts the workspace motion layer (./workspace.ts) on the shell: renders nothing, loads the layer only when motion
   is allowed, tells it when the section changes, and takes it down when motion is turned off or the shell unmounts. */
import { useEffect, useRef } from 'react';
import { useMotionAllowed } from './env';
import type { WorkspaceMotionHandle } from './workspace';

export function WorkspaceMotion({ routeKey }: { routeKey: string }) {
  const allowed = useMotionAllowed();
  const handle = useRef<WorkspaceMotionHandle | null>(null);
  useEffect(() => {
    if (!allowed) return;
    const main = document.getElementById('main');
    const shell = main?.closest<HTMLElement>('.shell');
    if (!main || !shell) return;
    let cancelled = false;
    import('./workspace').then((m) => { if (!cancelled) handle.current = m.attachWorkspaceMotion(main, shell); }).catch(() => { /* the layer is optional: the portal works the same without it */ });
    return () => { cancelled = true; handle.current?.dispose(); handle.current = null; };
  }, [allowed]);
  useEffect(() => { handle.current?.routeChanged(); }, [routeKey]);
  return null;
}
