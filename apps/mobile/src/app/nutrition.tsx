/* The old Nutrition screen's address (module entry '/nutrition', notifications, older builds' links): it opens the
   Fuel tab, keeping ?segment= (today, search, saved) when a link names one. */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function Nutrition() {
  const { segment } = useLocalSearchParams<{ segment?: string }>();
  return <Redirect href={segment ? { pathname: '/(tabs)/fuel', params: { segment } } : '/(tabs)/fuel'} />;
}
