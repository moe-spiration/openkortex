import { Plus, Search, Sparkles } from "lucide-react";
import {
  AppMark,
  Button,
  Card,
  Eyebrow,
  HashtagPill,
  Kbd,
  OBJECT_TYPES,
  ObjectBadge,
  SegmentedTabs,
  TAG_DOMAINS,
  type ObjectType,
} from "@kortex/ui";

export const metadata = { title: "UI" };

const SURFACES = ["app-shell", "main-window", "surface-flat", "surface-muted", "hover", "glass-sidebar", "floating-glass"] as const;
const TEXT = ["primary", "secondary", "muted"] as const;
const ACCENTS = ["accent-ai", "accent-ai-solid", "accent-checkin", "status-synced", "status-processing", "status-urgent"] as const;
const SAMPLE_TAGS = ["#ai/mcp", "#automotive/it", "#fitness/hyrox", "#rezepte/low-carb", "#finance/invest", "#strategy/mba"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div className="grid w-24 gap-1">
      <div className="h-10 rounded-lg shadow-[inset_0_0_0_1px_var(--border-subtle)]" style={{ background: `var(--bg-${name}, var(--${name}))` }} />
      <span className="font-mono text-[12px] text-muted">{name}</span>
    </div>
  );
}

function Panel({ theme }: { theme: "dark" | "light" }) {
  return (
    <div data-theme={theme} className="kx-scroll min-w-0 flex-1 bg-app-shell p-6 text-primary">
      <div className="grid gap-8">
        <div className="flex items-center gap-3">
          <AppMark size={32} />
          <span className="type-page">Kortex · {theme}</span>
        </div>

        <Section title="colors / surfaces">
          <div className="flex flex-wrap gap-3">
            {SURFACES.map((s) => (
              <Swatch key={s} name={s} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map((s) => (
              <Swatch key={s} name={s} />
            ))}
          </div>
          <div className="flex gap-6 text-[13px]">
            {TEXT.map((t) => (
              <span key={t} className={`text-${t}`}>
                text-{t}
              </span>
            ))}
          </div>
        </Section>

        <Section title="buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">
              <Plus /> Capture <Kbd onAccent>⌥ Space</Kbd>
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="ai">
              <Sparkles /> Ask AI
            </Button>
            <Button variant="checkin">Check-in</Button>
            <Button variant="danger">Delete</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary">
              Small
            </Button>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <Button size="icon" aria-label="Search">
              <Search />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Add">
              <Plus />
            </Button>
            <Button size="icon-lg" variant="ai" round aria-label="AI">
              <Sparkles />
            </Button>
          </div>
        </Section>

        <Section title="kbd / eyebrow">
          <div className="flex items-center gap-2">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <Eyebrow>12 items · synced</Eyebrow>
          </div>
        </Section>

        <Section title="hashtag pills">
          <div className="flex flex-wrap gap-1.5">
            {TAG_DOMAINS.map((d) => (
              <HashtagPill key={d} domain={d}>
                {d}
              </HashtagPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_TAGS.map((t) => (
              <HashtagPill key={t} tag={t} size="sm" />
            ))}
            <HashtagPill tag="#kortex" suggest />
          </div>
        </Section>

        <Section title="object badges">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(OBJECT_TYPES) as ObjectType[]).map((t) => (
              <ObjectBadge key={t} type={t} />
            ))}
          </div>
        </Section>

        <Section title="segmented tabs">
          <SegmentedTabs
            value="b"
            tabs={[
              { value: "a", label: "Notes" },
              { value: "b", label: "Meetings", icon: <Sparkles /> },
              { value: "c", label: "Clips" },
            ]}
          />
        </Section>

        <Section title="cards / surfaces">
          <div className="grid grid-cols-2 gap-3">
            <Card padded>
              <div className="type-card">card-3d-flat</div>
              <div className="type-small text-muted">Hover to lift.</div>
            </Card>
            <div className="floating-meeting-card p-4">
              <div className="type-card">floating-meeting-card</div>
            </div>
          </div>
          <div className="relative h-40 overflow-hidden rounded-2xl bg-main-window shadow-main-window">
            <div className="tc-float absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-full py-2 pr-2 pl-4">
              <Sparkles className="size-4 text-ai" />
              <span className="flex-1 text-muted">Ask your brain…</span>
              <Button variant="primary" size="sm" round>
                Send
              </Button>
            </div>
          </div>
          <div className="glass-sidebar kx-sidebar !w-full">
            <div className="kx-row is-active">Home</div>
            <div className="kx-row">Inbox</div>
            <div className="kx-row">Notes</div>
          </div>
        </Section>

        <Section title="type scale v2 (Geist)">
          <div className="type-display">Display 36/40 Guten Abend</div>
          <div className="type-h1">H1 30/36 Seitentitel</div>
          <div className="type-h2">H2 22/28 Sektion</div>
          <div className="type-h3">H3 17/24 Kartentitel</div>
          <div className="type-body">Body 14/21 Fließtext in Geist, Regular.</div>
          <div className="type-meta">Meta 12,5/18 · Datum, Eyebrow, Hinweis</div>
          <div className="type-mono">mono 12.5 · 10_Notes/Daily/2026-10-23.md · ⌘K</div>
        </Section>

        <Section title="tags: dot / quiet / datechip">
          <div className="flex flex-wrap items-center gap-3">
            <HashtagPill tag="#fitness/hyrox" variant="dot" />
            <HashtagPill tag="#ai/mcp" variant="dot" />
            <HashtagPill tag="#fitness/hyrox" variant="quiet" />
            <span className="kx-datechip">Heute</span>
            <span className="kx-datechip is-overdue">Gestern</span>
            <span className="kx-datechip">Fr, 24. Okt</span>
          </div>
        </Section>
      </div>
    </div>
  );
}

export default function UiShowcasePage() {
  return (
    <div className="flex min-h-screen">
      <Panel theme="dark" />
      <Panel theme="light" />
    </div>
  );
}
