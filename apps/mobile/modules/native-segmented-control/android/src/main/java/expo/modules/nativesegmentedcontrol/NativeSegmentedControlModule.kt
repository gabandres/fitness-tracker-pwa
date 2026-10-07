package expo.modules.nativesegmentedcontrol

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.View
import android.view.View.MeasureSpec
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.view.ContextThemeWrapper
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class Segment : Record {
  @Field var label: String = ""
  @Field var a11yLabel: String? = null
  @Field var testID: String? = null
}

class SegmentColors : Record {
  @Field var text: String = "#57534E"
  @Field var selectedText: String = "#1C1917"
  @Field var selectedBackground: String = "#E6F2F0"
  @Field var border: String = "#8A837C"
}

/**
 * The Android half of `src/components/charts/SegmentedControl.tsx`: Material 3
 * segmented buttons — a single-selection `MaterialButtonToggleGroup` of
 * outlined `MaterialButton`s, equal widths, the outer corners rounded and the
 * inner ones square, as the M3 spec draws them.
 *
 * Colours come from JS (the app's palette, not Material's purple baseline):
 * unselected segments are transparent with `muted` text, the selected one is
 * filled. The buttons are built on a Material3 `ContextThemeWrapper` because
 * the activity's theme is AppCompat, and a MaterialButton inflated there
 * throws for want of a MaterialComponents theme.
 *
 * TalkBack reads the group as radio buttons ("3M, radio button, checked" —
 * MaterialButtonToggleGroup does that for single selection); `a11yLabel`
 * replaces the label as the content description, and `testID` becomes the
 * button's resource id, where Maestro and uiautomator look.
 */
class NativeSegmentedControlModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeSegmentedControl")

    View(NativeSegmentedControlView::class) {
      Events("onChange")

      Prop("segments") { view: NativeSegmentedControlView, segments: List<Segment>? ->
        view.segments = segments ?: emptyList()
      }
      Prop("selectedIndex") { view: NativeSegmentedControlView, index: Int? ->
        view.selectedIndex = index ?: 0
      }
      Prop("enabled") { view: NativeSegmentedControlView, enabled: Boolean? ->
        view.controlEnabled = enabled ?: true
      }
      Prop("fontSize") { view: NativeSegmentedControlView, size: Double? ->
        view.fontSize = (size ?: 14.0).toFloat()
      }
      Prop("colors") { view: NativeSegmentedControlView, colors: SegmentColors? ->
        view.colors = colors ?: SegmentColors()
      }
      Prop("cornerRadius") { view: NativeSegmentedControlView, radius: Double? ->
        view.cornerRadiusDp = (radius ?: 12.0).toFloat()
      }
      // iOS-only; accepted so it is not reported as unknown.
      Prop("forceDark") { _: NativeSegmentedControlView, _: Boolean? -> }

      OnViewDidUpdateProps { view: NativeSegmentedControlView ->
        view.apply()
      }
    }
  }
}

class NativeSegmentedControlView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onChange by EventDispatcher()

  private val themed = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
  private val group = MaterialButtonToggleGroup(themed).apply {
    isSingleSelection = true
    isSelectionRequired = true
  }

  var segments: List<Segment> = emptyList()
  var selectedIndex = 0
  var controlEnabled = true
  var fontSize = 14f
  var colors = SegmentColors()
  var cornerRadiusDp = 12f

  private var shownLabels: List<String> = emptyList()
  private var buttonIds: List<Int> = emptyList()
  /** Set while the selection is applied from props, so it is not echoed back. */
  private var applying = false

  init {
    addView(group)
    group.addOnButtonCheckedListener { _, checkedId, isChecked ->
      if (applying || !isChecked) return@addOnButtonCheckedListener
      val index = buttonIds.indexOf(checkedId)
      if (index >= 0) onChange(mapOf("index" to index))
    }
  }

  private fun dp(v: Float): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

  private fun parse(hex: String, fallback: Int): Int =
    try { Color.parseColor(hex) } catch (_: IllegalArgumentException) { fallback }

  fun apply() {
    applying = true
    val labels = segments.map { it.label }
    if (labels != shownLabels) {
      group.removeAllViews()
      buttonIds = segments.map { View.generateViewId() }
      for (id in buttonIds) {
        val button = MaterialButton(themed, null, com.google.android.material.R.attr.materialButtonOutlinedStyle)
        button.id = id
        group.addView(button, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
      }
      shownLabels = labels
    }

    val text = parse(colors.text, Color.DKGRAY)
    val selectedText = parse(colors.selectedText, Color.BLACK)
    val selectedBg = parse(colors.selectedBackground, Color.LTGRAY)
    val border = parse(colors.border, Color.GRAY)
    val checkedStates = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf())
    val weight = if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 600, false) else Typeface.DEFAULT_BOLD

    segments.forEachIndexed { i, segment ->
      val button = group.findViewById<MaterialButton>(buttonIds[i]) ?: return@forEachIndexed
      button.text = segment.label
      button.isAllCaps = false
      button.letterSpacing = 0f
      button.typeface = weight
      button.setTextSize(TypedValue.COMPLEX_UNIT_DIP, fontSize)
      button.maxLines = 1
      button.ellipsize = TextUtils.TruncateAt.END
      button.insetTop = 0
      button.insetBottom = 0
      button.minHeight = 0
      button.minimumHeight = 0
      button.minWidth = 0
      button.minimumWidth = 0
      button.setPadding(dp(4f), 0, dp(4f), 0)
      button.backgroundTintList = ColorStateList(checkedStates, intArrayOf(selectedBg, Color.TRANSPARENT))
      button.setTextColor(ColorStateList(checkedStates, intArrayOf(selectedText, text)))
      button.strokeColor = ColorStateList.valueOf(border)
      button.strokeWidth = dp(1f)
      button.cornerRadius = dp(cornerRadiusDp)
      button.rippleColor = ColorStateList.valueOf((text and 0x00FFFFFF) or 0x33000000)
      button.isEnabled = controlEnabled
      button.contentDescription = segment.a11yLabel?.takeIf { it.isNotBlank() }
      val testID = segment.testID?.takeIf { it.isNotBlank() }
      button.accessibilityDelegate = object : View.AccessibilityDelegate() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
          super.onInitializeAccessibilityNodeInfo(host, info)
          if (testID != null) info.viewIdResourceName = testID
        }
      }
    }
    group.alpha = if (controlEnabled) 1f else 0.5f

    buttonIds.getOrNull(selectedIndex)?.let { id -> if (group.checkedButtonId != id) group.check(id) }
    applying = false
    layoutGroup()
  }

  // `ExpoView` is a LinearLayout and React Native never lays out views it did
  // not create, so the group is measured and placed here, at the size Yoga
  // gave this view — and again whenever its buttons change (the lesson of
  // `NativeMenuButtonModule.kt`: let LinearLayout do it and children land in
  // the top-left corner).
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    layoutGroup()
  }

  private fun layoutGroup() {
    val w = width
    val h = height
    if (w <= 0 || h <= 0) return
    group.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    group.layout(0, 0, w, h)
  }

  // A child asking for layout (a button's text changed) never reaches Yoga;
  // do the pass here instead, on the next frame.
  private val relayout = Runnable { layoutGroup() }

  override fun requestLayout() {
    super.requestLayout()
    @Suppress("SENSELESS_COMPARISON")
    if (relayout != null) post(relayout)
  }
}
