/**
 * The owner's live Push / Pull / Leg templates and the catalog rows they use,
 * read out of Firestore on 2026-10-11 (`users/…/workoutTemplates`,
 * `users/…/exercises`) — not invented. Only the fields the superset code
 * reads are kept. `createdAt`/`updatedAt` are fixed stand-ins.
 *
 * {@link OWNER_SUPERSET_LAYOUTS} is the superset version the owner specified
 * on 2026-10-11, and it is the SAME object `scripts/owner-data-2026-10-11.mts`
 * writes as drafts — so the parity test pins exactly what the script creates.
 */
import type { MuscleGroup, TemplateExercise, WorkoutTemplate } from '../workout';
import type { DraftLayout } from '../superset-context';
import type { EngineCatalogFields } from '../progression-engine';

const AT = new Date('2026-10-11T00:00:00Z');

const TEMPLATES = [
  {
    "id": "Nx1bxeRuH6bMnGgX7Trv",
    "name": "Push Day",
    "restMiniSec": 10,
    "restClusterSec": 90,
    "cardioBlocks": [
      {
        "modality": "walk",
        "label": "Zone 2",
        "targetDurationSec": 1200
      }
    ],
    "exercises": [
      {
        "exerciseId": "ud6fE363QklE3qXYxLw3",
        "name": "DB Flat Press",
        "targetLoad": 25,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "activation"
          },
          {
            "group": 2,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "ngF9959fQPGTYUHXpigC",
        "name": "Incline Dumbbell Press",
        "targetLoad": 20,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "activation"
          },
          {
            "group": 2,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "He4o7qVWRftiPneaXjiV",
        "name": "Seated DB Shoulder Press",
        "targetLoad": 70,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "baseline": {
          "since": "2026-10-09",
          "reason": "position changed 10/9",
          "dropBackTo": 60,
          "dropBackBelowReps": 5
        },
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "Zqb1sTIfs0olSLeDFlx1",
        "name": "Deficit Push-up",
        "targetLoad": 0,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "AAHHWXTA7UtbNWZbcf7z",
        "name": "Overhead DB Extension",
        "targetLoad": 30,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "EyDTWnfO4WrbYDbDkxrk",
        "name": "Skull Crusher",
        "targetLoad": 15,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "BGyAEJU6i5nN6AjXRU1g",
        "name": "DB Lateral Raise",
        "targetLoad": 15,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "kind": "drop",
            "weight": 10
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      }
    ]
  },
  {
    "id": "aliWJBD2FND6mU9foLdC",
    "name": "Pull Day",
    "restMiniSec": 10,
    "restClusterSec": 90,
    "cardioBlocks": [
      {
        "modality": "run",
        "label": "Zone 2",
        "targetDurationSec": 1200
      }
    ],
    "exercises": [
      {
        "exerciseId": "9x3b6rmxlxJyWWSMat3w",
        "name": "Seated Machine Row",
        "targetLoad": 100,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 12,
          "holdSessions": 2,
          "incrementLb": 5
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "kind": "mini",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          },
          {
            "group": 2,
            "kind": "activation"
          },
          {
            "group": 2,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "GOGOcWJNC9q9aBmN3ENq",
        "name": "Neutral-grip pull-up",
        "targetLoad": 0,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 12,
          "holdSessions": 2,
          "incrementLb": 2.5
        },
        "plannedSets": [
          {
            "kind": "activation",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "oxOuktVhb6Ghgg7hGkCk",
        "name": "Wide-grip lat pulldown",
        "targetLoad": 90,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 12,
          "holdSessions": 2,
          "incrementLb": 5
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "kind": "mini",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "loadLog": [
          {
            "at": "2026-10-07T16:24:55.228Z",
            "from": 80,
            "to": 90,
            "by": "user",
            "reason": "Owner-confirmed load for the next session (2026-10-07)"
          }
        ],
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "acs1BlQvTZdL97i5jXJv",
        "name": "Chest-supported DB row",
        "targetLoad": 35,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 12,
          "holdSessions": 2,
          "incrementLb": 5
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "kind": "mini",
            "group": 1
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "v2uqmVt1K4fJd0d6t4De",
        "name": "Rear delt DB flye",
        "targetLoad": 15,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 15,
          "holdSessions": 2,
          "incrementLb": 2.5
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "kind": "mini",
            "group": 1
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "MVC1wLKBkRz7XYyKp79e",
        "name": "Incline DB Curl 45°",
        "targetLoad": 15,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 12,
          "holdSessions": 2,
          "incrementLb": 2.5
        },
        "plannedSets": [
          {
            "kind": "activation",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "loadLog": [
          {
            "at": "2026-10-07T16:24:55.228Z",
            "from": 20,
            "to": 15,
            "by": "user",
            "reason": "Owner-confirmed load for the next session (2026-10-07)"
          }
        ],
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "LvVitCaOS23MmPTKodlk",
        "name": "DB hammer curl",
        "targetLoad": 20,
        "logStyle": "weight-reps",
        "progression": {
          "targetReps": 12,
          "holdSessions": 2,
          "incrementLb": 2.5
        },
        "plannedSets": [
          {
            "kind": "activation",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          },
          {
            "kind": "mini",
            "group": 1
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      }
    ]
  },
  {
    "id": "quxwARQlCnItzpLJgcr4",
    "name": "Leg Day",
    "restMiniSec": 10,
    "restClusterSec": 90,
    "cardioBlocks": [
      {
        "modality": "walk",
        "label": "Zone 2",
        "targetDurationSec": 1200
      }
    ],
    "exercises": [
      {
        "exerciseId": "eKW1qiIDpvfnSECIxSUn",
        "name": "Smith squat",
        "targetLoad": 30,
        "progression": {
          "holdSessions": 2,
          "incrementLb": 5,
          "targetReps": 12
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "activation"
          },
          {
            "group": 2,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "loadLog": [
          {
            "at": "2026-10-07T16:24:55.228Z",
            "from": 15,
            "to": 30,
            "by": "user",
            "reason": "Owner-confirmed load for the next session (2026-10-07)"
          }
        ],
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "vtSvqglnBZdM1f3qOJi4",
        "name": "DB Romanian deadlift",
        "targetLoad": 35,
        "progression": {
          "holdSessions": 2,
          "incrementLb": 5,
          "targetReps": 10
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 60,
        "loadLog": [
          {
            "at": "2026-10-07T16:24:55.228Z",
            "from": 20,
            "to": 35,
            "by": "user",
            "reason": "Owner-confirmed load for the next session (2026-10-07)"
          }
        ],
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "hXvPQM7Dv6YvScYW7h2l",
        "name": "Leg Extensions",
        "targetLoad": 90,
        "progression": {
          "holdSessions": 2,
          "incrementLb": 5,
          "targetReps": 12
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "loadLog": [
          {
            "at": "2026-10-07T16:24:55.228Z",
            "from": 80,
            "to": 90,
            "by": "user",
            "reason": "Owner-confirmed load for the next session (2026-10-07)"
          }
        ],
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "jZWYnikrGcdRG1adHXJ0",
        "name": "Leg Curls",
        "targetLoad": 90,
        "progression": {
          "holdSessions": 2,
          "incrementLb": 5,
          "targetReps": 12
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 60,
        "loadLog": [
          {
            "at": "2026-10-07T16:24:55.228Z",
            "from": 80,
            "to": 90,
            "by": "user",
            "reason": "Owner-confirmed load for the next session (2026-10-07)"
          }
        ],
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "m5E72J63gVXltnQ0zC8f",
        "name": "Single-leg DB calf raise",
        "targetLoad": 25,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation",
            "label": "L"
          },
          {
            "group": 1,
            "kind": "mini",
            "label": "L"
          },
          {
            "group": 1,
            "kind": "mini",
            "label": "L"
          },
          {
            "group": 2,
            "kind": "activation",
            "label": "R"
          },
          {
            "group": 2,
            "kind": "mini",
            "label": "R"
          },
          {
            "group": 2,
            "kind": "mini",
            "label": "R"
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "x3G0Speg04GclIOdKHAl",
        "name": "Weighted Floor Crunch",
        "targetLoad": 30,
        "progression": {
          "holdSessions": 2,
          "incrementLb": 10,
          "targetReps": 12
        },
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "activation"
          },
          {
            "group": 2,
            "kind": "mini"
          },
          {
            "group": 2,
            "kind": "mini"
          }
        ],
        "restAfterSec": 90,
        "restAfterMaxSec": 120,
        "lastModifiedAt": "2026-10-09T02:32:32.120Z",
        "lastModifiedBy": "prompt"
      },
      {
        "exerciseId": "8WVjS3nPucY5nQUC6lHM",
        "name": "Hanging Knee Raise",
        "targetLoad": 0,
        "logStyle": "weight-reps",
        "plannedSets": [
          {
            "group": 1,
            "kind": "activation"
          },
          {
            "group": 1,
            "kind": "mini"
          },
          {
            "group": 1,
            "kind": "mini"
          }
        ],
        "restAfterSec": 60,
        "lastModifiedAt": "2026-10-11T00:05:19.917Z",
        "lastModifiedBy": "prompt"
      }
    ]
  }
] as unknown as Array<Omit<WorkoutTemplate, 'createdAt' | 'updatedAt' | 'exercises'> & { exercises: TemplateExercise[] }>;

export const OWNER_TEMPLATES: WorkoutTemplate[] = TEMPLATES.map((x) => ({ ...x, createdAt: AT, updatedAt: AT }));

export const OWNER_CATALOG: Record<string, EngineCatalogFields & { muscles: MuscleGroup[] }> = {
  "8WVjS3nPucY5nQUC6lHM": {
    "name": "Hanging Knee Raise",
    "muscles": [
      "core"
    ],
    "logStyle": "weight-reps"
  },
  "9x3b6rmxlxJyWWSMat3w": {
    "name": "Seated Machine Row",
    "muscles": [
      "back",
      "biceps"
    ],
    "effortStandard": "failure"
  },
  "AAHHWXTA7UtbNWZbcf7z": {
    "name": "Overhead DB Extension",
    "muscles": [
      "triceps"
    ]
  },
  "BGyAEJU6i5nN6AjXRU1g": {
    "name": "DB Lateral Raise",
    "muscles": [
      "shoulders"
    ]
  },
  "EyDTWnfO4WrbYDbDkxrk": {
    "name": "Skull Crusher",
    "muscles": [
      "triceps"
    ],
    "logStyle": "weight-reps"
  },
  "GOGOcWJNC9q9aBmN3ENq": {
    "name": "Neutral-grip pull-up",
    "muscles": [
      "back",
      "biceps"
    ]
  },
  "He4o7qVWRftiPneaXjiV": {
    "name": "Seated DB Shoulder Press",
    "muscles": [
      "shoulders",
      "triceps"
    ]
  },
  "LvVitCaOS23MmPTKodlk": {
    "name": "DB hammer curl",
    "muscles": [
      "biceps",
      "forearms"
    ]
  },
  "MVC1wLKBkRz7XYyKp79e": {
    "name": "Incline DB Curl 45°",
    "muscles": [
      "biceps"
    ]
  },
  "Zqb1sTIfs0olSLeDFlx1": {
    "name": "Deficit Push-up",
    "muscles": [
      "chest",
      "triceps",
      "shoulders"
    ],
    "logStyle": "weight-reps"
  },
  "acs1BlQvTZdL97i5jXJv": {
    "name": "Chest-supported DB row",
    "muscles": [
      "back",
      "biceps"
    ]
  },
  "eKW1qiIDpvfnSECIxSUn": {
    "name": "Smith squat",
    "muscles": [
      "quads",
      "glutes"
    ],
    "effortStandard": "rir1"
  },
  "hXvPQM7Dv6YvScYW7h2l": {
    "name": "Leg Extensions",
    "muscles": [
      "quads"
    ],
    "availableLoads": [
      70,
      80,
      90
    ]
  },
  "jZWYnikrGcdRG1adHXJ0": {
    "name": "Leg Curls",
    "muscles": [
      "hamstrings"
    ],
    "availableLoads": [
      70,
      80,
      90
    ]
  },
  "m5E72J63gVXltnQ0zC8f": {
    "name": "Single-leg DB calf raise",
    "muscles": [
      "calves"
    ],
    "logStyle": "weight-reps"
  },
  "ngF9959fQPGTYUHXpigC": {
    "name": "Incline Dumbbell Press",
    "muscles": [
      "chest",
      "shoulders"
    ]
  },
  "oxOuktVhb6Ghgg7hGkCk": {
    "name": "Wide-grip lat pulldown",
    "muscles": [
      "back",
      "biceps"
    ]
  },
  "ud6fE363QklE3qXYxLw3": {
    "name": "DB Flat Press",
    "muscles": [
      "chest",
      "triceps"
    ],
    "logStyle": "weight-reps"
  },
  "v2uqmVt1K4fJd0d6t4De": {
    "name": "Rear delt DB flye",
    "muscles": [
      "shoulders",
      "back"
    ]
  },
  "vtSvqglnBZdM1f3qOJi4": {
    "name": "DB Romanian deadlift",
    "muscles": [
      "hamstrings",
      "glutes"
    ]
  },
  "x3G0Speg04GclIOdKHAl": {
    "name": "Weighted Floor Crunch",
    "muscles": [
      "core"
    ],
    "logStyle": "weight-reps"
  }
} as unknown as Record<string, EngineCatalogFields & { muscles: MuscleGroup[] }>;

/**
 * The owner's 2026-10-11 superset drafts.
 *
 * The rest after a superset is the rest-after of its LAST-PERFORMED member.
 * Two of those carry the owner's 10/9 rule (90–120 s into the same muscle,
 * 60 s on a switch) onto the member that now ends the group: the calf raise
 * ends B, which leads into the shoulder press (Incline → Shoulder was
 * 90–120 s), and the lateral raise ends C, which leads into the skull crusher
 * (Overhead extension → Skull crusher was 90–120 s). Every other value is the
 * live row's.
 */
export const OWNER_SUPERSET_LAYOUTS: DraftLayout[] = [
  {
    draftOf: 'Push Day',
    label: 'Push Day — superset draft',
    rows: [
      { exercise: 'DB Flat Press', group: 'A', pairPosition: 1 },
      { exercise: 'Weighted Floor Crunch', from: 'Leg Day', group: 'A', pairPosition: 2 },
      { exercise: 'Incline Dumbbell Press', group: 'B', pairPosition: 1 },
      { exercise: 'Single-leg DB calf raise', from: 'Leg Day', group: 'B', pairPosition: 2, restAfterSec: 90, restAfterMaxSec: 120 },
      { exercise: 'Seated DB Shoulder Press' },
      { exercise: 'Deficit Push-up' },
      { exercise: 'Overhead DB Extension', group: 'C', pairPosition: 1 },
      { exercise: 'DB Lateral Raise', group: 'C', pairPosition: 2, restAfterSec: 90, restAfterMaxSec: 120 },
      { exercise: 'Skull Crusher' },
    ],
  },
  {
    draftOf: 'Pull Day',
    label: 'Pull Day — superset draft',
    rows: [
      { exercise: 'Seated Machine Row' },
      { exercise: 'Neutral-grip pull-up' },
      { exercise: 'Wide-grip lat pulldown' },
      { exercise: 'Chest-supported DB row' },
      { exercise: 'Rear delt DB flye', group: 'A', pairPosition: 1 },
      { exercise: 'Incline DB Curl 45°', group: 'A', pairPosition: 2 },
      { exercise: 'DB hammer curl' },
    ],
  },
  {
    draftOf: 'Leg Day',
    label: 'Leg Day — superset draft',
    rows: [
      { exercise: 'Smith squat' },
      { exercise: 'DB Romanian deadlift' },
      { exercise: 'Leg Extensions', group: 'A', pairPosition: 1 },
      { exercise: 'Leg Curls', group: 'A', pairPosition: 2 },
      { exercise: 'Hanging Knee Raise' },
    ],
  },
];
