"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, ArrowRightLeft, CheckCircle2, Mail, MessageCircle, Paperclip, Phone, StickyNote, UserCog } from "lucide-react";
import { Button, Timeline, type TimelineEntry } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { humanize } from "./human";
import { getRecordTimeline, type RecordTimelineRow, type TimelineKind } from "./timeline-api";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

const FILTERS: { id: string; label: string; kinds?: TimelineKind[] }[] = [
  { id: "all", label: "All" },
  { id: "activity", label: "Activities", kinds: ["activity"] },
  { id: "communication", label: "Communications", kinds: ["communication"] },
  { id: "note", label: "Notes", kinds: ["note"] },
  { id: "attachment", label: "Files", kinds: ["attachment"] },
  { id: "changes", label: "Changes", kinds: ["stage", "assignment", "qualification"] },
];

const KIND_ICON = {
  activity: ActivityIcon,
  communication: Mail,
  note: StickyNote,
  attachment: Paperclip,
  stage: ArrowRightLeft,
  assignment: UserCog,
  qualification: CheckCircle2,
} as const;

const KIND_TONE: Record<TimelineKind, TimelineEntry["tone"]> = {
  activity: "info",
  communication: "neutral",
  note: "neutral",
  attachment: "neutral",
  stage: "warning",
  assignment: "warning",
  qualification: "success",
};

// Communication icons follow the channel, not just "message".
const CHANNEL_ICON: Record<string, typeof Mail> = { call: Phone, phone: Phone, whatsapp: MessageCircle, sms: MessageCircle };

function describe(row: RecordTimelineRow): string {
  // Qualification events store state codes (not_reviewed → unqualified); show words.
  if (row.kind === "qualification" && row.title) {
    const [change, ...rest] = row.title.split(" — ");
    const words = change.split(" → ").map((code) => humanize(code)).join(" → ");
    return `Qualification: ${[words, ...rest].join(" — ")}`;
  }
  const label = humanize(row.kind === "activity" && row.subtype ? row.subtype : row.kind);
  const qualifier = row.kind !== "activity" && row.subtype ? ` (${humanize(row.subtype)})` : "";
  return `${label}${qualifier}${row.title ? `: ${row.title}` : ""}`;
}

// F019 activity timeline composed into a record 360: one merged feed of
// calls/meetings/tasks/follow-ups, communications, notes, files and the
// record's own audit events (stage, owner, qualification changes), with an
// author on every entry, kind filters and real "Load more" paging. Privacy
// (private notes, restricted communications, record scope) is decided by
// the server; this panel renders whatever the page contains.
export function RecordTimelinePanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const workspace = useWorkspaceContext();
  const [filterId, setFilterId] = useState("all");
  const kinds = FILTERS.find((filter) => filter.id === filterId)?.kinds;

  const query = useInfiniteQuery({
    queryKey: scopedQueryKey(workspace, "crm", "timeline", entityType, entityId, filterId),
    queryFn: ({ pageParam }) => getRecordTimeline(entityType, entityId, { cursor: pageParam, kinds }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });

  const entries: TimelineEntry[] = useMemo(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.page.rows.map((row) => ({
          id: `${row.kind}-${row.id}`,
          icon: (row.kind === "communication" && row.subtype ? CHANNEL_ICON[row.subtype.toLowerCase()] : undefined) ?? KIND_ICON[row.kind] ?? ActivityIcon,
          tone: KIND_TONE[row.kind] ?? "neutral",
          title: describe(row),
          description:
            [row.kind === "communication" && row.status === "received" ? "Received" : row.actorName ? `By ${row.actorName}` : null, row.status && row.kind !== "qualification" && !(row.kind === "communication" && row.status === "received") ? `Status: ${humanize(row.status)}` : null].filter(Boolean).join(" · ") || undefined,
          timestamp: dateTimeFormatter.format(new Date(row.occurredAt)),
        })),
      ),
    [query.data],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter timeline">
        {FILTERS.map((filter) => (
          <Button key={filter.id} variant={filterId === filter.id ? "primary" : "secondary"} onPress={() => setFilterId(filter.id)}>
            {filter.label}
          </Button>
        ))}
      </div>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading activity…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">Activity could not be loaded.</p>
      ) : (
        <Timeline entries={entries} emptyMessage={filterId === "all" ? "No activity recorded yet." : "Nothing of this kind recorded yet."} />
      )}
      {query.hasNextPage && (
        <div>
          <Button variant="secondary" onPress={() => query.fetchNextPage()} isLoading={query.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
