import { t } from "@/i18n";
import type { ReviewFocus } from "@/lib/mock/review";

/** The weekly review note (10_Notes/Weekly/YYYY-Www.md): frontmatter, summary, answers, focus. */
export interface SaveReviewInput {
  isoWeek: string;
  title: string;
  summary: string;
  answers: { q: string; a: string }[];
  focus: ReviewFocus[];
}

const bullet = (s: string) => `- ${s.replace(/\s+/g, " ").trim()}`;

export function reviewMarkdown(input: SaveReviewInput, date: string): string {
  const fm = [
    "---",
    "type: weekly_review",
    `week: ${input.isoWeek}`,
    `date: ${date}`,
    "tags: [weekly-review]",
    "---",
    "",
  ];
  const body = [
    `# ${input.title}`,
    "",
    `## ${t("Looking back")}`,
    "",
    input.summary,
    "",
    `## ${t("Reflection")}`,
    "",
    ...input.answers.flatMap((x) => [`### ${x.q}`, "", x.a.trim() || t("_(open)_"), ""]),
    `## ${t("Focus next week")}`,
    "",
    ...input.focus.map((f) => bullet(`[ ] ${f.t} (${f.area})`)),
    "",
  ];
  return [...fm, ...body].join("\n");
}
