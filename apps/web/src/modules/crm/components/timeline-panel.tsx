"use client";

import { useEffect, useState } from "react";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, StatePanel, StatusBadge } from "@/shared/design";
import styles from "./timeline-panel.module.css";

type TimelineItem = {
  id: string;
  kind: "activity" | "communication" | "note" | "attachment";
  subtype?: string | null;
  title?: string | null;
  occurredAt: string;
  status?: string | null;
};

type TimelinePage = { rows: TimelineItem[]; hasMore: boolean; nextCursor: string | null };

function label(value?: string | null, fallback = "Update") {
  if (!value) return fallback;
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function kindLabel(item: TimelineItem) {
  if (item.kind === "activity") return label(item.subtype, "Activity");
  if (item.kind === "communication") return label(item.subtype, "Communication");
  if (item.kind === "attachment") return "File";
  return "Note";
}

function statusTone(status?: string | null) {
  if (status === "completed" || status === "delivered" || status === "sent") return "success";
  if (status === "cancelled" || status === "failed") return "danger";
  return "neutral";
}

// F019 — the shared rendering surface for the ONE canonical timeline
// projection (getCrmRecordTimelinePage), consumed by Account/Contact/
// Opportunity 360 (none of the three had a real paginated timeline before
// this feature) via a plain `endpoint` prop so this component makes no
// assumption about which record type it's showing.
export default function TimelinePanel({ endpoint }: { endpoint: string }) {
  const [page, setPage] = useState<TimelinePage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<TimelinePage>(endpoint);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Timeline could not be loaded.");
        setPage({ rows: [], hasMore: false, nextCursor: null });
        return;
      }
      setPage({ rows: result.rows || [], hasMore: Boolean(result.hasMore), nextCursor: result.nextCursor || null });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    const separator = endpoint.includes("?") ? "&" : "?";
    const result = await requestJson<TimelinePage>(`${endpoint}${separator}cursor=${encodeURIComponent(page.nextCursor)}`);
    setLoadingMore(false);
    if (!result.ok) {
      setLoadError(result.message || "Timeline could not be loaded.");
      return;
    }
    setPage((current) => ({
      rows: [...(current?.rows || []), ...(result.rows || [])],
      hasMore: Boolean(result.hasMore),
      nextCursor: result.nextCursor || null,
    }));
  }

  if (page === null) {
    return <StatePanel title="Loading timeline…" />;
  }
  if (loadError && !page.rows.length) {
    return <StatePanel title="Timeline could not be loaded." description={loadError} />;
  }
  if (!page.rows.length) {
    return <StatePanel title="No activity yet" description="Calls, meetings, tasks, follow-ups, emails, notes and files will appear here." />;
  }

  return (
    <div>
      <ul className={styles.list}>
        {page.rows.map((item) => (
          <li key={`${item.kind}:${item.id}`} className={styles.item}>
            <div className={styles.itemHeading}>
              <strong>{item.title || kindLabel(item)}</strong>
              <StatusBadge tone={statusTone(item.status)}>{kindLabel(item)}</StatusBadge>
            </div>
            <span className={styles.itemMeta}>{formatDate(item.occurredAt)}</span>
          </li>
        ))}
      </ul>
      {page.hasMore ? (
        <div className={styles.loadMore}>
          <ActionButton type="button" tone="quiet" busy={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Loading…" : "Load older"}
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
