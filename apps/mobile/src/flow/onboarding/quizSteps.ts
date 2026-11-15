/* The quiz's steps and options: the earlier app's seven-step chrome mapped onto what Bioptime's coach reads (the profile and
   goals of onboarding), plus the date of birth, gender and place the laboratory needs. Titles and answers only:
   nothing here is used to compute calories, targets or any score. Gender options and the 18+ rule are today's. */
import type { IconName } from '@/fx';
import type { QuizStepId } from './model';

export type Choice = { value: string; label: string; description?: string; icon?: IconName };

export type StepCopy = { title: string; subtitle: string; cta?: string; hint: string };

export const STEP_COPY: Record<QuizStepId, StepCopy> = {
  activity: { title: 'How active are you?', subtitle: 'Your coach reads this before writing your first plan.', hint: 'Select an option to continue' },
  birth: { title: 'When were you born?', subtitle: 'The laboratory needs it, with your gender, before a collection can be booked.', hint: 'You must be 18 or over to use Bioptime.' },
  weight: { title: 'What’s your weight?', subtitle: 'Saved to your progress as your starting point. Your coach sees it while health sharing is on.', hint: '' },
  height: { title: 'What’s your height?', subtitle: 'Kept with your profile for your coach.', hint: '' },
  fitness: { title: 'Your fitness level?', subtitle: 'Helps your coach choose where your plan starts.', hint: 'Select an option to continue' },
  goals: { title: 'What are you after?', subtitle: 'Pick any. Your coach reads these before writing your first plan.', hint: 'Choose at least one goal' },
  lifestyle: { title: 'Lifestyle preferences', subtitle: 'Optional: add tags that apply to you.', hint: 'Select all that apply; you can change them later.' },
  gender: { title: 'Your gender', subtitle: 'The laboratory needs it, with your date of birth, before a collection can be booked.', hint: 'Select an option to continue' },
  place: { title: 'Where are you?', subtitle: 'Where you are helps with home collections; the rest is optional.', cta: 'Send my answers', hint: 'You can add these later in your profile.' },
};

export const ACTIVITY: Choice[] = [
  { value: 'sedentary', label: 'Sedentary', description: 'Desk-bound with little daily movement', icon: 'moon' },
  { value: 'light', label: 'Lightly active', description: '1–3 light sessions a week', icon: 'leaf' },
  { value: 'moderate', label: 'Moderately active', description: '3–5 workouts a week', icon: 'activity' },
  { value: 'very', label: 'Very active', description: '6 or more sessions a week', icon: 'zap' },
  { value: 'athlete', label: 'Athlete', description: 'More than one training session most days', icon: 'flame' },
];

export const FITNESS: Choice[] = [
  { value: 'beginner', label: 'Beginner', description: 'New to structured training', icon: 'sunrise' },
  { value: 'intermediate', label: 'Intermediate', description: '1–2 years of regular training', icon: 'trending-up' },
  { value: 'advanced', label: 'Advanced', description: '3 years or more, a strong base', icon: 'dumbbell' },
  { value: 'competitive', label: 'Competitive', description: 'You compete in a sport', icon: 'trophy' },
];

/** Bioptime's eight goals, as the coach dashboard shows them (the stored value is the label). */
export const GOALS: Choice[] = [
  { value: 'Energy and sleep', label: 'Energy and sleep', description: 'Rest well, feel steadier', icon: 'moon' },
  { value: 'Strength', label: 'Strength', description: 'Get stronger', icon: 'dumbbell' },
  { value: 'Fat loss', label: 'Fat loss', description: 'Lose fat steadily', icon: 'trending-down' },
  { value: 'Endurance', label: 'Endurance', description: 'Go further for longer', icon: 'heart' },
  { value: 'Longevity', label: 'Longevity', description: 'Stay well for longer', icon: 'clock' },
  { value: 'Stress', label: 'Stress', description: 'Feel calmer day to day', icon: 'wind' },
  { value: 'Mobility', label: 'Mobility', description: 'Move more freely', icon: 'activity' },
  { value: 'Habits', label: 'Habits', description: 'Routines that stick', icon: 'refresh-cw' },
];

/** The earlier app's fourteen tags. Vegan, vegetarian, gluten-free and dairy-free also go to the nutrition profile. */
export const LIFESTYLE: Choice[] = [
  { value: 'vegan', label: 'Vegan' }, { value: 'vegetarian', label: 'Vegetarian' }, { value: 'gluten_free', label: 'Gluten-free' },
  { value: 'dairy_free', label: 'Dairy-free' }, { value: 'home_workouts', label: 'Home workouts' }, { value: 'gym_access', label: 'Gym access' },
  { value: 'morning', label: 'Morning trainer' }, { value: 'evening', label: 'Evening trainer' }, { value: 'stress', label: 'Stress reduction' },
  { value: 'sleep', label: 'Better sleep' }, { value: 'fasting', label: 'Intermittent fasting' }, { value: 'supplements_ok', label: 'Supplements OK' },
  { value: 'outdoor', label: 'Outdoor training' }, { value: 'no_equipment', label: 'No equipment' },
];

/** Today's four options (the profile's gender field). */
export const GENDER: Choice[] = [
  { value: 'female', label: 'Female', icon: 'user-round' },
  { value: 'male', label: 'Male', icon: 'user' },
  { value: 'other', label: 'Other', icon: 'users' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say', icon: 'eye-off' },
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
