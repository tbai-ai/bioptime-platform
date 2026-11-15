/* Book a test: the earlier app's five-step blood-test checkout on Bioptime's booking route (src/screens/tests).
   The simulated-laboratory note stays here, word for word: the review step shows it while the laboratory is the
   stand-in. */
import React from 'react';
import { Notice } from '@/fx';
import BookTestScreen from '@/screens/tests/BookTestScreen';

export default function BookTest() {
  return <BookTestScreen simulatedNotice={<Notice kind="sample" title="Simulated laboratory">Slots and collections are simulated; no sample is collected.</Notice>} />;
}
