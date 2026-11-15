/* Tab 7, Tests ("Clinic"): blood tests at home, bookings, released reports and the catalogue (src/screens/tests).
   The simulated-laboratory notice stays here, word for word: the screen shows it first while the laboratory is the
   stand-in. */
import React from 'react';
import { Notice } from '@/fx';
import TestsScreen from '@/screens/tests/TestsScreen';

export default function Tests() {
  return <TestsScreen simulatedNotice={<Notice kind="sample" title="Simulated laboratory">Bookings here are simulated; no laboratory is involved and no sample is collected.</Notice>} />;
}
