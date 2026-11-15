/* The flag gate of a coach module screen: the screen body shows only while the module's flag is in
   GET /public/config → features (lib/features), as the web's ModuleRouteGate does on every navigation; here the flags
   are read again each time the screen is focused (lib/features keeps them for a minute, so this costs nothing while
   they are fresh). While the flags load, a spinner; with the flag off, the web's "No such page" with the server's own
   sentence for a switched-off module, under the screen's title. The server still refuses the routes. */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { loadFeatures } from '@/lib/features';
import { SWITCHED_OFF_BODY, SWITCHED_OFF_TITLE } from '@/lib/coach/libraries/shared';
import { Empty, Loading, Screen, Title } from '@/components/ui';

export function ModuleGate({ flag, title, children }: { flag: string; title: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const who = user?.id ?? 'signed-out';
  const [features, setFeatures] = useState<Set<string> | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    void loadFeatures(who).then((f) => { if (alive) setFeatures(f); });
    return () => { alive = false; };
  }, [who]));
  if (!features) return <Screen><Loading /></Screen>;
  if (!features.has(flag)) return <Screen><Title>{title}</Title><Empty title={SWITCHED_OFF_TITLE} body={SWITCHED_OFF_BODY} /></Screen>;
  return <>{children}</>;
}
