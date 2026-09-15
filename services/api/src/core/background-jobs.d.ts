export declare class BackgroundJobError extends Error {
  status: number;
}
export declare function listBackgroundJobs(client: any, organizationId: string, options?: { status?: string; limit?: number }): Promise<any[]>;
export declare function getBackgroundJob(client: any, organizationId: string, jobId: string): Promise<any>;
