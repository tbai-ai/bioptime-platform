/* Next steps from your reports moved into the Life tab (BUILD_PLAN §7.1): links and notifications to /lab-follow-ups
   open Life with that section first. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function LabFollowUps() {
  return <Redirect href={{ pathname: '/(tabs)/life', params: { section: 'next-steps' } }} />;
}
