"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { ApiClientError, generateDigest } from "@/lib/api/client";
import { postponeTask, saveWeeklyReview } from "@/lib/data/review";
import { type ReviewData } from "@/lib/mock/review";
import { useShell } from "@/lib/shell/store";
import { ThemeHero } from "@/components/theme/ThemeHero";
import { WIco } from "./icons";
import type { ReviewState } from "./useReviewData";
import { msg, t, tn, tx } from "@/i18n";

const STEPS = [msg("Look back"), msg("Life balance"), msg("Reflection"), msg("Next week")];

/** Level-1 surface (Feinschliff Live): flat, hairline ring only. */
const flat: CSSProperties = { background: "var(--lum-2)", boxShadow: "0 0 0 1px var(--hair)" };
const muted: CSSProperties = { fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-muted)", padding: "0 6px" };

/**
 * Guided weekly review in four steps plus the finished state (design/reference/WeeklyReview.dc.html). It sits on the
 * journal's week tab (/journal/week, the old /review redirects here) below the seven days and the "Wochenrückblick";
 * the page loads the review data once and hands it in.
 */
export function WeeklyReview({ review }: { review: ReviewState }) {
  if (review.status !== "ready")
    return (
      <p className="kx-body kx-muted" role="status" style={{ margin: 0 }}>
        {review.status === "error" ? t("Weekly review could not be loaded: {error}", { error: review.error ?? "" }) : t("Loading weekly review …")}
      </p>
    );
  // The tinted review image of the theme pack (accent follows Settings) as a banner: no text ever sits on it (A-15).
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="jr-review-art" aria-hidden>
        <ThemeHero topic="review" tint />
      </div>
      <ReviewBody key={review.data.review.isoWeek} data={review.data} live={review.live} reload={review.reload} />
    </div>
  );
}

function ReviewBody({
  data,
  live,
  reload,
}: {
  data: ReviewData;
  live: boolean;
  reload: () => void;
}) {
  const { openNote, showToast } = useShell();
  const router = useRouter();
  const R = data.review;
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(R.file);
  const [doneText, setDoneText] = useState(R.doneText);
  const [digesting, setDigesting] = useState(false);
  const [ans, setAns] = useState(() => data.questions.map(() => ""));
  const [focus, setFocus] = useState(() => data.focus.map((f) => f.on));
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});

  const fc = focus.filter(Boolean).length;
  // Kortex proposes up to five; with fewer proposals all of them (at most three) are needed.
  const need = Math.min(3, data.focus.length);
  const last = step === 4;
  const setAnswer = (i: number, v: string) => setAns((a) => a.map((x, j) => (j === i ? v : x)));

  const finish = async () => {
    if (!live) {
      setDone(true);
      return showToast(t("Weekly review saved"));
    }
    setSaving(true);
    const r = await saveWeeklyReview({
      isoWeek: R.isoWeek,
      title: R.title,
      summary: R.summary,
      answers: data.questions.map(([q], i) => ({ q, a: ans[i] ?? "" })),
      focus: data.focus.filter((_, i) => focus[i]),
    });
    setSaving(false);
    if (!r.ok) return showToast(t("Review not saved: {error}", { error: r.error }));
    setFile(r.data.file);
    // New note and tasks: reload the workspace snapshot so they open and show up in Tasks.
    router.refresh();
    if (!r.data.tasks && !data.focus.some((f, i) => focus[i] && f.taskId))
      // The sentence comes from the server in the account's language; both forms are accepted.
      setDoneText(R.doneText.replace(" Deine Fokus-Punkte stehen jetzt in Tasks.", "").replace(" Your focus points are now in Tasks.", ""));
    setDone(true);
    showToast(
      r.data.tasks
        ? tn(r.data.tasks, "Weekly review saved, {n} new task", "Weekly review saved, {n} new tasks")
        : t("Weekly review saved"),
    );
  };
  const next = () => {
    if (!last) return setStep(step + 1);
    if (fc !== need)
      return showToast(
        need === 3 ? t("Choose exactly three focus points") : t("Choose all {n} focus points", { n: need }),
      );
    void finish();
  };

  const moveOpen = (o: ReviewData["open"][number]) => {
    setOpenDone((m) => ({ ...m, [o.k]: true }));
    if (!live || !o.id) return showToast(t("\"{task}\" carried over to {week}", { task: o.t, week: R.nextWeek }));
    void postponeTask(o.id).then((r) => {
      if (r.ok) return showToast(t("\"{task}\" carried over to {week}", { task: o.t, week: R.nextWeek }));
      setOpenDone((m) => ({ ...m, [o.k]: false }));
      showToast(t("Not moved: {error}", { error: r.error }));
    });
  };

  const makeDigest = async () => {
    setDigesting(true);
    try {
      const res = await generateDigest({ days: 7 });
      showToast(
        res.digests.length
          ? tn(res.digests.length, "{n} weekly digest created", "{n} weekly digests created")
          : t("There is nothing to summarize this week yet"),
      );
      reload();
      // The new digest items must be in the workspace snapshot to open in the drawer.
      router.refresh();
    } catch (err) {
      showToast(
        t("Digest not created: {error}", { error: err instanceof ApiClientError || err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setDigesting(false);
    }
  };
  const weekDigests = data.digests.filter((d) => d.week.startsWith(`${R.week}/`));
  const olderDigests = data.digests.filter((d) => !weekDigests.includes(d)).slice(0, 4);

  return (
    <div
      id="wochen-review"
      style={{
        display: "grid",
        gap: 22,
        // One column that never grows past the page: below 420 px the steps and tiles used to push it wider.
        gridTemplateColumns: "minmax(0,1fr)",
        scrollMarginTop: 16,
      }}
    >
      <header style={{ display: "grid", gap: 6 }}>
        <span className="kx-eyebrow">{R.eyebrow}</span>
        <h2 className="kx-h-page" style={{ margin: 0 }}>
          {R.title}
        </h2>
        <p className="kx-body" style={{ margin: 0, color: "var(--text-secondary)", maxWidth: 640 }}>
          {R.intro}
        </p>
        {data.saved && !done && (
          <span className="kx-help">
            {t("A review is already saved for {week}. Completing updates it.", { week: R.week })}
          </span>
        )}
      </header>

      <nav
        aria-label={t("Steps")}
        style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}
      >
        {STEPS.map((label, i) => {
          const reached = step >= i + 1 || done;
          return (
            <button
              key={label}
              type="button"
              className="kxb"
              aria-current={step === i + 1 && !done ? "step" : "false"}
              onClick={() => {
                setStep(i + 1);
                setDone(false);
              }}
              style={{ display: "grid", gap: 8, padding: "2px 0", textAlign: "left" }}
            >
              <span
                style={{
                  display: "block",
                  height: 3,
                  borderRadius: 2,
                  background: reached ? "var(--accent)" : "var(--lum-4)",
                }}
              />
              <span
                className="kxh-row"
                style={{
                  gap: 6,
                  fontSize: "calc(13px * var(--kx-fs, 1))",
                  fontWeight: 500,
                  color: reached ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}>
                  0{i + 1}
                </span>
                {t(label)}
              </span>
            </button>
          );
        })}
      </nav>

      {!done && step === 1 && (
        <section className="kx-in" style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              ...flat,
              padding: "18px 20px",
              borderRadius: 16,
              display: "grid",
              gap: 10,
            }}
          >
            <span
              className="kxh-row"
              style={{ gap: 6, color: "var(--tag-ai-fg)", fontSize: "calc(12px * var(--kx-fs, 1))", fontWeight: 500 }}
            >
              <WIco name="spark" sm />
              {t("Your week in three sentences")}
            </span>
            <p className="kx-h-card" style={{ margin: 0, fontWeight: 500 }}>
              {R.summary}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
            {data.stats.map((k) => (
              <div
                key={k.l}
                style={{ ...flat, padding: 14, borderRadius: 12, display: "grid", gap: 2 }}
              >
                <span className="kx-h-page">{k.v}</span>
                <span className="kx-help">{k.l}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(280px,100%),1fr))", gap: 12 }}>
            <div
              style={{
                ...flat,
                padding: 16,
                borderRadius: 16,
                display: "grid",
                gap: 4,
                alignContent: "start",
              }}
            >
              <span className="kx-label" style={{ marginBottom: 4 }}>
                {t("Highlights of the week")}
              </span>
              {data.highlights.length === 0 && (
                <span style={muted}>{t("No entries this week yet.")}</span>
              )}
              {data.highlights.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="kxb kxh-row"
                  onClick={() => openNote(h.id)}
                  style={{ gap: 10, minHeight: 40, padding: "0 6px", borderRadius: 8 }}
                >
                  <WIco name="check" sm style={{ color: "var(--status-synced)" }} />
                  <span className="kxh-grow" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                    {h.t}
                  </span>
                  <WIco name="r" sm style={{ color: "var(--text-muted)" }} />
                </button>
              ))}
            </div>
            <div
              style={{
                ...flat,
                padding: 16,
                borderRadius: 16,
                display: "grid",
                gap: 4,
                alignContent: "start",
              }}
            >
              <span className="kx-label" style={{ marginBottom: 4 }}>
                {t("Left open")}
              </span>
              {data.open.length === 0 && <span style={muted}>{t("Nothing left undone.")}</span>}
              {data.open.map((o) => (
                <div
                  key={o.k}
                  className="kxh-row"
                  style={{ gap: 10, minHeight: 40, padding: "0 6px" }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--status-processing)",
                      flex: "none",
                    }}
                  />
                  <span className="kxh-grow" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                    {o.t}
                  </span>
                  <button
                    type="button"
                    className="kx-btn kx-btn--ghost kx-btn--sm"
                    disabled={openDone[o.k]}
                    onClick={() => moveOpen(o)}
                  >
                    {openDone[o.k] ? t("Carried over") : t("To {week}", { week: R.nextWeek })}
                  </button>
                </div>
              ))}
            </div>
          </div>
          {live && (
            <div
              style={{
                ...flat,
                padding: 16,
                borderRadius: 16,
                display: "grid",
                gap: 4,
                alignContent: "start",
              }}
            >
              <div className="kxh-row" style={{ marginBottom: 4 }}>
                <span className="kx-label kxh-grow">{t("Weekly digests")}</span>
                <button
                  type="button"
                  className="kx-btn kx-btn--secondary kx-btn--sm"
                  disabled={digesting}
                  onClick={() => void makeDigest()}
                >
                  <WIco name="spark" sm />
                  {digesting
                    ? t("Creating …")
                    : weekDigests.length
                      ? tx("review", "Create again")
                      : t("Create digest {week}", { week: R.week })}
                </button>
              </div>
              {data.digests.length === 0 && (
                <span style={muted}>
                  {t("No digest yet. Kortex summarizes the week's decisions, progress and blockers per topic and files them in 90_Digests.")}
                </span>
              )}
              {[...weekDigests, ...olderDigests].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="kxb kxh-row"
                  onClick={() => openNote(d.id)}
                  style={{ gap: 10, minHeight: 40, padding: "0 6px", borderRadius: 8 }}
                >
                  <WIco name="file" sm style={{ color: "var(--text-muted)" }} />
                  <span className="kxh-grow kx-truncate" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                    {d.group || d.title}
                  </span>
                  <span className="kx-help">{d.week.split("/")[0]}</span>
                  <WIco name="r" sm style={{ color: "var(--text-muted)" }} />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {!done && step === 2 && (
        <section
          className="kx-in"
          style={{ ...flat, display: "grid", gap: 14, padding: 20, borderRadius: 16 }}
        >
          <div className="kxh-row">
            <span className="kx-label kxh-grow">
              {t("Life balance, this week compared with the last")}
            </span>
            <span className="kxh-row" style={{ gap: 12, fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>
              <span className="kxh-row" style={{ gap: 6 }}>
                <i
                  style={{
                    display: "block",
                    width: 12,
                    height: 8,
                    borderRadius: 2,
                    background: "var(--accent-ai)",
                  }}
                />
                {R.week}
              </span>
              <span className="kxh-row" style={{ gap: 6 }}>
                <i
                  style={{
                    display: "block",
                    width: 12,
                    height: 8,
                    borderRadius: 2,
                    background: "color-mix(in srgb, var(--text-muted) 30%, transparent)",
                  }}
                />
                {R.prevWeek}
              </span>
            </span>
          </div>
          {data.balance.map(([name, cur, prev]) => {
            const d = cur - prev;
            return (
              <div
                key={name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "190px 1fr 64px",
                  gap: 14,
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>{name}</span>
                <span
                  style={{
                    position: "relative",
                    height: 18,
                    borderRadius: 6,
                    background: "var(--lum-1)",
                    boxShadow: "var(--edge-inset)",
                  }}
                >
                  <i
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${prev}%`,
                      borderRadius: 6,
                      background: "color-mix(in srgb, var(--text-muted) 30%, transparent)",
                    }}
                  />
                  <i
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 4,
                      bottom: 4,
                      width: `${cur}%`,
                      borderRadius: 4,
                      background: "var(--accent-ai)",
                    }}
                  />
                </span>
                <span
                  className="kxh-row kx-num"
                  style={{
                    gap: 4,
                    justifyContent: "flex-end",
                    fontSize: "calc(12px * var(--kx-fs, 1))",
                    color: d >= 0 ? "var(--status-synced)" : "var(--status-urgent-text)",
                  }}
                >
                  <WIco name={d >= 0 ? "up" : "down"} sm />
                  {(d > 0 ? "+" : "") + d}
                </span>
              </div>
            );
          })}
          <div
            className="kxh-row"
            style={{
              gap: 8,
              alignItems: "flex-start",
              padding: "10px 12px",
              borderRadius: 12,
              background: "var(--accent-ai-soft)",
              fontSize: "calc(13px * var(--kx-fs, 1))",
              lineHeight: 1.4,
            }}
          >
            <WIco name="spark" sm style={{ color: "var(--tag-ai-fg)", marginTop: 2 }} />
            <span>{R.balanceNote}</span>
          </div>
        </section>
      )}

      {!done && step === 3 && (
        <section className="kx-in" style={{ display: "grid", gap: 12 }}>
          {data.questions.map(([q, hint], i) => (
            <div
              key={q}
              style={{ ...flat, padding: "16px 18px", borderRadius: 16, display: "grid", gap: 10 }}
            >
              <strong className="kx-h-card">{q}</strong>
              <div className="kx-composer">
                <textarea
                  aria-label={q}
                  placeholder={t("One or two sentences are enough")}
                  value={ans[i]}
                  onChange={(e) => setAnswer(i, e.target.value)}
                  style={{ minHeight: 56 }}
                />
              </div>
              <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="kx-suggest"
                  onClick={() => setAnswer(i, hint.replace(/^(?:Vorschlag|Suggestion): /, ""))}
                >
                  <WIco name="spark" />
                  {hint}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {!done && step === 4 && (
        <section
          className="kx-in"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(300px,100%),1fr))", gap: 12 }}
        >
          <div
            style={{
              ...flat,
              padding: 18,
              borderRadius: 16,
              display: "grid",
              gap: 6,
              alignContent: "start",
            }}
          >
            <div className="kxh-row" style={{ marginBottom: 4 }}>
              <span className="kx-label kxh-grow">{t("Focus for {week}", { week: R.nextWeek })}</span>
              <span
                className="kx-num"
                style={{
                  fontSize: "calc(12px * var(--kx-fs, 1))",
                  color: fc === need ? "var(--status-synced)" : "var(--status-processing)",
                }}
              >
                {t("{n} of {total}", { n: fc, total: need })}
              </span>
            </div>
            {data.focus.map((f, i) => (
              <label key={f.t} className="kx-choice" style={{ minHeight: 44, padding: "0 4px" }}>
                <input
                  type="checkbox"
                  className="kx-check"
                  checked={focus[i]}
                  onChange={() => setFocus((a) => a.map((x, j) => (j === i ? !x : x)))}
                />
                <span className="kxh-grow" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                  {f.t}
                </span>
                <span className="kx-help">{f.area}</span>
              </label>
            ))}
            <span className="kx-help" style={{ marginTop: 4 }}>
              {data.focus.length === 0
                ? t("No open goals or tasks yet. Create goals in a life area or tasks in Tasks and Kortex suggests focus points here.")
                : data.focus.length >= 5
                  ? t("Kortex suggests five. Choose exactly three.")
                  : need === 3
                    ? t("Kortex suggests {n}. Choose exactly three.", { n: data.focus.length })
                    : t("Kortex suggests {n}.", { n: data.focus.length })}
            </span>
          </div>
          <div
            style={{
              ...flat,
              padding: 18,
              borderRadius: 16,
              display: "grid",
              gap: 10,
              alignContent: "start",
            }}
          >
            <span className="kx-label">{t("The week at a glance")}</span>
            {data.week.every((w) => w.items.length === 0) && (
              <span className="kx-help">{t("No tasks due in {week} yet.", { week: R.nextWeek })}</span>
            )}
            {data.week.map((w) => (
              <div
                key={w.d}
                style={{
                  display: "grid",
                  gridTemplateColumns: "30px 1fr",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                {/* v2 (V2-06e): weekdays in Geist, entries as dot + text without a surface (V2-10b). */}
                <span className="kx-meta">{w.d}</span>
                <span style={{ display: "flex", gap: "2px 14px", flexWrap: "wrap", minWidth: 0 }}>
                  {w.items.map((it) => (
                    <span key={it.t} className={"kx-pill kx-pill--quiet " + it.cls}>
                      {it.t}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {done && (
        <section
          className="kx-in"
          style={{
            ...flat,
            display: "grid",
            gap: 10,
            justifyItems: "center",
            textAlign: "center",
            padding: "34px 20px",
            borderRadius: 16,
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "var(--accent-ai-soft)",
              color: "var(--accent-ai)",
            }}
          >
            <WIco name="check" style={{ width: 20, height: 20 }} />
          </span>
          <strong className="kx-h-page">{t("Review completed")}</strong>
          <span style={{ fontSize: "calc(13px * var(--kx-fs, 1))", color: "var(--text-secondary)" }}>{doneText}</span>
          <span className="kx-filerow" style={{ marginTop: 6 }}>
            <WIco name="file" />
            <span className="kx-mono" style={{ fontSize: "calc(12px * var(--kx-fs, 1))" }}>
              {file}
            </span>
            <span />
          </span>
          <button
            type="button"
            className="kx-btn kx-btn--ghost kx-btn--sm"
            onClick={() => {
              setDone(false);
              setStep(1);
            }}
          >
            {t("Open review again")}
          </button>
        </section>
      )}

      {!done && (
        <div className="kxh-row" style={{ gap: 10 }}>
          {step > 1 && (
            <button
              type="button"
              className="kx-btn kx-btn--secondary"
              onClick={() => setStep(step - 1)}
            >
              <WIco name="l" />
              {t("Back")}
            </button>
          )}
          <span className="kxh-grow" />
          <span className="kx-help">
            {last
              ? fc === need
                ? t("Ready to complete")
                : need === 3
                  ? t("Choose exactly three focus points")
                  : t("Choose {n} focus points", { n: need })
              : t("Step {step} of 4", { step })}
          </span>
          <button type="button" className="kx-btn kx-btn--primary" disabled={saving} onClick={next}>
            {last ? (saving ? t("Saving …") : t("Complete review")) : t("Next")}
            <WIco name="r" />
          </button>
        </div>
      )}
    </div>
  );
}
