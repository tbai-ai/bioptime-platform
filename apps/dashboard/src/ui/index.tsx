/* Small React wrappers over the brand component CSS: buttons, cards, pills, tables, dialogs with reasons, toasts,
   tabs, fields, empty states, skeletons, readouts and the SVG charts of the graphic language. */
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { STATUS_PILL, label } from '../lib/format';
import { ApiRequestError } from '../lib/api';

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<{ toast: (text: string, kind?: 'ok' | 'error') => void }>({ toast: () => {} });
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 2400);
  }, []);
  return <ToastCtx.Provider value={{ toast }}>{children}<div className="toasts" aria-live="polite"><AnimatePresence>{items.map((t) => <motion.div key={t.id} className="bp-toast" style={t.kind === 'error' ? { background: 'var(--bp-color-status-error)', color: '#fff' } : undefined} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2 }}>{t.text}</motion.div>)}</AnimatePresence></div></ToastCtx.Provider>;
}
export function useToast() { return useContext(ToastCtx).toast; }
export function errorText(e: unknown): string { return e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : 'Something went wrong'; }

/* ---------- primitives ---------- */
export function Button({ variant = 'secondary', size, busy, disabled, children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'; size?: 'sm' | 'lg'; busy?: boolean }) {
  return <button type="button" className={`bp-btn bp-btn-${variant} ${size ? 'bp-btn-' + size : ''} ${className}`} aria-busy={busy || undefined} {...rest} disabled={!!disabled || !!busy}>{children}</button>;
}
export function Card({ children, className = '', accent, dense, style }: { children: React.ReactNode; className?: string; accent?: boolean; dense?: boolean; style?: React.CSSProperties }) {
  return <div className={`bp-card ${accent ? 'bp-card-accent' : ''} ${dense ? 'bp-card-dense' : ''} ${className}`} style={style}>{children}</div>;
}
export function CardHead({ eyebrow, title, right }: { eyebrow?: string; title: React.ReactNode; right?: React.ReactNode }) {
  return <div className="bp-card-head"><div>{eyebrow && <span className="bp-eyebrow">{eyebrow}</span>}<h3>{title}</h3></div>{right}</div>;
}
export function Pill({ status, children }: { status?: string | null; children?: React.ReactNode }) {
  const kind = status ? STATUS_PILL[status] ?? 'neutral' : 'neutral';
  return <span className={`bp-pill bp-pill-${kind}`}>{children ?? label(status)}</span>;
}
export function Eyebrow({ children, accent }: { children: React.ReactNode; accent?: boolean }) { return <span className={`bp-eyebrow ${accent ? 'bp-eyebrow-accent' : ''}`}>{children}</span>; }
export function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return <div className="bp-empty"><b>{title}</b>{body && <p>{body}</p>}{action}</div>;
}
/** A lazily loaded chunk that could not be fetched (usually a new release replaced the files this tab was started with). */
export function isChunkLoadError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string' && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i.test(message);
}
export class PageBoundary extends React.Component<{ children: React.ReactNode; resetKey: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  override render() {
    // a failed chunk stays failed until the page loads again (React.lazy keeps the rejection), so the way out is a reload, not another section
    if (this.state.error && isChunkLoadError(this.state.error)) return <div className="bp-alert bp-alert-error crashed" role="alert"><AlertIcon kind="error" /><div><b>This part of the portal could not be loaded</b>The portal may have been updated since this tab was opened, or the connection dropped. Nothing was changed.<div style={{ marginTop: 8 }}><Button variant="primary" size="sm" onClick={() => window.location.reload()}>Reload the portal</Button></div></div></div>;
    if (this.state.error) return <div className="bp-alert bp-alert-error crashed" role="alert"><AlertIcon kind="error" /><div><b>This page hit a problem</b>{this.state.error.message}<div className="small" style={{ marginTop: 6 }}>Nothing was changed. Go back or open another section; if it keeps happening, tell support with the time and the section.</div></div></div>;
    return this.props.children;
  }
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="stack" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <span key={i} className="bp-skel bp-skel-text" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}
/** The status icon in an alert's first column: the four stroked icons of the approved brand book (drive/brand/book,
    components chapter, "Alerts, banners, toasts, tooltips"), sized and coloured by components.css (.bp-alert svg). */
export function AlertIcon({ kind }: { kind: 'info' | 'success' | 'warning' | 'error' }) {
  if (kind === 'info') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
  const shape = kind === 'success' ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>
    : kind === 'warning' ? <><path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5M12 17h.01" /></>
    : <><path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9L7.9 2z" /><path d="m15 9-6 6M9 9l6 6" /></>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shape}</svg>;
}
export function Alert({ kind = 'info', title, children, role }: { kind?: 'info' | 'success' | 'warning' | 'error'; title?: string; children?: React.ReactNode; role?: string }) {
  return <div className={`bp-alert bp-alert-${kind}`} role={role ?? (kind === 'error' || kind === 'warning' ? 'alert' : 'status')}><AlertIcon kind={kind} /><div>{title && <b>{title}</b>}{children}</div></div>;
}
export function Readout({ eyebrow, value, unit, sub, hot }: { eyebrow: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; hot?: boolean }) {
  return <div className={`bp-readout ${hot ? 'hot' : ''}`}><span className="bp-eyebrow">{eyebrow}</span><span className="bp-readout-value num">{value}{unit && <small>{unit}</small>}</span>{sub && <span className="small">{sub}</span>}</div>;
}

/* ---------- fields ---------- */
export function Field({ label: l, hint, error, children, optional }: { label: string; hint?: string; error?: string; children: React.ReactNode; optional?: boolean }) {
  return <label className="bp-field"><span className="bp-label">{l}{optional && <span className="bp-optional">Optional</span>}</span>{children}{hint && !error && <span className="bp-hint">{hint}</span>}{error && <span className="bp-error">{error}</span>}</label>;
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input className="bp-input bp-input-dense" {...p} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className="bp-select bp-select-dense" {...p} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="bp-textarea" {...p} />;

/* ---------- tabs ---------- */
/** How far in from an overflowing edge the tabs are covered: the fade plus the scroll button (dashboard.css, --bp-space-9). */
const TAB_EDGE = 64;
/** The brand book's "continue" arrow (iconography chapter, core set), mirrored for the way back. */
function ContinueIcon({ back }: { back?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={back ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} /></svg>;
}
/** A WAI-ARIA tab strip. Only the selected tab is in the tab order; Left/Right move through the strip (wrapping),
    Home/End jump to the ends, and moving selects. Each tab has an id and points at the panel: pass the panel as
    children (rendered in a role=tabpanel wrapper labelled by the selected tab) or set panelId to a wrapper you render.
    A strip wider than its box scrolls sideways with the scrollbar hidden (components.css), so it shows where it goes on:
    the edge with more tabs fades (data-overflow-start / -end, a mask in dashboard.css) and carries a small scroll button
    (the design system's icon button with the brand's "continue" arrow), wherever the edge happens to cut and whether or
    not the system shows scrollbars; the selected tab is scrolled into view clear of the fade. The scroll buttons are for
    the pointer: keyboard users move with the arrow keys, which select and reveal the next tab. */
export function Tabs<T extends string>({ items, value, onChange, label: ariaLabel, panelId, children }: { items: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; label?: string; panelId?: string; children?: React.ReactNode }) {
  const base = useId();
  const tabId = (id: T) => `${base}-tab-${id}`;
  const panel = panelId ?? `${base}-panel`;
  const hasPanel = panelId !== undefined || children !== undefined;
  const list = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const start = el.scrollLeft > 1, end = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
    setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, [measure]);
  const itemsKey = items.map((t) => `${t.id}:${t.label}:${t.count ?? ''}`).join('|');
  const scrolled = useRef(false);
  useEffect(() => {
    const el = list.current;
    const tab = el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (el && tab && el.scrollWidth > el.clientWidth + 1) {
      const peek = TAB_EDGE + 8; // a little more than the faded edge and its scroll button, so the selected tab is never under them
      const lr = el.getBoundingClientRect(), tr = tab.getBoundingClientRect();
      const from = tr.left - lr.left + el.scrollLeft, to = from + tr.width;
      const target = from < el.scrollLeft + peek ? from - peek : to > el.scrollLeft + el.clientWidth - peek ? to - el.clientWidth + peek : null;
      if (target !== null) {
        const still = !scrolled.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollTo({ left: Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth)), behavior: still ? 'auto' : 'smooth' });
      }
    }
    scrolled.current = true;
    measure();
  }, [value, itemsKey, measure]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value), n = items.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    const target = next >= 0 ? items[next] : undefined;
    if (!target) return;
    e.preventDefault();
    onChange(target.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  const scrollStrip = (dir: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(el.clientWidth - 2 * TAB_EDGE - 16, 120), behavior: still ? 'auto' : 'smooth' });
  };
  return <>
    <div className="tabsScroll">
      <div ref={list} className="tabs bp-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} data-overflow-start={edge.start || undefined} data-overflow-end={edge.end || undefined}>
        {items.map((t) => <button key={t.id} id={tabId(t.id)} type="button" role="tab" className="bp-tab" aria-selected={value === t.id} aria-controls={hasPanel ? panel : undefined} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}>{t.label}{t.count !== undefined && t.count > 0 && <span className="bp-badge">{t.count}</span>}</button>)}
      </div>
      {edge.start && <button type="button" className="bp-iconbtn tabsMore tabsMoreStart" tabIndex={-1} aria-label="Show earlier tabs" title="Earlier tabs" onClick={() => scrollStrip(-1)}><ContinueIcon back /></button>}
      {edge.end && <button type="button" className="bp-iconbtn tabsMore tabsMoreEnd" tabIndex={-1} aria-label="Show more tabs" title="More tabs" onClick={() => scrollStrip(1)}><ContinueIcon /></button>}
    </div>
    {children !== undefined && <div id={panel} role="tabpanel" aria-labelledby={tabId(value)} className="stack">{children}</div>}
  </>;
}

/* ---------- tables ---------- */
/** Every header cell gets scope="col" (fragments in `head` are walked); `label` names the table for assistive
    technology and `caption` adds a visually hidden caption. */
function scopeCols(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (c) => { if (!React.isValidElement(c)) return c; if (c.type === React.Fragment) return <>{scopeCols((c.props as { children?: React.ReactNode }).children)}</>; if (c.type === 'th') return React.cloneElement(c as React.ReactElement<React.ThHTMLAttributes<HTMLTableCellElement>>, { scope: (c.props as React.ThHTMLAttributes<HTMLTableCellElement>).scope ?? 'col' }); return c; });
}
export function Table({ head, children, dense, label: ariaLabel, caption }: { head: React.ReactNode; children: React.ReactNode; dense?: boolean; label?: string; caption?: string }) {
  return <div className="tableWrap"><table className={`t ${dense ? 'dense' : ''}`} aria-label={ariaLabel}>{caption && <caption className="sr">{caption}</caption>}<thead><tr>{scopeCols(head)}</tr></thead><tbody>{children}</tbody></table></div>;
}

/* ---------- dialogs ---------- */
/** A modal <dialog>: labelled by its title, Escape closes it (the native cancel → close event reaches onClose), and
    focus starts on the first field in the body, else the first footer button, else the close control. */
export function Dialog({ open, onClose, title, children, footer, danger }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; danger?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { d.showModal(); d.querySelector<HTMLElement>('.bp-dialog-body input, .bp-dialog-body select, .bp-dialog-body textarea, .bp-dialog-foot button, .bp-dialog-head button')?.focus(); } if (!open && d.open) d.close(); }, [open]);
  useEffect(() => { const d = ref.current; if (!d) return; const h = () => onClose(); d.addEventListener('close', h); return () => d.removeEventListener('close', h); }, [onClose]);
  return <dialog ref={ref} className={`bp-dialog ${danger ? 'bp-dialog-danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
    <div className="bp-dialog-head"><h2 id={titleId}>{title}</h2><button className="bp-iconbtn" type="button" aria-label="Close" onClick={onClose}>✕</button></div>
    <div className="bp-dialog-body">{children}</div>
    {footer && <div className="bp-dialog-foot">{footer}</div>}
  </dialog>;
}

/** A plain confirmation with an optional note, for member-facing choices that need no audit reason. */
export function ConfirmDialog({ open, onClose, title, body, confirmLabel, danger, onConfirm, note }: { open: boolean; onClose: () => void; title: string; body?: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: (note: string) => Promise<void>; note?: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setText(''); setErr(''); } }, [open]);
  const go = async () => { setBusy(true); try { await onConfirm(text.trim()); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Dialog open={open} onClose={onClose} title={title} danger={danger} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant={danger ? 'destructive' : 'primary'} busy={busy} onClick={go}>{confirmLabel}</Button></>}>
    {body && <p>{body}</p>}
    {note && <div style={{ marginTop: 12 }}><Field label={note} optional><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field></div>}
    {err && <Alert kind="error">{err}</Alert>}
  </Dialog>;
}

/** A confirmation that requires a typed reason, for every consequential action. */
export function ReasonDialog({ open, onClose, title, body, confirmLabel, danger, onConfirm, extra }: { open: boolean; onClose: () => void; title: string; body?: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<void>; extra?: React.ReactNode }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setReason(''); setErr(''); } }, [open]);
  const go = async () => { if (reason.trim().length < 3) { setErr('Say why, in a few words.'); return; } setBusy(true); try { await onConfirm(reason.trim()); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Dialog open={open} onClose={onClose} title={title} danger={danger} footer={<><Button variant="tertiary" onClick={onClose}>Keep as is</Button><Button variant={danger ? 'destructive' : 'primary'} busy={busy} onClick={go}>{confirmLabel}</Button></>}>
    {body && <p>{body}</p>}{extra}
    <div style={{ marginTop: 12 }}><Field label="Reason (recorded in the audit log)" error={err}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you know, and why this is right" /></Field></div>
  </Dialog>;
}

/* ---------- charts (the brand's graphic language) ---------- */
export function Bars({ series, labels, height = 120 }: { series: number[]; labels: string[]; height?: number }) {
  const w = 520, max = Math.max(1, ...series), pad = 36;
  const bw = Math.min(56, Math.max(8, (w - pad - 10) / series.length - 8));
  return <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`Bar chart: ${labels.map((l, i) => `${l} ${series[i]}`).join(', ')}`}>
    {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} className="grid" x1={pad} x2={w} y1={height - 20 - f * (height - 30)} y2={height - 20 - f * (height - 30)} />)}
    {series.map((v, i) => { const h = (v / max) * (height - 30); return <rect key={i} className={i === series.length - 1 ? 'bar1' : 'bar2'} x={pad + i * (bw + 8)} y={height - 20 - h} width={bw} height={h} rx={3} />; })}
    {labels.map((l, i) => <text key={l + i} className="axis" x={pad + i * (bw + 8)} y={height - 6}>{l}</text>)}
    <text className="axis" x={0} y={12}>{max}</text>
  </svg>;
}
export function Spark({ points, band }: { points: number[]; band?: [number, number] }) {
  if (!points.length) return null;
  const w = 120, h = 36, min = Math.min(...points, band?.[0] ?? Infinity), max = Math.max(...points, band?.[1] ?? -Infinity), span = max - min || 1;
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const coords = points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * w},${y(p)}`).join(' ');
  return <svg className="bp-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Trend ${points[0]} to ${points[points.length - 1]}`}>{band && <rect className="bp-spark-band" x={0} y={y(band[1])} width={w} height={Math.max(2, y(band[0]) - y(band[1]))} />}<polyline points={coords} /><circle cx={w} cy={y(points[points.length - 1]!)} r={3} /></svg>;
}
export function Ring({ value, labelText }: { value: number; labelText: string }) {
  const r = 52, c = 2 * Math.PI * r;
  return <div className="bp-ring" style={{ width: 96, height: 96 }}><svg viewBox="0 0 120 120"><circle className="bp-ring-track" cx="60" cy="60" r={r} /><circle className="bp-ring-fill" cx="60" cy="60" r={r} strokeDasharray={`${(c * Math.min(100, Math.max(0, value))) / 100} ${c}`} /></svg><span className="bp-ring-value" style={{ fontSize: 22 }}>{Math.round(value)}<small>{labelText}</small></span></div>;
}

/* ---------- a tiny data hook ---------- */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(''); } }).catch((e) => { if (alive) setError(errorText(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
