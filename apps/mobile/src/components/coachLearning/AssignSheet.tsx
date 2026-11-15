/* Assign the course being read to one of the coach's clients, from the course itself (/coach/courses/:courseId): the
   same request and wording as the web's "Assign a course" dialog on the client's Learning tab (apps/dashboard/src/
   modules/learning/LearningTab.tsx AssignDialog), with the course fixed and the client chosen instead (the Client choice
   of the programme editor). POST /coach/clients/:id/courses { courseId, note|null } (assignSchema: note at most 500); the
   server refuses a client outside the course's audience (a package course needs one of its packages) and says why.
   GET /coach/clients lists the coach's own clients only; the field policy strips their contact details. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { audienceLabel, type Package } from '@/lib/coach/learning';
import { Button, Input, Loading, Notice, P } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { OptField } from '@/components/coachWorkouts/parts';
import { SelectField } from '@/components/coachWorkouts/SelectField';
import { space } from '@/theme';

type Client = { id: string; name: string };

export function AssignSheet({ open, course, onClose, onDone }: { open: boolean; course: { id: string; title: string; lessons: number; audience: string; packages?: Package[] }; onClose: () => void; onDone: (clientName: string) => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [memberId, setMemberId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setMemberId(''); setNote(''); setErr(''); setLoadErr('');
    let alive = true;
    get<{ items: Client[] }>('/coach/clients?limit=100&sort=name').then((r) => { if (alive) setClients(r.items ?? []); }, (e) => { if (alive) setLoadErr(errorText(e)); });
    return () => { alive = false; };
  }, [open]);
  const send = async () => {
    setBusy(true); setErr('');
    try {
      await post(`/coach/clients/${memberId}/courses`, { courseId: course.id, note: note.trim() || null });
      onDone(clients?.find((c) => c.id === memberId)?.name ?? '');
      onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const packages = course.packages ?? [];
  return <Sheet open={open} onClose={onClose} title="Assign a course" footer={<View style={{ flexDirection: 'row', gap: space.sm }}>
    <Button title="Not now" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
    <Button title="Assign" busy={busy} disabled={!memberId} onPress={send} style={{ flex: 1 }} />
  </View>}>
    <OptField label="Course"><P>{`${course.title} (${course.lessons} ${course.lessons === 1 ? 'lesson' : 'lessons'})`}</P></OptField>
    <P small>{`${audienceLabel(course.audience)}${packages.length ? `: ${packages.map((p) => p.name).join(', ')}. Only a client who holds one of these can be assigned it.` : '.'}`}</P>
    {loadErr ? <Notice kind="error">{loadErr}</Notice> : !clients ? <Loading /> : <SelectField label="Client" value={memberId} placeholder="Choose a client" searchable
      options={[{ value: '', label: 'Choose a client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} onChange={setMemberId} />}
    <OptField label="Note for the client" optional hint="Shown with the course on their Learn page; not included in the notification.">
      <Input value={note} onChangeText={setNote} maxLength={500} multiline numberOfLines={3} style={{ minHeight: 76, textAlignVertical: 'top' }} accessibilityLabel="Note for the client" />
    </OptField>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
