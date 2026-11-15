/* /messages (old links, notifications and the web portal's wording) now opens the Coach tab, where the thread with the
   coach lives (BUILD_PLAN §7.1). */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Messages() {
  return <Redirect href="/(tabs)/coach" />;
}
