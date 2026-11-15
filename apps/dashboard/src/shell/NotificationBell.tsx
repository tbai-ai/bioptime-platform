/* The notifications bell of the top bar and its popover (the twelve latest, "Mark all read"), shared by every
   workspace shell. `tick` reloads the list (the shell's one-minute tick); `icon` is what the button shows. With
   `dismissible` (the coach shell) Escape closes the popover and returns focus to the bell, and so does a click outside. */
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { useApi } from '../ui';

export function NotificationBell({ workspace, tick, icon, className, dismissible }: { workspace: string; tick: number; icon: React.ReactNode; className?: string; dismissible?: boolean }) {
  const [bell, setBell] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const notifs = useApi(() => api.get('/notifications?limit=12'), [workspace, tick]);
  const unread = (notifs.data as any)?.unread ?? ((notifs.data as any)?.items ?? []).filter((n: any) => !n.read_at).length;
  const markAll = async () => { await api.post('/notifications/read', { all: true }); notifs.reload(); };
  useEffect(() => {
    if (!dismissible || !bell) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setBell(false); box.current?.querySelector<HTMLElement>('[data-testid="bell"]')?.focus(); } };
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setBell(false); };
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [dismissible, bell]);
  return <div ref={box} className={className ? `relative ${className}` : 'relative'}>
    <button className="bp-iconbtn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={bell} onClick={() => setBell((b) => !b)} data-testid="bell">{icon}{unread > 0 && <span className="bp-badge" style={{ position: 'absolute', top: 0, right: 0 }}>{unread}</span>}</button>
    <AnimatePresence>{bell && <motion.div className="popover" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
      <div className="row between" style={{ marginBottom: 8 }}><b>Notifications</b><button className="bp-btn bp-btn-tertiary bp-btn-sm" onClick={markAll}>Mark all read</button></div>
      <div className="notifList">{((notifs.data as any)?.items ?? []).map((n: any) => <div key={n.id} className={`notif ${n.read_at ? 'read' : ''}`}><span className="dot" /><div><b>{n.title}</b>{n.body}</div><time className="muted">{relative(n.created_at)}</time></div>)}{!((notifs.data as any)?.items ?? []).length && <p className="muted">Nothing yet.</p>}</div>
    </motion.div>}</AnimatePresence>
  </div>;
}
