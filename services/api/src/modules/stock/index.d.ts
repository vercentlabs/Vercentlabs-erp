export type StockContext={organizationId:string;companyId:string;userId:string;permissions:string[];roleSlugs:string[]};
export declare class StockError extends Error{status:number;code:string;}
export declare function stockContext(session:Record<string,unknown>):StockContext;
export declare function getStockDashboard(client:any,context:StockContext):Promise<Record<string,unknown>>;
export declare function listStockResource(client:any,context:StockContext,resource:string,options?:Record<string,unknown>):Promise<Array<Record<string,unknown>>>;
export declare function postStockMovement(client:any,context:StockContext,input:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function createStockTransfer(client:any,context:StockContext,input:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function completeStockTransfer(client:any,context:StockContext,id:string):Promise<Record<string,unknown>>;
export declare function diagnoseStockBalanceDrift(client:any,context:StockContext,options?:{repair?:boolean}):Promise<{dryRun:boolean;mismatchCount:number;mismatches:Array<Record<string,unknown>>;repaired:Array<Record<string,unknown>>}>;

export declare function getStockAvailability(client:any,context:StockContext,input?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function reserveStock(client:any,context:StockContext,input?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function releaseStockReservation(client:any,context:StockContext,id:string,options?:{status?:"released"|"cancelled"|"consumed"}):Promise<Record<string,unknown>>;
export declare function listStockReorderCandidates(client:any,context:StockContext,options?:{limit?:number}):Promise<Array<Record<string,unknown>>>;
export declare function listStockOperationOptions(client:any,context:StockContext):Promise<Record<string,Array<Record<string,unknown>>>>;
