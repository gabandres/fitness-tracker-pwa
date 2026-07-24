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
import 'expo-router/entry';
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widgets/widget-task-handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}
