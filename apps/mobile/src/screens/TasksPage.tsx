import { feature, t } from "../i18n";
import { View } from "react-native";
import { Help, T } from "../ui/primitives";
import { ScreenScroll } from "../ui/Screen";
import { Tasks } from "../ui/Tasks";

/*
 * Aufgaben as a page of its own (like the web /tasks board): the status board with its stages, quick-add and the
 * hand-over to the agent. The Inbox keeps only what is being processed and what waits for a check.
 */
export function TasksPage() {
  return (
    <ScreenScroll gap={16}>
      <View style={{ gap: 4 }}>
        <T type="h1">{t("Tasks")}</T>
        <Help>{feature("griply") ? t("Goals and habits stay in Griply. Here: what came out of your entries and meetings.") : t("What came out of your entries and meetings.")}</Help>
      </View>
      <Tasks />
    </ScreenScroll>
  );
}
