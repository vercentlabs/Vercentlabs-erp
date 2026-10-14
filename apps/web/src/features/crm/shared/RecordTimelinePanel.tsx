"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  ArrowRightLeft,
  History,
  Paperclip,
  StickyNote,
} from "lucide-react";
import {
  Button,
  Timeline,
  type TimelineEntry,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { humanize } from "@/shared/format/human";
import {
  getRecordTimeline,
  type RecordTimelineRow,
  type TimelineKind,
} from "./timeline-api";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const FILTERS: { id: string; label: string; kinds?: TimelineKind[] }[] = [
  { id: "all", label: "All" },
  { id: "activity", label: "Activities", kinds: ["activity"] },
  { id: "note", label: "Notes", kinds: ["note"] },
  { id: "attachment", label: "Files", kinds: ["attachment"] },
  {
    id: "changes",
    label: "Changes",
    kinds: ["stage", "history"],
  },
];

const KIND_ICON = {
  activity: ActivityIcon,
  note: StickyNote,
  attachment: Paperclip,
  stage: ArrowRightLeft,
  history: History,
} as const;

const KIND_TONE: Record<TimelineKind, TimelineEntry["tone"]> = {
  activity: "info",
  note: "neutral",
  attachment: "neutral",
  stage: "warning",
  history: "warning",
};

function describe(row: RecordTimelineRow): string {
  // A lead history entry is already a sentence ("Stage: New → Contacted").
  if (row.kind === "history") return row.title ?? "Lead changed";
  const label = humanize(
    row.kind === "activity" && row.subtype ? row.subtype : row.kind,
  );
  const qualifier =
    row.kind !== "activity" && row.subtype ? ` (${humanize(row.subtype)})` : "";
  return `${label}${qualifier}${row.title ? `: ${row.title}` : ""}`;
}

// F019 activity timeline composed into a record 360: one merged feed of
// tasks and follow-ups, notes, files and the record's own audit events
// (stage, owner, qualification changes), with an author on every entry,
// kind filters and real "Load more" paging. Privacy (private notes, record
// scope) is decided by
// the server; this panel renders whatever the page contains.
export function RecordTimelinePanel({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const workspace = useWorkspaceContext();
  const [filterId, setFilterId] = useState("all");
  const kinds = FILTERS.find((filter) => filter.id === filterId)?.kinds;

  const query = useInfiniteQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "timeline",
      entityType,
      entityId,
      filterId,
    ),
    queryFn: ({ pageParam }) =>
      getRecordTimeline(entityType, entityId, { cursor: pageParam, kinds }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });

  const entries: TimelineEntry[] = useMemo(
    () =>
      (query.data?.pages ?? []).flatMap((page) =>
        page.page.rows.map((row) => ({
          id: `${row.kind}-${row.id}`,
          icon: KIND_ICON[row.kind] ?? ActivityIcon,
          tone: KIND_TONE[row.kind] ?? "neutral",
          title: describe(row),
          description:
            [
              row.actorName ? `By ${row.actorName}` : null,
              row.status ? `Status: ${humanize(row.status)}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          timestamp: dateTimeFormatter.format(new Date(row.occurredAt)),
        })),
      ),
    [query.data],
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter timeline"
      >
        {FILTERS.map((filter) => (
          <Button
            key={filter.id}
            variant={filterId === filter.id ? "primary" : "secondary"}
            onPress={() => setFilterId(filter.id)}
          >
            {filter.label}
          </Button>
        ))}
      </div>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading activity…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          Activity could not be loaded.
        </p>
      ) : (
        <Timeline
          entries={entries}
          emptyMessage={
            filterId === "all"
              ? "No activity recorded yet."
              : "Nothing of this kind recorded yet."
          }
        />
      )}
      {query.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            onPress={() => query.fetchNextPage()}
            isLoading={query.isFetchingNextPage}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
