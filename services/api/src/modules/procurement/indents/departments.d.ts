// Departments for purchase requests (report Phase 3).
export declare const INDENT_APPROVAL: string;
export declare function listProcurementDepartments(client: any, context: any, options?: { includeInactive?: boolean }): Promise<Array<{ id: string; name: string; headUserId: string | null; headName: string | null; active: boolean }>>;
export declare function saveProcurementDepartment(client: any, context: any, input?: Record<string, unknown>): Promise<{ id: string }>;
export declare function departmentOf(client: any, organizationId: string, departmentId: string | null): Promise<Record<string, any> | null>;
export declare function indentApprovalContent(client: any, organizationId: string, indentId: string): Promise<{ amount: string; contentKey: string }>;
