/* Priya Nair's showcase (demo mode only): the open-preview member's records filled in so every screen of the client app
   has something true to show. Like the rest of the demo seed, everything is created through the domain services, as the
   member, her coach (Asha Menon), the Bioptime team or the laboratory stand-in would create it, at the time it would
   have happened (each call runs with a clock set to that moment). Where no service can set a date (an enrolment that
   predates the seed, a booking's timeline, a report's dates) the rows are moved back in time afterwards, as seed.ts does
   for its past appointment and bookings.

   What is synthetic and how it says so (owner decisions of 30 October 2026; AMENDED_PLAN_NOTES §4, CRITIQUE 5–7):
   - Every value is a fictional member's own entry, a coach's own words or the laboratory stand-in's practice report.
     Nothing on screen says "demo" or "sample", and nothing names the owner's earlier app.
   - Food values were taken from the owner's earlier app and are not checked against a food-composition table; their
     sourceRef says they are prepared values, not checked against such a table (PREPARED_SOURCE), in member words.
   - The Wellness Score (74) is prepared preview data: no service computes one, so it is written here with the label
     every score carries ('estimate'), and real members see "—".
   - Exercises are named for what their clip shows (the M1 clip review); a clip that failed the review leaves its
     exercise text only, and Kettlebell Swings has no clip at all. Her own programme uses only exercises with a clip
     (release round, 5 Nov 2026: every exercise she opens shows its demonstration); the text-only ones stay in the
     library. Guide text is the earlier app's, with calorie,
     fat-burn, hormone and disease claims removed and the form cues matched to the clip.
   - The stand-in returns the same practice values for every order, so the earlier report's values are set apart from
     the later one's (still within the practice laboratory's own ranges and flags) to give the trends something to show.
   - No photos are seeded: the progress gallery and dishes keep their own empty states. */
import type { Ctx } from '../context.js';
import type { Services } from '../services.js';
import { addDays, addMinutes, dateInZone, istDayLabel, zonedToIso } from '../lib/time.js';
import { randomId } from '../lib/ids.js';
import { audit } from '../domain/audit.js';
import { notify } from '../domain/notifications.js';
import { processPending } from '../domain/events.js';
import { updateTask } from '../domain/support.js';
import * as w from '../domain/workouts.js';
import * as exerciseMedia from '../domain/exerciseMedia.js';
import * as plans from '../domain/plans.js';
import * as progress from '../domain/progress.js';
import * as habits from '../domain/habits.js';
import * as n from '../domain/nutrition.js';
import * as bloodwork from '../domain/bloodwork.js';
import * as entitlements from '../domain/entitlements.js';
import * as labFollowups from '../domain/labFollowups.js';
import * as appointments from '../domain/appointments.js';
import * as sessions from '../domain/sessions.js';
import * as messaging from '../domain/messaging.js';
import * as courses from '../domain/learning.js';

export const SHOWCASE_MEMBER = 'priya.nair@demo.bioptime.test';
const COACH = 'asha.menon@demo.bioptime.test';

/** The source every prepared food value carries (CRITIQUE 6): true about where the numbers came from. */
export const PREPARED_SOURCE = 'Values prepared for this preview; not checked against a food-composition table';
/** The prepared Wellness Score of the preview member (AMENDED §9, owner question Q2). Bioptime does not calculate a
 *  score, so it is labelled 'preview' (the app says "Prepared for the preview"), never 'estimate'. */
export const PREPARED_WELLNESS_SCORE = 74;
export const PREPARED_WELLNESS_LABEL = 'preview';
/** How long ago the preview member joined: before her first blood test, so her history reads in order. */
const JOINED_DAYS_AGO = 100;

type Role = 'member' | 'coach' | 'admin' | 'owner';
type ExerciseDef = { name: string; clip: string | null; category: string; equipment: string[]; muscles: string[]; description: string; instructions: string[]; safety: string[] };

/* ---------- the exercise library: one exercise per reviewed clip, and the text-only ones (M1 clips/REVIEW.md) ---------- */
const EXERCISES: ExerciseDef[] = [
  { name: 'Barbell Back Squat', clip: 'barbell-back-squat', category: 'strength', equipment: ['barbell', 'squat rack'], muscles: ['quadriceps', 'glutes', 'hamstrings', 'core'],
    description: 'The main lower-body lift: a squat with the bar across the upper back, for leg and hip strength.',
    instructions: ['Take the bar from the rack with both feet under it, then step back two short steps.', 'Brace your trunk before each rep.', 'Sit down between your heels to about parallel, knees tracking over your toes.', 'Drive up through the whole foot and stand tall at the top.'],
    safety: ['Squat inside a rack with the safety bars set just below your lowest point.', 'Never lift the bar onto your back from the floor or by hand: take it from the rack.', 'Lower the load if your knees cave in or your lower back rounds.'] },
  { name: 'Pull-Up', clip: 'pull-up', category: 'strength', equipment: ['pull-up bar'], muscles: ['lats', 'biceps', 'upper back'],
    description: 'A pull from a dead hang until the chin clears the bar, for back and arm strength.',
    instructions: ['Start from a full hang with straight arms.', 'Draw your shoulder blades down before you bend your elbows.', 'Pull your elbows towards your hips until your chin is over the bar.', 'Lower under control to a full hang.'],
    safety: ['Use a resistance band, or slow lowering-only reps, until you can do strict reps.', 'Do not swing if your shoulders are sore.', 'Stop if you feel sharp pain in the shoulder or elbow.'] },
  { name: 'Incline Dumbbell Press', clip: 'incline-dumbbell-press', category: 'strength', equipment: ['dumbbells', 'incline bench'], muscles: ['chest', 'shoulders', 'triceps'],
    description: 'A press from an incline bench with a dumbbell in each hand, for the upper chest, shoulders and triceps.',
    instructions: ['Set the bench to a low incline; keep your head, upper back, hips and feet in contact.', 'Draw your shoulder blades back and down and keep them there.', 'Lower the dumbbells to the sides of your chest over about three seconds.', 'Press up and slightly in until your arms are straight.'],
    safety: ['Use dumbbells you can lower with control; never bounce at the bottom.', 'Ask for a spotter when you work close to your limit.', 'Stop if you feel pain at the front of the shoulder.'] },
  { name: 'Dumbbell Shoulder Press', clip: 'dumbbell-shoulder-press', category: 'strength', equipment: ['dumbbells'], muscles: ['shoulders', 'triceps', 'upper back'],
    description: 'A standing press of two dumbbells from shoulder height to overhead.',
    instructions: ['Stand with your feet hip-width apart and the dumbbells at shoulder height.', 'Brace your trunk and keep your ribs down, without arching your lower back.', 'Press straight up until your arms are fully extended.', 'Lower under control to shoulder height.'],
    safety: ['Warm up your shoulders before pressing.', 'If your lower back arches, press seated or use lighter dumbbells.', 'Do not press to failure without a safe way to put the weights down.'] },
  { name: 'Bodyweight Lunge', clip: 'bodyweight-lunge', category: 'strength', equipment: [], muscles: ['quadriceps', 'glutes', 'hamstrings'],
    description: 'A lunge without weights: step forward, lower, then return to standing, one leg at a time.',
    instructions: ['Stand tall with your hands on your hips.', 'Step forward and lower until both knees are bent to about 90 degrees.', 'Keep the front knee over the ankle and the torso upright.', 'Push through the front heel to return to standing, then switch legs.'],
    safety: ['Limit the depth if a knee is sore, and never drop the back knee onto the floor.', 'Use a flat, non-slip surface.', 'Hold a wall or a chair if your balance is unsteady.'] },
  { name: 'Sled Push', clip: 'sled-push', category: 'conditioning', equipment: ['sled'], muscles: ['quadriceps', 'glutes', 'calves', 'core'],
    description: 'Driving a loaded sled across the floor with short, powerful steps, for leg drive and conditioning.',
    instructions: ['Hold the poles with straight arms and lean into the sled at about 45 degrees.', 'Drive with short, quick steps from the legs.', 'Keep your head neutral, eyes on the floor a couple of metres ahead.', 'Walk back slowly between pushes.'],
    safety: ['Push only on a surface the sled is made for, never on wet or uneven floors.', 'Reduce the load if you cannot hold the forward lean.', 'Walk easily afterwards and stretch the front of your hips.'] },
  { name: 'Box Jump', clip: 'box-jump', category: 'conditioning', equipment: ['plyometric box'], muscles: ['quadriceps', 'glutes', 'calves'],
    description: 'A jump from the floor onto a stable box, landing softly, then stepping down.',
    instructions: ['Stand a short step from the box with your feet hip-width apart.', 'Swing your arms and jump onto the box.', 'Land softly in a quarter squat, knees over your toes, then stand tall.', 'Step down from the box one foot at a time; do not jump down backwards.'],
    safety: ['Start with a low box: pick a height you clear easily.', 'Use a stable box on a non-slip floor.', 'Stop when your landings get heavy or your knees cave in.'] },
  { name: 'Burpee', clip: 'burpee', category: 'conditioning', equipment: [], muscles: ['legs', 'glutes', 'shoulders', 'core'],
    description: 'From standing to a plank and back up into a jump, without a push-up.',
    instructions: ['Squat down and place your hands on the floor.', 'Step or jump your feet back to a straight plank.', 'Jump your feet back in towards your hands.', 'Stand up and jump with your arms overhead, landing softly.'],
    safety: ['Warm up for a few minutes first.', 'Step back and in instead of jumping if your knees or wrists are sore.', 'Stop and rest if you feel dizzy or unwell.'] },
  { name: 'Jump Rope', clip: 'jump-rope', category: 'conditioning', equipment: ['jump rope'], muscles: ['calves', 'shoulders', 'forearms'],
    description: 'Skipping with a rope in a steady rhythm, for footwork and conditioning.',
    instructions: ['Jump only 2 to 3 cm off the floor.', 'Keep your elbows close to your sides and turn the rope from the wrists.', 'Land on the balls of your feet with soft knees.', 'Look ahead, not down.'],
    safety: ['Use a firm, flat, non-slip floor and cushioned shoes.', 'Size the rope: standing on its middle, the handles reach your armpits.', 'Start with 30-second rounds if you are new to it.'] },
  { name: 'Medicine Ball Slam', clip: 'medicine-ball-slam', category: 'conditioning', equipment: ['slam ball'], muscles: ['lats', 'shoulders', 'core', 'legs'],
    description: 'Lifting a medicine ball overhead and slamming it to the floor, for power through the whole body.',
    instructions: ['Reach the ball fully overhead.', 'Brace your trunk and pull the ball down hard with your back and arms.', 'Hinge and bend your knees as you slam.', 'Catch the bounce in a squat, not standing upright.'],
    safety: ['Keep about two metres of clear space around you.', 'Use a slam ball that does not bounce when you are near walls or equipment.', 'Skip overhead slams if your shoulder hurts when you raise your arm.'] },
  { name: 'Mountain Climber', clip: 'mountain-climber', category: 'conditioning', equipment: [], muscles: ['core', 'hip flexors', 'shoulders'],
    description: 'Alternating knee drives from a high plank, for trunk control and conditioning.',
    instructions: ['Start in a high plank, wrists under shoulders, body in a straight line.', 'Drive one knee towards your chest, then switch legs.', 'Keep your hips level: they should not pop up or sag.', 'Breathe out with each knee drive.'],
    safety: ['Hold a 30-second plank comfortably before doing these.', 'Rest when your hips start to sag.', 'Avoid them if your wrists or shoulders hurt in a plank.'] },
  { name: 'Rowing Machine', clip: 'rowing-machine', category: 'conditioning', equipment: ['rowing machine'], muscles: ['legs', 'back', 'arms', 'core'],
    description: 'Rowing on a rowing machine, legs then body then arms, for low-impact conditioning.',
    instructions: ['Drive with your legs first, then lean back slightly, then pull the handle to your lower ribs.', 'Return in reverse: arms, body, then legs.', 'At the catch, keep your shins about vertical.', 'Keep your back long through the whole stroke.'],
    safety: ['Strap your feet across the ball of the foot, not the arch.', 'Reduce the resistance if your lower back rounds.', 'Keep the lean-back small if your lower back is sensitive.'] },
  { name: 'Indoor Cycling', clip: 'indoor-cycling', category: 'conditioning', equipment: ['indoor bike'], muscles: ['quadriceps', 'hamstrings', 'glutes', 'calves'],
    description: 'Riding an indoor bike at a steady pace or in intervals, for low-impact conditioning.',
    instructions: ['Set the saddle so your knee stays slightly bent at the bottom of the stroke.', 'Keep a light grip on the handlebars.', 'Push through the whole pedal stroke rather than stamping down.', 'Stand only briefly for climbs, with a slight forward lean.'],
    safety: ['Set the handlebars so you are not reaching forward.', 'Use caged pedals or cycling shoes so your feet stay in place.', 'Avoid grinding at a very low cadence against heavy resistance.'] },
  { name: 'Forearm Plank', clip: 'forearm-plank', category: 'core', equipment: ['mat'], muscles: ['abdominals', 'obliques', 'lower back'],
    description: 'Holding a straight line from head to heels on your forearms, for trunk strength.',
    instructions: ['Place your elbows under your shoulders and your forearms on the mat.', 'Lift your hips so your body forms a straight line.', 'Draw your navel in gently and keep your hips from sagging.', 'Breathe steadily throughout the hold.'],
    safety: ['Do not hold your breath.', 'Build up the hold time gradually.', 'Drop to your knees if your lower back starts to ache.'] },
  { name: 'Russian Twist', clip: 'russian-twist', category: 'core', equipment: ['medicine ball'], muscles: ['obliques', 'abdominals'],
    description: 'Seated rotation from side to side with a medicine ball, for the obliques.',
    instructions: ['Sit with your knees bent and heels on the floor, then lean back slightly with a long spine.', 'Hold the ball close to your body.', 'Rotate from your ribcage, letting the ball follow your torso.', 'Breathe out as you turn to each side.'],
    safety: ['Keep the movement slow and controlled.', 'Do not twist past a comfortable range.', 'Stop if you feel pain in your lower back rather than effort in your trunk.'] },
  { name: 'Reformer Reverse Plank', clip: 'reformer-reverse-plank', category: 'core', equipment: ['Pilates reformer'], muscles: ['glutes', 'hamstrings', 'shoulders', 'core'],
    description: 'A face-up plank on a Pilates reformer, lifting the hips into a straight line.',
    instructions: ['Sit on the carriage with your hands behind you and your feet on the footbar.', 'Press through your hands and feet to lift your hips into a straight line.', 'Keep your neck long and your shoulders away from your ears.', 'Lower with control.'],
    safety: ['Learn the reformer with an instructor before using it on your own.', 'Use light springs until the movement is steady.', 'Skip it if your wrists or shoulders hurt bearing weight.'] },
  { name: 'Standing Yoga Flow', clip: 'standing-yoga-flow', category: 'mobility', equipment: ['mat'], muscles: ['hips', 'shoulders', 'legs'],
    description: 'A slow standing sequence of a wide squat, side reaches and overhead stretches, for mobility.',
    instructions: ['Step into a wide stance with your toes turned out and sink into a wide squat.', 'Keep your knees tracking over your toes.', 'Reach one arm overhead and lean to the side, then switch.', 'Move with your breath: lengthen as you breathe in, settle as you breathe out.'],
    safety: ['Never force a range of motion.', 'Stand near a wall if your balance is unsteady.', 'Stop if a joint hurts sharply.'] },
  { name: 'Seated Forward Fold', clip: 'seated-forward-fold', category: 'mobility', equipment: ['mat'], muscles: ['hamstrings', 'lower back', 'calves'],
    description: 'A seated stretch reaching towards the toes, for the hamstrings and back.',
    instructions: ['Sit tall with your legs straight in front of you.', 'Hinge forward from the hips; do not force it.', 'Keep a slight bend in your knees if your hamstrings are tight.', 'Hold and breathe slowly, then roll back up.'],
    safety: ['Stretch to mild tension, never into pain.', 'Sit on a folded towel if your back rounds a lot.', 'Keep your knees bent if your lower back is sensitive.'] },
  // text only: no clip passed the review for these (or none was ever made)
  { name: 'Kettlebell Swings', clip: null, category: 'strength', equipment: ['kettlebell'], muscles: ['glutes', 'hamstrings', 'back', 'grip'],
    description: 'A hip hinge that swings a kettlebell to chest height, for the glutes, hamstrings and grip.',
    instructions: ['Hinge at the hips with the bell in both hands and a flat back.', 'Snap your hips forward to swing the bell; do not lift it with your arms.', 'Stand fully tall at the top: hips through, glutes squeezed.', 'Let the bell float to chest height, then hinge back as it falls.'],
    safety: ['Learn the hip hinge without weight first.', 'Never let your lower back round; if it does, use a lighter bell.', 'Start light until the technique is steady.'] },
  { name: 'Battle Ropes', clip: null, category: 'conditioning', equipment: ['battle ropes'], muscles: ['shoulders', 'arms', 'core'],
    description: 'Making waves with two heavy ropes, for the shoulders, grip and conditioning.',
    instructions: ['Stand with your feet shoulder-width apart, knees and hips slightly bent.', 'Alternate your arms to make even waves.', 'Keep your wrists neutral.', 'Breathe in rhythm with the waves.'],
    safety: ['Check that the anchor is secure.', 'Use shorter or lighter ropes if your shoulders are sensitive.', 'Stop when your form breaks down.'] },
  { name: 'Bent-Over Row', clip: null, category: 'strength', equipment: ['dumbbells'], muscles: ['upper back', 'lats', 'biceps'],
    description: 'A row from a hip hinge, pulling the dumbbells towards your hips, for the upper back.',
    instructions: ['Hinge to about 45 degrees with a flat back and soft knees.', 'Pull your elbows back past your torso.', 'Squeeze your shoulder blades together at the top.', 'Lower over two to three seconds.'],
    safety: ['Keep your lower back flat throughout.', 'Use lighter dumbbells if you cannot keep a flat back for the whole set.', 'Row one arm at a time from a bench if your lower back tires.'] },
  { name: 'Cable Fly', clip: null, category: 'strength', equipment: ['cable machine'], muscles: ['chest', 'shoulders'],
    description: 'Bringing two cable handles together in an arc in front of the chest.',
    instructions: ['Set both pulleys at chest height and stand between them.', 'Keep a slight bend in your elbows throughout.', 'Bring the handles together in a wide arc, as if hugging a barrel.', 'Return slowly until you feel a stretch across your chest.'],
    safety: ['Pick a load you can control on the way back.', 'Shorten the range if the front of your shoulder hurts.', 'Set the pins before you take the handles.'] },
  { name: 'Deadlift', clip: null, category: 'strength', equipment: ['barbell'], muscles: ['glutes', 'hamstrings', 'back', 'grip'],
    description: 'Lifting a barbell from the floor to standing with a flat back, for the whole back of the body.',
    instructions: ['Stand with the bar over your mid-foot, hinge and grip it just outside your legs.', 'Brace your trunk and take the slack out of the bar.', 'Push the floor away with your legs, keeping the bar close to your shins and thighs.', 'Stand tall, then lower the bar the same way.'],
    safety: ['Never round your lower back under load.', 'Add weight only while your back stays flat.', 'Lower the weight if you feel sharp pain in your back or hips.'] },
  { name: 'Lat Pulldown', clip: null, category: 'strength', equipment: ['cable machine'], muscles: ['lats', 'biceps', 'upper back'],
    description: 'A seated pull of a bar to the upper chest, for the back and arms.',
    instructions: ['Sit with your thighs under the pads and lean back slightly.', 'Draw your shoulder blades down first, then pull your elbows towards your hips.', 'Pull the bar to your upper chest, never behind your neck.', 'Let your arms straighten fully at the top.'],
    safety: ['Never pull the bar behind your neck.', 'Reduce the weight if you swing your body to move it.', 'Adjust the pads so you cannot lift off the seat.'] },
  { name: 'Leg Press', clip: null, category: 'strength', equipment: ['leg press machine'], muscles: ['quadriceps', 'glutes', 'hamstrings'],
    description: 'Pressing a weighted platform away on a machine, for the legs without a load on the spine.',
    instructions: ['Place your feet hip-width apart in the middle of the platform.', 'Lower until your knees are bent to about 90 degrees.', 'Keep your lower back flat against the pad.', 'Press back up through the whole foot.'],
    safety: ['Do not lock your knees out at the top.', 'Engage the safety catches before you get out.', 'Start light until you know the machine’s range.'] },
  { name: 'Heavy Bag', clip: null, category: 'conditioning', equipment: ['heavy bag', 'boxing gloves', 'hand wraps'], muscles: ['shoulders', 'arms', 'core', 'legs'],
    description: 'Punching combinations on a heavy bag, for coordination and conditioning.',
    instructions: ['Turn your hips and pivot your back foot to throw the cross.', 'Keep your chin tucked and your other hand guarding your face.', 'Stay light on the balls of your feet.', 'Breathe out sharply with each punch.'],
    safety: ['Wrap your hands and wear gloves for bag work.', 'Build technique before power.', 'Stop if your wrists ache, and check their alignment.'] },
  { name: 'Treadmill Run', clip: null, category: 'conditioning', equipment: ['treadmill'], muscles: ['legs', 'calves', 'core'],
    description: 'Running on a treadmill at a steady or brisk pace.',
    instructions: ['Land with your foot under your body rather than reaching ahead.', 'Lean slightly forward from the ankles.', 'Keep your shoulders relaxed and your arms swinging forward and back.', 'Stay in the middle of the belt.'],
    safety: ['Clip the safety key to your clothing.', 'Warm up with five minutes of easy walking.', 'Increase your running time gradually from week to week.'] },
  { name: 'Push-Up', clip: null, category: 'strength', equipment: [], muscles: ['chest', 'shoulders', 'triceps', 'core'],
    description: 'Lowering the chest to the floor and pressing back up from a straight plank.',
    instructions: ['Place your hands slightly wider than your shoulders.', 'Hold a straight line from head to heels, with your neck in line with your spine.', 'Lower your chest close to the floor, elbows at about 45 degrees.', 'Press back up to straight arms.'],
    safety: ['Put your hands on a bench if a full push-up is too hard.', 'Do not let your elbows flare out to the sides.', 'Stop if you feel sharp pain at the front of the shoulder.'] },
  { name: 'TRX Row', clip: null, category: 'strength', equipment: ['suspension trainer'], muscles: ['upper back', 'biceps', 'core'],
    description: 'Pulling your body towards suspension straps from a leaning plank, for the back and arms.',
    instructions: ['Hold the handles, walk your feet forward and lean back with straight arms.', 'Keep your body in a straight line.', 'Pull your chest to the handles, elbows close to your sides.', 'Lower slowly with the straps under tension.'],
    safety: ['Check the anchor and the straps before every session.', 'Stand more upright to make it easier.', 'Keep tension in the straps the whole time.'] },
];

/* ---------- the food library: prepared values (PREPARED_SOURCE) ---------- */
type FoodDef = { name: string; serving: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fibre: number; tags: string[] };
const FOODS: FoodDef[] = [
  { name: 'Idli with sambar', serving: '2 idlis with sambar', grams: 200, kcal: 168, protein: 5.8, carbs: 32, fat: 1.2, fibre: 3.5, tags: ['breakfast', 'South Indian', 'vegetarian'] },
  { name: 'Poha', serving: '1 plate', grams: 200, kcal: 220, protein: 4, carbs: 38, fat: 6, fibre: 2.5, tags: ['breakfast', 'vegetarian'] },
  { name: 'Overnight oats', serving: '1 jar', grams: 250, kcal: 310, protein: 12, carbs: 52, fat: 7, fibre: 8, tags: ['breakfast', 'vegetarian'] },
  { name: 'Plain dosa', serving: '1 dosa', grams: 100, kcal: 181, protein: 4, carbs: 30, fat: 5, fibre: 1.5, tags: ['breakfast', 'South Indian', 'vegetarian'] },
  { name: 'Masala chai', serving: '1 cup (250 ml)', grams: 250, kcal: 120, protein: 4, carbs: 16, fat: 4.5, fibre: 0.5, tags: ['drink', 'vegetarian'] },
  { name: 'Greek yoghurt with berries', serving: '1 cup', grams: 200, kcal: 180, protein: 15, carbs: 18, fat: 4, fibre: 2, tags: ['snack', 'vegetarian'] },
  { name: 'Dal tadka', serving: '1 medium bowl', grams: 250, kcal: 198, protein: 11.2, carbs: 28.4, fat: 4.8, fibre: 7.1, tags: ['lentils', 'vegetarian'] },
  { name: 'Rajma chawal', serving: '1 plate', grams: 300, kcal: 320, protein: 12, carbs: 52, fat: 8, fibre: 14, tags: ['beans', 'rice', 'vegetarian'] },
  { name: 'Curd rice', serving: '1 bowl', grams: 250, kcal: 260, protein: 7, carbs: 40, fat: 8, fibre: 1.5, tags: ['rice', 'South Indian', 'vegetarian'] },
  { name: 'Lemon rice', serving: '1 plate', grams: 200, kcal: 281, protein: 5, carbs: 45, fat: 9, fibre: 2.5, tags: ['rice', 'South Indian', 'vegetarian'] },
  { name: 'Tandoori roti', serving: '1 roti', grams: 35, kcal: 85, protein: 2.8, carbs: 16.5, fat: 0.8, fibre: 2, tags: ['bread', 'vegetarian'] },
  { name: 'Paneer tikka', serving: '6 pieces', grams: 200, kcal: 320, protein: 20, carbs: 8, fat: 24, fibre: 2, tags: ['paneer', 'vegetarian'] },
  { name: 'Palak paneer', serving: '1 bowl', grams: 250, kcal: 285, protein: 16, carbs: 12, fat: 20, fibre: 4.5, tags: ['paneer', 'vegetarian'] },
  { name: 'Chole', serving: '1 bowl', grams: 250, kcal: 296, protein: 12, carbs: 35, fat: 12, fibre: 9, tags: ['chickpeas', 'vegetarian'] },
  { name: 'Kerala fish curry', serving: '1 bowl', grams: 250, kcal: 225, protein: 22, carbs: 8, fat: 12, fibre: 2, tags: ['fish', 'Kerala'] },
  { name: 'Aloo gobi', serving: '1 bowl', grams: 200, kcal: 145, protein: 3.5, carbs: 18, fat: 7, fibre: 5.5, tags: ['vegetables', 'vegetarian'] },
];
/** Plates made of the foods above (one serving each; quantities in servings, so their values add up from the foods'). */
const RECIPES: Array<{ key: string; title: string; summary: string; method: string; tags: string[]; parts: Array<[string, number]> }> = [
  { key: 'idli', title: 'Idli, sambar and chai', summary: 'A South Indian breakfast plate: two idlis with sambar and a cup of masala chai.', method: '<p>Serve the idlis hot with the sambar. Have the chai with it or just after.</p>', tags: ['breakfast', 'South Indian'], parts: [['Idli with sambar', 1], ['Masala chai', 1]] },
  { key: 'poha', title: 'Poha with yoghurt', summary: 'Poha with half a cup of Greek yoghurt and berries on the side.', method: '<p>Serve the poha warm; add the yoghurt and berries on the side.</p>', tags: ['breakfast'], parts: [['Poha', 1], ['Greek yoghurt with berries', 0.5]] },
  { key: 'dal', title: 'Dal tadka, roti and aloo gobi', summary: 'A bowl of dal tadka with two tandoori rotis and a bowl of aloo gobi.', method: '<p>Warm the dal and the aloo gobi; serve with two rotis.</p>', tags: ['lunch', 'North Indian'], parts: [['Dal tadka', 1], ['Tandoori roti', 2], ['Aloo gobi', 1]] },
  { key: 'rajma', title: 'Rajma chawal with aloo gobi', summary: 'A plate of rajma chawal with half a bowl of aloo gobi.', method: '<p>Serve the rajma over the rice with the aloo gobi on the side.</p>', tags: ['lunch', 'North Indian'], parts: [['Rajma chawal', 1], ['Aloo gobi', 0.5]] },
  { key: 'palak', title: 'Palak paneer with roti', summary: 'A bowl of palak paneer with two tandoori rotis.', method: '<p>Warm the palak paneer and serve with two rotis.</p>', tags: ['North Indian', 'paneer'], parts: [['Palak paneer', 1], ['Tandoori roti', 2]] },
  { key: 'tikka', title: 'Paneer tikka with roti', summary: 'Six pieces of paneer tikka with a tandoori roti.', method: '<p>Serve the paneer tikka hot with one roti.</p>', tags: ['North Indian', 'paneer'], parts: [['Paneer tikka', 1], ['Tandoori roti', 1]] },
  { key: 'chole', title: 'Chole with roti', summary: 'A bowl of chole with two tandoori rotis.', method: '<p>Warm the chole and serve with two rotis.</p>', tags: ['North Indian'], parts: [['Chole', 1], ['Tandoori roti', 2]] },
  { key: 'fish', title: 'Kerala fish curry with lemon rice', summary: 'A bowl of Kerala fish curry with a plate of lemon rice.', method: '<p>Serve the fish curry alongside the lemon rice.</p>', tags: ['Kerala', 'fish'], parts: [['Kerala fish curry', 1], ['Lemon rice', 1]] },
];
/** Priya's week (1 is Monday): breakfast, lunch, evening and dinner; a recipe key or a food name. Vegetarian on
 *  weekdays, fish at the weekend, as her nutrition profile says. */
const MEAL_WEEK: Record<number, [string, string, string, string]> = {
  1: ['idli', 'dal', 'Greek yoghurt with berries', 'palak'],
  2: ['Overnight oats', 'rajma', 'Masala chai', 'chole'],
  3: ['poha', 'dal', 'Greek yoghurt with berries', 'tikka'],
  4: ['idli', 'rajma', 'Masala chai', 'palak'],
  5: ['Overnight oats', 'chole', 'Greek yoghurt with berries', 'dal'],
  6: ['Plain dosa', 'fish', 'Masala chai', 'tikka'],
  7: ['poha', 'fish', 'Greek yoghurt with berries', 'Curd rice'],
};

/** A small fixed pseudo-random sequence, so every reset gives the same history. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(step < 1 ? 1 : 0));
const plusDays = (date: string, days: number) => addDays(`${date}T00:00:00.000Z`, days).slice(0, 10);

export async function seedShowcase(base: Ctx, services: Services): Promise<{ member: string; exercises: number; sessionsLogged: number; progressEntries: number; mealLogs: number; reports: number }> {
  const db = base.db;
  const realNow = base.now();
  const today = dateInZone(realNow);
  const user = (email: string) => db.get<{ id: string; role: Role; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE email = ?', [email]);
  const priyaRow = user(SHOWCASE_MEMBER), ashaRow = user(COACH);
  const ownerRow = user('owner@demo.bioptime.test'), adminRow = user('admin@demo.bioptime.test');
  if (!priyaRow || !ashaRow || !ownerRow || !adminRow) throw new Error('showcase: the demo accounts are missing');
  const priya = priyaRow.id, asha = ashaRow.id;
  // a clock at a past moment; never later than the real now (a time later today has not happened yet)
  const clamp = (iso: string) => (iso < realNow ? iso : addMinutes(realNow, -1));
  const as = (u: { id: string; role: Role; email: string; name: string }, when?: string): Ctx => ({ ...base, actor: { id: u.id, role: u.role, email: u.email, name: u.name }, ...(when ? { now: () => clamp(when) } : {}) });
  const member = (when?: string) => as(priyaRow, when), coach = (when?: string) => as(ashaRow, when);
  const owner = as(ownerRow), admin = (when?: string) => as(adminRow, when);
  const at = (date: string, minute: number) => zonedToIso(date, minute);
  const rnd = sequence(0x5eed74);
  const justNow = addMinutes(realNow, -10); // rows the core seed wrote a moment ago are newer than this

  /* ---------- enrolment: Priya joined 100 days ago (moved back from the moment the seed ran) ---------- */
  const shift = (table: string, where: string, params: string[], columns: string[], minutes: number) => {
    const have = new Set(db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name));
    const cols = columns.filter((c) => have.has(c));
    if (cols.length) db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = CASE WHEN ${c} IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '${minutes} minutes') END`).join(', ')} WHERE ${where}`, params);
  };
  const back = -JOINED_DAYS_AGO * 1440;
  const endAtNow = () => db.get<{ end_at: string | null }>('SELECT end_at FROM programmes WHERE member_id = ? ORDER BY start_at LIMIT 1', [priya])?.end_at ?? null;
  const endBefore = endAtNow();
  shift('users', 'id = ?', [priya], ['created_at', 'updated_at', 'email_verified_at'], back - 60);
  shift('member_profiles', 'user_id = ?', [priya], ['created_at', 'updated_at', 'onboarding_completed_at'], back - 30);
  shift('member_consents', 'user_id = ?', [priya], ['at'], back - 30);
  shift('orders', 'member_id = ?', [priya], ['created_at', 'updated_at', 'paid_at', 'activated_at'], back);
  shift('programmes', 'member_id = ?', [priya], ['created_at', 'start_at', 'end_at'], back);
  shift('entitlements', 'member_id = ? AND package_version_id IS NOT NULL', [priya], ['created_at', 'updated_at', 'expires_at'], back);
  shift('entitlement_transactions', "kind = 'grant' AND entitlement_id IN (SELECT id FROM entitlements WHERE member_id = ?)", [priya], ['created_at'], back);
  shift('assignment_requests', 'member_id = ?', [priya], ['created_at', 'resolved_at'], back + 60);
  shift('coach_assignments', 'member_id = ?', [priya], ['created_at', 'effective_at'], back + 24 * 60);
  shift('conversations', 'member_id = ?', [priya], ['created_at'], back + 24 * 60);
  shift('referrals', 'referred_id = ?', [priya], ['created_at', 'updated_at', 'signed_up_at', 'became_paying_at'], back - 60);
  // (her receipt keeps its date: billing documents are immutable, and the billing module issued it when it was switched
  // on, after the payment.) What the core seed told her at the moment it ran, put back where it happened, and read since
  const retime = (title: string, when: string) => db.run('UPDATE notifications SET created_at = ?, read_at = ? WHERE user_id = ? AND title = ?', [when, addMinutes(when, 90), priya, title]);
  for (const [title, minutes] of [['Verify your email', back - 60], ['You are all set', back - 30], ['Payment received', back], ['Meet your coach', back + 24 * 60]] as Array<[string, number]>) retime(title, addMinutes(realNow, minutes));
  // the payment notice named the end date the package had when the seed ran; it ends where it was moved to
  const endAfter = endAtNow();
  if (endBefore && endAfter) db.run("UPDATE notifications SET body = replace(body, ?, ?) WHERE user_id = ? AND category = 'payment' AND title = 'Payment received'", [istDayLabel(endBefore), istDayLabel(endAfter), priya]);
  db.run('UPDATE member_profiles SET wellness_score = ?, wellness_score_label = ? WHERE user_id = ?', [PREPARED_WELLNESS_SCORE, PREPARED_WELLNESS_LABEL, priya]);

  // her coaching plan (published by the core seed with tasks from ten days ago) was published the evening before
  const plan = db.get<{ id: string }>("SELECT id FROM coaching_plans WHERE member_id = ? AND status = 'published' ORDER BY created_at LIMIT 1", [priya]);
  if (plan) {
    const published = at(plusDays(today, -11), 19 * 60);
    db.run('UPDATE coaching_plans SET created_at = ?, updated_at = ? WHERE id = ?', [addMinutes(published, -40), published, plan.id]);
    db.run('UPDATE coaching_plan_versions SET created_at = ?, published_at = ? WHERE plan_id = ?', [addMinutes(published, -40), published, plan.id]);
    retime('Your coaching plan is ready', published);
    // she ticked off most of what was due before today; one evening walk was skipped
    const due = plans.listTasks(owner, priya, { to: plusDays(today, -1) }) as Array<{ id: string; due_at: string; title: string }>;
    const skipped = due.find((t) => t.title.startsWith('Evening walk'))?.id;
    for (const t of due) plans.setTaskStatus(member(at(dateInZone(t.due_at), 20 * 60 + 30)), priya, t.id, t.id === skipped ? 'skipped' : 'done');
  }

  /* ---------- the exercise library and the templates ---------- */
  // a clip is mapped only when the media manifest lists it; without the clips installed every exercise is text only
  const exerciseId: Record<string, string> = {};
  for (const e of EXERCISES) {
    const mediaRef = e.clip && exerciseMedia.has(base, e.clip) ? e.clip : null;
    exerciseId[e.name] = w.createTeamExercise(owner, { name: e.name, description: e.description, instructions: e.instructions.join('\n'), category: e.category, equipment: e.equipment, muscleGroups: e.muscles, safetyNotes: e.safety.join('\n'), mediaRef, status: 'published' }).id;
  }
  type Item = { exercise: string; block: string; sets: number; reps?: string; seconds?: number; rest?: number; load?: string };
  const template = (title: string, description: string, level: string, items: Item[]) => w.createTeamTemplate(owner, { title, description, level, estMinutes: null, status: 'published', items: items.map((i) => ({ exerciseId: exerciseId[i.exercise]!, block: i.block, sets: i.sets, reps: i.reps ?? null, durationSeconds: i.seconds ?? null, restSeconds: i.rest ?? null, loadNote: i.load ?? '' })) }).id;
  const lowerA = template('Lower body A', 'Squats and sled pushes, then lunges and a plank to finish.', 'intermediate', [
    { exercise: 'Barbell Back Squat', block: 'Main', sets: 4, reps: '6', rest: 120, load: 'Add 2.5 kg a week while every rep stays clean' },
    { exercise: 'Sled Push', block: 'Main', sets: 3, reps: '20 m', rest: 120, load: 'Add 5 kg a week while your steps stay short and quick' },
    { exercise: 'Bodyweight Lunge', block: 'Accessory', sets: 3, reps: '10 each side', rest: 60 },
    { exercise: 'Forearm Plank', block: 'Finish', sets: 3, seconds: 45, rest: 45 },
  ]);
  const upperA = template('Upper body A', 'Presses and pull-ups for the upper body, with a rotation to finish.', 'intermediate', [
    { exercise: 'Incline Dumbbell Press', block: 'Main', sets: 4, reps: '8', rest: 90, load: 'Dumbbells you can lower over three seconds' },
    { exercise: 'Pull-Up', block: 'Main', sets: 4, reps: '5', rest: 90, load: 'With a resistance band' },
    { exercise: 'Dumbbell Shoulder Press', block: 'Main', sets: 3, reps: '10', rest: 75 },
    { exercise: 'Russian Twist', block: 'Finish', sets: 3, reps: '16 in total', rest: 45, load: '4 kg ball' },
  ]);
  const conditioning = template('Conditioning and core', 'A rowing warm-up, jump rope, slams and mountain climbers, then a plank.', 'intermediate', [
    { exercise: 'Rowing Machine', block: 'Warm-up', sets: 1, seconds: 600 },
    { exercise: 'Jump Rope', block: 'Main', sets: 4, seconds: 45, rest: 45 },
    { exercise: 'Medicine Ball Slam', block: 'Main', sets: 3, reps: '10', rest: 60, load: '6 kg ball' },
    { exercise: 'Mountain Climber', block: 'Main', sets: 4, seconds: 30, rest: 30 },
    { exercise: 'Forearm Plank', block: 'Finish', sets: 2, seconds: 40, rest: 40 },
  ]);
  const fullBody = template('Full body and core', 'Sled pushes, box jumps, slams and burpees, then core work.', 'intermediate', [
    { exercise: 'Sled Push', block: 'Main', sets: 4, reps: '20 m', rest: 90 },
    { exercise: 'Box Jump', block: 'Main', sets: 3, reps: '5', rest: 60, load: 'A low box; step down every time' },
    { exercise: 'Medicine Ball Slam', block: 'Main', sets: 3, reps: '10', rest: 60, load: '6 kg ball' },
    { exercise: 'Burpee', block: 'Main', sets: 3, reps: '8', rest: 60 },
    { exercise: 'Russian Twist', block: 'Finish', sets: 2, reps: '16 in total', rest: 45, load: '4 kg ball' },
    { exercise: 'Forearm Plank', block: 'Finish', sets: 2, seconds: 45, rest: 45 },
  ]);
  const mobility = template('Mobility and recovery', 'An easy ride, then a standing flow and a seated stretch.', 'all_levels', [
    { exercise: 'Indoor Cycling', block: 'Warm-up', sets: 1, seconds: 900 },
    { exercise: 'Standing Yoga Flow', block: 'Mobility', sets: 2, seconds: 300, rest: 60 },
    { exercise: 'Seated Forward Fold', block: 'Mobility', sets: 3, seconds: 45, rest: 15 },
  ]);

  /* ---------- the workout programme: six weeks from the Monday three weeks before this one ---------- */
  const thisMonday = plusDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const start = plusDays(thisMonday, -21);
  const weeks = (friday: (week: number) => string) => Array.from({ length: 6 }, (_, k) => ({ week: k + 1, focus: k < 2 ? 'Learning the lifts' : k < 4 ? 'Adding load' : 'Consolidating', days: [{ day: 1, templateId: lowerA }, { day: 3, templateId: upperA }, { day: 5, templateId: friday(k + 1) }, { day: 7, templateId: mobility }] }));
  // named apart from her coaching plan ("Strength and sleep", which counts its own weeks from a later start): two
  // programmes of one name showed week 2 and week 4 for the same week (release round, 5 Nov 2026)
  const draft = w.createProgram(coach(at(plusDays(start, -2), 19 * 60)), { memberId: priya, title: 'Six-week training block', summary: 'Four sessions a week: lower body on Monday, upper body on Wednesday, conditioning on Friday and an easy mobility session on Sunday.', structure: { weeks: weeks(() => conditioning) } });
  w.publishProgram(coach(at(plusDays(start, -2), 19 * 60 + 5)), draft.id, start);
  const programId = draft.id;
  const sessionOn = (date: string) => db.get<{ id: string; week: number; day: number; template_id: string }>("SELECT id, week, day, template_id FROM workout_sessions WHERE program_id = ? AND scheduled_date = ? AND status = 'scheduled'", [programId, date]);
  // what she lifted: loads rise 2.5 kg a week on the barbell, reps and holds as prescribed
  const LOAD: Record<string, number[]> = { 'Barbell Back Squat': [40, 42.5, 45, 47.5], 'Incline Dumbbell Press': [10, 11, 12, 12], 'Dumbbell Shoulder Press': [6, 7, 7, 8], 'Medicine Ball Slam': [6, 6, 6, 6], 'Russian Twist': [4, 4, 4, 4], 'Sled Push': [40, 45, 50, 50] };
  const PULL_UPS = [4, 5, 5, 6], PLANK = [40, 45, 50, 50];
  const sets = (sessionId: string, week: number, upTo?: number) => {
    const items = db.all<{ id: string; exercise_name: string; sets: number; reps: string | null; duration_seconds: number | null }>('SELECT id, exercise_name, sets, reps, duration_seconds FROM workout_session_items WHERE session_id = ? ORDER BY sort', [sessionId]).slice(0, upTo);
    return items.flatMap((i) => Array.from({ length: i.sets }, (_, k) => {
      const load = LOAD[i.exercise_name]?.[week - 1] ?? null;
      const reps = i.exercise_name === 'Pull-Up' ? PULL_UPS[week - 1]! : i.reps && !/\bm$/.test(i.reps) ? Number.parseInt(i.reps, 10) || null : null;
      const seconds = i.exercise_name === 'Forearm Plank' ? PLANK[week - 1]! : i.duration_seconds;
      return { itemId: i.id, setNumber: k + 1, repsDone: reps, durationSeconds: seconds ?? null, loadKg: load };
    }));
  };
  const minutesFor: Record<string, [number, number]> = { [lowerA]: [50, 56], [upperA]: [44, 50], [conditioning]: [38, 44], [fullBody]: [40, 46], [mobility]: [30, 34] };
  const NOTES: Record<string, string> = { '1|1': 'First week with the barbell. Squats felt steady.', '2|5': 'Liked the new Friday. Box jumps at the lowest box.', '3|1': 'Squat at 45 kg, all four sets clean.', '3|7': 'Slept badly, kept the ride easy.' };
  let logged = 0;
  const logWeek = (from: string, to: string) => {
    for (let d = from; d <= to && d < today; d = plusDays(d, 1)) {
      const s = sessionOn(d);
      if (!s) continue;
      const when = at(d, 18 * 60 + 30), done = addMinutes(when, 55);
      const key = `${s.week}|${s.day}`;
      if (key === '3|3') { w.skipSession(member(when), priya, s.id, 'Travelling for work.'); logged++; continue; }
      const [lo, hi] = minutesFor[s.template_id] ?? [40, 50];
      const partial = key === '2|7';
      w.completeSession(member(done), priya, s.id, { sets: partial ? sets(s.id, s.week, 1) : sets(s.id, s.week), rpe: partial ? 5 : 6 + Math.floor(rnd() * 3), durationMinutes: partial ? 18 : lo + Math.floor(rnd() * (hi - lo + 1)), note: partial ? 'Short on time: rode the bike only.' : NOTES[key] });
      plans.addProgress(member(done), { memberId: priya, metric: 'workout_minutes', value: db.get<{ m: number }>('SELECT duration_minutes m FROM workout_sessions WHERE id = ?', [s.id])!.m, at: done, source: 'member' });
      logged++;
    }
  };
  logWeek(start, plusDays(start, 7)); // week 1 and the Monday of week 2
  // version 2, on the Tuesday of week 2: Friday becomes full body and core from week 2 on (week 1's Friday was logged)
  w.updateProgramDraft(coach(at(plusDays(start, 8), 20 * 60)), programId, { summary: 'Four sessions a week: lower body on Monday, upper body on Wednesday, full body and core on Friday (from week 2) and an easy mobility session on Sunday.', structure: { weeks: weeks((week) => (week === 1 ? conditioning : fullBody)) } });
  w.publishProgram(coach(at(plusDays(start, 8), 20 * 60 + 5)), programId);
  logWeek(plusDays(start, 8), plusDays(today, -1));
  // two replies from Asha, the morning after
  for (const [date, body] of [[plusDays(start, 11), 'The new Friday suits you. Keep stepping down from the box, and keep the slams crisp rather than fast.'], [plusDays(start, 15), 'Squat at 45 kg with clean reps: well done. Same plan next week.']] as Array<[string, string]>) {
    const s = db.get<{ id: string }>("SELECT id FROM workout_sessions WHERE program_id = ? AND scheduled_date = ? AND status != 'scheduled'", [programId, date]);
    if (s) w.giveFeedback(coach(at(plusDays(date, 1), 8 * 60)), s.id, body);
  }

  /* ---------- goals (set six weeks ago), then 60 days of her own measurements ---------- */
  const goalsSet = at(plusDays(today, -45), 20 * 60);
  const sleepGoal = progress.createGoal(coach(goalsSet), priya, { title: 'Sleep 7.5 hours on most nights', metric: 'sleep_hours', baselineValue: 6.4, targetValue: 7.5 }, 'coach');
  progress.addMilestone(coach(goalsSet), priya, sleepGoal.id, { title: 'Seven hours', targetValue: 7 }, 'coach');
  const weightGoal = progress.createGoal(member(addMinutes(goalsSet, 10)), priya, { title: 'Weight to 62 kg', metric: 'weight_kg', baselineValue: 64.6, targetValue: 62 }, 'member');
  progress.addMilestone(member(addMinutes(goalsSet, 11)), priya, weightGoal.id, { title: '64 kg', targetValue: 64 }, 'member');
  progress.addMilestone(member(addMinutes(goalsSet, 12)), priya, weightGoal.id, { title: '63 kg', targetValue: 63 }, 'member');
  // daily targets: no starting value, so they never count as reached on one good day
  progress.createGoal(coach(addMinutes(goalsSet, 20)), priya, { title: 'Walk 9,000 steps a day', metric: 'steps', targetValue: 9000 }, 'coach');
  progress.createGoal(member(addMinutes(goalsSet, 30)), priya, { title: 'Drink 2 litres of water a day', metric: 'water_ml', targetValue: 2000 }, 'member');

  let entries = 0;
  const DAYS = 60;
  // a measurement at a time that has come (today's morning readings wait for the morning)
  const measure = (metric: string, value: number, date: string, minute: number) => {
    const when = at(date, minute);
    if (when >= realNow) return;
    plans.addProgress(member(when), { memberId: priya, metric, value, at: when, source: 'member' });
    entries++;
  };
  for (let ago = DAYS; ago >= 0; ago--) {
    const date = plusDays(today, -ago), t = (DAYS - ago) / DAYS; // 0 sixty days ago, 1 today
    const isToday = ago === 0;
    // sleep, logged each morning: from about 6.2 hours towards 7.3, never a night of 7.5 yet
    if (ago < DAYS) measure('sleep_hours', Math.min(7.4, round(6.2 + 1.0 * t + (rnd() - 0.5) * 0.6, 0.1)), date, 7 * 60 + 10);
    if (!isToday) {
      // steps from this phone and water she typed, each a day's total
      plans.putDailyTotal(member(at(date, 23 * 60)), { memberId: priya, metric: 'steps', date, value: Math.round(4800 + 4200 * t + rnd() * 2200), source: 'device', provider: 'phone' }, { seed: true });
      plans.putDailyTotal(member(at(date, 22 * 60)), { memberId: priya, metric: 'water_ml', date, value: round(1250 + 750 * t + rnd() * 500, 50), source: 'member' }, { seed: true });
      entries += 2;
    }
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 6) measure('weight_kg', round(64.8 - 1.6 * t + (rnd() - 0.5) * 0.1, 0.1), date, 7 * 60 + 30);
    if (weekday === 6 && Math.floor(ago / 7) % 2 === 0) measure('waist_cm', round(79 - 2.5 * t, 0.5), date, 7 * 60 + 35);
    if (weekday === 2 || weekday === 5) measure('resting_hr_bpm', Math.round(64 - 6 * t + (rnd() - 0.5) * 2), date, 7 * 60 + 5);
    if (weekday === 0 && ago > 0) {
      measure('energy_1_5', Math.min(5, Math.round(2.6 + 1.8 * t + (rnd() - 0.5))), date, 21 * 60);
      measure('wellbeing_1_5', Math.min(5, Math.round(3 + 1.5 * t + (rnd() - 0.5))), date, 21 * 60 + 1);
    }
    // a value logged today may reach a milestone: told on the evening it happened
    progress.evaluateGoals(member(at(date, 22 * 60 + 30)), priya);
  }
  // today so far: the phone's count and the water she has typed, in proportion to the hours since 6:00
  const hour = Math.max(0, Math.min(16, (Date.parse(realNow) - Date.parse(at(today, 6 * 60))) / 3_600_000));
  if (hour >= 1) {
    plans.putDailyTotal(member(), { memberId: priya, metric: 'steps', date: today, value: Math.round(560 * hour), source: 'device', provider: 'phone' }, { seed: true });
    plans.putDailyTotal(member(), { memberId: priya, metric: 'water_ml', date: today, value: round(125 * hour, 250) || 250, source: 'member' }, { seed: true });
    entries += 2;
  }

  /* ---------- habits: three weeks of check-ins, each on its evening ---------- */
  const habitStart = plusDays(today, -23);
  const habit = (by: 'coach' | 'member', input: habits.HabitInput, pattern: Array<'done' | 'skipped' | null>) => {
    const who = by === 'coach' ? { role: 'coach' as const, id: asha } : { role: 'member' as const, id: priya };
    const h = habits.createHabit(by === 'coach' ? coach(at(habitStart, 19 * 60)) : member(at(habitStart, 20 * 60)), priya, who, { ...input, startDate: habitStart }, { seed: true });
    // pattern[0] is the oldest day; null leaves the day without a check-in
    pattern.forEach((status, k) => {
      const date = plusDays(today, -(pattern.length - k));
      if (!status) return;
      try { habits.checkIn(member(at(date, 21 * 60 + 30)), priya, h.id, { date, status }); }
      catch (e) { if ((e as { details?: { code?: string } }).details?.code !== 'HABIT_NOT_DUE') throw e; } // a weekday habit on a weekend
    });
  };
  const run = (oldest: number, ...parts: Array<[number, 'done' | 'skipped' | null]>) => { const out: Array<'done' | 'skipped' | null> = []; for (const [count, status] of parts) for (let i = 0; i < count; i++) out.push(status); return out.slice(-oldest); };
  // twelve nights, one late night, then nine in a row up to yesterday (a current streak of nine, the best twelve)
  habit('coach', { title: 'Lights out by 22:30', detail: 'Screens away and lights out by 22:30.', kind: 'sleep', schedule: { type: 'daily' } }, run(22, [12, 'done'], [1, 'skipped'], [9, 'done']));
  habit('member', { title: '10-minute walk after dinner', detail: 'A short walk after dinner.', kind: 'movement', schedule: { type: 'daily' }, targetLabel: '10 minutes' }, run(22, [5, 'done'], [1, null], [6, 'done'], [1, 'skipped'], [4, 'done'], [1, null], [4, 'done']));
  habit('coach', { title: 'Protein at breakfast', detail: 'Include a source of protein with breakfast.', kind: 'nutrition', schedule: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] } }, run(22, [22, 'done']));
  habit('member', { title: 'Stretch before bed', detail: 'Five minutes of gentle stretching.', kind: 'recovery', schedule: { type: 'times_per_week', timesPerWeek: 4 } }, run(22, [2, 'done'], [1, null], [2, 'done'], [2, null], [3, 'done'], [1, null], [2, 'done'], [1, null], [3, 'done'], [2, null], [3, 'done']));

  /* ---------- weekly check-ins: two answered and replied to, one waiting this week ---------- */
  const checkinTemplate = db.get<{ id: string }>("SELECT id FROM checkin_templates WHERE scope = 'library' AND status = 'published' ORDER BY created_at LIMIT 1");
  if (checkinTemplate) {
    const replies: Array<[number, Record<string, unknown>, string]> = [
      [15, { energy: 3, sleep: 6.9, plan: true, notes: 'Squats are going well. Still waking up around 3 am some nights.' }, 'Good week. Keep lights out by 22:30 and the walk after dinner; we look at sleep again next week.'],
      [8, { energy: 4, sleep: 7.1, plan: true, notes: 'One late night for work, otherwise on track.' }, 'Sleep is moving the right way. Keep the routine on work nights too.'],
    ];
    for (const [daysAgo, answers, reply] of replies) {
      const asked = at(plusDays(today, -daysAgo - 1), 9 * 60);
      const c = progress.requestCheckin(coach(asked), asha, priya, { templateId: checkinTemplate.id, dueDate: plusDays(today, -daysAgo) });
      progress.submitCheckin(member(at(plusDays(today, -daysAgo), 21 * 60)), priya, c.id, answers);
      progress.reviewCheckin(coach(at(plusDays(today, -daysAgo + 1), 8 * 60 + 30)), asha, c.id, { response: reply });
    }
    progress.requestCheckin(coach(at(plusDays(today, -1), 9 * 60)), asha, priya, { templateId: checkinTemplate.id, dueDate: plusDays(today, 1) });
  }

  /* ---------- nutrition: the library, her published meal plan, two weeks of logs ---------- */
  const team = { kind: 'team' as const };
  const reason = 'initial data: prepared values for the preview';
  const foodId: Record<string, string> = {};
  for (const f of FOODS) foodId[f.name] = n.createFood(admin(), { name: f.name, servingLabel: f.serving, servingGrams: f.grams, kcal: f.kcal, proteinG: f.protein, carbsG: f.carbs, fatG: f.fat, fibreG: f.fibre, sourceRef: PREPARED_SOURCE, tags: f.tags }, { source: 'team', status: 'published' }, reason).id;
  const recipeId: Record<string, string> = {};
  for (const r of RECIPES) recipeId[r.key] = n.createRecipe(admin(), team, { title: r.title, summary: r.summary, method: r.method, servings: 1, tags: r.tags, ingredients: r.parts.map(([food, q]) => ({ foodId: foodId[food]!, label: food, quantity: q, unit: q === 1 ? 'serving' : 'servings' })) }, { source: 'team', status: 'published' }, reason).id;
  const SLOTS = ['breakfast', 'lunch', 'evening', 'dinner'] as const;
  const slotRef = (ref: string) => (recipeId[ref] ? { recipeId: recipeId[ref] } : { foodId: foodId[ref]! });
  const planWritten = at(plusDays(today, -21), 18 * 60);
  const mealPlan = n.createMealPlan(coach(planWritten), { coachId: asha, memberId: priya, title: 'Vegetarian weekdays, fish at the weekend', summary: 'Four meals a day built from home-cooked dishes. Swap freely within the same meal; tell me what you swapped.', targets: { kcal: 1400, protein_g: 65, carbs_g: 175, fat_g: 45 },
    slots: Object.entries(MEAL_WEEK).flatMap(([day, refs]) => refs.map((ref, k) => ({ day: Number(day), slot: SLOTS[k]!, timeHint: ['Morning', 'Midday', 'Around 5 pm', 'Evening'][k]!, ...slotRef(ref) }))) });
  n.publishMealPlan(coach(addMinutes(planWritten, 20)), mealPlan.id);
  n.setProfile(member(at(plusDays(today, -30), 20 * 60)), priya, { dietPattern: 'Vegetarian on weekdays; fish at the weekend', restrictions: [], cuisines: ['South Indian', 'Kerala', 'North Indian'], mealsPerDay: 4, notes: 'Cooks at home on weekdays.' });
  const planSlots = db.all<{ id: string; day: number; slot: string }>("SELECT s.id, s.day, s.slot FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id WHERE v.plan_id = ? AND v.status = 'published'", [mealPlan.id]);
  const SLOT_TIME: Record<string, number> = { breakfast: 9 * 60, lunch: 14 * 60, evening: 17 * 60 + 30, dinner: 21 * 60 };
  let mealLogs = 0;
  let feedbackOn: string | null = null;
  for (let ago = 14; ago >= 0; ago--) {
    const date = plusDays(today, -ago), day = n.planDayOf(date);
    for (const slot of SLOTS) {
      if (ago === 0 && slot !== 'breakfast') continue; // today: breakfast so far
      const s = planSlots.find((p) => p.day === day && p.slot === slot);
      if (!s) continue;
      const ctxAt = member(at(date, SLOT_TIME[slot]!));
      // two swaps on fixed days (one with a dish from the library, which her coach answers), then the usual days
      if (slot === 'lunch' && ago === 6) { const l = n.logMeal(ctxAt, priya, { date, slotId: s.id, outcome: 'swapped', foodId: foodId['Lemon rice'], portion: 1 }); feedbackOn = l.id; mealLogs++; continue; }
      if (slot === 'dinner' && ago === 9) { n.logMeal(ctxAt, priya, { date, slotId: s.id, outcome: 'swapped', description: 'Dinner at a friend’s wedding' }); mealLogs++; continue; }
      const roll = rnd();
      if (roll < 0.1 && ago > 0) continue; // a meal she did not log
      if (slot === 'evening' && roll > 0.88) { n.logMeal(ctxAt, priya, { date, slotId: s.id, outcome: 'skipped', description: 'Skipped: a late meeting' }); mealLogs++; continue; }
      n.logMeal(ctxAt, priya, { date, slotId: s.id, outcome: 'as_planned' });
      mealLogs++;
    }
    if (ago > 0 && ago % 4 === 1) { n.logMeal(member(at(date, 11 * 60)), priya, { date, slot: 'mid_morning', outcome: 'extra', foodId: foodId['Masala chai'], portion: 1 }); mealLogs++; }
  }
  if (feedbackOn) n.feedbackOnLog(coach(at(plusDays(today, -5), 8 * 60)), asha, feedbackOn, 'Lemon rice instead of the dal plate is fine now and then. Add a bowl of curd for protein when you do.');
  for (const [kind, id] of [['recipe', recipeId.fish], ['recipe', recipeId.idli], ['food', foodId['Greek yoghurt with berries']], ['food', foodId['Overnight oats']]] as Array<['food' | 'recipe', string]>) n.setFavourite(member(at(plusDays(today, -10), 21 * 60)), priya, { kind, id, saved: true });

  /* ---------- the laboratory: a baseline full checkup, a second one twenty days ago, a lipid retest to come ---------- */
  const standin = services.standin;
  let reports = 0;
  if (standin) {
    const tests = db.all<{ id: string; vendor_test_id: string }>('SELECT id, vendor_test_id FROM bloodwork_tests');
    const testId = (v: string) => tests.find((t) => t.vendor_test_id === v)!.id;
    const profile = db.get<{ pincode: string; city: string; state: string; address: string }>('SELECT pincode, city, state, address FROM member_profiles WHERE user_id = ?', [priya])!;
    // the timeline of a booking, in the order the laboratory reports it
    const timeline = (bookingId: string, booked: string, slot: string) => {
      // the booking's own notices named the slot it was booked for; they name the visit it is moved to
      const bookedFor = db.get<{ slot_at: string }>('SELECT slot_at FROM bloodwork_bookings WHERE id = ?', [bookingId])!.slot_at;
      db.run("UPDATE notifications SET body = replace(body, ?, ?) WHERE json_extract(data, '$.bookingId') = ?", [istDayLabel(bookedFor), istDayLabel(slot), bookingId]);
      const stamp: Record<string, string> = { '': booked, PENDING: addMinutes(booked, 1), CREATED: addMinutes(booked, 2), PHLEBO_ASSIGNED: addMinutes(slot, -12 * 60), PHLEBO_NO_SHOW: addMinutes(slot, 75), SAMPLE_COLLECTED: addMinutes(slot, 10), SAMPLE_PROCESSED: addMinutes(slot, 6 * 60), REPORT_DELIVERED: addMinutes(slot, 20 * 60) };
      for (const e of db.all<{ id: string; vendor_status: string | null; to_status: string }>('SELECT id, vendor_status, to_status FROM booking_events WHERE booking_id = ? ORDER BY rowid', [bookingId])) {
        const when = e.vendor_status ? stamp[e.vendor_status] : e.to_status === 'confirmed' ? booked : null;
        if (when) db.run('UPDATE booking_events SET at = ? WHERE id = ?', [when, e.id]);
      }
      const STATUS_AT: Record<string, string> = { '': booked, confirmed: booked, scheduled: stamp.PHLEBO_ASSIGNED!, sample_collected: stamp.SAMPLE_COLLECTED!, processing: stamp.SAMPLE_PROCESSED!, results_ready: stamp.REPORT_DELIVERED! };
      for (const x of db.all<{ id: string; status: string | null; title: string }>("SELECT id, json_extract(data, '$.status') AS status, title FROM notifications WHERE json_extract(data, '$.bookingId') = ?", [bookingId])) {
        const when = x.title === 'A new visit is needed' ? stamp.PHLEBO_NO_SHOW! : STATUS_AT[x.status ?? ''];
        if (when) db.run('UPDATE notifications SET created_at = ? WHERE id = ?', [when, x.id]);
      }
      db.run('UPDATE bloodwork_bookings SET slot_at = ?, created_at = ?, updated_at = ?, last_vendor_event_at = ? WHERE id = ?', [slot, booked, stamp.REPORT_DELIVERED!, stamp.REPORT_DELIVERED!, bookingId]);
      db.run('UPDATE report_metadata SET delivered_at = ?, created_at = ? WHERE booking_id = ?', [stamp.REPORT_DELIVERED!, stamp.REPORT_DELIVERED!, bookingId]);
      return stamp.REPORT_DELIVERED!;
    };
    const fullCheckup = async (vendorTest: string, daysAgo: number, note: string, flagged: string[]) => {
      const b = await bloodwork.book(member(), standin, { memberId: priya, testId: testId(vendorTest), slotAt: at(plusDays(today, 3), 7 * 60 + 30), pincode: profile.pincode, address: profile.address, city: profile.city, state: profile.state });
      await processPending(base);
      const order = bloodwork.getBooking(base, b.id).vendorOrderId!;
      for (let k = 0; k < 5; k++) await standin.step(order);
      await processPending(base);
      const slot = at(plusDays(today, -daysAgo), 7 * 60 + 30);
      const delivered = timeline(b.id, addDays(slot, -4), slot);
      const report = db.get<{ id: string }>('SELECT id FROM report_metadata WHERE booking_id = ?', [b.id])!;
      const reviewed = addMinutes(delivered, 13 * 60);
      bloodwork.reviewReport(coach(reviewed), report.id, { coachNote: note, flagged });
      // the review's own event and notices carry the review's time
      db.run('UPDATE booking_events SET at = ? WHERE booking_id = ? AND at >= ?', [reviewed, b.id, realNow]);
      db.run("UPDATE notifications SET created_at = ? WHERE json_extract(data, '$.bookingId') = ? AND created_at >= ?", [reviewed, b.id, realNow]);
      reports++;
      return report.id;
    };
    const first = await fullCheckup('LS-FBA', JOINED_DAYS_AGO - 5, 'Your baseline. Vitamin D is below the laboratory’s range and LDL cholesterol is above it; both are common and worth raising with your doctor. Everything else is in range. We start with strength training, an evening walk and a regular bedtime, and test again in about three months.', ['Vitamin D (25-OH) 18 ng/mL (low)', 'LDL cholesterol 128 mg/dL (high)']);
    // the stand-in gives every order the same practice values: the baseline's own, still inside its ranges and flags
    for (const [key, value, flag] of [['VITD', '18', 'low'], ['LDL', '128', 'high'], ['CHOL', '198', null], ['TRIG', '118', null], ['HDL', '44', null], ['HBA1C', '5.6', null], ['GLU', '97', null], ['HB', '12.9', null]] as Array<[string, string, string | null]>) {
      db.run('UPDATE report_values SET value = ?, flag = ? WHERE report_id = ? AND vendor_test_id = ?', [value, flag, first, key]);
    }
    // the package holds two tests; after the baseline report the team added two, agreed with her coach (a second full
    // checkup and a lipid retest), so one of the package's own is still hers to book
    entitlements.adjust(admin(at(plusDays(today, -26), 10 * 60)), { memberId: priya, serviceType: 'bloodwork', delta: 2, reason: 'initial data: two retests agreed with the coach after the baseline report', idempotencyKey: 'showcase-retests' });
    const second = await fullCheckup('LS-FBE', 20, 'Vitamin D is up from 18 to 24 and LDL down from 128 to 112: both moving the right way, both still outside the laboratory’s range. Keep the routine; a lipid profile in a few weeks shows where LDL settles. Raise vitamin D with your doctor if you have not yet.', ['Vitamin D (25-OH) 24 ng/mL (low)', 'LDL cholesterol 112 mg/dL (high)']);

    // the lipid profile the core seed booked: the phlebotomist did not come two days ago; the team arranged a new visit
    // for next week (eight days out, so its preparation reminder is not due within the reminder tests' fixed dates)
    const lipid = db.get<{ id: string; slot_at: string }>("SELECT b.id, b.slot_at FROM bloodwork_bookings b JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.member_id = ? AND t.vendor_test_id = 'LS-LIPID' ORDER BY b.created_at LIMIT 1", [priya]);
    if (lipid) {
      const missed = at(plusDays(today, -2), 7 * 60 + 30);
      timeline(lipid.id, at(plusDays(today, -12), 20 * 60), missed);
      db.run('UPDATE bloodwork_bookings SET updated_at = ?, last_vendor_event_at = ? WHERE id = ?', [addMinutes(missed, 75), addMinutes(missed, 75), lipid.id]);
      const rebooked = at(plusDays(today, -1), 11 * 60);
      await bloodwork.reschedule(admin(rebooked), standin, lipid.id, at(plusDays(today, 8), 7 * 60 + 30));
      const task = db.get<{ id: string }>("SELECT id FROM support_tasks WHERE kind = 'collection_rebook' AND ref_id = ? AND status IN ('open','in_progress')", [lipid.id]);
      if (task) updateTask(admin(rebooked), task.id, { status: 'resolved', resolution: 'New visit arranged with the member' });
      db.run("UPDATE support_tasks SET created_at = ? WHERE kind = 'collection_rebook' AND ref_id = ?", [addMinutes(missed, 75), lipid.id]);
      await processPending(base);
      // next steps from the second report
      const apt = db.get<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled') ORDER BY start_at LIMIT 1", [priya]);
      const steps = coach(at(plusDays(today, -19), 9 * 60));
      const retest = labFollowups.createFollowUp(steps, second, { kind: 'retest', note: 'A lipid profile in about four weeks, to see where LDL settles.' }, { as: 'coach', notifyMember: false, seed: true });
      labFollowups.updateFollowUp(coach(at(plusDays(today, -12), 20 * 60 + 30)), retest.id, { bookingId: lipid.id }, { as: 'coach' }); // linked once booked
      labFollowups.createFollowUp(steps, second, { kind: 'consultation', note: 'We go through both reports together at your next consultation.', appointmentId: apt?.id ?? null }, { as: 'coach', notifyMember: false, seed: true });
      if (plan) {
        const change = labFollowups.createFollowUp(steps, second, { kind: 'plan_change', note: 'Two fish meals a week are in your meal plan now.', planId: plan.id }, { as: 'coach', notifyMember: false, seed: true });
        labFollowups.updateFollowUp(coach(at(plusDays(today, -18), 9 * 60)), change.id, { status: 'done' }, { as: 'coach' });
      }
    }
  }

  /* ---------- her coach: recommendations, the conversation, a consultation with its summary ---------- */
  const recommend = (when: string, body: string) => {
    // the same row, audit and notification as POST /coach/clients/:id/notes with visibility client
    const c = coach(when), noteId = randomId('cnt');
    db.insert('coach_notes', { id: noteId, coach_id: asha, member_id: priya, kind: 'note', visibility: 'client', author_role: 'coach', body, ref_type: null, ref_id: null, created_at: c.now() });
    audit(c, 'coach.note', { type: 'user', id: priya }, null, { noteId, kind: 'note', visibility: 'client' });
    notify(c, { userId: priya, category: 'message', title: 'A note from your coach', body: 'Your coach left you a recommendation. Read it under Recommendations.', data: { noteId } });
  };
  recommend(at(plusDays(today, -40), 19 * 60), 'Keep a water bottle on your desk and refill it at lunch and at 4 pm.');
  recommend(at(plusDays(today, -19), 19 * 60), 'Two fish meals at the weekend help with the LDL your report shows. Kerala fish curry counts.');
  recommend(at(plusDays(today, -4), 19 * 60), 'On the nights you work late, keep the walk after dinner short rather than skipping it.');

  const conversation = messaging.conversationForMember(base, priya);
  if (conversation) {
    const thread: Array<[number, number, 'member' | 'coach', string]> = [
      [9, 20 * 60, 'member', 'Travelling for work Wednesday and Thursday next week. Can I move the upper body session?'],
      [9, 21 * 60 + 10, 'coach', 'Skip it this once and keep Friday as it is. Walk where you can while you are away.'],
      [6, 13 * 60 + 30, 'member', 'Had lemon rice at lunch today instead of the dal plate. Is that all right?'],
      [5, 8 * 60, 'coach', 'Fine now and then. I left a note on the meal.'],
      [3, 19 * 60 + 40, 'member', 'Squats at 47.5 kg tonight, all sets clean.'],
      [3, 21 * 60, 'coach', 'Excellent. If Monday feels as good, we try 50 kg next week.'],
      [1, 18 * 60, 'member', 'The lab team called: my lipid test is moved to next week.'],
      [0, 8 * 60 + 15, 'coach', 'Thanks. Remember the 12-hour fast before it; water is fine. See you at the consultation.'],
    ];
    for (const [daysAgo, minute, from, body] of thread) {
      const when = at(plusDays(today, -daysAgo), minute);
      const ctxAt = from === 'member' ? member(when) : coach(when);
      messaging.send(ctxAt, conversation.id, body);
      // the other side reads it within the hour, except Asha's latest, which waits for Priya
      if (daysAgo > 0) messaging.markRead(from === 'member' ? coach(addMinutes(when, 40)) : member(addMinutes(when, 50)), conversation.id);
    }
  }

  // a consultation two weeks ago: booked by Asha, completed, with a summary for Priya
  const consultAt = at(plusDays(today, -14), 17 * 60);
  const consult = appointments.book(coach(addDays(consultAt, -3)), { memberId: priya, coachId: asha, startAt: consultAt, kind: 'consultation', byCoach: true, note: 'Booked by your coach' });
  appointments.complete(coach(addMinutes(consultAt, 35)), consult.id, 'Went through the first weeks of the programme and the sleep goal.');
  sessions.writeSummary(coach(addMinutes(consultAt, 90)), consult.id, {
    forMember: 'We looked at your first weeks of training and your sleep. The squat is moving well; we keep adding 2.5 kg a week while every rep is clean. For sleep, keep lights out by 22:30 and the walk after dinner, and we check again in two weeks.',
    privateNote: 'Motivated; travels for work about once a month. Ask about sleep on travel weeks.',
  });

  /* ---------- Learn (her referral code is made when she first opens Refer a friend) ---------- */
  // Asha assigned the introduction to Learn (in the learning module's seed) a week before she read two lessons
  const assigned = -8 * 1440;
  shift('course_enrollments', 'member_id = ?', [priya], ['enrolled_at', 'assigned_at', 'updated_at'], assigned);
  db.run("UPDATE notifications SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, ? || ' minutes') WHERE user_id = ? AND category = 'learning' AND created_at > ?", [String(assigned), priya, justNow]);
  const lessons = db.all<{ id: string }>("SELECT l.id FROM lessons l JOIN course_modules m ON m.id = l.module_id JOIN course_enrollments e ON e.course_id = m.course_id WHERE e.member_id = ? AND l.status = 'published' ORDER BY m.sort, l.sort LIMIT 2", [priya]);
  lessons.forEach((l, k) => courses.completeLesson(member(at(plusDays(today, -6 + k * 2), 21 * 60)), l.id));

  // the consultation the core seed booked for next week was booked three days ago
  for (const a of db.all<{ id: string }>("SELECT id FROM appointments WHERE member_id = ? AND status = 'scheduled' AND start_at > ? AND created_at > ?", [priya, realNow, justNow])) {
    shift('appointments', 'id = ?', [a.id], ['created_at', 'updated_at'], -3 * 1440);
    db.run("UPDATE notifications SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-4320 minutes') WHERE json_extract(data, '$.appointmentId') = ? AND created_at > ?", [a.id, justNow]);
  }

  /* ---------- what she has read: everything older than two days ---------- */
  await processPending(base);
  db.run("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+2 hours') WHERE user_id = ? AND read_at IS NULL AND created_at < ?", [priya, addDays(realNow, -2)]);

  return { member: SHOWCASE_MEMBER, exercises: EXERCISES.length, sessionsLogged: logged, progressEntries: entries, mealLogs, reports };
}
