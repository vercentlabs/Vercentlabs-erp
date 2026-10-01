"use client";

import { Button, StatusBadge } from "@vercentlabs/design-system";
import { formatDateTime, humanize } from "@/shared/format/human";
import type { ForecastWorkspace } from "../api/forecast-api";

export function SnapshotsSection({
  data,
  onOpen,
}: {
  data: ForecastWorkspace;
  onOpen: (captureId: string) => void;
}) {
  return (
    <section
      aria-label="Forecast snapshots"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">Snapshots</h2>
        <span className="text-xs text-text-muted">
          Taken daily, when a period is locked or closed, and on demand. A
          snapshot never changes.
        </span>
      </div>
      {data.captures.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No snapshots for this period yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {data.captures.map((capture) => (
            <li
              key={capture.id}
              className="flex flex-wrap items-center gap-3 py-2 text-sm"
            >
              <span className="font-medium text-text">
                {formatDateTime(capture.capturedAt)}
              </span>
              <StatusBadge tone="neutral">
                {humanize(capture.source)}
              </StatusBadge>
              <span className="text-text-muted">{`${capture.rowCount} rows`}</span>
              <Button
                size="compact"
                variant="ghost"
                className="ml-auto"
                onPress={() => onOpen(capture.id)}
                aria-label={`Open snapshot from ${formatDateTime(capture.capturedAt)}`}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
