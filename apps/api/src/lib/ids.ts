/* Identifiers: prefixed random ids for records, human references (PAY-, BIO-) for things people quote. */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish, no i/l/o/u

export function randomId(prefix: string, length = 14): string {
  const bytes = randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${prefix}_${s}`;
}

export const ids = {
  user: () => randomId('usr'),
  session: () => randomId('ses'),
  token: () => randomId('tok'),
  profile: () => randomId('prf'),
  consent: () => randomId('cns'),
  invitation: () => randomId('inv'),
  package: () => randomId('pkg'),
  packageVersion: () => randomId('pkv'),
  order: () => randomId('ord'),
  payment: () => randomId('pay'),
  refund: () => randomId('rfd'),
  programme: () => randomId('prg'),
  entitlement: () => randomId('ent'),
  entitlementTx: () => randomId('etx'),
  assignmentRequest: () => randomId('arq'),
  assignment: () => randomId('asg'),
  availabilityRule: () => randomId('avr'),
  availabilityBlock: () => randomId('avb'),
  appointment: () => randomId('apt'),
  plan: () => randomId('pln'),
  planVersion: () => randomId('plv'),
  task: () => randomId('tsk'),
  progress: () => randomId('prg'),
  test: () => randomId('tst'),
  booking: () => randomId('bkg'),
  bookingEvent: () => randomId('bke'),
  vendorEvent: () => randomId('vev'),
  report: () => randomId('rpt'),
  reportValue: () => randomId('rpv'),
  conversation: () => randomId('cnv'),
  message: () => randomId('msg'),
  notification: () => randomId('ntf'),
  delivery: () => randomId('dlv'),
  outbox: () => randomId('obx'),
  customPlan: () => randomId('cpl'),
  customPlanEvent: () => randomId('cpe'),
  supportTask: () => randomId('spt'),
  audit: () => randomId('aud'),
  event: () => randomId('evt'),
  job: () => randomId('job'),
  file: () => randomId('fil'),
  enquiry: () => randomId('enq'),
  dataRequest: () => randomId('drq'),
  reminder: () => randomId('rmd'),
  pushDevice: () => randomId('pdv'),
};

/** The human reference families: payments, bloodwork bookings, invoices, bespoke plans, support requests, credit notes. */
export type ReferencePrefix = 'PAY' | 'BIO' | 'INV' | 'CPL' | 'SUP' | 'CRN';

/** Human references with a numeric sequence: PAY-1001, BIO-24011, INV-1001, SUP-1001, CRN-1001. Callers pass the next sequence number. */
export function reference(prefix: ReferencePrefix, n: number): string {
  return `${prefix}-${n}`;
}
