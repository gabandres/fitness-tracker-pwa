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
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.PopupMenu
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** One row. `sfSymbol` is iOS-only and ignored here (PopupMenu rows are text). */
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

  private fun isNight(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  private fun open() {
    if (actions.isEmpty()) return
    val ctx = appContext.currentActivity ?: context
    val popup = PopupMenu(ctx, this, Gravity.END)
    // `danger` from src/theme.ts — light #c42020, dark #f2555a.
    val danger = if (isNight()) Color.parseColor("#F2555A") else Color.parseColor("#C42020")
    // Destructive rows last, after the rest — the same grouping iOS draws.
    val ordered = actions.withIndex().sortedBy { if (it.value.destructive) 1 else 0 }
    ordered.forEachIndexed { order, (index, action) ->
      val title: CharSequence =
        if (action.destructive) {
          SpannableString(action.title).apply {
            setSpan(ForegroundColorSpan(danger), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          }
        } else {
          action.title
        }
      popup.menu.add(Menu.NONE, index, order, title).isEnabled = !action.disabled
    }
    popup.setOnMenuItemClickListener { item ->
      actions.getOrNull(item.itemId)?.let { onAction(mapOf("key" to it.key)) }
      true
    }
    popup.show()
  }

  /** TalkBack: "More options, button" — a group with a click action. */
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.className = Button::class.java.name
  }
}
