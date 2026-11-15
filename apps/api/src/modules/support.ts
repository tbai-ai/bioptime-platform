/* M4 Support requests, help centre, data export, imports and coach onboarding.
   Routes: api/http/routes/support.ts (each through def() with feature: 'support'; the parts also check their own
   switches support_requests, help_centre and imports). Job: data_exports. File kind: data_export (the member alone).
   Demo rows: help articles, a few support requests and a staged members import, in plain words.
   Migration: 0012_support.sql. */
import type { ApiModule, DemoSeedContext } from './types.js';
import { randomId } from '../lib/ids.js';
import { audit } from '../domain/audit.js';
import { supportRoutes, SUPPORT_SUBFLAGS } from '../http/routes/support.js';
import * as dataExport from '../domain/dataExport.js';
import * as help from '../domain/help.js';
import * as imports from '../domain/imports.js';

/* ---------- demo rows (demo mode only; plain words, no Demo or Sample: owner decision of 24 October 2026) ---------- */

// How-to articles that describe what the portal and the app do today. Nothing clinical, no service levels, no legal text.
const SEED_ARTICLES: Array<{ slug: string; title: string; audience: help.HelpAudience; category: string; sort: number; body: string }> = [
  { slug: 'asking-for-help', title: 'Asking the Bioptime team for help', audience: 'all', category: 'Using Bioptime', sort: 1,
    body: '<p>Open <strong>Help and support</strong> and choose <strong>New request</strong>. Pick the topic that fits, give it a short subject and describe what happened.</p><p>Replies appear in the same request, in the portal and in the app, and a notification tells you when the team has answered. The notification never carries the reply itself.</p>' },
  { slug: 'copy-of-your-data', title: 'Getting a copy of your data', audience: 'member', category: 'Using Bioptime', sort: 2,
    body: '<p>Ask for a copy under <strong>Profile › Your data</strong> in the portal, or <strong>Profile › Settings › Your data</strong> in the app.</p><p>When the team has prepared it, it is listed under <strong>Help and support › Your data export</strong>. Each time you open it, the download link works for five minutes. Only you can open it.</p>' },
  { slug: 'booking-a-blood-test', title: 'Booking a blood test at home', audience: 'member', category: 'Using Bioptime', sort: 3,
    body: '<p>Open <strong>Bloodwork</strong> in the portal or <strong>Tests</strong> in the app, choose a test, then a date and a home-collection slot for your PIN code. A booking uses one blood test from your package.</p><p>Bookings need a confirmed email address and the choice <em>Share my details with the partner laboratory</em> under <strong>Privacy and sharing</strong>.</p>' },
  { slug: 'working-hours', title: 'Setting your working hours', audience: 'coach', category: 'Coaching on Bioptime', sort: 1,
    body: '<p>Open <strong>Settings</strong> and set your weekly working hours. Members book consultations only inside them.</p><ul><li>Mark yourself away, with a reason, to pause your assignments.</li><li>Block a period for leave; no appointments are offered in it.</li></ul>' },
  { slug: 'health-sharing', title: 'When a client has not shared health records', audience: 'coach', category: 'Coaching on Bioptime', sort: 2,
    body: '<p>A client chooses whether their coach may see their health information. While it is off, their measurements, progress log, wellness score and blood tests stay hidden from you; you still see their name, member ID, age, gender, goals, programme and plan.</p><p>Ask them to turn on sharing under <strong>Privacy and sharing</strong> in the app or the portal. You never see a client’s phone number, email, address, PIN code or date of birth.</p>' },
];

async function seedDemo(demo: DemoSeedContext): Promise<void> {
  const { owner, adminId, coachIds, memberIds } = demo;
  if (!owner.config.isDemo) return;
  const db = owner.db;
  const now = owner.now();

  // the parts' own switches follow the module flag, which the demo seed has just switched on
  for (const key of SUPPORT_SUBFLAGS) db.run("UPDATE feature_flags SET enabled = 1, updated_at = ?, updated_by = ? WHERE key = ?", [now, owner.actor?.id ?? null, key]);
  audit(owner, 'feature_flag.update', { type: 'feature_flag', id: 'support_parts' }, 'initial data: every part of the support module switched on', { enabled: true, keys: [...SUPPORT_SUBFLAGS] });

  // help articles, published
  for (const a of SEED_ARTICLES) {
    const created = help.createArticle(owner, a);
    help.setPublished(owner, created.id, true, 'initial data: help article');
  }

  // support requests, written directly (no notifications) with references below the SUP sequence (which starts at
  // SUP-1001), so they never collide with a request made later: SUP-0901, SUP-0902, SUP-0903
  const at = (minutesAgo: number) => new Date(Date.parse(now) - minutesAgo * 60_000).toISOString();
  const request = (n: number, requesterId: string, role: 'member' | 'coach', category: string, subject: string, status: string, assignedTo: string | null, thread: Array<{ authorId: string; body: string; internal?: boolean; minutesAgo: number }>) => {
    const id = randomId('sup');
    const first = thread[0]!.minutesAgo, last = thread[thread.length - 1]!.minutesAgo;
    const reference = `SUP-09${String(n).padStart(2, '0')}`;
    db.insert('support_requests', { id, reference, requester_id: requesterId, requester_role: role, category, subject, status, assigned_to: assignedTo, created_at: at(first), updated_at: at(last), last_message_at: at(thread.filter((m) => !m.internal).at(-1)!.minutesAgo), resolved_at: status === 'resolved' ? at(last) : null });
    for (const m of thread) db.insert('support_messages', { id: randomId('spm'), request_id: id, author_id: m.authorId, body: m.body, internal: m.internal ? 1 : 0, file_id: null, created_at: at(m.minutesAgo) });
    audit(owner, 'support_request.create', { type: 'support_request', id }, 'initial data: support request', { reference, category, requesterRole: role });
  };
  request(1, memberIds[0]!, 'member', 'app', 'The app still shows yesterday’s tasks', 'waiting_on_requester', adminId, [
    { authorId: memberIds[0]!, body: 'My plan tasks in the app still show yesterday after I pull to refresh.', minutesAgo: 300 },
    { authorId: adminId, body: 'Ask which app version first; the version is printed at the bottom of the Me tab.', internal: true, minutesAgo: 240 },
    { authorId: adminId, body: 'Thank you. Which app version do you have? It is shown at the bottom of the Me tab.', minutesAgo: 235 },
  ]);
  if (coachIds[0]) request(2, coachIds[0], 'coach', 'account', 'Change the email on my coach account', 'open', null, [
    { authorId: coachIds[0], body: 'I would like to use a different email address for my coach account.', minutesAgo: 90 },
  ]);
  if (memberIds[8]) request(3, memberIds[8], 'member', 'privacy', 'What can my coach see?', 'resolved', adminId, [
    { authorId: memberIds[8], body: 'What exactly can my coach see about me?', minutesAgo: 2880 },
    { authorId: adminId, body: 'Privacy and sharing lists it (in the app: Profile › Settings › Privacy and sharing). Your coach never sees your phone, email, address, PIN code or date of birth, and sees your health records only while “My coach may see my health information” is on.', minutesAgo: 2700 },
  ]);

  // a staged members import with one row that fails validation, to show the error report; not applied, nobody invited
  imports.upload(owner, {
    kind: 'members', fileName: 'members-to-invite.csv',
    csv: 'email,name,phone,note\nnisha.pillai@demo.bioptime.test,Nisha Pillai,+919700000101,Staged; not invited yet\narun.kumar@demo.bioptime.test,Arun Kumar,,Staged; not invited yet\nnot-an-email,Row with an error,,Fails validation: not an email address\n',
  });
}

export const support: ApiModule = {
  key: 'support',
  feature: 'support',
  routes: supportRoutes,
  // a member keeps access to an export already made for them while the module is switched off
  ungated: ['POST /me/data-requests/:id/file-token'],
  jobs: [{
    name: 'data_exports',
    everyMs: 5 * 60_000,
    run: (ctx) => dataExport.generatePending(ctx),
    idle: (r) => { const x = r as { generated?: number; failed?: number; waiting?: string } | undefined; return !!x && !x.generated && !x.failed && !x.waiting; },
  }],
  fileAccess: { [dataExport.EXPORT_KIND]: dataExport.canOpenExport },
  seedDemo,
};
