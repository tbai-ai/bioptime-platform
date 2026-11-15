/* The old Me tab: its name, account line, progress, account list, sign-out and footer now live in Profile (tab 9).
   Kept as a hidden route so old links and notifications still land there. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Me() {
  return <Redirect href="/(tabs)/profile" />;
}
