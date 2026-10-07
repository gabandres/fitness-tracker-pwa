package expo.modules.nativemenubutton

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.Menu
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ListPopupWindow
import android.widget.PopupMenu
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** One row. `sfSymbol` is iOS-only and ignored here (the rows are text). */
class MenuAction : Record {
  @Field var key: String = ""
  @Field var title: String = ""
  @Field var subtitle: String? = null
  @Field var sfSymbol: String? = null
  @Field var destructive: Boolean = false
  @Field var disabled: Boolean = false
}

/**
 * The Android half of `src/components/MenuButton.tsx`: the view's RN children
 * are the visible face, and a tap opens an anchored `android.widget.PopupMenu`
 * — the platform overflow menu, themed by the activity's DayNight theme, so it
 * follows dark mode with nothing here.
 *
 * `android.widget.PopupMenu` rather than the AppCompat one: no dependency to
 * add, and on an AppCompat-themed activity the two draw the same.
 *
 * A PopupMenu row is one line (its title view is `singleLine`), so a menu
 * where any row has a `subtitle` opens as a `ListPopupWindow` instead: the
 * same themed popup surface, with two-line rows — the title, and the subtitle
 * under it in the secondary text colour, as iOS draws `UIAction.subtitle`.
 *
 * The children are plain RN views with no touch handlers, so a tap on them
 * falls through to this view's click listener (Android dispatches to the
 * deepest clickable view, and they are not clickable). A scroll that starts on
 * the button is still the ScrollView's: it intercepts and cancels the click.
 */
class NativeMenuButtonModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeMenuButton")

    View(NativeMenuButtonView::class) {
      Events("onAction")

      Prop("actions") { view: NativeMenuButtonView, actions: List<MenuAction>? ->
        view.actions = actions ?: emptyList()
      }
      Prop("enabled") { view: NativeMenuButtonView, enabled: Boolean? ->
        view.menuEnabled = enabled ?: true
      }
    }
  }
}

class NativeMenuButtonView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onAction by EventDispatcher()

  var actions: List<MenuAction> = emptyList()
  var menuEnabled: Boolean = true

  init {
    isClickable = true
    isFocusable = true
    // The standard Material press ripple, drawn over the RN face.
    val ripple = TypedValue()
    if (context.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true) &&
      ripple.resourceId != 0
    ) {
      foreground = context.getDrawable(ripple.resourceId)
    }
    setOnClickListener { if (menuEnabled) open() }
  }

  // `ExpoView` is a LinearLayout, and LinearLayout lays its children out
  // itself — top-left, in a row — on every Android layout pass, overwriting
  // the frames Yoga gave them. So the RN face (the ⋯ glyph) sat in the
  // top-left corner of its 48 dp button instead of centred in it (Android
  // emulator QA, 2026-10-06). React Native's own views leave layout to Yoga
  // the same way: measure to the size given, and position nothing here.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  private fun isNight(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  // `danger` from src/theme.ts — light #c42020, dark #f2555a.
  private fun dangerColor(): Int =
    if (isNight()) Color.parseColor("#F2555A") else Color.parseColor("#C42020")

  private fun styledTitle(action: MenuAction): CharSequence =
    if (action.destructive) {
      SpannableString(action.title).apply {
        setSpan(ForegroundColorSpan(dangerColor()), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    } else {
      action.title
    }

  private fun open() {
    if (actions.isEmpty()) return
    val ctx = appContext.currentActivity ?: context
    // Destructive rows last, after the rest — the same grouping iOS draws.
    val ordered = actions.withIndex().sortedBy { if (it.value.destructive) 1 else 0 }
    if (actions.any { !it.subtitle.isNullOrBlank() }) {
      openTwoLine(ctx, ordered.map { it.value })
      return
    }
    val popup = PopupMenu(ctx, this, Gravity.END)
    ordered.forEachIndexed { order, (index, action) ->
      popup.menu.add(Menu.NONE, index, order, styledTitle(action)).isEnabled = !action.disabled
    }
    popup.setOnMenuItemClickListener { item ->
      actions.getOrNull(item.itemId)?.let { onAction(mapOf("key" to it.key)) }
      true
    }
    popup.show()
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun themeColor(attr: Int, ctx: Context): Int? {
    val tv = TypedValue()
    if (!ctx.theme.resolveAttribute(attr, tv, true)) return null
    return if (tv.resourceId != 0) ctx.getColorStateList(tv.resourceId).defaultColor else tv.data
  }

  /** The menu with subtitles: a themed `ListPopupWindow` of two-line rows. */
  private fun openTwoLine(ctx: Context, rows: List<MenuAction>) {
    val primary = themeColor(android.R.attr.textColorPrimary, ctx)
    val secondary = themeColor(android.R.attr.textColorSecondary, ctx)
    val padH = dp(16)
    val padV = dp(10)

    fun rowView(action: MenuAction): View =
      LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(padH, padV, padH, padV)
        minimumHeight = dp(48)
        gravity = Gravity.CENTER_VERTICAL
        addView(TextView(ctx).apply {
          text = styledTitle(action)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
          primary?.let { setTextColor(it) }
        })
        if (!action.subtitle.isNullOrBlank()) {
          addView(TextView(ctx).apply {
            text = action.subtitle
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            secondary?.let { setTextColor(it) }
            setPadding(0, dp(2), 0, 0)
          })
        }
        alpha = if (action.disabled) 0.38f else 1f
      }

    val adapter = object : BaseAdapter() {
      override fun getCount() = rows.size
      override fun getItem(position: Int) = rows[position]
      override fun getItemId(position: Int) = position.toLong()
      override fun isEnabled(position: Int) = !rows[position].disabled
      override fun areAllItemsEnabled() = rows.none { it.disabled }
      override fun getView(position: Int, convertView: View?, parent: ViewGroup?) = rowView(rows[position])
    }

    // Material menus: at least 112 dp wide, at most the screen less a margin.
    val maxWidth = minOf(dp(320), resources.displayMetrics.widthPixels - dp(32))
    val measureSpec = MeasureSpec.makeMeasureSpec(maxWidth, MeasureSpec.AT_MOST)
    var width = dp(112)
    for (row in rows) {
      val v = rowView(row)
      v.measure(measureSpec, MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
      width = maxOf(width, v.measuredWidth)
    }

    ListPopupWindow(ctx).apply {
      anchorView = this@NativeMenuButtonView
      setAdapter(adapter)
      setContentWidth(minOf(width, maxWidth))
      setDropDownGravity(Gravity.END)
      isModal = true
      setOnItemClickListener { _, _, position, _ ->
        rows.getOrNull(position)?.takeIf { !it.disabled }?.let { onAction(mapOf("key" to it.key)) }
        dismiss()
      }
      show()
    }
  }

  /** TalkBack: "More options, button" — a group with a click action. */
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.className = Button::class.java.name
  }
}
