package expo.modules.nativedatepicker

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.text.format.DateFormat
import androidx.fragment.app.FragmentActivity
import com.google.android.material.datepicker.CalendarConstraints
import com.google.android.material.datepicker.CompositeDateValidator
import com.google.android.material.datepicker.DateValidatorPointBackward
import com.google.android.material.datepicker.DateValidatorPointForward
import com.google.android.material.datepicker.MaterialDatePicker
import com.google.android.material.timepicker.MaterialTimePicker
import com.google.android.material.timepicker.TimeFormat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Calendar
import java.util.TimeZone

/** What JS asks for. Every instant is epoch milliseconds, local wall clock. */
class ShowOptions : Record {
  /** `"date"`, `"time"` or `"dateAndTime"` (date first, then time). */
  @Field var mode: String = "date"
  @Field var value: Double = 0.0
  @Field var min: Double? = null
  @Field var max: Double? = null
  /** `null` = the phone's own 12/24-hour setting. */
  @Field var is24h: Boolean? = null
  /** `"material"` (default) or `"platform"` — see the class header. */
  @Field var style: String = "material"
}

/**
 * The Android half of `src/components/NativeDatePicker.tsx`: one function,
 * `show(options) → Promise<number | null>`, that puts up the system picker and
 * resolves the chosen instant (epoch ms) or `null` when dismissed.
 *
 * ## Material, with a platform escape hatch
 *
 * `MaterialDatePicker` / `MaterialTimePicker` (material 1.13.0 — already in
 * the release graph via expo-router and react-native-screens) are what Google's
 * own apps show. They are themed from `res/values/styles.xml`, whose header
 * explains why they need FULL themes on an AppCompat app.
 *
 * `style: "platform"` uses `android.app.DatePickerDialog` / `TimePickerDialog`
 * instead. Nothing selects it today; it exists so that if a device ever
 * crashes inside the Material picker (theme resolution is a runtime act that
 * no compile step proves), JS can switch every user to the platform dialogs
 * with an OTA instead of a store binary.
 *
 * ## Dates and the UTC trap
 *
 * MaterialDatePicker's selection is UTC midnight of the chosen day. Every
 * conversion below goes local calendar day ⇄ UTC midnight explicitly; reading
 * the selection as a local instant shifts the day by one west of Greenwich —
 * which is all of this app's market.
 *
 * `min` / `max` constrain the calendar by DAY. Time-of-day bounds (a fast's end
 * after its start, an entry not in the future) are clamped by the JS caller,
 * which already owns that validation.
 */
class NativeDatePickerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeDatePicker")

    AsyncFunction("show") { options: ShowOptions, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null || activity.isFinishing || activity.supportFragmentManager.isStateSaved) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val once = Once(promise)
      try {
        val base = local(options.value.toLong())
        val is24h = options.is24h ?: DateFormat.is24HourFormat(activity)
        val platform = options.style == "platform"
        when (options.mode) {
          "time" ->
            if (platform) platformTime(activity, base, is24h, once) else materialTime(activity, base, is24h, once)
          "dateAndTime" -> {
            val thenTime: (Calendar) -> Unit = { day ->
              if (platform) platformTime(activity, day, is24h, once) else materialTime(activity, day, is24h, once)
            }
            if (platform) platformDate(activity, base, options, once, thenTime)
            else materialDate(activity, base, options, once, thenTime)
          }
          else ->
            if (platform) platformDate(activity, base, options, once) { once.resolve(it) }
            else materialDate(activity, base, options, once) { once.resolve(it) }
        }
      } catch (_: Throwable) {
        // Never reject: a picker that will not open leaves the field as it was.
        once.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)
  }

  /** Resolves the JS promise exactly once — dismiss listeners fire after a
   *  positive click too, and must not overwrite the answer with `null`. */
  private class Once(private val promise: Promise) {
    private var done = false
    fun resolve(cal: Calendar?) {
      if (done) return
      done = true
      promise.resolve(cal?.timeInMillis?.toDouble())
    }
    val settled get() = done
  }

  private fun local(ms: Long): Calendar = Calendar.getInstance().apply { timeInMillis = ms }

  /** Local calendar day of `ms` → UTC midnight of that same day. */
  private fun utcMidnightOfLocalDay(ms: Long): Long {
    val l = local(ms)
    return Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
      clear()
      set(l.get(Calendar.YEAR), l.get(Calendar.MONTH), l.get(Calendar.DAY_OF_MONTH))
    }.timeInMillis
  }

  /** `base` moved to the day a UTC-midnight selection names, time kept. */
  private fun withUtcDay(base: Calendar, utcMidnight: Long): Calendar {
    val u = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = utcMidnight }
    return (base.clone() as Calendar).apply {
      set(u.get(Calendar.YEAR), u.get(Calendar.MONTH), u.get(Calendar.DAY_OF_MONTH))
    }
  }

  private fun materialDate(
    activity: FragmentActivity,
    base: Calendar,
    options: ShowOptions,
    once: Once,
    onPicked: (Calendar) -> Unit,
  ) {
    val constraints = CalendarConstraints.Builder()
    val validators = mutableListOf<CalendarConstraints.DateValidator>()
    options.min?.let {
      val m = utcMidnightOfLocalDay(it.toLong())
      constraints.setStart(m)
      validators.add(DateValidatorPointForward.from(m))
    }
    options.max?.let {
      val m = utcMidnightOfLocalDay(it.toLong())
      constraints.setEnd(m)
      validators.add(DateValidatorPointBackward.before(m))
    }
    if (validators.isNotEmpty()) constraints.setValidator(CompositeDateValidator.allOf(validators))
    val selection = utcMidnightOfLocalDay(base.timeInMillis)
    constraints.setOpenAt(selection)

    val picker = MaterialDatePicker.Builder.datePicker()
      .setTheme(R.style.IgniaMaterialCalendar)
      .setSelection(selection)
      .setCalendarConstraints(constraints.build())
      .build()
    var picked = false
    picker.addOnPositiveButtonClickListener { utc ->
      picked = true
      onPicked(withUtcDay(base, utc))
    }
    picker.addOnDismissListener { if (!picked) once.resolve(null) }
    picker.show(activity.supportFragmentManager, "ignia-date-picker")
  }

  private fun materialTime(activity: FragmentActivity, base: Calendar, is24h: Boolean, once: Once) {
    if (activity.supportFragmentManager.isStateSaved) {
      once.resolve(null)
      return
    }
    val picker = MaterialTimePicker.Builder()
      .setTheme(R.style.IgniaMaterialTimePicker)
      .setTimeFormat(if (is24h) TimeFormat.CLOCK_24H else TimeFormat.CLOCK_12H)
      .setHour(base.get(Calendar.HOUR_OF_DAY))
      .setMinute(base.get(Calendar.MINUTE))
      .build()
    picker.addOnPositiveButtonClickListener {
      once.resolve(
        (base.clone() as Calendar).apply {
          set(Calendar.HOUR_OF_DAY, picker.hour)
          set(Calendar.MINUTE, picker.minute)
          set(Calendar.SECOND, 0)
          set(Calendar.MILLISECOND, 0)
        },
      )
    }
    picker.addOnDismissListener { once.resolve(null) }
    picker.show(activity.supportFragmentManager, "ignia-time-picker")
  }

  private fun platformDate(
    activity: FragmentActivity,
    base: Calendar,
    options: ShowOptions,
    once: Once,
    onPicked: (Calendar) -> Unit,
  ) {
    var picked = false
    val dialog = DatePickerDialog(
      activity,
      { _, y, m, d ->
        picked = true
        onPicked((base.clone() as Calendar).apply { set(y, m, d) })
      },
      base.get(Calendar.YEAR),
      base.get(Calendar.MONTH),
      base.get(Calendar.DAY_OF_MONTH),
    )
    options.min?.let { dialog.datePicker.minDate = it.toLong() }
    options.max?.let { dialog.datePicker.maxDate = it.toLong() }
    dialog.setOnDismissListener { if (!picked && !once.settled) once.resolve(null) }
    dialog.show()
  }

  private fun platformTime(activity: FragmentActivity, base: Calendar, is24h: Boolean, once: Once) {
    val dialog = TimePickerDialog(
      activity,
      { _, h, min ->
        once.resolve(
          (base.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, h)
            set(Calendar.MINUTE, min)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
          },
        )
      },
      base.get(Calendar.HOUR_OF_DAY),
      base.get(Calendar.MINUTE),
      is24h,
    )
    dialog.setOnDismissListener { once.resolve(null) }
    dialog.show()
  }
}
