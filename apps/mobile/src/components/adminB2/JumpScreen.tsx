/* A workspace screen whose cards can be jumped to, for the LabStack operations counters (the web's Counter: a link that
   scrolls the page to "Breaching now", "Escalations open" or the streams table).
   JumpScreen   { title, sub?, refreshing?, onRefresh?, children }   WorkspaceScreen (components/workspaceShell) drawn the
                same way: Screen's safe area, scroll view, pull to refresh and entrance (components/ui Screen,
                motion/ScreenEnter), the padded column and the Title. The one difference is that it keeps a handle on its
                scroll view, which Screen does not expose, so a card can be brought to the top.
   JumpTarget   { id, children }   marks a card a counter can jump to
   useJump()    → jump(id)         scrolls the screen so that card sits at the top (at once under reduced motion, as
                the web uses behavior 'auto' there); nothing happens outside a JumpScreen */
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Title } from '../ui';
import { ScreenEnter } from '../../motion/ScreenEnter';
import { useReduceMotion } from '../../motion/useReduceMotion';
import { colors, space } from '../../theme';

type HostView = React.ComponentRef<typeof View>;
type JumpContextValue = { register: (id: string, node: HostView | null) => void; jump: (id: string) => void };
const JumpContext = createContext<JumpContextValue | null>(null);

export function JumpScreen({ title, sub, children, refreshing, onRefresh }: { title: string; sub?: string; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const column = useRef<HostView>(null);
  const targets = useRef(new Map<string, HostView>());
  const reduce = useReduceMotion();
  const register = useCallback((id: string, node: HostView | null) => { if (node) targets.current.set(id, node); else targets.current.delete(id); }, []);
  const jump = useCallback((id: string) => {
    const target = targets.current.get(id), within = column.current;
    if (!target || !within) return;
    // the card's offset inside the scrolled column (layout, not the entrance transform), less a little air above it
    target.measureLayout(within, (_x: number, y: number) => { scroll.current?.scrollTo({ y: Math.max(0, y - space.sm), animated: !reduce }); }, () => { /* not laid out yet */ });
  }, [reduce]);
  const value = useMemo(() => ({ register, jump }), [register, jump]);
  const refreshControl = onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.muted} /> : undefined;
  return <JumpContext.Provider value={value}>
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scrollContent} refreshControl={refreshControl}>
        <ScreenEnter><View ref={column} collapsable={false} style={styles.padded}>
          <Title sub={sub}>{title}</Title>
          {children}
        </View></ScreenEnter>
      </ScrollView>
    </SafeAreaView>
  </JumpContext.Provider>;
}

export function JumpTarget({ id, children }: { id: string; children: React.ReactNode }) {
  const ctx = useContext(JumpContext);
  const ref = useCallback((node: HostView | null) => { ctx?.register(id, node); }, [ctx, id]);
  return <View ref={ref} collapsable={false} nativeID={id}>{children}</View>;
}

export function useJump(): (id: string) => void {
  return useContext(JumpContext)?.jump ?? noop;
}
const noop = () => { /* outside a JumpScreen */ };

// the values of components/ui.tsx styles.screen, scrollContent and padded
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: { flexGrow: 1 },
  padded: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
});
