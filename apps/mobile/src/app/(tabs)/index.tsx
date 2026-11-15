/* The Home tab (slot 1 of the nine): the screen lives in src/screens/home (HomeScreen.tsx says what it shows). The
   onboarding redirect for a member who has not finished it is done by the tabs layout for every tab, and again by the
   screen itself from the same shared GET /me. */
import { HomeScreen } from '@/screens/home/HomeScreen';

export default HomeScreen;
