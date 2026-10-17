// Assets — Automatic Depreciation Accounting (types for the web and the worker).
type Client = any;
type Ctx = { organizationId: string; userId: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };
export declare const DEPRECIATION_AUTOMATION_MESSAGES: Readonly<Record<string, string>>;
export declare const DEPRECIATION_AUTOMATION_PERMISSIONS: Readonly<Record<string, string>>;
export declare const DEPRECIATION_AUTOMATION_REPORTS: readonly string[];
export declare function configureDepreciationAutomation(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function disableAutomaticDepreciationPosting(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function enableAutomaticDepreciationPosting(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function retryDepreciationExecution(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function runDepreciationAutomation(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function triggerDepreciationAutomation(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function validateAutomationReadiness(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getDepreciationAutomation(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getDepreciationAutomationAudit(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getDepreciationAutomationReport(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getDepreciationExecution(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function getDepreciationJournalPreview(client: Client, c: Ctx, ...args: any[]): Promise<any>;
export declare function listDepreciationExecutions(client: Client, c: Ctx, ...args: any[]): Promise<any>;
