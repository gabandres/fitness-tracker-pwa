/**
 * One-off seed script: populates `dailyLogs` with 14 days of realistic data
 * so the Dashboard shows a real TDEE estimate instead of the seed fallback.
 *
 * Safe to re-run (it just appends more entries). Uses the Firebase Web SDK,
 * same as the app — no admin credentials required.
 *
 * Usage:
 *   node scripts/seed.mjs
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';

const firebaseConfig = {
  projectId: 'fitness-tracker-gb-1775407101',
  appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
  storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
  apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
  authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
  messagingSenderId: '647810616435',
};

// 14 days of data modeling a gentle ~1.5 lb/week cut.
// Tuned so the calculator produces a realistic trueTdee and a new target
// above the 1500 safety floor.
//   Week 1 avg weight: 184.8 lbs  (oldest 7 days)
//   Week 2 avg weight: 183.2 lbs  (most recent 7 days)
//   Weight change:    1.6 lbs lost
//   Daily deficit achieved: (1.6 * 3500) / 7 = 800 kcal
//   Avg daily intake: 1850 kcal
//   True TDEE:        2650 kcal
//   New daily target: 1900 kcal
const seedData = [
  { daysAgo: 13, weight: 185.2, calories: 1850 },
  { daysAgo: 12, weight: 185.0, calories: 1800 },
  { daysAgo: 11, weight: 184.8, calories: 1900 },
  { daysAgo: 10, weight: 184.9, calories: 1850 },
  { daysAgo: 9,  weight: 184.7, calories: 1750 },
  { daysAgo: 8,  weight: 184.5, calories: 1950 },
  { daysAgo: 7,  weight: 184.5, calories: 1850 },
  { daysAgo: 6,  weight: 183.6, calories: 1800 },
  { daysAgo: 5,  weight: 183.4, calories: 1900 },
  { daysAgo: 4,  weight: 183.3, calories: 1850 },
  { daysAgo: 3,  weight: 183.1, calories: 1850 },
  { daysAgo: 2,  weight: 183.0, calories: 1800 },
  { daysAgo: 1,  weight: 183.0, calories: 1850 },
  { daysAgo: 0,  weight: 183.0, calories: 1900 },
];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const logs = collection(db, 'dailyLogs');

console.log(`Seeding ${seedData.length} daily log entries...`);

for (const entry of seedData) {
  const date = new Date();
  date.setDate(date.getDate() - entry.daysAgo);
  date.setHours(7, 0, 0, 0); // 7am morning weigh-in

  await addDoc(logs, {
    weight: entry.weight,
    calories: entry.calories,
    timestamp: Timestamp.fromDate(date),
  });
  console.log(`  day -${String(entry.daysAgo).padStart(2, ' ')}  ${entry.weight} lbs  ${entry.calories} cal  @  ${date.toISOString()}`);
}

console.log('Done.');
process.exit(0);
