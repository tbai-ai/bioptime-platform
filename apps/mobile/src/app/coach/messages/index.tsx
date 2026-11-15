/* /coach/messages as a deep link: the Messages tab of the coach workspace. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function CoachMessagesLink() { return <Redirect href="/(coach)/messages" />; }
