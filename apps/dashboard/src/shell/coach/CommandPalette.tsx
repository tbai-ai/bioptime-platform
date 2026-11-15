/* The coach workspace's command palette (⌘K / Ctrl+K, or the top bar's search): one field that finds the coach's own
   clients (GET /coach/clients?q=, the clients currently assigned to them, active or paused, never a restricted field),
   the names of their plans and templates (coaching plans; meal plans while Nutrition is on; workout templates and
   programmes while Workouts is on; check-in templates while Progress is on) and the sections of the navigation.
   A modal <dialog>: focus stays inside, Escape closes it and focus returns to where it was. The field is a combobox:
   Up and Down move through the results, Enter opens one.
   Nothing here changes anything; every result is a link to a page that already exists. */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { label as words } from '../../lib/format';
import { useNavigate } from '../../lib/nav';
import { Icon, type IconName } from './icons';

export type PaletteEntry = { id: string; label: string; hint?: string; to: string; icon: IconName; keywords?: string };
type Group = { id: string; title: string; entries: PaletteEntry[]; note?: string };

/** The plan and template names, fetched once when the palette first opens and kept for a minute. */
let libraryCache: { key: string; at: number; promise: Promise<PaletteEntry[]> } | null = null;
const FRESH_MS = 60_000;

type Sources = { workouts: boolean; progress: boolean; nutrition: boolean };

function loadLibrary(sources: Sources): Promise<PaletteEntry[]> {
  const key = `${sources.workouts ? 'w' : ''}${sources.progress ? 'p' : ''}${sources.nutrition ? 'n' : ''}`;
  if (libraryCache && libraryCache.key === key && Date.now() - libraryCache.at < FRESH_MS) return libraryCache.promise;
  const asItems = (r: unknown) => ((r as { items?: unknown[] } | null)?.items ?? []) as any[];
  const jobs: Array<Promise<PaletteEntry[]>> = [
    api.get('/coach/plans').then((r) => asItems(r).map((p) => ({ id: `plan:${p.id}`, label: p.title ?? 'Untitled plan', hint: `Coaching plan${p.member_name ? ` · ${p.member_name}` : ''}${p.status ? ` · ${words(p.status)}` : ''}`, to: `/plans/${p.id}`, icon: 'plans' as IconName }))),
  ];
  if (sources.nutrition) {
    // the summarised list (title, status, client name; no meals, preferences or logs), so no health record is read
    jobs.push(api.get('/coach/meal-plans').then((r) => asItems(r).map((p) => ({ id: `mp:${p.id}`, label: p.title || 'Untitled meal plan', hint: `Meal plan${p.memberName ? ` · ${p.memberName}` : ''}${p.status ? ` · ${words(p.status)}` : ''}`, to: `/meal-plans/${p.id}`, icon: 'meal' as IconName }))));
  }
  if (sources.workouts) {
    jobs.push(api.get('/coach/workout-templates').then((r) => asItems(r).map((t) => ({ id: `wt:${t.id}`, label: t.title ?? 'Untitled template', hint: `Workout template${t.source === 'team' ? ' · Bioptime library' : ' · mine'}`, to: `/workout-templates/${t.id}`, icon: 'workout' as IconName }))));
    jobs.push(api.get('/coach/workout-programs').then((r) => asItems(r).map((p) => ({ id: `wp:${p.id}`, label: p.title ?? 'Untitled programme', hint: `Workout programme${p.memberName ? ` · ${p.memberName}` : ''}${p.status ? ` · ${words(p.status)}` : ''}`, to: `/workout-programs/${p.id}`, icon: 'workout' as IconName }))));
  }
  if (sources.progress) {
    jobs.push(api.get('/coach/checkin-templates').then((r) => asItems(r).map((t) => ({ id: `ct:${t.id}`, label: t.title ?? 'Untitled template', hint: `Check-in template${t.scope === 'library' ? ' · Bioptime library' : ' · mine'}`, to: '/checkin-templates', icon: 'checklist' as IconName }))));
  }
  // a source that fails (a module switched off a moment ago, a dropped connection) leaves the others standing
  const promise = Promise.allSettled(jobs).then((all) => all.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
  libraryCache = { key, at: Date.now(), promise };
  return promise;
}

const norm = (s: string) => s.toLocaleLowerCase('en-IN').normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** Every word typed must appear somewhere in the label, hint or keywords. */
function matches(e: PaletteEntry, q: string): boolean {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(`${e.label} ${e.hint ?? ''} ${e.keywords ?? ''}`);
  return terms.every((t) => hay.includes(t));
}
/** Results whose label starts with what was typed come first. */
function rank(list: PaletteEntry[], q: string): PaletteEntry[] {
  const n = norm(q.trim());
  if (!n) return list;
  return [...list].sort((a, b) => Number(!norm(a.label).startsWith(n)) - Number(!norm(b.label).startsWith(n)));
}

type ClientState = { q: string; items: PaletteEntry[]; loading: boolean; error: boolean };

export function CommandPalette({ open, onClose, pages, sources }: { open: boolean; onClose: () => void; pages: PaletteEntry[]; sources: Sources }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const shown = useRef(false);
  const nav = useNavigate();
  const base = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [library, setLibrary] = useState<PaletteEntry[] | null>(null);
  const [clients, setClients] = useState<ClientState>({ q: '', items: [], loading: false, error: false });

  // open and close the native modal dialog; focus goes back to where it was
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQ(''); setActive(0);
      d.showModal();
      shown.current = true;
      input.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  // closed by Escape, the backdrop, Esc button or a result: tell the shell once. 'close' is the event that matters;
  // 'toggle' (to "closed") is also heard, whichever comes first, because headless Chrome that draws no frames can skip
  // 'close' after the first Escape (a test-harness artefact, not a browser behaviour pages need to handle).
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const h = () => {
      if (d.open || !shown.current) return;
      shown.current = false;
      onClose();
      const back = returnTo.current; returnTo.current = null;
      if (back && back.isConnected && back !== document.body) back.focus();
    };
    d.addEventListener('close', h); d.addEventListener('toggle', h);
    return () => { d.removeEventListener('close', h); d.removeEventListener('toggle', h); };
  }, [onClose]);

  // plan and template names: once per opening (cached for a minute)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadLibrary(sources).then((l) => { if (alive) setLibrary(l); });
    return () => { alive = false; };
  }, [open, sources.workouts, sources.progress, sources.nutrition]); // eslint-disable-line react-hooks/exhaustive-deps

  // clients: asked of the server as the coach types (a short pause first), only the coach's own
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    let alive = true;
    setClients((c) => ({ ...c, loading: true, error: false }));
    const t = window.setTimeout(() => {
      // no status: the API's default is the active and paused assignments, the clients whose record the coach may open
      const qs = term ? `?q=${encodeURIComponent(term.slice(0, 80))}&limit=8` : '?status=active&sort=recent&limit=5';
      api.get(`/coach/clients${qs}`).then((r) => {
        if (!alive) return;
        const items = (((r as { items?: any[] } | null)?.items) ?? []).map((c: any): PaletteEntry => ({ id: `client:${c.id}`, label: c.name, hint: [c.memberCode, c.assignment?.status ? words(c.assignment.status) : null].filter(Boolean).join(' · ') || undefined, to: `/clients/${c.id}`, icon: 'client' }));
        setClients({ q: term, items, loading: false, error: false });
      }, () => { if (alive) setClients({ q: term, items: [], loading: false, error: true }); });
    }, term ? 180 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [open, q]);

  const term = q.trim();
  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    const pageHits = rank(pages.filter((p) => matches(p, term)), term).slice(0, term ? 8 : 30);
    // while the server answers a new query, the previous answer shows only where it still matches what is typed, so
    // Enter never opens a client the coach did not ask for
    const clientHits = clients.items.filter((e) => clients.q === term || matches(e, term)).slice(0, term ? 8 : 5);
    const clientEntries = term ? [...clientHits, { id: 'client:all', label: `Search all clients for “${term}”`, to: `/clients?q=${encodeURIComponent(term)}`, icon: 'search' as IconName }] : clientHits;
    const libHits = rank((library ?? []).filter((e) => matches(e, term)), term).slice(0, term ? 8 : 5);
    const clientNote = clients.loading && !clientHits.length ? 'Searching your clients…' : clients.error ? 'Your clients could not be searched just now.' : !clientHits.length && term ? 'None of your clients matches.' : undefined;
    // with nothing typed the sections come first; once the coach types, clients lead
    const pageGroup: Group = { id: 'pages', title: 'Pages', entries: pageHits };
    const clientGroup: Group = { id: 'clients', title: term ? 'Clients' : 'Recent clients', entries: clientEntries, note: clientNote };
    const libGroup: Group = { id: 'library', title: 'Plans and templates', entries: libHits, note: library === null ? 'Loading plans and templates…' : undefined };
    if (term) out.push(clientGroup, libGroup, pageGroup); else out.push(pageGroup, clientGroup, libGroup);
    return out.filter((g) => g.entries.length || g.note);
  }, [pages, term, clients, library]);
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  useEffect(() => { setActive(0); }, [term]);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optId = (i: number) => `${base}-opt-${i}`;
  useEffect(() => { if (open) document.getElementById(optId(current))?.scrollIntoView({ block: 'nearest' }); }, [current, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((e: PaletteEntry | undefined) => {
    if (!e) return;
    returnTo.current = null; // the page changes: focus starts on the new page, not on the old control
    ref.current?.close();
    nav(e.to);
  }, [nav]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      setActive((i) => { const cur = Math.min(i, flat.length - 1); return e.key === 'ArrowDown' ? (cur + 1) % flat.length : (cur - 1 + flat.length) % flat.length; });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[current]);
    } else if ((e.key === 'PageDown' || e.key === 'PageUp') && flat.length) {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(flat.length - 1, Math.min(i, flat.length - 1) + (e.key === 'PageDown' ? 5 : -5))));
    }
  };

  let index = -1;
  const status = clients.loading || library === null ? 'Searching…' : `${flat.length} result${flat.length === 1 ? '' : 's'}`;
  return <dialog ref={ref} className="wzPalette" aria-label="Search clients, plans and pages" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
    <div className="wzPaletteField">
      <Icon name="search" size={20} />
      <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls={`${base}-list`} aria-autocomplete="list" aria-activedescendant={flat.length ? optId(current) : undefined}
        aria-label="Search clients, plans and pages" placeholder="Search clients, plans and pages…" autoComplete="off" spellCheck={false} maxLength={80}
        value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} />
      <button type="button" className="wzPaletteEsc" onClick={() => ref.current?.close()} aria-label="Close search"><kbd>Esc</kbd></button>
    </div>
    <div ref={listRef} id={`${base}-list`} className="wzPaletteList" role="listbox" aria-label="Results">
      {groups.map((g) => <div key={g.id} role="group" aria-labelledby={`${base}-${g.id}`} className="wzPaletteGroup">
        <div id={`${base}-${g.id}`} className="wzPaletteGroupTitle" role="presentation">{g.title}</div>
        {g.entries.map((e) => {
          index += 1;
          const i = index;
          return <div key={e.id} id={optId(i)} role="option" aria-selected={i === current} className="wzPaletteOpt" onMouseMove={() => { if (i !== current) setActive(i); }} onClick={() => go(e)}>
            <span className="wzPaletteIcon"><Icon name={e.icon} size={16} /></span>
            <span className="wzPaletteText"><span className="wzPaletteLabel">{e.label}</span>{e.hint && <span className="wzPaletteHint">{e.hint}</span>}</span>
            {i === current && <span className="wzPaletteEnter" aria-hidden="true">↵</span>}
          </div>;
        })}
        {g.note && <div className="wzPaletteNote" role="presentation">{g.note}</div>}
      </div>)}
      {!groups.length && <div className="wzPaletteNote" role="presentation">Nothing matches “{term}”.</div>}
    </div>
    <div className="wzPaletteFoot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
    <div className="sr" role="status" aria-live="polite">{open ? status : ''}</div>
  </dialog>;
}
