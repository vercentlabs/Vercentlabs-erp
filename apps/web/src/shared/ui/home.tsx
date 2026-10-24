"use client";

// The building blocks of a module home, in CRM Home's style: a headline figure with its icon and caption, a panel with a title, a line
// and a link, the "needs attention" list (what needs action stands out, what is clear fades), an all-clear line, and recent activity
// grouped by day. Every figure and row opens what is behind it.
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from "lucide-react";

import { dayInDisplayZone, displayTimeZone } from "@/shared/format/display-time-zone";

export type HomeTone = "brand" | "success" | "warning" | "danger";
export const TONE_CHIP: Record<HomeTone, string> = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// The day and hour in the workspace's time zone.
export function homeClock() {
  const now = new Date();
  return {
    today: now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: displayTimeZone() }),
    hour: Number(now.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: displayTimeZone() })),
    ymd: dayInDisplayZone(),
  };
}

export function Kpi({ icon, tone, label, value, title, caption, captionTone, href, progress }: {
  icon: ReactNode; tone: HomeTone; label: string; value: ReactNode; title?: string; caption?: string; captionTone?: "danger" | "success"; href: string;
  // 0–100: a thin bar under the figure (a target, say).
  progress?: number | null;
}) {
  return (
    <Link href={href} className="group flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand sm:p-4">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-text-muted sm:text-sm">{label}</span>
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-4 ${TONE_CHIP[tone]}`} aria-hidden="true">{icon}</span>
      </span>
      <span className="truncate text-xl font-semibold tabular-nums text-text sm:text-2xl" title={title}>{value}</span>
      {progress !== undefined && progress !== null && (
        <span className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
      {caption && <span className={`truncate text-xs ${captionTone === "danger" ? "font-medium text-danger" : captionTone === "success" ? "text-success" : "text-text-muted"}`}>{caption}</span>}
    </Link>
  );
}

export function HomePanel({ title, description, action, children, grow = false }: { title: string; description?: string; action?: ReactNode; children: ReactNode; grow?: boolean }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 md:p-5 ${grow ? "lg:flex-1" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
      {children}<ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

export function AllClear({ title, description, fill = false }: { title: string; description?: string; fill?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-2 ${fill ? "lg:flex-1 lg:justify-center lg:py-6" : ""}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success [&>svg]:size-4" aria-hidden="true"><CheckCircle2 /></span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
    </div>
  );
}

// The "needs attention" list: rows with something to do first, highlighted with their figure; clear rows after, quiet, with "None".
export type AttentionRow = { label: string; value: number | null; display?: string; href: string; tone: "warning" | "danger" };
export function AttentionList({ rows }: { rows: AttentionRow[] }) {
  const shown = rows.filter((row): row is AttentionRow & { value: number } => row.value !== null);
  const flagged = shown.filter((row) => row.value > 0);
  return (
    <ul className="flex flex-col gap-1">
      {[...flagged, ...shown.filter((row) => row.value <= 0)].map((row) => (
        <li key={row.label}>
          {row.value > 0 ? (
            <Link href={row.href} className={`group flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${row.tone === "danger" ? "bg-danger-soft" : "bg-warning-soft"}`}>
              <AlertTriangle className={`size-4 shrink-0 ${row.tone === "danger" ? "text-danger" : "text-warning"}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className={`font-semibold tabular-nums ${row.tone === "danger" ? "text-danger" : "text-warning"}`}>{row.display ?? row.value}</span>
              <ArrowRight className="size-3.5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ) : (
            <Link href={row.href} className="flex min-h-9 items-center gap-3 rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-text-muted hover:bg-surface-muted">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="text-xs">None</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

// What just happened, newest first, grouped by day: "<who> <did what> <record>", the time of day, the record opens from its name.
export type HomeActivity = { key: string; at: string; actor: string | null; verb: string; recordLabel: string; recordName: string; href: string };
const dayLabel = (value: string) => {
  const date = new Date(value);
  const day = dayInDisplayZone(date);
  if (day === dayInDisplayZone()) return "Today";
  if (day === dayInDisplayZone(new Date(Date.now() - 86_400_000))) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: displayTimeZone() });
};
const timeOfDay = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: displayTimeZone() });
const initials = (name: string | null) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const AVATAR = ["bg-brand-soft text-brand", "bg-success-soft text-success", "bg-warning-soft text-warning", "bg-danger-soft text-danger"];
const avatarTone = (name: string | null) => AVATAR[[...(name ?? "")].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATAR.length];

export function ActivityTimeline({ entries, empty }: { entries: HomeActivity[]; empty: string }) {
  if (!entries.length) return <p className="text-sm text-text-muted">{empty}</p>;
  const groups: Array<{ label: string; entries: HomeActivity[] }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at);
    const group = groups[groups.length - 1];
    if (group?.label === label) group.entries.push(entry); else groups.push({ label, entries: [entry] });
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-3 text-xs font-medium text-text-muted">{group.label}<span className="h-px flex-1 bg-border" aria-hidden="true" /></h3>
          <ol className="flex flex-col">
            {group.entries.map((entry, index) => (
              <li key={entry.key} className="relative flex gap-3 pb-4 last:pb-0">
                {index < group.entries.length - 1 && <span className="absolute top-8 bottom-0 left-[13px] w-px bg-border" aria-hidden="true" />}
                <span className={`relative flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarTone(entry.actor)}`} title={entry.actor ?? "System"} aria-hidden="true">
                  {entry.actor ? initials(entry.actor) : <Clock className="size-3.5" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <p className="min-w-0 text-sm leading-6 text-text-secondary">
                    <span className="font-medium text-text">{entry.actor ?? "Someone"}</span>
                    {` ${entry.verb} the ${entry.recordLabel} `}
                    <Link href={entry.href} className="font-medium text-text tabular-nums hover:text-brand hover:underline">{entry.recordName}</Link>
                  </p>
                  <time dateTime={entry.at} title={new Date(entry.at).toLocaleString("en-IN", { timeZone: displayTimeZone() })} className="shrink-0 text-xs leading-6 text-text-muted tabular-nums">{timeOfDay(entry.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
