export type ProcurementClient={query(text:string,values?:unknown[]):Promise<{rows:Array<Record<string,any>>}>};
export type ProcurementContext={organizationId:string;userId:string;permissions:string[];roleSlugs:string[]};
export declare class ProcurementError extends Error{status:number;code:string;constructor(status:number,message:string,code?:string)}
export declare function contentHash(value:unknown):string;
export declare function procurementContext(session:Record<string,any>):ProcurementContext;
export declare function listProcurementRecords(client:ProcurementClient,context:ProcurementContext,resource:string,filters?:Record<string,unknown>):Promise<Record<string,any>>;
export declare function getProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,id:string):Promise<Record<string,any>>;
export declare function createProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,input:Record<string,any>):Promise<Record<string,any>>;
export declare function updateProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,id:string,input:Record<string,any>):Promise<Record<string,any>>;
export declare function transitionProcurementRecord(client:ProcurementClient,context:ProcurementContext,resource:string,id:string,action:string,input?:Record<string,any>):Promise<Record<string,any>>;
export declare function amendPurchaseOrder(client:ProcurementClient,context:ProcurementContext,id:string,input?:Record<string,any>):Promise<Record<string,any>>;
export declare function runProcurementMatch(client:ProcurementClient,context:ProcurementContext,input:Record<string,any>):Promise<Record<string,any>>;
export declare function getProcurementDashboard(client:ProcurementClient,context:ProcurementContext):Promise<Record<string,any>>;
export declare function decimal(value:unknown):bigint;
export declare function add(a:unknown,b:unknown):bigint;
export declare function mul(a:unknown,b:unknown):bigint;
export declare function format(value:bigint,places?:number):string;
export declare function allocate(total:unknown,weights:unknown[]):bigint[];


export declare function listProcurementPass1Operations(client:ProcurementClient,context:ProcurementContext,options?:{kind?:string;limit?:number}):Promise<Record<string,any>[]>;
export declare function listProcurementPass1Options(client:ProcurementClient,context:ProcurementContext):Promise<Record<string,Record<string,any>[]>>;
