type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export type JobPresentation = { jobType: string; label: string; category: string; userVisible: boolean };
export const JOB_TYPE_PRESENTATION: readonly JobPresentation[];
export const USER_VISIBLE_JOB_TYPES: readonly string[];
export function jobPresentation(jobType: string): JobPresentation;

export class BackgroundJobError extends Error {
  status: number;
  code: string;
}
export const JOB_OPERATIONS_PERMISSION: "automation.view";
export function redactJobError(message: string | null | undefined): string | null;
export type JobViewer = { organizationId: string; userId: string; operations: boolean };
export type JobView = {
  id: string;
  label: string;
  category: string;
  jobType?: string;
  status: "pending" | "processing" | "completed" | "dead" | "cancelled";
  requestedByMe: boolean;
  requestedByName?: string | null;
  attempts?: number;
  maxAttempts?: number;
  progress: Record<string, number | boolean>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result?: Record<string, number | boolean>;
  hasOutput?: boolean;
};
export function listJobsForViewer(client: Client, viewer: JobViewer, options?: { status?: string; limit?: number }): Promise<JobView[]>;
export function getJobForViewer(client: Client, viewer: JobViewer, jobId: string): Promise<JobView>;
