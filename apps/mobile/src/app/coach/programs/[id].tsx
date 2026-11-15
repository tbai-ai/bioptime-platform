/* /coach/programs/:id (and 'new' with ?member=): an older address of the workout programme editor. The editor lives at
   /coach/workout-programs/:id, the web's address (apps/dashboard/src/modules/workouts/module.tsx), which the client's
   Workouts tab links to; this route only passes the id and the query on, so an old link still opens the same editor. */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function ProgramsRedirect() {
  const { id = 'new', ...rest } = useLocalSearchParams<{ id: string; member?: string; saved?: string }>();
  const query = Object.entries(rest).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return <Redirect href={`/coach/workout-programs/${encodeURIComponent(String(id))}${query ? `?${query}` : ''}`} />;
}
