/* The questions of a check-in template (the web's QuestionsEditor, apps/dashboard/src/modules/progress/shared.tsx:313-330):
   per question its wording, its key (derived from the wording, editable), the answer type and, for number and 1-to-5
   questions, the metric it also logs. At most 20; the last one cannot be removed. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Field, Input, Row } from '@/components/ui';
import { cleanKey, cleanQuestion, keyFrom, MAX_QUESTIONS, QUESTION_TYPE_LABELS, QUESTION_TYPES, scaleMetrics, type Metric, type Question } from '@/lib/coach/libraries/progress';
import { colors, radius, space } from '@/theme';
import { SelectField } from './SelectField';

export function QuestionsEditor({ value, onChange, metrics }: { value: Question[]; onChange: (q: Question[]) => void; metrics: Metric[] }) {
  const update = (i: number, patch: Partial<Question>) => onChange(value.map((q, k) => (k === i ? cleanQuestion({ ...q, ...patch }) : q)));
  const scale = scaleMetrics(metrics);
  return <View style={{ gap: space.md }}>
    {value.map((q, i) => <View key={i} style={styles.tile}>
      <Field label={`Question ${i + 1}`}><Input value={q.label} onChangeText={(v) => update(i, { label: v, key: q.key || keyFrom(v, value, i) })} maxLength={200} accessibilityLabel={`Question ${i + 1}`} /></Field>
      <Field label="Key" hint="Lower-case, unique"><Input value={q.key} onChangeText={(v) => update(i, { key: cleanKey(v) })} autoCapitalize="none" autoCorrect={false} maxLength={40} accessibilityLabel={`Key ${i + 1}`} /></Field>
      <SelectField label="Answer" value={q.type} options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))} onChange={(v) => update(i, { type: v as Question['type'] })} />
      {q.type === 'number' || q.type === 'scale_1_5' ? <SelectField label="Also logs" hint="Optional" value={q.metric ?? ''} placeholder="Nothing" options={[{ value: '', label: 'Nothing' }, ...(q.type === 'scale_1_5' ? scale : metrics).map((m) => ({ value: m.metric, label: `${m.label} (${m.unit})` }))]} onChange={(v) => update(i, { metric: v || undefined })} /> : null}
      <Row><Button title="Remove" variant="ghost" small disabled={value.length <= 1} onPress={() => onChange(value.filter((_, k) => k !== i))} /></Row>
    </View>)}
    {value.length < MAX_QUESTIONS ? <Row><Button title="Add a question" variant="secondary" small onPress={() => onChange([...value, { key: '', label: '', type: 'text' }])} /></Row> : null}
  </View>;
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, paddingBottom: space.xs },
});
