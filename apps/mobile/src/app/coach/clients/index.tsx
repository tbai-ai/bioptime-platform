/* /coach/clients as a deep link: the Clients tab of the coach workspace. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function CoachClientsLink() { return <Redirect href="/(coach)/clients" />; }
