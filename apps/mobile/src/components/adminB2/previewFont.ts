/* The font of the Theme screen's live preview: the draft's fontSans, as the web preview sets --bp-font-sans
   (pages/admin/Theme.tsx cssVars): 'system-ui' is the system face; a named face (Montserrat, the brand face) is used
   when it can be drawn. The app's own text keeps its system face: this applies to the preview's texts only.
   On the web build the portal's own Montserrat file (served with the portal under /portal/fonts, the file the web
   portal's @font-face reads) is registered once through expo-font for the preview, and the preview names the web's
   stack ("Montserrat", system-ui, …), so the browser draws the system face until the file is in. A phone has no copy of
   that web font (the app bundles none, and none is added): there the face is used only if the app already holds it,
   otherwise the system face is drawn. */
import * as Font from 'expo-font';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { apiBaseSync } from '../../lib/config';

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
let webMontserrat: Promise<boolean> | null = null;

function loadOnWeb(face: string): Promise<boolean> {
  if (Platform.OS !== 'web' || face !== 'Montserrat') return Promise.resolve(Font.isLoaded(face));
  if (!webMontserrat) {
    webMontserrat = Font.loadAsync({ Montserrat: { uri: `${apiBaseSync()}/portal/fonts/montserrat-latin.woff2`, display: Font.FontDisplay.SWAP } })
      .then(() => true, () => { webMontserrat = null; return false; });
  }
  return webMontserrat;
}

/** The fontFamily for the preview's texts (undefined: the platform's system face). */
export function usePreviewFont(face: string): string | undefined {
  const [, setReady] = useState(0);
  useEffect(() => {
    if (face === 'system-ui' || Font.isLoaded(face)) return;
    let alive = true;
    void loadOnWeb(face).then((ok) => { if (alive && ok) setReady((n) => n + 1); });
    return () => { alive = false; };
  }, [face]);
  if (face === 'system-ui') return Platform.OS === 'web' ? SYSTEM_STACK : undefined;
  if (Platform.OS === 'web') return `"${face}", ${SYSTEM_STACK}`;
  return Font.isLoaded(face) ? face : undefined;
}
