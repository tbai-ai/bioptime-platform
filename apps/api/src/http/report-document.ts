/* The report document a member or coach opens: laboratory values as reported, Bioptime commentary labelled, the
   brand book's report template structure. Rendered on the server from the stored values; no public URL. */
import type { Ctx } from '../context.js';
import type { getReport } from '../domain/bloodwork.js';
import { istLongDate, istLongDateTime } from '../lib/time.js';

type Report = ReturnType<typeof getReport>;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Dates in India time and in words, as the portal and the app show them (5 October 2026; 5 October 2026, 17:25 IST). */
const valid = (iso: unknown): iso is string => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
const date = (iso: unknown) => (valid(iso) ? istLongDate(iso) : '—');
const dateTime = (iso: unknown) => (valid(iso) ? istLongDateTime(iso) : '—');

export function reportDocument(ctx: Ctx, r: Report): string {
  const byCoach = r.reviewerKind === 'coach';
  const member = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [r.memberId as string]);
  const values = r.values as Array<{ label: string; value: string; units: string | null; range_low: number | null; range_high: number | null; matched_range: string | null; flag: string | null; unmapped: number }>;
  const rows = values.map((v) => `<tr><td>${esc(v.label)}</td><td class="num">${esc(v.value)}</td><td class="unit">${esc(v.units ?? '')}</td><td>${esc(v.matched_range ?? (v.range_low !== null && v.range_high !== null ? `${v.range_low}–${v.range_high}` : v.range_low !== null ? `≥ ${v.range_low}` : v.range_high !== null ? `≤ ${v.range_high}` : '—'))}</td><td class="${v.flag ? 'flag' : ''}">${v.flag ? `▲ Outside range (${esc(v.flag)})` : 'In range'}</td></tr>`).join('');
  // one small plain note on a practice laboratory result (the owner's decision of 24 October 2026), as on billing documents
  const practiceNote = r.simulated ? '<span class="simulated">Practice laboratory: no sample was collected</span>' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Bioptime report ${esc(r.reference)}</title>
<style>
body{margin:0;background:#ECE6DC;color:#1D1B18;font:11pt/1.5 Montserrat,system-ui,sans-serif}.page{position:relative;max-width:210mm;margin:16px auto;padding:18mm;background:#fff;box-shadow:0 2px 4px rgba(45,36,24,.08),0 28px 56px -28px rgba(45,36,24,.36)}
header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:5mm;border-bottom:2px solid #0B1120}header b{font-size:20px;letter-spacing:-.02em}header b i{color:#EE3324;font-style:normal}.doc{text-align:right;font:500 8.5pt/1.5 "JetBrains Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:#5A544C}
.simulated{position:absolute;top:8mm;right:18mm;font-size:8pt;color:#6B655D}
.ident{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm 8mm;margin:6mm 0;font-size:10pt}.ident span{display:block;color:#6B655D;font-size:8.5pt}h1{font-size:23pt;letter-spacing:-.03em;line-height:1.1;margin:0 0 2mm}h2{font-size:14pt;letter-spacing:-.02em;margin:8mm 0 3mm}h2 small{font-weight:400;font-size:10pt;color:#5A544C}
table{width:100%;border-collapse:collapse;font-size:9.5pt}th{text-align:left;padding:2mm 0;border-bottom:1px solid #1D1B18;font:500 8pt/1.3 "JetBrains Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:#5A544C}td{padding:2.2mm 0;border-bottom:1px solid #E4DED3;vertical-align:top}.num{text-align:right;padding-right:4mm;font-weight:600;font-variant-numeric:tabular-nums}.unit{color:#5A544C;padding-right:6mm}.flag{color:#7A4F00;font-weight:600}
.prov{font:400 8pt/1.5 "JetBrains Mono",monospace;color:#6B655D;margin-top:2mm}.box{padding:4mm 5mm;border:1px solid rgba(45,36,24,.18);border-radius:3mm;background:#F5F1EA;font-size:10pt;margin-top:3mm}.box b{display:block;margin-bottom:1mm}footer{margin-top:10mm;padding-top:3mm;border-top:1px solid #E4DED3;font-size:8pt;color:#6B655D}
.tableWrap{overflow-x:auto}
@media screen and (max-width:640px){.page{margin:0;padding:6mm}.simulated{top:1.5mm;right:6mm}.ident{grid-template-columns:1fr 1fr}th,td{padding-right:2mm}th:last-child,td:last-child{padding-right:0}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0}.tableWrap{overflow:visible}}
</style></head><body><article class="page">${practiceNote}
<header><b>bi<i>o</i>ptime</b><div class="doc">Blood test report<br>${byCoach ? 'Explained by your coach' : 'Reviewed by the Bioptime team'}</div></header>
<div class="ident"><div><span>Member</span><b>${esc(member?.name ?? '')}</b></div><div><span>Booking</span><b>${esc(r.reference)}</b></div><div><span>Test</span>${esc((r.test as { name?: string } | null)?.name ?? '')}</div><div><span>${r.simulated ? 'Collection time' : 'Sample collected'}</span>${esc(dateTime(r.collectedAt))}</div><div><span>Laboratory report</span>${esc(date(r.deliveredAt))}</div><div><span>Reviewed by</span>${r.reviewed ? esc(r.reviewerName ?? 'Bioptime coach') + ' · ' + esc(date(r.reviewedAt)) : 'Not yet reviewed'}</div></div>
<h1>${valid(r.collectedAt) ? `Your ${esc(date(r.collectedAt))} results, explained.` : 'Your results, explained.'}</h1>
<p>Section 1 reproduces the laboratory's results exactly as reported, with the laboratory's own reference ranges. Section 2 is ${byCoach ? 'your Bioptime coach&#39;s commentary' : 'the Bioptime team&#39;s review notes'}, which is guidance, not a medical opinion. Section 3 says what a report like this can and cannot tell you.</p>
<h2>1 · Results as reported by the laboratory</h2>
<div class="tableWrap"><table><thead><tr><th>Marker</th><th class="num">Result</th><th>Unit</th><th>Laboratory range</th><th>Flag</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Marker values are not available yet; the laboratory PDF is the record until they arrive.</td></tr>'}</tbody></table></div>
<p class="prov">Values, units and ranges are reproduced from the laboratory report without change. A flag marks a value outside the laboratory's range, as the laboratory reported it or as read against its range. Bioptime does not alter, round or re-rank results. Ranges differ between laboratories and by age, sex and method.</p>
<h2>2 · ${byCoach ? 'Coach commentary <small>· Bioptime coach · not a medical opinion</small>' : 'Review notes <small>· Bioptime team · not a medical opinion</small>'}</h2>
<p>${r.coachNote ? esc(r.coachNote) : byCoach ? 'Your coach has not added notes yet.' : 'No review notes have been added yet.'}</p>
<h2>3 · What this report can and cannot tell you</h2>
<div class="box"><b>A single test is a snapshot.</b> Results move with the time of day, what you ate, sleep, illness and the laboratory's method. A result outside a range is not a diagnosis, and a result inside one does not rule a condition out. Trends over several tests tell you more than any one of them.</div>
<div class="box"><b>Who decides what.</b> ${byCoach ? 'Your Bioptime coach' : 'Bioptime'} can explain results and adjust training, food and habits. Decisions about medicines, supplements, further tests or treatment belong with a qualified doctor. If you feel unwell, or a result worries you, contact a doctor; do not wait for your next consultation.</div>
<footer>Bioptime is wellbeing guidance and behaviour support, not medical advice or a medical service. Keep this report for your records and share it with your doctor. Generated ${esc(dateTime(ctx.now()))} · ${esc(r.reference)}</footer>
</article></body></html>`;
}
