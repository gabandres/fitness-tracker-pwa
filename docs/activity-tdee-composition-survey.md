# How Comparable Products Combine Measured Active Energy With a Basal Estimate

Primary-source research for the wayfinder question (issue #21): **how do comparable products combine *measured* active energy with a basal estimate to produce a daily calorie target?** Six products surveyed — Apple (Move/Activity), Garmin, Fitbit/Google Health, Cronometer, MacroFactor, MyFitnessPal — each classified into one of four composition shapes, plus documented behaviour for partial days and missing days.

Every claim cites the source that owns it. Where a product publishes nothing on a point it is marked **"&lt;Product&gt; does not document this"** rather than inferred. A separate **Inference** label marks conclusions this note draws.

Companion note: `docs/health-active-energy-semantics.md` (what HealthKit / Health Connect actually hand us). This note assumes its conclusions — most importantly that active energy excludes basal on both platforms, and that Ignia's current raw-sample read double-counts across sources.

_Last updated: 2026-07-23. No production activity data exists yet — the importer has never run on a device._

---

## Bottom line

- **Nobody adds measured active energy on top of a `BMR × activity-multiplier` TDEE.** Every product that produces an intake *target* from measured data either (a) corrects the multiplier's own activity allowance, or (b) reconciles the whole day against the tracker's **total** burn. The naive additive shape appears only where the base is a bare BMR with no activity factor — i.e. as a burn *display*, never as a target. **This is the load-bearing finding for Ignia.**
- **MyFitnessPal — the canonical "additive" example — is not actually additive.** It compares the partner's *projected full-day total* burn against MFP's own goal-derived total and pays out only the **difference**. It is a correction to the self-reported activity level, not a sum. MFP says so in its own words.
- **Cronometer is the cleanest additive-with-guard model.** It adds only "Expenditure Above Baseline," and it *decrements* the baseline activity allowance both by imported tracker activity and by time spent exercising — "This ensures you don't double-count calories burned." It is also opt-in and off by default.
- **MacroFactor refuses wearable energy outright** and says so explicitly, on validity grounds. As of Nov 2025 it *does* use **step counts** — but as a trend signal that nudges its energy-balance expenditure estimate, explicitly **not** as a per-day additive adjustment. Its initial (pre-data) estimate is BMR × an activity factor, exactly Ignia's `formula` mode.
- **Fitbit/Google Health has *retired* burn-derived calorie targets.** "Food Plans" are gone; the calorie target is now user-set. Measured burn is display-only against it.
- **Apple never produces an intake target at all.** The Move ring is a goal for *active energy only* — no basal, no food side. Apple ships no daily calorie budget, so the composition question does not arise.
- **Partial days split into two camps.** Products with an intraday-live target (MFP, Cronometer, Fitbit's burn display) let it grow through the day; MFP is the only one that *projects* to a full day. Products with a daily/weekly target (MacroFactor, Garmin's plan, Ignia) sidestep the problem entirely. **Missing days are near-universally "fall back to the formula estimate," never zero.**

---

## 1. Comparison table

| Product | Composition shape | Partial days | Missing days | Double-count guard |
|---|---|---|---|---|
| **Apple** (Move/Activity) | **Display-only** — no intake target exists. Move ring goal is active energy alone, no basal | Ring fills through the day; per-day summary object. Apple does not document a projection or a reset time | Apple does not document this. Rings can be *paused* up to 90 days, which is a streak feature, not a data fallback | N/A — nothing to double-count into |
| **Garmin** (Connect / Connect+ Nutrition) | Base target is **`BMR × activity level`**; recorded activities then **additively** adjust it, opt-in via "Auto Adjust Calorie Goal" | Garmin does not document this | Resting calories keep accruing from the profile even when the device is unworn. Garmin does not document what happens to the *nutrition goal* on unworn days | Garmin does not document one for the nutrition goal. It does separate `Active` from `Activity Calories` (the latter includes resting) in its terminology |
| **Fitbit / Google Health** | **Display-only** as of the redesign — calorie target is user-set. Device burn is `BMR + activity (+ HR)`, shown against it. Legacy "Food Plans" (burn-derived budget) **discontinued** | Burn number "increase[s] throughout the day" from a BMR floor | Fitbit does not document this for the target. BMR component is profile-derived, so it accrues without a device | N/A now that the target is user-set |
| **Cronometer** | **Additive, but only above baseline.** `Energy Target = Baseline Target ± Weight Goal + Expenditure Above Baseline − Consumed`. Opt-in, off by default | Grows through the day as tracker activity and exercise accrue | Baseline Activity persists explicitly so unworn time still gets credit — falls back to `BMR × activity level` | **Yes, explicit.** Tracker activity *replaces* Baseline Activity; exercise *decrements* it pro-rata by duration. "This ensures you don't double-count calories burned" |
| **MacroFactor** | **Measured activity is ignored for energy; steps only *correct* the energy-balance estimate's responsiveness.** Wearable kcal refused outright | N/A — targets are set per-day in advance and revised weekly, never intraday | Algorithm tolerates ~3 missing days per 7 before pausing updates; infers unlogged intake (~13% mean error) | **Yes, by construction** — the target derives from energy balance, which already contains all activity. This is why they refuse wearable kcal |
| **MyFitnessPal** | **Measured activity corrects the self-reported activity level.** Partner's *total* daily burn vs. MFP's own total; only the **delta** is paid out as a "Calorie Adjustment" | **Projected to a full day** from partial data; updates on every sync; "at midnight, your projected sync and actual sync should match" | No adjustment at all — the profile-based goal stands unmodified (a `0` adjustment). Negative adjustments are opt-in and off by default | **Yes, explicit** — manually logged cardio is added into the *MFP* side of the comparison "To prevent double-counting" |

---

## 2. Apple — Move/Activity model

**Shape: display-only. Apple ships no daily calorie intake target, so measured active energy is never composed with a basal estimate for target purposes.**

The Move ring is a goal for active energy *alone*:

> "The red Move ring shows how many active calories you've burned."

> "The green Exercise ring shows how many minutes of brisk activity you've done."

— [Track daily activity with Apple Watch](https://support.apple.com/guide/watch/track-daily-activity-apd3bf6d85a6/watchos)

HealthKit confirms the same structure developer-side. `HKActivitySummary` is:

> "An object that contains the move, exercise, and stand data for a given day."

with

> `var activeEnergyBurnedGoal: HKQuantity` — "The user's daily goal for active energy burned."

— [HKActivitySummary](https://developer.apple.com/documentation/healthkit/hkactivitysummary)

There is no basal quantity and no dietary-energy goal anywhere in the activity summary. `HKActivityMoveMode` exists only to say whether the ring measures active energy or move *time* — "Constants that specify the value measured by the Move ring on the user's device" (same page). And per the companion note, `activeEnergyBurned` samples "should not include the resting energy burned during the sample's duration" ([activeEnergyBurned](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)).

**Goals are set from history, not from a formula:**

> "Your Apple Watch suggests goals based on your previous performance."

— [Adjust your Activity ring goals on Apple Watch](https://support.apple.com/guide/watch/adjust-your-activity-ring-goals-apd29b30023c/watchos)

That is the one genuinely transferable idea here: Apple's *only* use of measured activity to set a number is a **trailing-window recommendation**, presented to the user for approval, not an arithmetic input.

**Partial days.** The summary is scoped "for a given day" and the ring visibly fills as energy accrues. **Apple does not document** a projection, an extrapolation, or the exact reset boundary. Goals can be changed "for Today" only, which implies a day-scoped budget but does not describe partial-day handling.

**Missing days.** **Apple does not document this.** The nearest documented feature is pausing rings "for up to 90 days without breaking your award streak" (same source) — an awards mechanic, not a data-gap fallback.

**Inference:** because Apple has no intake target, its model contributes a *pattern* (goal suggested from trailing measured performance) but no composition arithmetic Ignia can copy.

---

## 3. Garmin

**Shape: `BMR × activity level` for the base target, then an opt-in additive adjustment from recorded activities.**

Garmin's calorie vocabulary is explicit that resting is a profile formula and total is a sum:

> "**Active Calories**: Calories burned through physical activity and movement throughout the day."

> "**Activity Calories**: The total calories burned during an activity recorded with a Garmin device, including both Active Calories and Resting Calories accumulated during the activity."

> "**Resting Calories**: Calories burned to support your body's basic functions, such as breathing, circulation, and cell production. This value is estimated using your Resting Metabolic Rate (RMR), which is calculated from factors such as your age, height, weight, and sex."

> "**Total Calories**: The combined total of your Active Calories and Resting Calories."

— [Learn More About Tracking Calories on Garmin Devices](https://support.garmin.com/en-US/?faq=lkl4cwCLlK7ox362uGQEV7)

Note `Activity Calories` deliberately *includes* resting for the activity window — Garmin maintains two different summing conventions and names them apart. That naming discipline is worth copying; conflating the two is exactly how double-counting starts.

**The target side** lives in the Connect+ Nutrition feature, and Garmin states the composition in one sentence:

> "**How Are Calories and Macros Calculated?** We combine your BMR (resting calories) with your Activity Level to estimate your TDEE (Total Daily Energy Expenditure). Targets are then set based on your specific plan goals."

> "**Will My Calorie Goals Adjust Based on Recorded Activities?** Yes, if enabled. Go to Nutrition > Settings > Toggle Auto Adjust Calorie Goal."

— [Garmin Connect + Nutrition](https://support.garmin.com/en-US/?faq=yve3hAUsxU1IEzbzo91Gt6)

So the base is a self-reported activity multiplier over BMR, and measured activity is layered on top — **opt-in, default state not documented**. Note the trigger is "recorded activities," i.e. logged workouts, not all-day active calories. **Garmin does not document** whether all-day Active Calories (as opposed to discrete recorded activities) move the nutrition goal, nor by how much, nor whether the activity-level allowance is decremented first. Given Garmin's own `TDEE = BMR × Activity Level` statement, **Inference:** an un-decremented addition of recorded-activity calories on top of that TDEE would double-count the activity level's allowance. Garmin publishes no guard against this.

**Partial days.** **Garmin does not document this** for the nutrition goal.

**Missing days.** For *burn*, Garmin documents a formula fallback:

> "Compatible Garmin wearables calculate Resting Calories based on your user profile information, even when the device is not being worn. As the device syncs with Garmin Connect, Resting Calories continue to accumulate throughout the day and appear in your account."

— [Learn More About Tracking Calories on Garmin Devices](https://support.garmin.com/en-US/?faq=lkl4cwCLlK7ox362uGQEV7)

For the *nutrition goal* on an unworn day, **Garmin does not document this**.

One relevant operational note: Garmin Nutrition and MyFitnessPal are mutually exclusive — "You must choose one source" (same Nutrition article). Garmin treats a second calorie-target authority as a conflict, not a merge.

---

## 4. Fitbit / Google Health

**Shape: display-only. The burn number is `BMR + activity`, but the calorie target is now user-set, and burn-derived targets were removed.**

The burn composition is documented plainly:

> "Fitbit devices combine your basal metabolic rate (BMR) and your activity data to estimate your calories burned. Your BMR is the rate at which you burn calories at rest to maintain vital body functions like breathing, blood circulation, and heartbeat. If your device tracks heart rate, your heart-rate data is also included, especially to estimate calories burned during exercise. **The number that appears on your Fitbit device is your total calories burned for the day.**"

> "Your BMR is based on the physical data you entered into your Google Health account like height, weight, sex, and age. It also accounts for at least half the calories you burn in a day. Your body burns calories even if you're asleep there's no activity. Because of this, your device will display your calories burned when you wake up and **notice this number increase throughout the day**."

— [How does my Fitbit device calculate my daily activity?](https://support.google.com/googlehealth/answer/14237111?hl=en)

That is the pure `BMR + active` shape — but it is a **burn display**, not a target. The API mirrors it field-for-field:

> `summary : caloriesBMR` — "Total BMR calories burned for the day."
> `summary : caloriesOut` — "Total calories burned for the day (daily timeseries total)."
> `summary : activityCalories` — "The number of calories burned for the day during periods the user was active above sedentary level. **This includes both activity burned calories and BMR.**"
> `goals : caloriesOut` — "**User defined** goal for daily calories burned."

— [Get Daily Activity Summary](https://dev.fitbit.com/build/reference/web-api/activity/get-daily-activity-summary/)

Two things to take from those definitions. First, the only calorie *goal* in the activity resource is a user-defined **burn** goal, not an intake target. Second, `activityCalories` is a third convention — "above sedentary level," inclusive of BMR — so Fitbit maintains three different calorie sums under three names. Same lesson as Garmin.

**The intake target was deliberately removed.** Fitbit's legacy "Food Plan" produced a calorie budget from estimated burn; the API still documents it:

> "The `calories` value consists of either manual calorie target or the user's calorie goal according to their Food Plan, where the Food Plan is enabled."

— [Get Food Goals](https://dev.fitbit.com/build/reference/web-api/nutrition/get-food-goals/)

But in the current app:

> "Setting calorie targets with \"Food Plans\" will no longer be supported. You can still set a personalized calorie target in the Nutrition section of the Health tab. You can also set targets for macronutrients."

— [What is new with the redesigned Google Health app](https://support.google.com/googlehealth/answer/17068213?hl=en)

And the replacement is manual:

> "The Google Health app provides smart goals based on clinical recommendations that you can adjust in your Nutrition settings on the Health tab. … Adjust the range for your calorie target and then tap **Set goal**."

> "Log your food throughout the day to check your estimated calories eaten against calories burned."

— [Track your nutrition and hydration with the Google Health app](https://support.google.com/googlehealth/answer/14237210?hl=en)

**Verdict:** the vendor with the best measured-burn data in the survey chose to *stop* deriving intake targets from it. That is a data point, not a proof, but it cuts against building the additive shape.

**Partial days.** For the burn number, documented to grow through the day from a BMR floor (quote above). For the target, N/A — it is static and user-set. **Fitbit does not document** whether `caloriesBMR` on a partial day reports the full day's BMR or only elapsed BMR.

**Missing days.** **Fitbit does not document this.** BMR is profile-derived, so **Inference:** it accrues without a worn device; the activity component would simply be absent.

---

## 5. Cronometer

**Shape: additive — but only the portion *above* a formula baseline, with an explicit decrement so the baseline is never counted twice. Opt-in.**

Cronometer decomposes TDEE into named parts:

> "Your TDEE is made up of: **Basal Metabolic Rate** - energy burned at rest. **Activity Level** - energy burned through activities of daily living and exercise. **Tracker Activity** - energy burned from activity (outside of logged workouts) imported from linked devices. **Exercise** - energy burned during workouts logged manually or imported from linked devices. **Thermic Effect of Food** - energy burned from digesting your food."

> "Cronometer calculates your BMR by using the Mifflin St. Jeor Equation."

> Baseline Activity Level options: "Sedentary (BMR x 0.2) … Lightly Active (BMR x 0.375) … Moderately Active (BMR x 0.5) … Very Active (BMR x 0.9)"

— [Energy Expenditure](https://support.cronometer.com/hc/en-us/articles/31974307318420-Energy-Expenditure)

Note the multipliers are expressed as the *activity increment* (`BMR × 0.2`), not the total factor (`BMR × 1.2`). Structurally identical to Ignia's `ACTIVITY_MULTIPLIERS`, but the framing makes the replaceable part explicit.

**The double-count guard, stated twice:**

> "If you are synced with a device that tracks general activity, the Tracker Activity from your device will **gradually replace** your Baseline Activity throughout the day (and will now appear as **Adjusted Baseline Activity** in your Energy Expenditure circle). Exercise (either logged or imported from a device) will also adjust your Baseline Activity based on the time spent exercising. **This ensures you don't double-count calories burned.**"

— [Energy Expenditure](https://support.cronometer.com/hc/en-us/articles/31974307318420-Energy-Expenditure)

> "Exercise (either logged or imported from a device) will also replace your Baseline Activity based on the time spent exercising. For example: Baseline Activity is divided into 16 hours as that's an estimate of how long the average person is awake. If your Baseline Activity = 400 kcals, you're burning approximately 25 kcal/hour from general activity. If you exercise for 1 hour, your Adjusted Baseline Activity = 400 - 25 = 375 kcal."

> "Once your Tracker Activity and Exercise have fully replaced the calories from the Adjusted Baseline Activity, the Adjusted Baseline Activity section will disappear from the Burned circle."

— [Energy Summary](https://support.cronometer.com/hc/en-us/articles/360060616191-Energy-Summary)

**The target arithmetic**, with the additive term ring-fenced:

> "**Energy Target = Baseline Target (+/- Weight Goal if you have set this) + Expenditure Above Baseline (if you have set this) - Consumed**"

> "Toggle on/off **Add Expenditure Above Baseline to Energy Target**. This setting adds any energy burned above your Baseline Activity Level (from both exercise and general activity) to your daily Energy Target."

> Worked example: "BMR = 1394 / Adjusted Baseline Activity = 261 / Exercise = 500 / Total Burned = 2155 kcal … Here's how we calculate Expenditure Above Baseline: Baseline Activity = 279 kcal; Exercise + Adjusted Baseline Activity = 761 kcal; **Expenditure Above Baseline = 761 - 279 = 482 kcal**."

> "**This ensures that your baseline energy target is static until you exercise above and beyond your baseline for the day.** Therefore if you toggle OFF include exercise, your energy target will be the same as your baseline."

— [Energy Target](https://support.cronometer.com/hc/en-us/articles/31975503009044-Energy-Target)

This is the most directly copyable model in the survey: a formula TDEE that stays put until measured activity exceeds what the formula already assumed, at which point only the excess is added.

**Partial days.** The target grows through the day; nothing is projected. Cronometer starts the day at the full formula estimate and lets measurement erode/exceed it:

> "Note that total daily BMR and general activity are automatically logged at the beginning of each day by Cronometer. If you are wondering why your diary says you have burned energy already today even when you haven't logged any exercise yet, these values are why!"

— [Energy Summary](https://support.cronometer.com/hc/en-us/articles/360060616191-Energy-Summary)

**Missing days: explicit formula fallback, and Cronometer explains *why* it keeps the formula around even for tracker users:**

> "**Better meal planning** – At the start of the day, you'll see your BMR plus your Baseline Activity, giving you a realistic idea of your total daily energy needs before your device has tracked any movement. If your baseline were set to 0, your Energy Expenditure would start much lower and only increase as your device logs activity, making it harder to plan meals in advance."

> "**Credit for untracked time** – If your activity tracker isn't worn all day (e.g., you forget to put it on, it runs out of battery, or you remove it for certain activities), your Baseline Activity ensures you still receive credit for that time so your Energy Expenditure stays accurate."

— [Energy Expenditure](https://support.cronometer.com/hc/en-us/articles/31974307318420-Energy-Expenditure)

That is the answer to Ignia's missing-day question, written by someone who already shipped it: **never treat absent activity data as zero; the formula estimate is the floor.**

---

## 6. MacroFactor

**Shape: measured activity energy is refused. Step *trends* correct the responsiveness of an energy-balance expenditure estimate; they never additively move a day's target.** This is the closest analogue to Ignia's `measured` mode, and MacroFactor's reasoning is the reasoning Ignia already adopted.

**The base algorithm is energy balance — the same identity as Ignia's `measured` mode:**

> "Your estimated energy expenditure is a deterministic calculation based on your calorie intake and change in trend weight."

> "We start with the basic energy balance equation: Calories in - Calories out = Change in stored energy … 'Calories in - Change in stored energy = Calories out.'"

> "For example, if we estimate that you've been in an energy surplus of 200 Calories per day based on the rate at which your trend weight has been changing, and we can see that you've been eating approximately 3000 Calories per day, we can calculate that your daily energy expenditure is approximately 3000 - 200 = 2800 Calories."

— [Expenditure](https://help.macrofactorapp.com/en/articles/20-expenditure)

**Wearable energy is refused, explicitly and on the record:**

> "Short answer: no. That's a deliberate choice in order to calculate your expenditure more accurately."

> "But, in short, no: MacroFactor doesn't use estimates of energy expenditure from wearable devices for the purpose of calculating expenditure or modifying dietary targets."

> "1) Wearable devices are known to regularly misestimate energy expenditure. In fact, they under- or overestimate energy expenditure by at least 10% more than 80% of the time. Furthermore, their reliability (i.e. their ability to produce consistent estimates, even if those estimates are inaccurate) is unknown. So, incorporating this data would introduce error into MacroFactor's expenditure calculation, without an obvious mechanism to correct for that error."

> "2) MacroFactor doesn't need energy expenditure data from wearable devices in order to accurately calculate energy expenditure. Weight and nutrition data are fully sufficient."

— [Does MacroFactor use Energy Expenditure Data from my Wearable Activity Tracker?](https://help.macrofactorapp.com/en/articles/33-does-macrofactor-use-energy-expenditure-data-from-my-wearable-activity-tracker)

**But as of Nov 2025 it does use steps — and the framing is the single most useful sentence in this survey:**

> "For the first time, MacroFactor's expenditure algorithm will directly incorporate activity data if you enable 'Step-Informed Updates.'"

> "For the time being, we're only using step counts. The reasons for this decision are pretty straightforward: If you have a smartphone, you also have a reasonably accurate pedometer … Even if you have a smartwatch, **you have a device that's quite good at measuring step counts, and quite bad at estimating energy expenditure.** When given the option, we lean in favor of using more accurate data sources."

> "**Note that step counts won't be used to additively increase or decrease your calorie targets on individual days.** Rather, step data will be incorporated into MacroFactor's algorithms in a manner similar to the data you're already logging (weight and nutrition data), meaning it will **smoothly and progressively increase or decrease your estimated expenditure and calorie targets over time.**"

— [An Examination of MacroFactor's Expenditure Modifiers](https://macrofactor.com/expenditure-modifiers/) (Greg Nuckols, updated 17 Nov 2025; linked from the in-app help as the canonical explainer)

The in-app version:

> "If you enable 'Step-Informed Updates,' your expenditure (and, consequently, your recommended energy intake) will increase a bit faster when your step counts are trending up, and decrease a bit faster when your step counts are trending down."

> "Enabling both modifiers makes the algorithm about 6-8% more accurate month-to-month, and about 20% more accurate over longer time scales."

— [Expenditure Modifiers](https://help.macrofactorapp.com/en/articles/274-expenditure-modifiers)

Two caveats they publish about their own feature: the measured gain is small — "a ~3% decrease in stability, compared to a ~2% improvement in responsiveness" — and they concede "When we've said that MacroFactor's algorithms didn't need activity data to function well, we weren't bullshitting" ([expenditure-modifiers](https://macrofactor.com/expenditure-modifiers/)).

**The pre-data seed is `BMR × activity factor` — Ignia's `formula` mode:**

> "we initially estimate expenditure by estimating BMR, and then multiplying that value with an activity correction factor (i.e., 0.92 × 1.5 is still 8% less than 1 × 1.5)"

— [expenditure-modifiers](https://macrofactor.com/expenditure-modifiers/)

**And once real data exists, the self-reported activity level stops mattering entirely:**

> "Note that changing your activity level in this section of the app won't impact your current expenditure estimate, or your current calorie or macro targets. Your expenditure and program targets are calculated on an ongoing basis, using your weight and nutrition data. So, you don't need to edit this page for your program changes to reflect changes in your actual activity levels. Realistically, you don't ever need to edit this page…"

— [Change Your Activity Level](https://help.macrofactorapp.com/en/articles/57-change-your-activity-level)

**Steps are also merely displayed.** The step-import help article describes adding steps to the Dashboard, graphing them, and browsing history — and says nothing about any effect on expenditure or targets, deferring instead to the wearables article ([How to Import your Step Count](https://help.macrofactorapp.com/en/articles/255-how-to-import-your-step-count)).

**Partial days: N/A by design.** Targets are set per day in advance and revised on a program cadence, not intraday. MacroFactor documents no partial-day mechanism because it has none.

**Missing days: tolerated, with a documented threshold and imputation.**

> "When doing robustness testing on V2 of the expenditure algorithm, we found that we needed about 80-85% nutrition data completeness for the algorithm to still perform well … with two or more days of missing nutrition data per seven-day period, we found it was simply better to pause updates until data completeness returned to an acceptable level."

> "But, with expenditure V3, updates will only pause if you have more than three days of missing nutrition data in a seven-day period."

> "V3 of the expenditure algorithm is able to handle missing data better because it can make reasonably accurate inferences about your energy intake on days you don't log … its energy intake estimates are generally within about 15-20% of the actual values."

> "However, it has one Achilles heel: **partial nutrition tracking.** If, for example, you track your breakfast and lunch one day, but you don't put your dinner in the Food Log, we have no way of knowing that your energy intake for the day is incorrect, and your estimated daily energy expenditure (and future calorie recommendations) will decrease accordingly."

— [An In-Depth Look at MacroFactor's New V3 Expenditure Algorithm](https://macrofactor.com/expenditure-v3/) and [Expenditure](https://help.macrofactorapp.com/en/articles/20-expenditure)

**Does it warn about double-counting?** Not in those words — because its architecture makes the failure impossible. The refusal to ingest wearable energy *is* the guard, and the stated rationale ("weight and nutrition data are fully sufficient") is the same argument Ignia already used to rule `measured` mode out of scope.

---

## 7. MyFitnessPal

**Shape: measured activity *corrects a self-reported activity level*. The "exercise calorie adjustment" is a reconciliation delta against the tracker's total daily burn — not an addition of active energy.** This matters: MFP is universally cited as the additive example, and its own documentation says otherwise.

**The base goal is a self-reported activity level with a deficit applied:**

> "When you create your profile, we ask you for your age, height, weight, sex, and normal daily activity level. We use these factors to determine the calories required to maintain your current weight. We also ask how much weight you would like to lose or gain per week, and with this goal in mind we subtract calories (for weight loss) or add calories (for weight gain) to determine your daily calorie and nutrient goals."

> "Additionally we also account for weekly exercise goals (which should not be included in your initial activity level) … However, we do not account for additional exercise outside of your reported daily activity level, until you actually perform and log exercise to your diary under the 'Cardiovascular' section."

> "We set your daily calorie goal in **Net Calories** which we define as: Calories Consumed (Food) - Calories Burned (Exercise) = Net Calories"

> "If you would prefer a calorie goal that responds to your specific daily activity level, we suggest looking into our third party integrations."

— [How does MyFitnessPal calculate my initial goals?](https://support.myfitnesspal.com/hc/en-us/articles/360032625391-How-does-MyFitnessPal-calculate-my-initial-goals)

Manually logged exercise *is* purely additive — that is the well-known Net-Calories model:

> "Because your daily calorie goal already accounts for your intent to gain or lose weight at a particular rate, you can achieve your goal by eating the specified number of calories per day, with no additional exercise required. If you do exercise, then your daily calorie goal will increase for the day, to stabilize your weight loss or weight gain at the rate you initially specified."

— [Why do my daily nutrient values and my calorie goal change when I log exercise?](https://support.myfitnesspal.com/hc/en-us/articles/360032623851-Why-do-my-daily-nutrient-values-and-my-calorie-goal-change-when-I-log-exercise)

**But the *device* path is not additive. It compares totals and pays the difference:**

> "MyFitnessPal gets your calorie burn information straight from your connected app partners' '**total daily calorie**' data. Partner devices track your activity minute by minute, while our program looks at your whole day. We estimate your total calories for the day based on what you've burned so far."

> "On the calculation page, under the partner totals, you'll see your MyFitnessPal total (C). This total includes your daily goals and the calories needed to reach your set goals, like losing 1 pound. We subtract these calories when setting your daily goals, but add them back in when comparing to your actual total burn from your partner device."

> "If your connected partner's projected total is higher than your MyFitnessPal total, you'll see a positive adjustment **for the difference** added to your account."

— [Understanding your Calorie Adjustment](https://support.myfitnesspal.com/hc/en-us/articles/360032623871-Understanding-your-Calorie-Adjustment)

Restated even more plainly in the Fitbit/Google Health troubleshooting article:

> "**The adjustment is derived by comparing your total calories burned from your tracker with the total calories already provided by MyFitnessPal. If you burn more calories than MyFitnessPal expected, you'll see the difference as your adjustment.**"

> "MyFitnessPal estimates how many calories you'll need each day based on your profile and chosen activity level (like lightly active or very active). When Google Health updates us on your calories burned, we adjust your calorie goal to help you reach your weight loss or gain target."

> "When you first pick your activity level on MyFitnessPal, you might choose 'active'. MyFitnessPal then sets your goals based on what an average active person burns each day. But if you use a Fitbit device, your actual activity might be different from that average."

> "For example, MyFitnessPal might set your daily goal at 1700 calories based on your profile, but Google Health could show that you will only burn 1600 calories that day. MyFitnessPal will either keep your goal at 1700 or, if you allow negative adjustments, subtract 100 calories to match the Google Health data."

— [Google Health (Fitbit) Troubleshooting](https://support.myfitnesspal.com/hc/en-us/articles/47284924832013-Google-Health-Fitbit-Troubleshooting)

Note two structural facts Ignia's `activeKcal` import does **not** satisfy: MFP consumes the partner's **total** (basal + active) burn, and it compares that against a total on its own side. It never touches an active-energy-only figure.

**Explicit double-count guard for the manual path:**

> "When you add exercises to the cardiovascular section, our program immediately adds those calories to your day. **To prevent double-counting, we also include your cardiovascular totals in your MyFitnessPal total (D).** This way, you'll see the calories burned from each exercise added to your diary."

— [Understanding your Calorie Adjustment](https://support.myfitnesspal.com/hc/en-us/articles/360032623871-Understanding-your-Calorie-Adjustment)

I.e. manually logged cardio is added to *both* sides of the comparison so it cannot be paid out twice. MFP publishes **no** guard against the more basic overlap — that the chosen activity level and the tracker both describe the same movement — because the delta arithmetic *is* that guard.

**Partial days: projected to a full day, updated on every sync, converging at midnight.**

> "When you check your adjustment, you'll see a number under the partner for the instant sync (A), and another number to the right showing our **projection for the day** based on your current sync (B)."

> "The adjustment value updates every time your device sends new data, so it will change throughout the day. … **At midnight, your projected sync and actual sync should match.**"

— [Understanding your Calorie Adjustment](https://support.myfitnesspal.com/hc/en-us/articles/360032623871-Understanding-your-Calorie-Adjustment)

And MFP documents the resulting UX hazard candidly:

> "If you're very active, your adjustment will go up. If you rest afterward, your next sync may lower it. … At first, you may find that your adjustment drops unexpectedly overnight. This is due to inactivity and sleep during the last hours of the day. You'll soon become accustomed to these small variations. **We recommend aiming to come in slightly below your food goal in your last meal, as your adjustment may decrease a bit by the time the day ends at midnight.**"

— [Google Health (Fitbit) Troubleshooting](https://support.myfitnesspal.com/hc/en-us/articles/47284924832013-Google-Health-Fitbit-Troubleshooting)

That is the projection model's price, stated by its owner: a budget that can be *revoked* after the user has already eaten against it.

**Missing days / low-activity days: fall back to the profile goal, and the downside adjustment is opt-in and off by default.**

> "**By default, MyFitnessPal will show you only positive calorie adjustments.** This setting is only available to be changed on the website."

> "If you do not opt in to these 'negative' calorie adjustments, you may see a 'zero' adjustment in your diary for part of the day. The zero indicates that we are receiving calorie data from Google Health, but tells you that you have not yet been active enough to earn more calories than your baseline MyFitnessPal food goal."

— [Understanding your Calorie Adjustment](https://support.myfitnesspal.com/hc/en-us/articles/360032623871-Understanding-your-Calorie-Adjustment) / [Google Health (Fitbit) Troubleshooting](https://support.myfitnesspal.com/hc/en-us/articles/47284924832013-Google-Health-Fitbit-Troubleshooting)

> "You should turn on negative adjustments if any of the following apply: You plan to wear your tracking device regularly. You want the most accurate calorie feedback that MyFitnessPal can give. Your device can sync its data several times throughout the day."

> "You may want to turn off negative adjustments if any of these apply: You do not plan to wear your device regularly. You do not want your calorie adjustment to become negative, which would reduce your calories to eat. You only want to use the device to motivate yourself by earning extra calories."

— [Negative Calorie Adjustments](https://support.myfitnesspal.com/hc/en-us/articles/360032272152-Negative-Calorie-Adjustments)

MFP's own escape hatch when the correction fires constantly is to fix the *input*, not the arithmetic:

> "If you are typically unable to sync your device until late in the day, you may wish to leave negative adjustments off."

— [Understanding your Calorie Adjustment](https://support.myfitnesspal.com/hc/en-us/articles/360032623871-Understanding-your-Calorie-Adjustment)

---

## 8. Recommendation for Ignia

Scope reminders, taken as given and not re-argued here:

- Ignia has three TDEE modes in `packages/core/src/tdee.ts`: `seed` (no profile → `trueTdee: 2450`, `newDailyTarget: 1800`), `formula` (profile present, <14 aggregated days → Mifflin-St Jeor × `ACTIVITY_MULTIPLIERS[activityLevel]`, 1.2 / 1.375 / 1.55 / 1.725 / 1.9), and `measured` (≥14 days → `trimmedMean(intake) + (−slope × 3500)` over a 28-day window).
- **`measured` is out of scope and settled** — energy balance already contains every training calorie. MacroFactor §6 is the industry's own statement of that argument; it does not reopen the question.
- **`steps` is ruled out as an energy input.** Note §6 does *not* contradict this: MacroFactor uses steps as a *trend* input to an energy-balance estimator, never as kcal. That is a different use of the same field.
- Imported data is `users/{uid}/dailyActivity/{dateKey}` = `{ steps?, activeKcal? }` (`apps/mobile/src/lib/ledger.ts`), import-only, never written back to Health.

This section is input to a follow-on decision ticket, **"The composition model."** It gives the shape and the trade-offs; it deliberately does not fix parameter values.

### 8.1 The shape the survey actually supports

**Do not build `formulaTdee + activeKcal`.** Not one surveyed product does this, and the two that come closest both publish an explicit decrement to stop it:

- Cronometer subtracts the baseline allowance before adding: `+ Expenditure Above Baseline`, where the baseline is *replaced* by tracker activity rather than stacked with it (§5).
- MyFitnessPal never adds active energy at all; it differences two whole-day totals (§7).

The reason is structural, and it applies to Ignia exactly. `ACTIVITY_MULTIPLIERS[activityLevel]` is not a fudge factor — the increment `BMR × (mult − 1)` is *a claim about the user's daily active energy*, ranging from `BMR × 0.2` to `BMR × 0.9`. `activeKcal` is a measurement of the same quantity. Summing them counts the user's movement twice. Cronometer's `BMR × 0.2 … × 0.9` phrasing (§5) is the same table Ignia has, written in the form that makes the overlap visible.

That leaves two viable shapes, in the ticket's vocabulary:

**Shape A — measured activity *corrects the self-reported activity level* (recommended).**
Derive an implied multiplier from a trailing window of `activeKcal` — conceptually `1 + mean(activeKcal) / bmr` over N complete days — and use it to *correct* `profile.activityLevel`, not to alter the day's arithmetic. Two possible strengths, in increasing order of intrusiveness:

1. **Suggest.** Surface "your last N days look *Lightly Active*, not *Very Active* — update?" and let the user accept. This is Apple's pattern for Move goals ("Your Apple Watch suggests goals based on your previous performance," §2) and MFP's own written advice when adjustments trend one way.
2. **Apply.** Substitute the derived multiplier for the stored one inside `formula` mode.

Either way the correction lands on a **profile field**, which means it cannot leak into `measured` mode — `calculateTdee`'s measured branch never reads `activityLevel`. MacroFactor confirms this is the right seam: "changing your activity level … won't impact your current expenditure estimate" once real data exists (§6). The double-count guard is free, because there is only ever one activity term.

**Shape B — Cronometer's "above baseline" additive (the fallback if daily responsiveness is wanted).**
`tdee_day = bmr + max(bmr × (mult − 1), activeKcal)`, i.e. add only the excess over what the multiplier already assumed. Requires: opt-in and off by default (Cronometer's and MFP's default), a floor at the formula estimate on data-missing days (§5's "credit for untracked time"), and a name in the UI that distinguishes the two calorie conventions (§3, §4 — both Garmin and Fitbit maintain three separately-named sums for exactly this reason).

**Rejected: MFP's whole-day projection.** It needs the partner's *total* burn (basal + active), which Ignia does not import and cannot reliably obtain — per the companion note, Android's BMR record is itself a height/weight formula, and Apple documents nothing about `basalEnergyBurned` provenance. It also imports the failure mode MFP itself warns about: a budget that shrinks after dinner (§7). And it needs frequent intraday sync, which Ignia's foreground-triggered importer does not provide.

### 8.2 Why Shape A, specifically, for Ignia

Three reasons that are peculiar to this codebase rather than to the domain:

1. **`formula` mode's entire lifespan is under 14 aggregated days.** `MEASURED_MIN_DAYS = 14`. Any per-day additive adjustment would be live for at most two weeks per user, then permanently silenced. A profile-level correction to `activityLevel` is cheap, persists as a *user-visible fact*, and does not need to earn its keep daily.
2. **Ignia has no intraday target.** `newDailyTarget` is a scalar computed from logs, not a running budget. Adopting a shape that grows through the day (§5) or is projected and revised (§7) would be a new concept in the data model, not a parameter change. Shape A adds none.
3. **Ignia's read path is currently wrong.** Per `docs/health-active-energy-semantics.md` §2, both platforms' raw reads return unmerged multi-source samples and the current code naively sums them. Until that is fixed, `activeKcal` is biased **high** by an unknown factor. A shape that *suggests* a change for the user to confirm degrades into a bad suggestion; a shape that silently adds kcal to a target degrades into overeating. Prefer the shape whose failure mode is visible.

**`seed` mode: recommend doing nothing.** With no profile there is no BMR, so there is no basal term to compose with and no multiplier to correct. Both shapes are undefined. Displaying imported activity is fine; feeding 2450/1800 from it is not.

### 8.3 What a device test would confirm or kill

No production activity data exists, so nothing below is validated. Each item names what would settle it.

| Claim | Confirmed by | **Killed by** |
|---|---|---|
| `activeKcal` is large enough to discriminate activity levels | Typical active-day `activeKcal / bmr` spreading across a usable part of 0.2–0.9 | Ratios clustering near the bottom — e.g. `activeKcal ≈ 350`, `bmr ≈ 1700` → implied 1.21, i.e. **everyone reads "sedentary."** Shape A would then just tell every user they overstated themselves. **This is the single most likely failure.** |
| An iPhone-only user (no Watch) produces usable `activeKcal` at all | Non-trivial daily values on a watch-less device | Near-zero or absent values. Apple documents automatic active-energy recording **on Apple Watch** and makes no equivalent claim for iPhone (companion note §2). If iPhone-only users get nothing, the feature is Watch-owners-only and its addressable audience shrinks accordingly |
| The dedup fix materially changes the number | Raw-sum vs. `queryStatisticsForQuantity` / `aggregate()` on the same day agreeing within a few percent | A large gap — in which case **no** composition shape may ship until the read path is fixed, since the bias direction is always "target too high" |
| A trailing window is long enough to be stable inside `formula` mode's <14-day life | Day-to-day `activeKcal` variance low enough that a ~7-day mean is steady | High variance forcing a window ≥10 days, leaving Shape A ~3 days of usefulness before `measured` takes over — at which point the honest answer is **display-only, and ship nothing** |

An additional non-device open question, for the decision ticket rather than the lab: whether a *correction that only ever lowers* the multiplier is acceptable. MFP ships the asymmetric version by default (positive adjustments only, negatives opt-in — §7); Cronometer's "above baseline" is likewise one-directional by construction (§5). A downward-only correction to `activityLevel` is the mirror image and is the more conservative choice for a weight-loss app, but it is a product decision, not a research finding.
