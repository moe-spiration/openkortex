/* eslint-disable @typescript-eslint/no-require-imports -- native-only modules are loaded on Android only */
// First: registers the German catalog and sets the device language before any screen or headless task runs.
import "./src/i18n";
import { Platform } from "react-native";

// JS entry. The widget task handler and the background task must be registered here, at module level,
// because Android starts them headless (without the React tree).
if (Platform.OS === "android") {
  require("./src/widgets/handler");
  // Settings of a placed widget (hold it, then "Settings"): its own React root, started by Android.
  require("react-native-android-widget").registerWidgetConfigurationScreen(require("./src/widgets/config").WidgetConfig);
  require("./src/notify/background");
  // Quick overlay of the widgets (note, voice, task): its own small activity and React root, not the app.
  require("react-native").AppRegistry.registerComponent("KortexQuick", () => require("./src/quick/QuickCapture").QuickCapture);
}

import "expo-router/entry";
