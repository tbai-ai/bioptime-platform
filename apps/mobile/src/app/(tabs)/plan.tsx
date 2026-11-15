/* The old Plan tab: its weekly plan now lives in Train › Plan. Kept as a hidden route so old links and notifications
   still land there. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Plan() {
  return <Redirect href="/(tabs)/train?view=plan" />;
}
