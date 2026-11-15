/* Admin › Referrals (the web's /admin/referrals, modules/referrals/AdminReferrals.tsx; referrals module,
   members.manage): every member who joined with someone's referral code, with its status: signed up, or became a
   paying member (their first order paid, after the payment provider's verified confirmation)
   (GET /admin/referrals?status&q → { items, counts }). Names open the client record. Read only; nothing about rewards
   is stored: they are an owner decision. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { get, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Code, Readout } from '@/components/adminA/parts';
import { LoadError } from '@/components/adminB1/parts';
import { Card, Empty, Loading, Pill, Row } from '@/components/ui';
import { FilterChips, RecordList, SearchBar } from '@/components/workspace';
import { AdminModuleScreen, useScreenRefresh } from '@/components/adminModules/shared';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Person = { id: string; name: string; memberCode: string | null };
type Item = { id: string; code: string; status: 'signed_up' | 'paying_member'; statusLabel: string; signedUpAt: string; becamePayingAt: string | null; referrer: Person; referred: Person };
type List = { items: Item[]; counts: { signed_up: number; paying_member: number; total: number; referringMembers: number } };

const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, { value: 'signed_up', label: 'Signed up' }, { value: 'paying_member', label: 'Became a paying member' }];

export default function AdminReferralsScreen() {
  return <AdminModuleScreen title="Referrals" module="referrals" permission="members.manage"
    sub="Members who created an account with another member’s link. A referral becomes a paying member when their first order is paid. Rewards are set by the Bioptime team; nothing here promises one.">
    <Referrals />
  </AdminModuleScreen>;
}

function Referrals() {
  const router = useRouter();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const list = useLoad<List>(`admin-referrals-${status}-${search}`, () => get(`/admin/referrals${qs({ status, q: search })}`), [status, search, tick]);
  const pull = useScreenRefresh(list.loading, list.stale);
  useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  useEffect(() => { if (!q.trim() && search) setSearch(''); }, [q, search]);
  const d = list.data;
  const c = d?.counts;
  const person = (p: Person, prefix: string) => <Pressable accessibilityRole="link" onPress={() => router.push(`/admin/clients/${p.id}` as never)} style={{ paddingVertical: 2 }}>
    <Text style={{ color: colors.muted, fontSize: font.small }}>{prefix}<Text style={{ color: colors.accentText, fontWeight: '600' }}>{p.name}</Text>{p.memberCode ? ` · ${p.memberCode}` : ''}</Text>
  </Pressable>;
  return <View style={{ gap: space.md }}>
    {c ? <Enter index={1}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      <Readout eyebrow="Referrals" value={c.total} />
      <Readout eyebrow="Signed up" value={c.signed_up} />
      <Readout eyebrow="Paying members" value={c.paying_member} />
      <Readout eyebrow="Members referring" value={c.referringMembers} />
    </View></Enter> : null}
    <FilterChips options={STATUS_OPTIONS} value={status} onChange={(v) => setStatus(String(v))} />
    <SearchBar value={q} onChangeText={setQ} placeholder="Name, member ID or code" onSubmit={() => setSearch(q.trim())} />
    <LoadError title="Referrals could not be loaded" error={list.error} onRetry={list.reload} />
    {!d && !list.error ? <Loading /> : d && d.items.length ? <RecordList title="Referrals">
      {d.items.map((r, i) => <View key={r.id} style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: i === d.items.length - 1 ? 0 : 1, borderBottomColor: colors.border, gap: 2 }}>
        <Row between style={{ flexWrap: 'nowrap' }}>
          <Text style={{ color: colors.text, fontSize: font.small }}>{`Joined ${fmtDate(r.signedUpAt)}`}</Text>
          <Pill tone="success">{r.statusLabel}</Pill>
        </Row>
        {person(r.referred, 'New member: ')}
        {person(r.referrer, 'Referred by: ')}
        <Row><Code>{r.code}</Code>{r.becamePayingAt ? <Text style={{ color: colors.muted, fontSize: font.small }}>{fmtDate(r.becamePayingAt)}</Text> : null}</Row>
      </View>)}
    </RecordList> : d ? <Card><Empty title="No referrals in this view" body="Members find their personal link under Refer a friend in the portal and the app." /></Card> : null}
  </View>;
}
