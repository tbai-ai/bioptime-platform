/* The phone's answer to the portal's <select>: a field that shows the chosen option and opens a bottom sheet with the
   options (grouped when they name a group, searchable for long lists such as exercises, templates and clients). Built
   from the existing primitives and tokens; no new colours. `compact` draws it without a Field label (inline rows), with
   `label` still its accessible name (the web's aria-label). Each option's accessible name is its label. */
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Eyebrow, P } from '@/components/ui';
import { SearchBar, Sheet } from '@/components/workspace';
import { colors, font, radius, space } from '@/theme';
import { OptField } from './parts';

export type SelectOption = { value: string; label: string; detail?: string; group?: string; disabled?: boolean };

export function SelectField({ label, value, options, onChange, placeholder = 'Choose…', hint, error, searchable, disabled, compact, title, optional }: {
  label: string; value: string; options: SelectOption[]; onChange: (v: string) => void; placeholder?: string; hint?: string; error?: string; optional?: boolean;
  searchable?: boolean; disabled?: boolean; compact?: boolean; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t) || (o.detail ?? '').toLowerCase().includes(t)) : options;
  }, [options, q]);
  const groups = useMemo(() => {
    const out: Array<{ group: string | undefined; items: SelectOption[] }> = [];
    for (const o of shown) { const g = out.find((x) => x.group === o.group); if (g) g.items.push(o); else out.push({ group: o.group, items: [o] }); }
    return out;
  }, [shown]);
  const close = () => { setOpen(false); setQ(''); };
  const pick = (v: string) => { onChange(v); close(); };
  const control = <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={() => setOpen(true)} style={({ pressed }) => [styles.control, disabled && styles.disabled, pressed && { backgroundColor: colors.hover }]}>
    <Text style={[styles.value, !current?.value && { color: colors.disabled }]} numberOfLines={1}>{current ? current.label : placeholder}</Text>
    <Ionicons name={disabled ? 'lock-closed-outline' : 'chevron-down'} size={18} color={colors.muted} />
  </Pressable>;
  return <>
    {compact ? control : <OptField label={label} optional={optional} hint={hint} error={error}>{control}</OptField>}
    <Sheet open={open} onClose={close} title={title ?? label}>
      {searchable ? <SearchBar value={q} onChangeText={setQ} placeholder="Search" /> : null}
      {groups.length ? groups.map((g) => <View key={g.group ?? '_'}>
        {g.group ? <Eyebrow>{g.group}</Eyebrow> : null}
        {g.items.map((o) => {
          const selected = o.value === value;
          return <Pressable key={o.value || '_empty'} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected, disabled: !!o.disabled }} disabled={o.disabled} onPress={() => pick(o.value)} style={({ pressed }) => [styles.option, selected && { backgroundColor: colors.raised }, pressed && { backgroundColor: colors.hover }, o.disabled && { opacity: 0.5 }]}>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.optionLabel}>{o.label}</Text>{o.detail ? <Text style={styles.optionDetail}>{o.detail}</Text> : null}</View>
            {selected ? <Ionicons name="checkmark" size={18} color={colors.accentText} /> : null}
          </Pressable>;
        })}
      </View>) : <P muted small>Nothing matches.</P>}
    </Sheet>
  </>;
}

const styles = StyleSheet.create({
  control: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.base, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, minHeight: 46 },
  disabled: { opacity: 0.55, borderStyle: 'dashed' },
  value: { flex: 1, color: colors.text, fontSize: font.body },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: radius.sm },
  optionLabel: { color: colors.text, fontSize: font.body },
  optionDetail: { color: colors.muted, fontSize: font.small, marginTop: 2 },
});
