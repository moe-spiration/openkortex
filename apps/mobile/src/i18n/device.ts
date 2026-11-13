// The app's language on this device: same storage as the server address (AsyncStorage), which the
// headless widget and background tasks can read too (they run without the React tree).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { chooseLocale, getLocale, restoreLocale, subscribeLocale, type Locale } from "./index";

/** Applies the language stored on the device; call before rendering (app start, widget task, background task). */
export const restoreDeviceLocale = (): Promise<Locale> => restoreLocale(AsyncStorage);

/** Switches the language now and remembers it (`value`: "en" | "de", anything else counts as English). */
export const chooseDeviceLocale = (value: unknown): Promise<Locale> => chooseLocale(AsyncStorage, value);

/** Current language; the component renders again when it changes (`t` is read at render time). */
export const useLocale = (): Locale => useSyncExternalStore(subscribeLocale, getLocale, getLocale);
