export type ProjectsContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getProjectsDashboard(client: any, context: ProjectsContext): Promise<any>;
export declare function listProjectResource(client: any, context: ProjectsContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function createProject(client: any, context: ProjectsContext, input: Record<string, any>): Promise<any>;
export declare function createProjectTask(client: any, context: ProjectsContext, input: Record<string, any>): Promise<any>;
export declare function createTimeEntry(client: any, context: ProjectsContext, input: Record<string, any>): Promise<any>;
export declare function transitionProject(client: any, context: ProjectsContext, projectId: string, action: string): Promise<any>;
export declare function approveTimeEntry(client: any, context: ProjectsContext, timeEntryId: string, approve: boolean, reason?: string | null): Promise<any>;
export declare function getProjectProfitability(client: any, context: ProjectsContext, projectId: string): Promise<any>;
