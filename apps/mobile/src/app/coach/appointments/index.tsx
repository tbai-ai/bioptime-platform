/* /coach/appointments as a deep link (the portal has it beside /coach/calendar): the Calendar tab of the coach workspace. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function CoachAppointmentsLink() { return <Redirect href="/(coach)/calendar" />; }
