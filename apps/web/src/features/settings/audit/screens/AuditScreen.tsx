"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Drawer, EmptyState, ErrorState, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { AUDIT_AREAS, auditEntityLabel, auditEventLabel, auditFieldLabel, auditValueText, isKnownAuditEvent } from "../audit-labels";

type AuditEvent = { id: string; eventType: string; entityType: string; entityId: string | null; actorName: string | null; createdAt: string };
type AuditDetail = AuditEvent & { metadata: unknown; before: unknown; after: unknown; request: { ipAddress: string | null; userAgent: string | null } | null };

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The audit log could not be loaded.");
  return payload as T;
}

const dayFormatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" });

function FieldList({ title, value }: { title: string; value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-sm">
        {Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
          <div key={key} className="contents">
            <dt className="text-text-muted">{auditFieldLabel(key)}</dt>
            <dd className="break-words text-text">{auditValueText(entry)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useQuery({ queryKey: ["settings", "audit", "event", id], queryFn: () => get<{ event: AuditDetail }>(`/api/settings/audit/${id}`), enabled: Boolean(id) });
  const event = query.data?.event;
  return (
    <Drawer isOpen={Boolean(id)} onOpenChange={(open) => !open && onClose()} title={event ? auditEventLabel(event.eventType) : "Audit event"}>
      {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {query.isError && <p role="alert" className="text-sm text-danger">This event could not be loaded.</p>}
      {event && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-text-muted">When</dt>
            <dd>{dateTimeFormatter.format(new Date(event.createdAt))}</dd>
            <dt className="text-text-muted">Who</dt>
            <dd>{event.actorName ?? "System"}</dd>
            <dt className="text-text-muted">Record</dt>
            <dd>{auditEntityLabel(event.entityType)}</dd>
          </dl>
          <FieldList title="Before" value={event.before} />
          <FieldList title="After" value={event.after} />
          <FieldList title="Details" value={event.metadata} />
          {event.request && <FieldList title="Device" value={{ "IP address": event.request.ipAddress, Browser: event.request.userAgent }} />}
          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer">Technical reference</summary>
            <p className="mt-1 break-all">{`${event.eventType} · ${event.entityType}${event.entityId ? ` · ${event.entityId}` : ""}`}</p>
          </details>
        </div>
      )}
    </Drawer>
  );
}

export function AuditScreen({ canView }: { canView: boolean }) {
  const [actor, setActor] = useState("");
  const [area, setArea] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const actors = useQuery({ queryKey: ["settings", "audit", "actors"], queryFn: () => get<{ actors: Array<{ id: string; name: string }> }>("/api/settings/audit/actors"), enabled: canView });
  const feed = useInfiniteQuery({
    queryKey: ["settings", "audit", actor, area, from, to],
    enabled: canView,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (actor) params.set("actorUserId", actor);
      if (area) params.set("area", area);
      if (from) params.set("from", from);
      if (to) params.set("to", new Date(new Date(to).getTime() + 86_400_000).toISOString().slice(0, 10));
      if (pageParam) params.set("cursor", pageParam);
      return get<{ events: AuditEvent[]; nextCursor: string | null }>(`/api/settings/audit?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  if (!canView) {
    return <PermissionState title="You can't view the audit log" description="Ask an administrator for access to view audit history." />;
  }

  const events = feed.data?.pages.flatMap((page) => page.events) ?? [];
  const byDay = new Map<string, AuditEvent[]>();
  for (const event of events) {
    const day = dayFormatter.format(new Date(event.createdAt));
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  const filtered = Boolean(actor || area || from || to);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Audit" description="Who did what in your organization. This history cannot be changed." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" key={resetKey} aria-label="Audit filters">
        <Select
          label="Person"
          options={[{ value: "", label: "Anyone" }, ...(actors.data?.actors ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]}
          selectedKey={actor}
          onSelectionChange={(key) => setActor(String(key ?? ""))}
        />
        <Select
          label="Area"
          options={[{ value: "", label: "All areas" }, ...AUDIT_AREAS.map((entry) => ({ value: entry.key, label: entry.label }))]}
          selectedKey={area}
          onSelectionChange={(key) => setArea(String(key ?? ""))}
        />
        <DatePicker label="From" onChange={(value) => setFrom(value ? value.toString() : null)} />
        <DatePicker label="To" onChange={(value) => setTo(value ? value.toString() : null)} />
      </div>
      {filtered && (
        <div>
          <Button
            variant="secondary"
            size="compact"
            onPress={() => {
              setActor("");
              setArea("");
              setFrom(null);
              setTo(null);
              setResetKey((key) => key + 1);
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      {feed.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : feed.isError ? (
        <ErrorState title="Could not load the audit log" description="Something went wrong." action={{ label: "Retry", onPress: () => feed.refetch() }} />
      ) : events.length === 0 ? (
        <EmptyState title="No activity" description={filtered ? "Nothing matches these filters." : "Activity appears here as people use the workspace."} />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDay.entries()].map(([day, dayEvents]) => (
            <section key={day} aria-label={day} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{day}</h2>
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <Button variant="ghost" className="flex h-auto w-full flex-col items-start gap-0.5 px-4 py-3 text-left" onPress={() => setSelected(event.id)}>
                      <span className="text-sm font-medium text-text">{auditEventLabel(event.eventType)}</span>
                      <span className="text-xs text-text-secondary">
                        {`${event.actorName ?? "System"} · ${timeFormatter.format(new Date(event.createdAt))} · ${auditEntityLabel(event.entityType)}`}
                        {!isKnownAuditEvent(event.eventType) ? ` · ${event.eventType}` : ""}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {feed.hasNextPage && (
            <div>
              <Button variant="secondary" isLoading={feed.isFetchingNextPage} onPress={() => void feed.fetchNextPage()}>
                Load older activity
              </Button>
            </div>
          )}
        </div>
      )}
      <Detail id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
