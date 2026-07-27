export type ProcurementClient={query(text:string,values?:unknown[]):Promise<{rows:Array<Record<string,unknown>>}>};
export type ProcurementContext={organizationId:string;userId:string;activeCompanyId:string|null;activeBranchId:string|null;allowAllCompanies:boolean;permissions:string[];roleSlugs:string[]};
export declare class ProcurementError extends Error{status:number;code:string;constructor(status:number,message:string,code?:string)}
export declare function procurementContext(session:Record<string,unknown>):ProcurementContext;
export declare function listProcurementRecords(client:ProcurementClient,context:ProcurementContext,resource:string,filters?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function getProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,id:string):Promise<Record<string,unknown>>;
export declare function createProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,input:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function transitionProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,id:string,action:string,input?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function getProcurementDashboard(client:ProcurementClient,context:ProcurementContext):Promise<Record<string,unknown>>;
export declare function getProcurementReport(client:ProcurementClient,context:ProcurementContext,report:string,filters?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function evaluateSupplierScore(weights:Record<string,unknown>,scores:Record<string,unknown>):string;
