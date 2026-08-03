import { onSchedule } from "firebase-functions/v2/scheduler";
import { resendApiKey } from "./resend-client";
import { runDailyReminders, runDayThreeCoachPush } from "./push-reminders";
import { runWeeklyDigest } from "./weekly-digest";
import { runPublishUserCount } from "./ops";
import { runRetentionCohorts } from "./retention";
import { runSpendCeilingWatch } from "./spend-ceiling";
import { db } from "./init";

// ─── Hourly dispatcher ──────────────────────────────────────────────
//
// Consolidates what used to be four separate hourly scheduled
// functions (sendDailyReminders, sendDayThreeCoachPush,
// sendWeeklyDigest, publishUserCount) into ONE Cloud Scheduler job.
// Cloud Scheduler's free tier is 3 jobs/project; folding these four
// into one keeps us within it (this + statusPulse + weeklyFirestoreBackup).
//
// Each task runs independently via allSettled so a failure in one does
// not block the others — same isolation the standalone functions had.
// Config is the union of what the sub-tasks need: the resend secret
// (weekly digest) and the 512MiB / 540s budget the per-user digest
// aggregation requires. The cheaper tasks tolerate that envelope fine.
export const hourlyTasks = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "UTC",
    secrets: [resendApiKey],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const tasks: Array<[string, () => Promise<void>]> = [
      ["publishUserCount", runPublishUserCount],
      ["sendDailyReminders", runDailyReminders],
      ["sendDayThreeCoachPush", runDayThreeCoachPush],
      ["sendWeeklyDigest", runWeeklyDigest],
      // Self-gating: returns immediately except on its one UTC hour a day.
      ["retentionCohorts", () => runRetentionCohorts(db)],
      // A kill-switch with no alarm is a trap: without this, the first sign
      // that an AI feature is serving nobody is a support email — and the
      // daily ceiling silently re-opens at UTC midnight, so the evidence
      // rolls over before anyone looks. Two Firestore reads an hour.
      ["spendCeilingWatch", () => runSpendCeilingWatch(db)],
    ];

    const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`hourlyTasks: ${tasks[i][0]} failed:`, r.reason);
      }
    });
  },
);
