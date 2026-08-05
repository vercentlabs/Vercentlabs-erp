export type HrPayrollContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getHrPayrollDashboard(client: any, context: HrPayrollContext): Promise<any>;
export declare function listHrPayrollResource(client: any, context: HrPayrollContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function createEmployee(client: any, context: HrPayrollContext, input: Record<string, any>): Promise<any>;
export declare function createLeaveRequest(client: any, context: HrPayrollContext, input: Record<string, any>): Promise<any>;
export declare function reviewLeaveRequest(client: any, context: HrPayrollContext, leaveRequestId: string, input: Record<string, any>): Promise<any>;
export declare function createPayrollRun(client: any, context: HrPayrollContext, input: Record<string, any>): Promise<any>;
export declare function calculatePayrollRun(client: any, context: HrPayrollContext, payrollRunId: string): Promise<any>;
export declare function transitionPayrollRun(client: any, context: HrPayrollContext, payrollRunId: string, input: Record<string, any>): Promise<any>;
