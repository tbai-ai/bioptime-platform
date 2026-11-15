/* Log a meal, as a sheet over whatever screen opened it (a sheet route: transparentModal, drawn by SheetScreen). The
   form is the Fuel tab's own (src/screens/fuel/MealLogForm): the day, the planned meal or which meal, what happened,
   what was eaten, a note and an optional photo; nothing is estimated from it. ?slotId= and ?outcome= preselect a
   planned meal (as the Fuel tab's Swapped does). */
export { default } from '@/screens/fuel/MealLogRoute';
