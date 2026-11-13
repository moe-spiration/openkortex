/* eslint-disable @typescript-eslint/no-require-imports -- native-only modules are loaded on Android only */
// First: registers the German catalog and sets the device language before any screen or headless task runs.
import "./src/i18n";
import { Platform } from "react-native";

// JS entry. The widget task handler and the background task must be registered here, at module level,
// because Android starts them headless (without the React tree).
if (Platform.OS === "android") {
  require("./src/widgets/handler");
  require("./src/notify/background");
}

import "expo-router/entry";
