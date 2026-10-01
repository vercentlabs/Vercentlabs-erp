"use client";

import { CrmReportApiError } from "./reports-api.ts";
import { crmApiClient } from "../../shared/http/crm-request.ts";

// Saved, run and scheduled CRM reports through the shared reporting service
// (report_definitions / report_runs / report_schedules). CRM datasets are
// computed by the canonical CRM metric layer, so a saved report shows the
// same figures as the dashboard.

export type SavedReportDefinition = {
  id: string;
  name: string;
  datasetKey: string;
  datasetLabel: string;
  columns: string[];
  filters: Record<string, string>;
  status: string;
  createdByName: string | null;
  isMine: boolean;
  updatedAt: string;
};

export type ReportRun = {
  id: string;
  datasetKey: string;
  datasetLabel: string;
  definitionName: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  rowCount: number | null;
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
  downloadable: boolean;
};

export type ReportSchedule = {
  id: string;
  definitionId: string;
  definitionName: string | null;
  frequency: "daily" | "weekly" | "monthly";
  timeOfDay: string;
  weekday: number | null;
  monthDay: number | null;
  timezone: string;
  recipients: string[];
  status: "active" | "paused" | "cancelled";
  nextRunAt: string | null;
  lastRunAt: string | null;
  isMine: boolean;
  deliveries: Array<{
    occurrenceAt: string;
    recipientUserId: string;
    status: string;
    reason: string | null;
  }>;
};

const { parseResponse: parse } = crmApiClient(CrmReportApiError);

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export async function listSavedReports(): Promise<SavedReportDefinition[]> {
  const payload = await parse<{ definitions: SavedReportDefinition[] }>(
    await fetch("/api/reports/definitions"),
  );
  return payload.definitions.filter((definition) =>
    definition.datasetKey.startsWith("crm."),
  );
}

export async function saveReport(input: {
  name: string;
  datasetKey: string;
  columns: string[];
  filters: Record<string, string>;
}) {
  return parse<{ definition: { id: string } }>(
    await post("/api/reports/definitions", input),
  );
}

export async function runSavedReport(definitionId: string) {
  return parse<{ run: { id: string } }>(
    await post("/api/reports/runs", { definitionId }),
  );
}

export async function listReportRuns(): Promise<ReportRun[]> {
  const payload = await parse<{ runs: ReportRun[] }>(
    await fetch("/api/reports/runs"),
  );
  return payload.runs.filter((run) => run.datasetKey.startsWith("crm."));
}

export const reportRunDownloadUrl = (runId: string) =>
  `/api/reports/runs/${runId}/download`;

export async function listReportSchedules(): Promise<ReportSchedule[]> {
  return (
    await parse<{ schedules: ReportSchedule[] }>(
      await fetch("/api/reports/schedules"),
    )
  ).schedules;
}

export async function scheduleReport(input: {
  definitionId: string;
  frequency: "daily" | "weekly" | "monthly";
  timeOfDay: string;
  timezone: string;
  weekday?: number | null;
  monthDay?: number | null;
  recipients: string[];
}) {
  return parse<{ schedule: ReportSchedule }>(
    await post("/api/reports/schedules", input),
  );
}

export async function setReportScheduleStatus(
  id: string,
  status: "active" | "paused" | "cancelled",
) {
  return parse<{ schedule: ReportSchedule }>(
    await post(`/api/reports/schedules/${id}/status`, { status }),
  );
}
