import { t } from "../i18n";
import { useEffect, type ReactNode } from "react";
import { Keyboard, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

/*
 * Bottom sheet that slides in and closes with a downward swipe (native feel: the content follows
 * the finger; a fast flick or > 120 px closes, anything less springs back).
 *  - Grab zone: the top `grabHeight` px (handle and hero) always drag the sheet.
 *  - Content: a downward drag takes over once the inner scroll is at the top; the offset at that
 *    moment is subtracted, so the sheet does not jump when you scroll up into it. While the sheet
 *    is pulled down the content is pinned at the top, so scroll and sheet never move together.
 *  - `scroll={false}`: no scroll view (capture sheets with a text field); the whole sheet drags.
 *
 * A5 fix: the content uses Reanimated's ScrollView (the core RN one) under one Gesture.Native.
 * The old version wrapped gesture-handler's ScrollView, which is a native handler itself, in a
 * second Native gesture; on Android the two fought and the sheet pan was often cancelled.
 */

const GRAB_H = 72;
/** Leaves the top-right corner free for a close button. */
const GRAB_RIGHT_GAP = 64;
const CLOSE_PX = 120;

export function SwipeSheet({
  onClose,
  style,
  children,
  contentContainerStyle,
  grabHeight = GRAB_H,
  scroll = true,
}: {
  /** Height of the always-draggable top zone (small for menus so items stay tappable). */
  grabHeight?: number;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  const y = useSharedValue(40);
  const opacity = useSharedValue(0);
  const scrollY = useSharedValue(0);
  /** translationY at which the content pan started moving the sheet (-1 = not yet). */
  const from = useSharedValue(-1);
  const ref = useAnimatedRef<Animated.ScrollView>();

  useEffect(() => {
    y.value = withTiming(0, { duration: 200 });
    opacity.value = withTiming(1, { duration: 160 });
  }, [y, opacity]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const settle = (velocityY: number) => {
    "worklet";
    if (y.value > CLOSE_PX || (y.value > 24 && velocityY > 800)) {
      y.value = withTiming(900, { duration: 180 }, () => runOnJS(close)());
      opacity.value = withTiming(0, { duration: 180 });
    } else {
      y.value = withSpring(0, { damping: 22, stiffness: 260 });
    }
  };

  // Grab zone (and the whole sheet without a scroll view): plain vertical pan.
  const grab = Gesture.Pan()
    .activeOffsetY(6)
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      y.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => settle(e.velocityY));

  // Content: runs together with the scroll view.
  const native = Gesture.Native();
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-24, 24])
    .simultaneousWithExternalGesture(native)
    .onBegin(() => {
      from.value = -1;
    })
    .onUpdate((e) => {
      if (from.value < 0) {
        // Hand over only at the top and only for a downward move.
        if (scrollY.value > 1) return;
        from.value = e.translationY;
      }
      y.value = Math.max(0, e.translationY - from.value);
      // Keep the content still while the sheet follows the finger.
      if (y.value > 0) scrollTo(ref, 0, 0, false);
    })
    .onFinalize((e) => {
      if (y.value > 0) settle(e.velocityY);
      from.value = -1;
    });

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: Math.max(0, y.value) }] }));

  if (!scroll)
    return (
      <Animated.View style={[style, anim]}>
        <GestureDetector gesture={grab}>
          <View collapsable={false} style={contentContainerStyle}>
            {children}
          </View>
        </GestureDetector>
      </Animated.View>
    );

  return (
    <Animated.View style={[style, anim]}>
      <GestureDetector gesture={pan}>
        <View collapsable={false} style={{ flexShrink: 1 }}>
          <GestureDetector gesture={native}>
            <Animated.ScrollView
              ref={ref}
              onScroll={onScroll}
              scrollEventThrottle={16}
              bounces={false}
              overScrollMode="never"
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              contentContainerStyle={contentContainerStyle}
            >
              {children}
            </Animated.ScrollView>
          </GestureDetector>
        </View>
      </GestureDetector>
      <GestureDetector gesture={grab}>
        <View
          accessibilityLabel={t("Drag down to close")}
          style={{ position: "absolute", left: 0, right: GRAB_RIGHT_GAP, top: 0, height: grabHeight }}
        />
      </GestureDetector>
    </Animated.View>
  );
}
