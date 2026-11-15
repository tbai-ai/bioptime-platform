/* The old Live sessions screen: the group classes, webinars and workshops now sit in Train › This week under
   "Live classes" (first, when opened from here). Kept so old links, module entries and notifications still work. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Sessions() {
  return <Redirect href="/(tabs)/train?section=live" />;
}
