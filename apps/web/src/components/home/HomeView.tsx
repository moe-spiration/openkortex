"use client";

import { t } from "@/i18n";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useHomeBriefing, useHomeData, useSmartMixes } from "@/lib/data/home";
import { DAILY_SEED } from "@/lib/mock/home";
import { todayDate, todayIso } from "@/lib/date/today";
import { lifeHref, spaceHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { dailyStreakNow, isLiveData } from "@/lib/workspace-data";
import { JumpBackIn, MixesRail } from "./Carousels";
import { fetchCheckin, persistCheckin, seedCheckin, type DailyCheckin as Checkin } from "./daily";
import { HomeHeader } from "./HomeHeader";
import { BENTO_LAYOUT, bentoSpans, HOME_TOGGLES, moveKey, parseHidden, parseOrder } from "./home-utils";
import { HomeLiveStrip } from "./HomeLiveStrip";
import { useShellStatus } from "@/lib/shell/status";

/** Mountain and cloud landscape behind the top of Home (Feinschliff Live `.home-bg`; the inspiring image stays). */
const HOME_BG = "/home/home.webp";
import { LifeMini } from "./LifeMini";
import { MorningBriefing } from "./MorningBriefing";
import { DueTodayCard } from "./DueToday";
import { AgentNight } from "./AgentNight";
import { DailyStack } from "./DailyStack";
import { energyHistory, energyNotes, HISTORY_DAYS } from "./overview";
import { Rediscover } from "./Rediscover";
import { SessionsCard } from "./Sessions";
import { TodayOverview } from "./TodayOverview";
import { watchToday } from "./today";
import { useHomeNav } from "./useHomeNav";
import { useLook } from "@/components/theme/look";
import { HomeRuhe } from "./HomeRuhe";

const PREFS_KEY = "kortex.home.v1";

interface HomePrefs {
  hidden: Set<string>;
  order: string[];
}

function loadPrefs(): HomePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return { hidden: parseHidden(raw), order: parseOrder(raw) };
  } catch {
    return { hidden: new Set(), order: parseOrder(null) }; // storage blocked
  }
}

function savePrefs(p: HomePrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ hidden: [...p.hidden], order: p.order, layout: BENTO_LAYOUT }));
  } catch {
    /* ignore */
  }
}

/**
 * Home (Feinschliff Live, edge to edge): the mountain/cloud image faded in behind the top (fs-home.css), the live
 * strip while a meeting records, date and greeting with "Anpassen", the briefing with its action chips; below a
 * 12-column bento: "Heute im Überblick" (12) with streak, energy and Top 3, "Heute fällig" (7) next to
 * "Weiter, wo Du warst" (5), then Wiederentdecken, Life, Tab-Sessions and the Smart Knowledge Mixes, which the
 * prototype has no place for but which carry their own features. Single column below 1080 px. Clock-dependent
 * parts render after mount so server and client markup agree.
 */
export function HomeView() {
  const nav = useHomeNav();
  const router = useRouter();
  const { showToast } = useShell();
  const [now, setNow] = useState<Date | null>(null);
  // N5 #11: the workspace's day (todayIso), not the browser's; set after mount, updated at midnight.
  const [day, setDay] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<HomePrefs>(() => ({ hidden: new Set(), order: parseOrder(null) }));
  const { hidden, order } = prefs;
  const [checkin, setCheckin] = useState<Checkin>(() => seedCheckin(""));
  const { view } = useHomeData(day);
  const { briefing, done, toggle } = useHomeBriefing(day, showToast);
  const mixes = useSmartMixes();
  const { inboxCount } = useShellStatus();

  useEffect(() => {
    // The workspace's "today" (lib/date/today.ts): real day live, the frozen mock day in mock mode.
    // Re-evaluated when the tab comes back and at midnight (watchToday).
    const update = () => {
      setNow(todayDate());
      setDay(todayIso());
    };
    update();
    setPrefs(loadPrefs());
    return watchToday(update);
  }, []);

  useEffect(() => {
    if (!day) return;
    let alive = true;
    // GET read, aborted when Home unmounts (P7-5).
    const ac = new AbortController();
    fetchCheckin(day, ac.signal)
      .then((c) => {
        if (alive) setCheckin(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
      ac.abort();
    };
  }, [day]);

  const toggleSection = useCallback((k: string) => {
    setPrefs((p) => {
      const next = new Set(p.hidden);
      if (!next.delete(k)) next.add(k);
      const np = { ...p, hidden: next };
      savePrefs(np);
      return np;
    });
  }, []);

  const moveSection = useCallback((k: string, before: string | null) => {
    setPrefs((p) => {
      const np = { ...p, order: moveKey(p.order, k, before) };
      savePrefs(np);
      return np;
    });
  }, []);

  const updateCheckin = useCallback(
    (fn: (c: Checkin) => Checkin) => {
      setCheckin((c) => {
        const next = fn(c);
        // N5 #10: only the fields this tap changed, merged onto the note's current state.
        if (next.date && next !== c) persistCheckin(next, () => showToast(t("Check-in saved locally only")), c);
        return next;
      });
    },
    [showToast],
  );

  const show = (k: string) => !hidden.has(k);
  // The shared streak value (W6 owns the calculation); shown once on Home, in the overview (plan K7).
  const streak = isLiveData() ? dailyStreakNow() : DAILY_SEED.streak;
  const history = useMemo(
    () => (checkin.date ? energyHistory(checkin.date, checkin.energy, energyNotes(checkin.date), HISTORY_DAYS) : []),
    [checkin.date, checkin.energy],
  );
  const pickTag = nav.pickTag;
  // Order from "Anpassen" (drag & drop); spans recomputed so hidden or moved cards leave no holes.
  const visible = order.filter(show);
  const spans = bentoSpans(visible);

  const look = useLook();
  const sectionFor = (k: string): ReactNode => {
    switch (k) {
      case "t":
        return (
          <>
            <DailyStack day={day} view={view} go={nav.go} />
            <AgentNight />
          </>
        );
      case "c":
        return (
          <TodayOverview
            checkin={checkin}
            streak={streak}
            history={history}
            now={now}
            onChange={updateCheckin}
          />
        );
      case "d":
        return <DueTodayCard day={day} openNote={nav.openNote} />;
      case "r":
        return <Rediscover now={now} view={view} go={nav.go} />;
      case "j":
        return <JumpBackIn cards={view?.backIn ?? null} go={nav.go} onAll={() => router.push(spaceHref("all"))} />;
      case "l":
        return <LifeMini go={(a) => router.push(lifeHref(a))} />;
      case "s":
        return <SessionsCard openNote={nav.openNote} />;
      case "m":
        return (
          <div className="hm-bx hm-bx--bare">
            <MixesRail mixes={mixes} onPick={pickTag} />
          </div>
        );
      default:
        return null;
    }
  };

  // Ruhe (mockup "heute"): its own page (HomeRuhe) on the same state; the briefing card unfolds under the greeting.
  if (look === "ruhe") {
    return (
      <HomeRuhe
        day={day}
        now={now}
        view={view}
        go={nav.go}
        openNote={nav.openNote}
        checkin={checkin}
        onCheckin={updateCheckin}
        hidden={hidden}
        onToggleSection={toggleSection}
        briefing={
          briefing?.summary || briefing?.items.length ? (
            <MorningBriefing
              briefing={briefing}
              done={done}
              today={day}
              tag={mixes?.[0]?.tag ?? null}
              onToggle={toggle}
              onOpenNote={nav.openNote}
              onInbox={() => router.push("/inbox")}
              onTag={pickTag}
              inboxCount={inboxCount}
            />
          ) : null
        }
      />
    );
  }

  return (
    <div className="hm-page fs-home">
      <div className="fs-home-bg" aria-hidden style={{ backgroundImage: `url(${HOME_BG})` }} />
      <HomeHeader
        top={<HomeLiveStrip openNote={nav.openNote} />}
        now={now}
        sections={HOME_TOGGLES}
        hidden={hidden}
        order={order}
        onToggle={toggleSection}
        onMove={moveSection}
      >
        {show("b") && (
          <MorningBriefing
            briefing={briefing}
            done={done}
            today={day}
            tag={mixes?.[0]?.tag ?? null}
            onToggle={toggle}
            onOpenNote={nav.openNote}
            onInbox={() => router.push("/inbox")}
            onTag={pickTag}
            inboxCount={inboxCount}
          />
        )}
      </HomeHeader>
      <div className="hm-bento">
        {visible.map((k) => (
          <div key={k} className="hm-slot" data-section={k} style={{ "--hm-span": spans[k] ?? 12 } as CSSProperties}>
            {sectionFor(k)}
          </div>
        ))}
      </div>
    </div>
  );
}
