/* The open preview (GET /public/config → openPreview: the server's owner offers a prepared member account for a
   preview).
   - The client app (STAFF_APP off; BUILD §7.4, owner decision D4): the member sign-in draws its form as always and,
     while the server offers the preview, a one-tap "Continue without signing in" card (usePreviewOffer, drawn by
     src/flow/auth/PreviewCard). Nothing is asked of the server until that tap: then one POST /auth/open-preview with
     the member workspace, and Home. A refusal (too many attempts, no answer) is said under the card's button and the
     form stays usable. The phone code, registration and password reset draw their forms too; a screen opened with a
     session already on this device goes to that session's home instead (usePreviewAway).
   - A staff build keeps the earlier behaviour (usePreviewDoor, OpeningPreview, PreviewDoorScreen): a sign-in screen
     reached with no session asks the server for a session of its workspace (lib/auth openPreview) and goes to that
     workspace's home, showing only "Opening Bioptime…" meanwhile, never the form. When that fails, the screen shows
     the reason and one "Open Bioptime" button instead. A failure the app already met by itself (on start or on
     sign-out) is shown the same way instead of being tried again at once. Reached with a session, the screen goes to
     that session's home. Until the app has read the server's settings (useAuth().ready) the screen shows a spinner.
   When the server stops offering the open preview, a 404 makes lib/auth read its settings again: openPreview is then
   absent, the card goes (client) and the forms come back (staff). */
import { Link } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { homeFor, openPreviewFailure, useAuth, WORKSPACE_SIGN_IN, type Workspace } from '@/lib/auth';
import { SERVER_OVERRIDE_ALLOWED, STAFF_APP } from '@/lib/config';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { ServerNotice } from '@/components/serverNotice';
import { colors, font, space } from '@/theme';

/** What PreviewDoorScreen says when the server gave no reason it can show. */
const NOT_OPENED = 'Bioptime could not be opened just now. Try again in a moment.';

export type PreviewDoor = {
  /** The workspace home to go to now (the open preview, with a session), or null. */
  home: string | null;
  /** Show OpeningPreview instead of the form: the session is being opened, or the app is still starting. */
  opening: boolean;
  /** The open preview is opening a session (OpeningPreview says so); false while the app is only starting. */
  announce: boolean;
  /** The open preview could not open a session: show PreviewDoorScreen (the reason and one button), never the form. */
  failed: boolean;
  /** Why the session could not be opened, while `failed`; null otherwise. */
  error: string | null;
  retry: () => void;
};

export function usePreviewDoor(workspace: Workspace): PreviewDoor {
  const { ready, config, user, openPreview, previewError } = useAuth();
  const on = STAFF_APP && !!config?.openPreview; // the client app opens the preview only on a tap (usePreviewOffer)
  const tried = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async () => {
    tried.current = true;
    setBusy(true); setError(null);
    try { await openPreview(workspace); }
    catch (e) { setError(e instanceof ApiError && e.status === 404 ? null : openPreviewFailure(e)); }
    finally { setBusy(false); }
  }, [openPreview, workspace]);
  useEffect(() => {
    if (!ready || !on || user || tried.current) return;
    tried.current = true;
    if (previewError) return; // met by the app a moment ago (on start or sign-out): shown with the button, not tried again at once
    void open();
  }, [ready, on, user, previewError, open]);
  const waiting = on && !user && (busy || (!tried.current && !previewError));
  const failed = ready && on && !user && !waiting;
  return {
    home: on && user ? homeFor(user.role) : null,
    opening: !ready || waiting,
    announce: waiting,
    failed,
    error: failed ? error ?? previewError ?? NOT_OPENED : null,
    retry: () => { void open(); },
  };
}

export type PreviewOffer = {
  /** Draw the "Continue without signing in" card: the server offers the open preview and nobody is signed in. */
  offer: boolean;
  /** The tap's request is under way. */
  busy: boolean;
  /** Why the last tap did not open the preview (shown under the card's button); null otherwise. */
  error: string | null;
  /** One POST /auth/open-preview for the member workspace; true once the session is open (the caller goes Home). */
  open: () => Promise<boolean>;
};

/** The client app's one-tap preview (BUILD §7.4): nothing is sent until open() is called, once per tap. A 404 means the
 *  server no longer offers it (lib/auth reads its settings again, so `offer` turns false and no reason is shown). */
export function usePreviewOffer(): PreviewOffer {
  const { ready, config, user, openPreview } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async () => {
    setBusy(true); setError(null);
    try { await openPreview('member'); return true; }
    catch (e) { setError(e instanceof ApiError && e.status === 404 ? null : openPreviewFailure(e)); return false; }
    finally { setBusy(false); }
  }, [openPreview]);
  return { offer: ready && !!config?.openPreview && !user, busy, error, open };
}

/** The member flows around signing in (the phone code, registration, password reset). `wait`: the app has not read the
 *  server's settings yet (on a phone the splash screen covers that moment). `to`:
 *  - the client app: the home of a session that was already on this device when the screen first knew (a link to it
 *    while signed in); a session the screen itself opens (registration, the phone code) does not move it, so its own
 *    next step (the email code, the Verified moment) still shows. Null otherwise: the form draws, preview or not.
 *  - a staff build in the open preview (nobody signs in there): with a session, its home; without one, the member
 *    sign-in, which opens the session (or says why it could not). Null without the open preview. */
export function usePreviewAway(): { to: string | null; wait: boolean } {
  const { ready, config, user } = useAuth();
  const arrived = useRef<boolean | null>(null); // a session was on the device when the screen first knew
  if (ready && arrived.current === null) arrived.current = !!user;
  if (!ready) return { to: null, wait: true };
  if (!STAFF_APP) return { to: arrived.current && user ? homeFor(user.role) : null, wait: false };
  if (!config?.openPreview) return { to: null, wait: false };
  return { to: user ? homeFor(user.role) : WORKSPACE_SIGN_IN.member, wait: false };
}

/** A staff build's sign-in while the open preview opens its session (announce), or while the app is starting. */
export function OpeningPreview({ announce = true }: { announce?: boolean }) {
  return <Screen>
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: space.xxl * 2, gap: space.sm }}>
      <Loading />
      {announce ? <Text style={{ color: colors.muted, fontSize: font.small }}>Opening Bioptime…</Text> : null}
    </View>
  </Screen>;
}

/** A staff build's sign-in when the open preview could not open a session: the reason and one button to try again.
 *  No email, password, Google, Apple or phone sign-in. ServerNotice and, for testers, the Server screen stay reachable. */
export function PreviewDoorScreen({ door }: { door: PreviewDoor }) {
  return <Screen>
    <View style={{ paddingTop: space.xxl, gap: space.md }}>
      <Notice kind="error" title="Bioptime did not open">
        <Text style={{ color: colors.muted, fontSize: font.small, lineHeight: 19 }}>{door.error ?? NOT_OPENED}</Text>
      </Notice>
      <Button title="Open Bioptime" onPress={door.retry} />
      <ServerNotice />
      {SERVER_OVERRIDE_ALLOWED ? <Link href="/settings/server" style={{ color: colors.muted, marginTop: space.md }}>Change the server address (testers)</Link> : null}
    </View>
  </Screen>;
}
