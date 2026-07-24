# Health Active-Energy Semantics — Can Imported Active Energy Feed a TDEE Estimate?

Primary-source research for the wayfinder question: **is imported `activeEnergy` trustworthy as an input to a TDEE estimate?** Scope is HealthKit (iOS) and Health Connect (Android) as consumed by `apps/mobile/src/lib/health.ts`, `apps/mobile/src/lib/health-sync.ts`, and `packages/core/src/health-mapping.ts`.

Every claim below cites the source that owns it. Where a primary source does not settle a question it is marked **Apple/Google does not document this** rather than inferred. A separate **Inference** label marks conclusions this note draws from documented facts.

_Last updated: 2026-07-23. No production activity data exists yet — the importer has never run on a device._

---

## Bottom line

- **No self-inflicted feedback loop from our workout writes.** Neither OS synthesizes active-energy from a saved workout. Apple states the app must add those samples itself ([HKWorkout](https://developer.apple.com/documentation/healthkit/hkworkout)); Ignia never does, and on Android `ExerciseSession` and `ActiveCaloriesBurned` are unrelated record types ([ExerciseSessionRecord](https://developer.android.com/reference/androidx/health/connect/client/records/ExerciseSessionRecord)). **Verdict: the loop we feared does not exist.** Caveat: the `sourceRevision` question is moot *because* no samples are created, not because dedup would catch them.
- **Semantics are clean and explicit on both platforms.** Active energy excludes resting/basal on iOS ("should not include the resting energy burned") and on Android ("excluding basal metabolic rate (BMR)"). So active energy is a *component* of TDEE, never TDEE itself.
- **The current read path double-counts across sources. This is the real bug.** Both platforms document that raw sample/record reads return every source's data unmerged, and that the *statistics/aggregate* API is the one that merges. Ignia uses the raw read on both platforms and naively sums. An iPhone + Apple Watch user, or anyone running Strava/Fitbit alongside, gets an inflated daily total. **Verdict: must change before trusting the number.**
- **"Measured BMR + measured active" is not available on a stock phone.** Android's own docs call BMR an estimate "based on their height and weight." Apple does not document what produces `basalEnergyBurned` or whether an iPhone alone produces it at all. **Verdict: a measured-BMR TDEE is not achievable; don't design for it.**
- **Two additional v14 API-shape bugs found in `health.ts`** (date filter silently ignored; `saveWorkoutSample` called with an obsolete positional signature). Both are independent of the TDEE question and both are pre-existing in unshipped-to-device code. See §4.

---

## 1. The feedback loop — does saving a workout create active-energy samples?

### iOS — No. HealthKit does not synthesize them; the app must add them.

Apple's `HKWorkout` discussion is explicit that the workout is a *container* and that associated samples are the developer's responsibility:

> "The workout records a summary of information about a single physical activity (for example, the duration, total distance, and total energy burned). It also acts as a container for other `HKSample` objects."

> "After saving the workout to the HealthKit store, you must associate additional samples with the workout (for example, active energy burned or distance samples). These samples provide fine-grained details. Use the `HKHealthStore/add(_:to:completion:)` method to associate them with the workout."

> "If a workout has summary information, it also needs a set of associated samples that add up to the summary's total."

— [HKWorkout](https://developer.apple.com/documentation/healthkit/hkworkout)

The same division is restated on the energy property itself:

> "Provide a total energy burned value whenever the active calories burned is relevant to the workout type. In addition, add active energy burned samples to a workout using the `add(_:to:completion:)` method. These samples should sum up to the total energy, while providing detailed information about how the intensity changes over the duration of the workout."

— [HKWorkout.totalEnergyBurned](https://developer.apple.com/documentation/healthkit/hkworkout/totalenergyburned) (deprecated iOS 18; Apple directs callers to `statistics(for:)` with the `activeEnergyBurned` quantity type — i.e. the workout's energy figure is *read back out of* its associated samples)

Automatic collection exists but is a distinct, opt-in, live-session mechanism, not something a plain save triggers: `HKLiveWorkoutDataSource` is "a data source that automatically provides live data from an active workout session," and collection must be turned on per quantity type via `enableCollection(for:predicate:)` ([HKLiveWorkoutDataSource](https://developer.apple.com/documentation/healthkit/hkliveworkoutdatasource)). Ignia uses neither `HKLiveWorkoutDataSource` nor `HKWorkoutBuilder`.

Corroboration from Apple's forums — a developer saved a workout with `totalEnergyBurned` set and found the energy did **not** reach the Fitness/Activity rings until they explicitly created and added an `activeEnergyBurned` `HKQuantitySample`. Apple's DTS reply recommended `HKWorkoutBuilder` "which will do the association and save for you" ([Apple Developer Forums thread 725572](https://developer.apple.com/forums/thread/725572)). This is a forum post, not normative documentation, but it is consistent with the reference docs above.

**Does the Health *app* display a workout's energy without underlying samples?** The forum poster above reports the calorie number *is* "recorded in the Health app" from the workout summary alone while the rings ignore it. **Apple does not document** whether a summary-only workout surfaces in the Active Energy data browser, and therefore does not document what `sourceRevision.source.bundleIdentifier` such a synthesized sample would carry. This is unresolved in principle — but see the applicability note below.

**Applies to Ignia:** the current `writeWorkout` passes no energy value at all (it passes a duration quantity). Even the deprecated `HKWorkout` save path does not create energy samples on its own per the docs above. **Inference:** Ignia's iOS workout export cannot feed back into the ActiveEnergyBurned read. The `bundleIdentifier` provenance question is moot for us because there is nothing to provenance.

One genuine HealthKit-side transformation does exist, but it is not synthesis. HealthKit *condenses and coalesces* first-party workout data — including active energy — into quantity-series samples for workouts "at least a few months old":

> "HealthKit combines data that's consecutive in time and has the same value for rate over time. When combining quantities, the framework replaces the data with a new total that spans the combined timespan, with a value is the sum of the original quantities."

> "The condensing and coalescing processes preserve all the data from the original workout."

— [Accessing condensed workout samples](https://developer.apple.com/documentation/healthkit/accessing-condensed-workout-samples)

Totals are preserved, so a per-day sum is unaffected. Apple does **not** document what `sourceRevision` a condensed series sample carries relative to its originals.

### Android — No. `ExerciseSession` and `ActiveCaloriesBurned` are independent record types.

`ExerciseSessionRecord`'s full class documentation is:

> "Captures any exercise a user does. This can be common fitness exercise like running or different sports. Each record needs a start time and end time. Records don't need to be back-to-back or directly after each other, there can be gaps in between."

— [ExerciseSessionRecord](https://developer.android.com/reference/androidx/health/connect/client/records/ExerciseSessionRecord) ([AndroidX source](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/ExerciseSessionRecord.kt))

There is no mention of calories, energy derivation, or any relationship to `ActiveCaloriesBurnedRecord`. They carry separate permissions (`READ_EXERCISE` vs. `READ_ACTIVE_CALORIES_BURNED`) and separate aggregate metrics ([Health Connect data types](https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types)).

`ACTIVE_CALORIES_TOTAL` is a plain sum over the stored `energy` field of `ActiveCaloriesBurnedRecord` — `AggregateMetric.doubleMetric(dataTypeName = TYPE_NAME, aggregationType = TOTAL, fieldName = ENERGY_FIELD_NAME, mapper = Energy::kilocalories)` ([AndroidX source](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/ActiveCaloriesBurnedRecord.kt)). It has no input other than records of that one type.

**Does `readRecords` ever return derived records?** Google's architecture page describes the Health Connect APK as an on-device store providing "CRUD operations on record and data synchronization," with aggregation applied by clients over data written by apps ([Health Connect architecture](https://developer.android.com/health-and-fitness/guides/health-connect/plan/architecture)). Google **does not** publish an explicit statement of the form "Health Connect never fabricates records." **Inference (well-supported but not quoted):** `readRecords` returns stored records only. Note that a *third-party* app on the device (Google Fit, Samsung Health, Fitbit) may itself write `ActiveCaloriesBurned` derived from a session it observed — that is an app behavior, not a Health Connect behavior, and it is exactly the double-counting risk in §2.

**Applies to Ignia:** our `insertRecords([{recordType:'ExerciseSession', …}])` writes no energy field and cannot round-trip into `ActiveCaloriesBurned`.

---

## 2. Semantics and exclusions

### Active energy excludes resting energy — both platforms, explicitly.

**iOS.** `HKQuantityTypeIdentifier.activeEnergyBurned`:

> "Active energy is the energy that the user has burned due to physical activity and exercise. **These samples should not include the resting energy burned during the sample's duration.** Use the health store's `splitTotalEnergy(_:start:end:resultsHandler:)` method to split a workout's total energy burned into the active and resting portions, and then save each portion in its own sample. The system automatically records active energy samples on Apple Watch."

> "Active energy samples use energy units (described in `HKUnit`) and measure cumulative values (described in `HKQuantityAggregationStyle`)."

— [activeEnergyBurned](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)

Note the last sentence of the first quote: Apple states the *Apple Watch* is what automatically records these. Apple does not make an equivalent statement for iPhone-only devices.

**Android.** `ActiveCaloriesBurnedRecord`:

> "Captures the estimated active energy burned by the user (in kilocalories), **excluding basal metabolic rate (BMR)**. Each record represents the total kilocalories burned over a time interval, so both the start and end times should be set."

— [ActiveCaloriesBurnedRecord](https://developer.android.com/reference/androidx/health/connect/client/records/ActiveCaloriesBurnedRecord) ([source](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/ActiveCaloriesBurnedRecord.kt))

Google also names the word "estimated" in its own definition.

**Google's stated relationship between the two calorie types.** `TotalCaloriesBurnedRecord`:

> "Total energy burned by the user (in kilocalories), **including active & basal energy burned (BMR)**. Each record represents the total kilocalories burned over a time interval."

— [TotalCaloriesBurnedRecord](https://developer.android.com/reference/androidx/health/connect/client/records/TotalCaloriesBurnedRecord) ([source](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/TotalCaloriesBurnedRecord.kt))

So Google defines `Total = Active + Basal`. **Google does not document** that Health Connect enforces or verifies this identity across records written by different apps.

**Consequence for TDEE:** on both platforms, active energy is by definition only the activity component. Adding it to a TDEE that already contains an activity multiplier double-counts — which the existing memory note about activity import already flags. Nothing found here changes that; the docs *confirm* it.

### Multiple sources — raw reads do NOT deduplicate. This is where the current code is wrong.

**iOS.** `HKSampleQuery` is documented as "a general query that returns a snapshot of **all** the matching samples currently saved in the HealthKit store," filtered only "by the provided type and predicate." Its documentation contains **no** mention of deduplication or source merging ([HKSampleQuery](https://developer.apple.com/documentation/healthkit/hksamplequery)).

The statistics APIs are where merging lives. `HKStatisticsCollectionQuery`'s `options` property is documented as:

> "A list of options that define the type of statistical calculations performed and **the way in which data from multiple sources are merged**."

— [HKStatisticsCollectionQuery](https://developer.apple.com/documentation/healthkit/hkstatisticscollectionquery)

`HKStatisticsOptions.separateBySource` is "an option indicating that the system calculates the specified statistics separately for each source," and it may be combined with `cumulativeSum` ([HKStatisticsOptions](https://developer.apple.com/documentation/healthkit/hkstatisticsoptions)). The default — *without* `separateBySource` — is therefore a single merged figure.

Apple's reference docs do not spell out the merge algorithm. Apple DTS does, on the forums:

> "The HealthKit store contains the data from all sources (`sourceRevision`). An Apple Watch, an iPhone, and also any app running on the devices can write Health data to the HealthKit store. **If you simply fetch the samples and add them together, yes, the result may be significantly larger than expected because of the duplicate data.** HealthKit provides APIs to address the issue – If you use `HKStatisticsQuery` to retrieve the steps in a period of time, the result should have been de-duplicated, and should be the same as the one shown in system-provided Health.app."

— DTS Engineer, [Apple Developer Forums thread 759709](https://developer.apple.com/forums/thread/759709)

That is a forum statement from Apple, not documentation. It describes exactly Ignia's current failure mode.

**Does Apple document the Health app's "Data Sources & Access" priority order as affecting queries?** Apple's user-facing support article states the ordering and that it is user-reorderable:

> "By default, Health prioritizes data in this order: Health data that you enter manually, data from your iPhone, iPad, and Apple Watch, and data from apps and Bluetooth devices."

— [Manage Health data on your iPhone, iPad, or Apple Watch](https://support.apple.com/en-us/108779)

**Apple does not document** whether this user-set priority order influences the results a third-party app receives from `HKStatisticsQuery`/`HKStatisticsCollectionQuery`, or whether it governs Health-app display only. Treat this as unsettled.

**Android.** Google is unusually direct here.

> **Note:** For cumulative types like `StepsRecord`, use `aggregate()` instead of `readRecords()` to avoid double counting from multiple sources and improve accuracy.

> "The aggregation API also contains logic to handle duplicate records, and lessens the chances of rate limiting."

— [Read raw data](https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data)

And on what actually gets deduped:

> "When you perform an aggregate read, the Aggregate API accounts for any duplicate data and keeps only the data from the app with the **highest priority**. Duplicate data could exist if the user has multiple apps writing the same kind of data—such as the number of steps taken or the distance covered—at the same time."

> "**Only the Activity and Sleep data types are deduped by Health Connect**, and the data totals shown are the values after the dedupe has been performed by the Aggregate API."

> "For other types of data, the aggregated results combine all data of the type in Health Connect from all apps which wrote the data."

— [Read aggregated data](https://developer.android.com/health-and-fitness/guides/health-connect/develop/aggregate-data)

`ActiveCaloriesBurned` and `Steps` are both in the **Activity** category ([data types](https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types)), so both fall inside the deduped set — **but only via `aggregate()`**. `readRecords()` does not dedupe, and Ignia uses `readRecords()` + a manual sum for both.

**Verdict for §2:** Ignia's current implementation matches the documented double-counting anti-pattern on both platforms, for both `steps` and `activeEnergy`.

---

## 3. Is measured basal energy separately importable?

### iOS — `basalEnergyBurned` exists, but Apple does not document its provenance.

> "Resting energy is the energy that the user's body burns to maintain its normal, resting state. The body uses this energy to perform basic functions like breathing, circulating blood, and managing the growth and maintenance of cells. These samples use energy units (described in `HKUnit`) and measure cumulative values."

— [basalEnergyBurned](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/basalenergyburned)

That is the entire discussion. Note what it does **not** say:

- **Apple does not document what produces basal energy samples.** There is no equivalent of the active-energy doc's "The system automatically records active energy samples on Apple Watch."
- **Apple does not document whether an iPhone alone writes basal energy**, or whether an Apple Watch is required.
- **Apple does not document whether basal energy is measured or computed**, nor any formula or its inputs (height/weight/age/sex).

Apple Support community threads assert that resting energy is computed from the Health profile, but discussions.apple.com is user-generated content, not a primary source, and is not cited here as evidence. Treat all three points as genuinely unanswered.

Related but distinct: `splitTotalEnergy(_:start:end:resultsHandler:)` is referenced from the active-energy doc as the way to split a workout's *total* into active and resting portions ([activeEnergyBurned](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)). **Inference:** HealthKit possesses *some* internal resting-energy model, since it can perform that split. Apple does not describe the model.

### Android — BMR is documented as an estimate from height and weight.

> "Captures the BMR of a user. Each record represents the energy a user would burn if at rest all day, **based on their height and weight**."

— [BasalMetabolicRateRecord](https://developer.android.com/reference/androidx/health/connect/client/records/BasalMetabolicRateRecord) ([source](https://github.com/androidx/androidx/blob/androidx-main/health/connect/connect-client/src/main/java/androidx/health/connect/client/records/BasalMetabolicRateRecord.kt))

This is Google stating in its own type definition that BMR is a **formula output, not a measurement**. The record is an *instantaneous* type with a `Power` unit, and its aggregate is `BASAL_CALORIES_TOTAL` ([data types](https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types)).

**What writes them in practice?** Google **does not document** which apps or system components populate `BasalMetabolicRateRecord` or `TotalCaloriesBurnedRecord`. Given the architecture page's description of Health Connect as a store for data written by client apps ([architecture](https://developer.android.com/health-and-fitness/guides/health-connect/plan/architecture)), **inference:** on a device where no installed app writes them, they will be absent — Health Connect will not compute them. Google does not state this in so many words.

### Plain answer

**"Measured BMR + measured active energy" is not available on a stock phone with no wearable.**

- Android's BMR is explicitly a height/weight estimate — the same class of number Ignia already computes in `packages/core` from the user's profile. Importing it adds no information, only a second opinion.
- Apple gives no documented guarantee that `basalEnergyBurned` exists at all without an Apple Watch, and no documented statement that it is anything other than an estimate.
- Active energy on iOS is documented as automatically recorded **on Apple Watch**; Apple makes no equivalent claim for iPhone-only motion.

**Inference:** any TDEE built on imported energy is "estimate + estimate," with the resting half being a formula Ignia can already evaluate locally and more transparently. This argues for treating imported active energy as a *display/context* metric, or at most a carefully-weighted adjustment, rather than a measurement that supersedes the app's own model.

---

## 4. Wrapper-library verification

This section reads the published sources at the exact installed tags via the GitHub API. Its conclusions were independently cross-checked against the **installed** `.d.ts` files hoisted to the repo-root `node_modules/` (npm workspaces put them there, not under `apps/mobile/`); the two agree except where noted.

### `@kingstinct/react-native-healthkit` v14.0.2

**`sourceRevision` is populated by default — no option required. ✅**

The published `src/types/Shared.ts` declares `readonly sourceRevision: SourceRevision` non-optionally on the base type ([v14.0.2](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/types/Shared.ts)), and there is no opt-in flag in `GenericQueryOptions` gating it ([`src/types/QueryOptions.ts`](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/types/QueryOptions.ts)). **Cross-check discrepancy:** the *installed* `lib/typescript/types/QuantitySample.d.ts:28` and `CategoryType.d.ts:18` both declare it **optional** (`sourceRevision?: SourceRevision`), while `Shared.d.ts:30` has it required. Immaterial here — `health.ts` optional-chains it either way — but it means a sample with no `sourceRevision` would read as *not* ours and be imported, which is the safe direction for our own-write dedup only because we never write the import-only kinds.

**`sourceRevision.source.bundleIdentifier` is the correct v14 access path. ✅**

`SourceRevision { readonly source: SourceProxy; … }` and `SourceProxy extends HybridObject<{ios:'swift'}>, Source` where `Source { readonly name: string; readonly bundleIdentifier: string }` ([`src/types/Source.ts`](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/types/Source.ts), [`src/specs/SourceProxy.nitro.ts`](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/specs/SourceProxy.nitro.ts)). Caveat worth a device check: `SourceProxy` is a **Nitro hybrid object**, not a plain JS object. Property reads cross the JSI bridge per access, and it exposes `toJSON(key?)`. Reading `.bundleIdentifier` once per sample inside a hot loop over a 400-day import is a plausible performance concern; correctness should be fine.

**Bug 1 — the date filter is silently ignored.** `health.ts` passes:

```ts
{ limit: 0, unit: HK_UNIT[kind], filter: { startDate, endDate } }
```

but v14's `FilterForSamples` has no `startDate`/`endDate` keys. Dates live one level deeper:

```ts
interface FilterForSamplesBase {
  readonly uuid?: string
  readonly uuids?: string[]
  readonly metadata?: PredicateWithMetadataKey
  readonly date?: DateFilter          // ← { startDate?, endDate?, strictStartDate?, strictEndDate? }
  readonly workout?: WorkoutProxy
  sources?: SourceProxy[]
}
```

Combined with `limit: 0` — documented as "specify -1, 0 or any non-positive number for fetching **all** samples" — the iOS reader appears to fetch the user's **entire** HealthKit history for each of five kinds on every foreground. The `as never` casts in `health.ts` suppress the type error that would otherwise catch this. Correct shape: `filter: { date: { startDate, endDate } }`.

**Bug 2 — `saveWorkoutSample` is called with an obsolete positional signature.** v14.0.2 declares ([`src/specs/WorkoutsModule.nitro.ts`](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/specs/WorkoutsModule.nitro.ts)):

```ts
saveWorkoutSample(
  workoutActivityType: WorkoutActivityType,
  quantities: readonly QuantitySampleForSaving[],
  startDate: Date,
  endDate: Date,
  totals?: WorkoutTotals,       // { distance?: number; energyBurned?: number }
  metadata?: AnyMap,
): Promise<WorkoutProxy>
```

`health.ts` calls it as `(type, {quantity, unit}, undefined, undefined, start, end)` — i.e. a bare object where an array is expected, `undefined` for both required `Date` arguments, and the real dates landing in the `totals`/`metadata` slots. This is masked by the deliberate `as unknown as (...a: unknown[]) => Promise<unknown>` cast. **Not device-verified**, but by the published signature the iOS workout export cannot be saving correctly.

**Relevant good news:** the module already exposes the statistics APIs needed for the §2 fix — `queryStatisticsForQuantity`, `queryStatisticsCollectionForQuantity`, and the `…SeparateBySource` variants ([`src/specs/QuantityTypeModule.nitro.ts`](https://github.com/kingstinct/react-native-healthkit/blob/master/packages/react-native-healthkit/src/specs/QuantityTypeModule.nitro.ts)). No library change or fork is required to switch iOS activity reads onto a deduplicating path.

### `react-native-health-connect` v3.5.3

**`metadata.dataOrigin` is a plain string (the package name). ✅**

```ts
export interface Metadata {
  id?: string;
  // package name of the app that created the record
  dataOrigin?: string;
  // ISO 8601 date time string
  lastModifiedTime?: string;
  clientRecordId?: string;
  clientRecordVersion?: number;
  device?: Device;
  recordingMethod?: RecordingMethod;
}
```

— [`src/types/metadata.types.ts` @ v3.5.3](https://github.com/matinzd/react-native-health-connect/blob/v3.5.3/src/types/metadata.types.ts)

It is a flat optional `string`, not a `{ packageName }` object, so `r.metadata?.dataOrigin === APP_ID` in `health.ts` is the correct comparison. The optional-chaining is warranted since the field is optional in the type.

Also present and potentially useful: `recordingMethod` (`RECORDING_METHOD_AUTOMATICALLY_RECORDED` / `_ACTIVELY_RECORDED` / `_MANUAL_ENTRY`) — a documented way to distinguish passively-tracked activity from manually-entered numbers, should the TDEE model want to weight them differently.

---

## 5. Open / unsettled

Ordered by how much they matter to the TDEE decision.

1. **How much does the double-count actually inflate a real day's total?** Documented as a real risk on both platforms, but the magnitude depends entirely on the user's device mix. *Settled by:* a dev build on a device with an Apple Watch paired — read the same day via `queryQuantitySamples` + manual sum, then via `queryStatisticsForQuantity([cumulativeSum])`, then compare both to the Health app's Active Energy figure. On Android, the same comparison between `readRecords` + sum and `aggregate(ACTIVE_CALORIES_TOTAL)`.
2. **Does the Health app's user-set "Data Sources & Access" priority affect third-party statistics queries, or only Health-app display?** Apple does not document this. *Settled by:* on a device with two active sources, reorder the sources in Health, re-run `queryStatisticsForQuantity`, and check whether the returned figure changes.
3. **Does a summary-only third-party workout surface as an ActiveEnergyBurned sample in the Health data browser, and under whose `bundleIdentifier`?** Apple does not document this. Currently moot for Ignia (we write no workout energy), but it becomes load-bearing the moment anyone adds `totals.energyBurned` to `writeWorkout`. *Settled by:* save a workout with `totals: { energyBurned: N }`, then query `activeEnergyBurned` for that window and inspect `sourceRevision.source.bundleIdentifier` on anything returned.
4. **Does an iPhone with no Apple Watch produce `basalEnergyBurned` samples at all, and what source writes them?** Apple does not document this. *Settled by:* query `basalEnergyBurned` on a watch-less iPhone and inspect the returned samples' `sourceRevision`.
5. **What writes `BasalMetabolicRateRecord` / `TotalCaloriesBurnedRecord` on a stock Android device?** Google does not document this. *Settled by:* `readRecords('BasalMetabolicRate')` on a clean device and inspect `metadata.dataOrigin`.
6. **Does HealthKit's condensing/coalescing alter `sourceRevision` on the resulting series samples?** Apple does not document this. Low impact — totals are documented as preserved, and our dedup only needs to catch *our own* writes, which we never associate with workouts. *Settled by:* inspect `activeEnergyBurned` samples older than a few months on a device with historical first-party workouts.
7. **Do the two v14 API-shape bugs in §4 actually fail at runtime, and how?** Both are inferred from published type signatures with the errors cast away; neither has ever run on a device. *Settled by:* an EAS dev build exercising import once and workout export once, with logging.

Every item above requires an EAS dev build on a physical device. None can be settled from documentation, and none can be settled from production data, which does not exist yet.
