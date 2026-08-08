/**
 * Custom entry point (`main` in package.json), replacing the default
 * `expo-router/entry`.
 *
 * It exists for exactly one reason: `registerWidgetTaskHandler` must run at
 * module scope, before React mounts, because Android can wake the widget when
 * the app's UI was never started. Importing `expo-router/entry` for its side
 * effect keeps routing behaviour identical to the default entry.
 *
 * The handler is Android-only, so the require is guarded — on iOS the widget is
 * a separate SwiftUI process that never touches our JS.
 */
import { initSentry } from './src/lib/sentry';
import 'expo-router/entry';
import { Platform } from 'react-native';

// Imports are hoisted, so this can't run before expo-router/entry is
// *evaluated* — but that call only registers the root component. Nothing
// renders until the bundle finishes evaluating, so the reporter is live before
// the first mount, and before the widget handler is registered below.
initSentry();

if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widgets/widget-task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);

  // The Quick Settings tile's headless task (ADR-0020), registered here for the
  // same reason and at the same moment as the widget handler: Android starts it
  // when the app's UI was never mounted, so it has to exist before React does.
  //
  // The task NAME must equal `QuickAddTileTaskService.TASK_NAME` in
  // `modules/quick-add-tile`. A mismatch is silent — the service starts, finds
  // nothing registered, and stops — so the two strings are the one thing to
  // check if a tile tap ever does nothing at all.
  const { AppRegistry } = require('react-native');
  const { quickAddTileTask } = require('./src/widgets/quick-add-tile-task');
  AppRegistry.registerHeadlessTask('IgniaQuickAddTile', () => quickAddTileTask);
}
