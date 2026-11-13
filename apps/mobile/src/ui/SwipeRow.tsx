import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { buzz } from "../lib/haptics";
import { useTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
import { T } from "./primitives";

/*
 * List row with native gestures: tap opens, long-press opens the context menu, a horizontal
 * swipe past the threshold runs the side's action on release (Gmail-style full swipe).
 *   swipe right → `left` action (revealed on the left), swipe left → `right` action.
 * A side with several actions (an array) never fires on its own: the swipe opens a tray of buttons
 * (e.g. Gelesen · Markieren · Archivieren · Löschen) and a tap on one runs it.
 * `onLeadPress` handles taps on the first `leadWidth` px (a checkbox): a nested Pressable does not get
 * the tap on Android because the row's own tap gesture wins.
 */

export interface SwipeAction {
  label: string;
  icon: IconName;
  /** Colour with meaning only: status colours (done = synced, archive = muted, delete = urgent). */
  color: string;
  run: () => void;
  /**
   * Destructive actions (archive): the swipe only opens the row and shows the action as a button;
   * a tap on it runs the action, a tap on the row or a swipe back closes it.
   */
  confirm?: boolean;
}

const THRESHOLD = 84;
/** Width of an opened confirm action. */
const OPEN = 128;
/** Width of one button in a tray of several actions. */
const TRAY_BTN = 72;

type Side = SwipeAction | SwipeAction[] | undefined;
const list = (s: Side): SwipeAction[] => (Array.isArray(s) ? s : s ? [s] : []);
const isTray = (s: Side) => list(s).length > 1;
const openWidth = (s: Side) => (isTray(s) ? list(s).length * TRAY_BTN + 8 : OPEN);


export function SwipeRow({
  children,
  onPress,
  onLongPress,
  left,
  right,
  style,
  onLeadPress,
  leadWidth = 40,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  left?: SwipeAction | SwipeAction[];
  right?: SwipeAction | SwipeAction[];
  style?: StyleProp<ViewStyle>;
  onLeadPress?: () => void;
  leadWidth?: number;
}) {
  const th = useTheme();
  const x = useSharedValue(0);
  const armed = useSharedValue(0);
  const pressed = useSharedValue(0);
  /** Which side stands open waiting for a confirming tap (JS state, mirrored in `openX`). */
  const [open, setOpen] = useState<"left" | "right" | null>(null);
  const openX = useSharedValue(0);
  const hasLeft = list(left).length > 0;
  const hasRight = list(right).length > 0;
  const leftConfirm = isTray(left) || !!list(left)[0]?.confirm;
  const rightConfirm = isTray(right) || !!list(right)[0]?.confirm;
  const leftOpen = openWidth(left);
  const rightOpen = openWidth(right);

  const close = () => {
    setOpen(null);
    openX.value = 0;
    x.value = withSpring(0, { damping: 20, stiffness: 260 });
  };
  // An open row closes by itself after a few seconds.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(close, 4000);
    return () => clearTimeout(id);
  }, [open]);

  // A tap on an open tray can reach both the button and the row's own tap gesture (web, some Android
  // hit tests); run the action once.
  const lastFire = useRef(0);
  const fire = (side: "left" | "right", i = 0) => {
    const now = Date.now();
    if (now - lastFire.current < 400) return;
    lastFire.current = now;
    buzz();
    list(side === "left" ? left : right)[i]?.run();
  };

  /** Where the container sits on screen, to map a tap on an open tray to its button. */
  const box = useRef<ComponentRef<typeof View>>(null);
  const frame = useRef({ x: 0, w: 0 });
  const measure = () => box.current?.measureInWindow((x: number, _y: number, w: number) => (frame.current = { x, w }));

  /** Tap while a side stands open: run the tray button under the finger, else just close. */
  const tapOpen = (absX: number) => {
    const which = open;
    const acts = list(which === "left" ? left : which === "right" ? right : undefined);
    const { x, w } = frame.current;
    const rel = absX - x;
    let i = -1;
    if (which && w > 0) {
      if (acts.length > 1) {
        const start = which === "right" ? w - 4 - acts.length * TRAY_BTN : 4;
        const k = Math.floor((rel - start) / TRAY_BTN);
        if (rel >= start && k >= 0 && k < acts.length) i = k;
      } else {
        const inside = which === "right" ? rel >= w - OPEN + 8 : rel <= OPEN - 8;
        if (inside) i = 0;
      }
    }
    close();
    if (which && i >= 0) fire(which, i);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const dx = openX.value + e.translationX;
      if ((dx > 0 && !hasLeft) || (dx < 0 && !hasRight)) return;
      x.value = dx;
      const over = Math.abs(dx) > THRESHOLD ? 1 : 0;
      if (over !== armed.value) {
        armed.value = over;
        if (over) runOnJS(buzz)();
      }
    })
    .onEnd(() => {
      const dx = x.value;
      if (Math.abs(dx) > THRESHOLD) {
        const side = dx > 0 ? "left" : "right";
        if ((side === "left" && leftConfirm) || (side === "right" && rightConfirm)) {
          openX.value = side === "left" ? leftOpen : -rightOpen;
          x.value = withSpring(openX.value, { damping: 20, stiffness: 260 });
          runOnJS(setOpen)(side);
          runOnJS(measure)();
          armed.value = 0;
          return;
        }
        x.value = withTiming(dx > 0 ? 420 : -420, { duration: 160 }, () => {
          runOnJS(fire)(side);
          x.value = 0;
        });
      } else {
        openX.value = 0;
        x.value = withSpring(0, { damping: 20, stiffness: 260 });
        runOnJS(setOpen)(null);
      }
      armed.value = 0;
    });

  const tap = Gesture.Tap()
    .maxDuration(400)
    .onBegin(() => {
      pressed.value = withTiming(1, { duration: 80 });
    })
    .onFinalize(() => {
      pressed.value = withTiming(0, { duration: 120 });
    })
    .onEnd((e, ok) => {
      if (!ok) return;
      // A tap on an opened row closes it instead of opening the entry.
      if (openX.value !== 0) runOnJS(tapOpen)(e.absoluteX);
      else if (onLeadPress && e.x <= leadWidth) runOnJS(onLeadPress)();
      else if (onPress) runOnJS(onPress)();
    });

  const long = Gesture.LongPress()
    .minDuration(380)
    .onStart(() => {
      if (onLongPress) {
        runOnJS(buzz)();
        runOnJS(onLongPress)();
      }
    });

  const gesture = Gesture.Race(pan, Gesture.Exclusive(long, tap));

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    opacity: 1 - pressed.value * 0.25,
  }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, THRESHOLD], [0, 1], "clamp") }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: interpolate(-x.value, [0, THRESHOLD], [0, 1], "clamp") }));

  const side = (s: Side, which: "left" | "right", anim: object) => {
    const isOpen = open === which;
    const acts = list(s);
    const tray = acts.length > 1;
    return (
      <Animated.View
        pointerEvents={isOpen ? "box-none" : "none"}
        style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: which === "left" ? "flex-start" : "flex-end", gap: tray ? 0 : undefined, paddingHorizontal: isOpen || tray ? 4 : 16 }, anim]}
      >
        {acts.map((a, i) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            disabled={!isOpen}
            onPress={() => {
              close();
              fire(which, i);
            }}
            style={
              tray
                ? { width: TRAY_BTN, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: 4 }
                : { width: isOpen ? OPEN - 16 : undefined, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 8, borderWidth: isOpen ? 1 : 0, borderColor: a.color }
            }
          >
            <Icon name={a.icon} size={18} color={a.color} />
            <T size={tray ? 11 : 13} lh={tray ? 14 : 18} weight={600} color={a.color} numberOfLines={1}>
              {a.label}
            </T>
          </Pressable>
        ))}
      </Animated.View>
    );
  };

  return (
    <View ref={box} style={[{ overflow: "hidden", backgroundColor: th.bgMainWindow }, style]}>
      {hasLeft && side(left, "left", leftStyle)}
      {hasRight && side(right, "right", rightStyle)}
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ backgroundColor: th.bgMainWindow }, rowStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
