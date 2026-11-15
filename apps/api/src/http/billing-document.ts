/* The printable billing document (receipt, tax invoice or credit note), modelled on report-document.ts: the brand's
   document template, rendered on the server from the stored document; opened only through a 5-minute token.

   Nothing here is decided for the owner: the seller block shows exactly what the billing_entity setting held when the
   document was issued, a receipt says plainly that it is not a tax invoice, and the GST split (CGST and SGST, or IGST)
   is not drawn because the place-of-supply rules are an owner and counsel decision.

   A document for a payment that went through the payment simulator carries one small, plain "Simulated payment" note
   at the top, and nothing else says so (owner decision of 24 October 2026: no "Sample data" or "demo" label, one
   simulated note). */
import type { Ctx } from '../context.js';
import type { presentDocument } from '../domain/billing.js';
import { istLongDateTime } from '../lib/time.js';

type Doc = ReturnType<typeof presentDocument> & { voidReason?: string | null; restricted?: boolean };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A calendar date in India Standard Time, as the portal and the app show it (12 October 2026). */
const IST_DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const day = (iso: string | null | undefined) => { if (!iso) return '—'; const t = new Date(iso); return Number.isNaN(t.getTime()) ? String(iso).slice(0, 10) : IST_DATE.format(t); };

/** The seller fields in a readable order: the ones a tax invoice needs first, then anything else the setting holds. */
const SELLER_ORDER = ['legalName', 'tradeName', 'gstin', 'address', 'state', 'stateCode', 'pan', 'email', 'phone', 'website'];
const SELLER_LABEL: Record<string, string> = { legalName: 'Legal name', tradeName: 'Trade name', gstin: 'GSTIN', address: 'Registered address', state: 'State', stateCode: 'State code', pan: 'PAN', email: 'Email', phone: 'Phone', website: 'Website', sacCode: 'SAC code' };
const fieldLabel = (k: string) => SELLER_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function sellerBlock(seller: Record<string, string> | null): string {
  if (!seller) return '<p class="muted">Seller details have not been added yet. They will appear here once Bioptime’s business details are set.</p>';
  const keys = [...SELLER_ORDER.filter((k) => seller[k]), ...Object.keys(seller).filter((k) => !SELLER_ORDER.includes(k) && k !== 'sacCode')];
  return `<b>${esc(seller.legalName ?? '')}</b>${keys.filter((k) => k !== 'legalName').map((k) => `<div><span>${esc(fieldLabel(k))}</span> ${esc(seller[k])}</div>`).join('')}`;
}

function buyerBlock(buyer: Record<string, unknown>, restricted: boolean): string {
  const place = [buyer.address, buyer.city, buyer.state, buyer.pincode].filter((v) => typeof v === 'string' && v.trim()).map(esc).join(', ');
  return `<b>${esc(buyer.name ?? '')}</b>${buyer.email ? `<div>${esc(buyer.email)}</div>` : ''}${restricted ? `<div class="muted">Address withheld: it needs the “View members’ restricted contact fields” permission.</div>${buyer.city || buyer.state ? `<div>${esc([buyer.city, buyer.state].filter(Boolean).join(', '))}</div>` : ''}` : place ? `<div>${place}</div>` : '<div class="muted">No billing address on file.</div>'}`;
}

export function billingDocument(ctx: Ctx, d: Doc): string {
  const isVoid = d.status === 'void';
  const heading = d.kind === 'tax_invoice' ? 'Tax invoice' : d.kind === 'credit_note' ? (d.taxDocument ? 'Credit note' : 'Credit note · refund record') : 'Payment receipt';
  const simulatedNote = d.simulated ? '<span class="simulated">Simulated payment</span>' : '';
  const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${esc(l.sacCode ?? '—')}</td><td class="num">${esc(l.qty)}</td><td class="num">${money(l.taxableInr)}</td><td class="num">${esc(l.gstRatePct)}%</td><td class="num">${money(l.gstInr)}</td><td class="num">${money(l.amountInr)}</td></tr>`).join('');
  const notes: string[] = [];
  if (d.kind === 'receipt') notes.push('<div class="box"><b>Not a tax invoice.</b> This receipt records a payment the provider verified; GST is shown as included in the price at checkout. A tax invoice, where one is issued, is a separate document with its own INV number.</div>');
  if (d.kind === 'credit_note' && d.relatedDocument) notes.push(`<div class="box"><b>Issued against ${esc(d.relatedDocument.kind === 'tax_invoice' ? 'tax invoice' : 'receipt')} ${esc(d.relatedDocument.number)}.</b> ${d.refundId ? 'It records the refund of this order.' : 'It cancels that document in full.'}${d.taxDocument ? '' : ' No tax invoice was issued for this order, so this is a refund record, not a GST credit note.'}</div>`);
  if (d.kind === 'tax_invoice' && d.relatedDocument) notes.push(`<div class="box"><b>Replaces tax invoice ${esc(d.relatedDocument.number)}</b>, which was cancelled by a credit note.</div>`);
  if (d.taxDocument) notes.push('<div class="box"><b>GST.</b> The total GST is shown at the rate the order was priced with. Its split into CGST and SGST, or IGST, follows the place-of-supply rules, which are pending configuration.</div>');
  if (isVoid) notes.push(`<div class="box void"><b>Void.</b> This document was cancelled on ${esc(day(d.voidedAt))}${d.creditedBy ? ` by credit note ${esc(d.creditedBy.number)}` : ''}${d.replacedBy ? `; tax invoice ${esc(d.replacedBy.number)} replaces it` : ''}.</div>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Bioptime ${esc(heading.toLowerCase())} ${esc(d.number)}</title>
<style>
body{margin:0;background:#ECE6DC;color:#1D1B18;font:11pt/1.5 Montserrat,system-ui,sans-serif}.page{position:relative;max-width:210mm;margin:16px auto;padding:18mm;background:#fff;box-shadow:0 2px 4px rgba(45,36,24,.08),0 28px 56px -28px rgba(45,36,24,.36)}
header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:5mm;border-bottom:2px solid #0B1120}header b{font-size:20px;letter-spacing:-.02em}header b i{color:#EE3324;font-style:normal}.doc{text-align:right;font:500 8.5pt/1.5 "JetBrains Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:#5A544C}
.simulated{position:absolute;top:8mm;right:18mm;font-size:8pt;color:#6B655D}
.ident{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm 8mm;margin:6mm 0;font-size:10pt}.ident span,.party span{display:block;color:#6B655D;font-size:8.5pt}h1{font-size:23pt;letter-spacing:-.03em;line-height:1.1;margin:0 0 2mm}h2{font-size:14pt;letter-spacing:-.02em;margin:8mm 0 3mm}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:8mm;font-size:10pt}.party div{margin-top:1mm}.party div span{display:inline;font-size:8.5pt}.muted{color:#6B655D}
table{width:100%;border-collapse:collapse;font-size:9.5pt}th{text-align:left;padding:2mm 0;border-bottom:1px solid #1D1B18;font:500 8pt/1.3 "JetBrains Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:#5A544C}td{padding:2.2mm 0;border-bottom:1px solid #E4DED3;vertical-align:top}.num{text-align:right;padding-left:3mm;font-variant-numeric:tabular-nums}
.totals{margin:4mm 0 0 auto;width:60%;font-size:10pt}.totals td{border-bottom:1px solid #E4DED3}.totals tr:last-child td{border-bottom:2px solid #0B1120;font-weight:700;font-size:12pt}
.box{padding:4mm 5mm;border:1px solid rgba(45,36,24,.18);border-radius:3mm;background:#F5F1EA;font-size:10pt;margin-top:3mm}.box b{display:inline}.box.void{border-color:#EE3324}
.stamp{display:inline-block;margin-left:3mm;padding:1px 8px;border:1.5px solid #EE3324;border-radius:2mm;color:#EE3324;font:600 9pt/1.4 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase;vertical-align:middle}
footer{margin-top:10mm;padding-top:3mm;border-top:1px solid #E4DED3;font-size:8pt;color:#6B655D}
.tableWrap{overflow-x:auto}
@media screen and (max-width:640px){.page{margin:0;padding:6mm}.simulated{top:1.5mm;right:6mm}.ident{grid-template-columns:1fr 1fr}.parties{grid-template-columns:1fr}.totals{width:100%}th,td{padding-right:2mm}th:last-child,td:last-child{padding-right:0}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0}.tableWrap{overflow:visible}}
</style></head><body><article class="page">${simulatedNote}
<header><b>bi<i>o</i>ptime</b><div class="doc">${esc(heading)}<br>${esc(d.number)}</div></header>
<div class="ident"><div><span>Number</span><b>${esc(d.number)}</b></div><div><span>Issued (IST)</span>${esc(day(d.issuedAt))}</div><div><span>Order</span>${esc(d.orderReference ?? '')}</div><div><span>Paid (IST)</span>${esc(day(d.paidAt))}</div><div><span>Payment</span>${esc(d.paymentId ?? '—')}</div><div><span>Status</span>${isVoid ? 'Void' : 'Issued'}</div></div>
<h1>${esc(heading)}${isVoid ? '<span class="stamp">Void</span>' : ''}</h1>
<div class="parties"><div class="party"><span>Seller</span>${sellerBlock(d.seller)}</div><div class="party"><span>${d.kind === 'credit_note' ? 'Credited to' : 'Billed to'}</span>${buyerBlock(d.buyer as Record<string, unknown>, !!d.restricted)}</div></div>
<h2>${d.kind === 'credit_note' ? 'Credit' : 'Details'}</h2>
<div class="tableWrap"><table><thead><tr><th>Description</th><th>SAC</th><th class="num">Qty</th><th class="num">Taxable value</th><th class="num">GST rate</th><th class="num">GST</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table></div>
<table class="totals"><tbody><tr><td>Taxable value</td><td class="num">${money(d.subtotalInr)}</td></tr><tr><td>GST</td><td class="num">${money(d.gstInr)}</td></tr><tr><td>${d.kind === 'credit_note' ? 'Total credited' : 'Total paid'} (${esc(d.currency)})</td><td class="num">${money(d.totalInr)}</td></tr></tbody></table>
${notes.join('\n')}
<footer>Keep this document for your records. Generated ${esc(istLongDateTime(ctx.now()))} · ${esc(d.number)}</footer>
</article></body></html>`;
}
