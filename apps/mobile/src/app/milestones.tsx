/* The old Milestones screen: the member's milestones now live in Profile › Achievements. Kept so old links and
   notifications still land there. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Milestones() {
  return <Redirect href="/(tabs)/profile?tab=achievements" />;
}
