/* The old Progress screen moved into the Bio tab (BUILD_PLAN §7.1): links and notifications to /progress land there. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Progress() {
  return <Redirect href="/(tabs)/bio" />;
}
