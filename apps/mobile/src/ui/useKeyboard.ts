import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from "react-native";

/*
 * How far the on-screen keyboard overlaps the app window (0 when hidden).
 * Android runs edge to edge (SDK 58), so adjustResize no longer shrinks the window and bottom
 * sheets have to lift themselves. Measured against the window, so a window that did resize
 * yields 0 and nothing is lifted twice.
 */
export function keyboardOverlap(e: KeyboardEvent, windowHeight = Dimensions.get("window").height): number {
  const y = e.endCoordinates.screenY;
  if (!y) return Math.max(0, e.endCoordinates.height);
  return Math.max(0, Math.round(windowHeight - y));
}

export function useKeyboardInset(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => setH(keyboardOverlap(e)));
    const change = Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame", (e) => setH(keyboardOverlap(e)));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setH(0));
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);
  return h;
}
