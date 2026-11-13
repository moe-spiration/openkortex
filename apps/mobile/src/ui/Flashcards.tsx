import { t } from "../i18n";
import { useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Btn, Eyebrow, Help, Progress, ring, T } from "./primitives";
import { SwipeSheet } from "./SwipeSheet";

/* Flashcard review (Home "Wiederentdecken"): tap the card to reveal, then "Wusste ich" / "Nochmal". */

export function Flashcards({ deck, cards, onClose, onDone }: { deck: string; cards: [string, string][]; onClose: () => void; onDone: (known: number) => void }) {
  const th = useTheme();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [known, setKnown] = useState(0);
  const [queue, setQueue] = useState(cards);
  const card = queue[i];

  const next = (ok: boolean) => {
    const k = known + (ok ? 1 : 0);
    // A card you did not know comes back at the end once.
    const q = ok || queue.length > cards.length * 2 ? queue : [...queue, card!];
    setKnown(k);
    setShown(false);
    if (i + 1 >= q.length) {
      onDone(k);
      onClose();
      return;
    }
    setQueue(q);
    setI(i + 1);
  };

  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={onClose} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: th.bgScrim }} />
      <SwipeSheet
        onClose={onClose}
        grabHeight={40}
        contentContainerStyle={{ padding: 18, paddingBottom: 32, gap: 14 }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 31, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, backgroundColor: th.bgMainWindow, boxShadow: th.shadowFloating } as ViewStyle}
      >
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: th.borderSubtle }} />
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Eyebrow style={{ flex: 1 }}>{deck}</Eyebrow>
          <Help>{t("{n} of {total}", { n: Math.min(i + 1, queue.length), total: queue.length })}</Help>
        </View>
        <Progress pct={(i / Math.max(1, queue.length)) * 100} color={th.textSecondary} />
        {card && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? t("Answer") : t("Show answer")}
            onPress={() => setShown(true)}
            style={[{ minHeight: 200, padding: 18, gap: 12, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat, justifyContent: "center" }, ring(th.borderSubtle)]}
          >
            <T type="h3">{card[0]}</T>
            {shown ? (
              <T size={15} lh={23} color={th.textSecondary}>
                {card[1]}
              </T>
            ) : (
              <Help>{t("Tap to see the answer")}</Help>
            )}
          </Pressable>
        )}
        {shown && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Btn grow minHeight={44} onPress={() => next(false)}>
              {t("Again")}
            </Btn>
            <Btn grow variant="checkin" minHeight={44} onPress={() => next(true)}>
              {t("I knew it")}
            </Btn>
          </View>
        )}
      </SwipeSheet>
    </>
  );
}
