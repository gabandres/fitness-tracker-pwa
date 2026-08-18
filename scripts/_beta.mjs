import { api } from './asc-client.mjs';
const GROUP = '38f9bec1-57a3-49c4-aac8-c94566fab4a0';
const BUILD = 'eb9d61ae-ed1f-438c-8054-d2c7647474db';
const LOC = 'f4238e03-cb58-4a4d-9ad5-14c8abbb92cb';

const notes = [
  'Workout templates in the Train tab got a rebuild.',
  '',
  'A set is now a row that says what to do — weight and reps, under column headers — so a template can prescribe "3 x 8 @ 135" instead of just "three sets". Starting a workout fills those numbers in: grey means it is the plan, tap the tick and it becomes yours. Nothing is logged until you tick it.',
  '',
  'Exercises collapse to one readable line, drag the grip to reorder, and the optional parts (form notes, automatic weight increases) moved under "More options". Clusters read 1a/1b/1c instead of C1, and the RIR column is labelled LEFT.',
  '',
  'Please try building a template and running a workout from it.',
].join('\n');

await api('PATCH', `/v1/betaBuildLocalizations/${LOC}`, {
  data: { type: 'betaBuildLocalizations', id: LOC, attributes: { whatsNew: notes } },
});
console.log('✓ What to Test updated');

await api('POST', `/v1/betaGroups/${GROUP}/relationships/builds`, {
  data: [{ type: 'builds', id: BUILD }],
});
console.log('✓ build 58 added to Public Beta Testers');
