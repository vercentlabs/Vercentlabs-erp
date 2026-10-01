import type { CrmContext, QueryClient } from "../index.js";

export type CrmPipelineSnapshotCaptureResult = {
  snapshotDate: string;
  source: "scheduled" | "manual";
  pipelinesProcessed: number;
  rowsWritten: number;
  rowsSkippedDuplicate: number;
};

// Raw snake_case rows straight from the query (listPipelineSnapshots does
// not camelize) — id, organization_id, pipeline_id, company_id, stage_id,
// currency_code, snapshot_date, opportunity_count, amount, weighted_amount,
// source, captured_by, captured_at. Callers (the API route) camelize.
export type CrmPipelineStageSnapshot = Record<string, unknown>;

export function capturePipelineSnapshots(
  client: QueryClient,
  context: CrmContext,
  options?: {
    source?: "scheduled" | "manual";
    capturedBy?: string | null;
    snapshotDate?: string;
    pipelineId?: string;
  },
): Promise<CrmPipelineSnapshotCaptureResult>;

export function listPipelineSnapshots(
  client: QueryClient,
  context: CrmContext,
  options?: { pipelineId?: string; limit?: number },
): Promise<CrmPipelineStageSnapshot[]>;
