/* The cards the switched-on modules add to the administrator's Overview (the web's useModuleCards('adminOverview'), in
   registry order): Billing (modules/billing/BillingCard.tsx), Coach proposals to review (modules/workouts/Cards.tsx
   AdminLibraryCard), Lab next steps (modules/labFollowups/AdminLabFollowups.tsx AdminOverviewCard), Coming up
   (modules/sessions/Cards.tsx AdminSessionsCard), Courses (modules/learning/Cards.tsx AdminCoursesCard) and From the
   website (modules/growth/Cards.tsx AdminGrowthCard). Each card fetches its own endpoint, reloads on the Overview's pull
   to refresh (refreshTick) and links to its page with an explicit admin href; offline, a card showing the copy saved on
   the device says so with the stale banner. Wording as on the web. */
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import type { OverviewCardContext } from '@/lib/admin/a/overviewCards';
import { Card, Empty, Eyebrow, H2, Loading, Notice, Row, StaleBanner } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { fmtSpan } from '@/components/coachModules/shared';
import { placesText } from '@/components/coachModules/sessions';
import { colors, font, space } from '@/theme';

const s = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** The web's CardHead: eyebrow, title and the "Open" link on the right. */
function Head({ eyebrow, title, href }: { eyebrow: string; title: string; href: string }) {
  const router = useRouter();
  return <Row between style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
    <View style={{ flex: 1 }}><Eyebrow>{eyebrow}</Eyebrow><H2>{title}</H2></View>
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`} onPress={() => router.push(href as never)} hitSlop={8} style={({ pressed }) => [st.open, pressed && { opacity: 0.7 }]}><Text style={st.openText}>Open</Text></Pressable>
  </Row>;
}

function Line({ children, sub, href }: { children: React.ReactNode; sub?: string; href?: string }) {
  const router = useRouter();
  const body = <View style={st.line}><Text style={[st.lineText, href ? { color: colors.accentText } : null]}>{children}</Text>{sub ? <Text style={st.sub}>{sub}</Text> : null}</View>;
  return href ? <Pressable accessibilityRole="link" onPress={() => router.push(href as never)}>{body}</Pressable> : body;
}

/* ---------- Billing (orders.manage) ---------- */
type BillingSummary = { taxInvoices: { ready: boolean; missing: string[] }; openRefundRequests: number; documents: { receipts: number; taxInvoices: number; creditNotes: number; void: number }; paidOrdersWithoutReceipt: number };

export function BillingOverviewCard({ ctx }: { ctx: OverviewCardContext }) {
  const q = useLoad<BillingSummary>('admin-card-billing', () => get('/admin/billing/summary'), [ctx.refreshTick]);
  const d = q.data;
  const title = d ? (d.openRefundRequests ? `${d.openRefundRequests} refund ${s(d.openRefundRequests, 'request')} to decide` : 'No refund requests waiting') : 'Billing';
  return <Card>
    <Head eyebrow="Billing" title={title} href={d?.openRefundRequests ? '/admin/billing?tab=requests' : '/admin/billing'} />
    <StaleBanner at={q.stale} />
    {q.error ? <Text style={st.sub}>{q.error.message}</Text> : !d ? <Loading /> : <Text style={st.body}>
      {d.taxInvoices.ready ? `Tax invoices are issued. ${d.documents.taxInvoices} issued, ${d.documents.creditNotes} credit notes.` : `Receipts only: tax invoices are pending configuration (missing ${d.taxInvoices.missing.join(', ')}).`}
      {d.paidOrdersWithoutReceipt ? ` ${d.paidOrdersWithoutReceipt} verified paid ${s(d.paidOrdersWithoutReceipt, 'order')} without a receipt.` : ''}
    </Text>}
  </Card>;
}

/* ---------- Exercise library: coach proposals (library.manage) ---------- */
export function WorkoutsLibraryOverviewCard({ ctx }: { ctx: OverviewCardContext }) {
  const q = useLoad<{ items: Array<{ id: string; name: string; authorName?: string | null }> }>('admin-card-workouts', () => get('/admin/exercises?status=draft&source=coach'), [ctx.refreshTick]);
  const items = q.data?.items ?? [];
  return <Card>
    <Head eyebrow="Exercise library" title="Coach proposals to review" href="/admin/exercise-library" />
    <StaleBanner at={q.stale} />
    {q.error ? <Notice kind="error">{q.error.message}</Notice> : !q.data ? <Loading /> : items.length ? <View>{items.slice(0, 5).map((e) => <Line key={e.id}><Text style={{ fontWeight: '700' }}>{e.name}</Text>{e.authorName ? ` · ${e.authorName}` : ''}</Line>)}</View> : <Empty title="Nothing waiting" />}
  </Card>;
}

/* ---------- Lab next steps (reports.view) ---------- */
export function LabFollowupsOverviewCard({ ctx }: { ctx: OverviewCardContext }) {
  const q = useLoad<{ summary: { open: number; done: number; cancelled: number; overdue: number } }>('admin-card-lab-follow-ups', () => get('/admin/lab-follow-ups?status=open&limit=1'), [ctx.refreshTick]);
  const sm = q.data?.summary;
  return <Card>
    <Head eyebrow="Reports" title="Lab next steps" href="/admin/lab-follow-ups" />
    <StaleBanner at={q.stale} />
    {q.error ? <Notice kind="error">{q.error.message}</Notice> : !sm ? <Loading /> : <KeyValue rows={[['Open', String(sm.open)], ['Past due', String(sm.overdue)], ['Done', String(sm.done)], ['Cancelled', String(sm.cancelled)]]} />}
  </Card>;
}

/* ---------- Live sessions: coming up (sessions.manage) ---------- */
type SessionRow = { id: string; title: string; startAt: string; endAt: string; hostName: string; capacity: number | null; counts?: { registered: number; attended: number; noShow: number; waitlisted: number } };
export function SessionsOverviewCard({ ctx }: { ctx: OverviewCardContext }) {
  const q = useLoad<{ items: SessionRow[] }>('admin-card-sessions', () => get('/admin/sessions?range=upcoming&status=published'), [ctx.refreshTick]);
  const items = q.data?.items ?? [];
  return <Card>
    <Head eyebrow="Live sessions" title="Coming up" href="/admin/sessions" />
    <StaleBanner at={q.stale} />
    {q.error ? <Notice kind="error">{q.error.message}</Notice> : !q.data ? <Loading /> : items.length ? <View>{items.slice(0, 4).map((x) => <Line key={x.id} sub={`${x.hostName} · ${placesText(x)}`}><Text style={{ fontWeight: '700' }}>{x.title}</Text>{` · ${fmtSpan(x.startAt, x.endAt)}`}</Line>)}</View> : <Empty title="Nothing published" />}
  </Card>;
}

/* ---------- Learning: courses (learning.manage); nothing on error, as on the web ---------- */
export function CoursesOverviewCard({ ctx }: { ctx: OverviewCardContext }) {
  const q = useLoad<{ items: Array<{ status: string }> }>('admin-card-courses', () => get('/admin/courses'), [ctx.refreshTick]);
  const items = q.data?.items;
  if (q.error && !items) return <View />;
  const n = (status: string) => (items ?? []).filter((c) => c.status === status).length;
  return <Card>
    <Head eyebrow="Learning" title="Courses" href="/admin/learning" />
    <StaleBanner at={q.stale} />
    {!items ? <Loading /> : <Row style={{ gap: space.xl }}>
      {([['Drafts', n('draft')], ['Published', n('published')], ['Archived', n('archived')]] as const).map(([k, v]) => <View key={k} accessibilityLabel={`${k}: ${v}`}><Eyebrow>{k}</Eyebrow><Text style={st.readout}>{v}</Text></View>)}
    </Row>}
  </Card>;
}

/* ---------- Growth: from the website (growth.manage) ---------- */
type GrowthSummary = { discoveryNew: number; discoveryOpen: number; corporateNew: number; corporateOpen: number; subscribersConfirmed: number; subscribersPending: number; slotsOffered: number };
export function GrowthOverviewCard({ ctx }: { ctx: OverviewCardContext }) {
  const q = useLoad<GrowthSummary>('admin-card-growth', () => get('/admin/growth/summary'), [ctx.refreshTick]);
  const g = q.data;
  return <Card>
    <Head eyebrow="Growth" title="From the website" href="/admin/growth/discovery-calls" />
    <StaleBanner at={q.stale} />
    {q.error ? <Notice kind="error">{q.error.message}</Notice> : !g ? <Loading /> : <View>
      <Line href="/admin/growth/discovery-calls" sub={`${g.discoveryOpen} open · ${g.slotsOffered} ${s(g.slotsOffered, 'time')} offered on the website`}><Text style={{ fontWeight: '700' }}>{g.discoveryNew}</Text>{` new discovery call ${s(g.discoveryNew, 'request')}`}</Line>
      <Line href="/admin/growth/corporate" sub={`${g.corporateOpen} open`}><Text style={{ fontWeight: '700' }}>{g.corporateNew}</Text>{` new corporate ${s(g.corporateNew, 'enquiry', 'enquiries')}`}</Line>
      <Line href="/admin/growth/newsletter" sub={`${g.subscribersPending} waiting to confirm`}><Text style={{ fontWeight: '700' }}>{g.subscribersConfirmed}</Text>{` newsletter ${s(g.subscribersConfirmed, 'subscriber')}`}</Line>
    </View>}
  </Card>;
}

const st = StyleSheet.create({
  line: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  lineText: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  sub: { color: colors.muted, fontSize: font.small },
  body: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  open: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  openText: { color: colors.accentText, fontSize: font.small, fontWeight: '700' },
  readout: { color: colors.text, fontSize: font.title, fontWeight: '700' },
});
