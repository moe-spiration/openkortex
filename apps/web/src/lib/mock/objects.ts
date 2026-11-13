import { OBJECTS as VIEW_OBJECTS, coverSrc, type DomainObject } from "./views";
import { NOTES } from "./notes";
import type { NoteContent, NoteSummary } from "./types";

/*
 * Domain objects (70_Objects/<Type>/) as knowledge items for the note sheet. The canonical list is
 * the space views' mock (./views OBJECTS); this maps its card metadata onto the metadata field sets
 * of @kortex/db domain.ts, so the Smart Object header, Turn into Object and validation all work on
 * the same objects the hubs show. Card-only facts without a domain.ts field (project progress,
 * asset total value, contact counts) stay on the cards.
 */

export interface MockObject extends NoteSummary, NoteContent {
  metadata: Record<string, unknown>;
}

const MONTH: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** "Dec 31" → ISO date in the mock year (Oct 2026): months before October fall into 2027. */
function isoFromDue(due: string): string | undefined {
  const m = /^(\p{L}{3}) (\d{1,2})$/u.exec(due);
  const month = m && MONTH[m[1]!];
  if (!m || !month) return undefined;
  const year = month >= 10 ? 2026 : 2027;
  return `${year}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/** Card status of the mock projects → the stored project_status enum value. */
const PROJECT_STATUS: Record<string, string> = { "In Progress": "In Arbeit", Planning: "Geplant", Review: "Review", Done: "Fertig" };

function domainMetadata(o: DomainObject): Record<string, unknown> {
  const m = o.meta;
  switch (m.type) {
    case "person":
      return { role: m.role, organization: m.org };
    case "organization":
      return { org_type: m.kind, industry: m.industry };
    case "project":
      return { project_status: PROJECT_STATUS[m.status] ?? m.status, target_date: isoFromDue(m.due) };
    case "concept":
      return { category: m.kind };
    case "tool":
      return { tool_category: m.category, usage_status: m.inStack ? "Im Stack" : undefined };
    case "asset":
      return { asset_type: m.kind, status: m.status };
    case "goal":
      return { goal_timeframe: m.period, target_metric: m.metric, progress_pct: m.progress };
  }
}

const noteTitle = (id: string) => NOTES.find((n) => n.id === id)?.title;

function toItem(o: DomainObject): MockObject {
  const linked = noteTitle(o.noteId);
  const metadata = Object.fromEntries(Object.entries(domainMetadata(o)).filter(([, v]) => v !== undefined));
  return {
    id: o.id,
    type: o.meta.type,
    title: o.title,
    path: o.path,
    date: o.date,
    time: o.time,
    tags: o.tags,
    tldr: o.tldr,
    links: [o.noteId],
    metadata,
    contentMd: o.tldr + "\n" + (linked ? `\nLast mentioned in [[${linked}]].\n` : ""),
    cover: coverSrc(o.cover),
    actionItems: [],
  };
}

export const OBJECT_ITEMS: MockObject[] = VIEW_OBJECTS.map(toItem);
