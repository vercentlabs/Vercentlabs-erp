export type StockContext={organizationId:string;companyId:string;userId:string;permissions:string[];roleSlugs:string[]};
export declare class StockError extends Error{status:number;code:string;}
export declare function stockContext(session:Record<string,unknown>):StockContext;
export declare function getStockDashboard(client:any,context:StockContext):Promise<Record<string,unknown>>;
export declare function listStockResource(client:any,context:StockContext,resource:string,options?:Record<string,unknown>):Promise<Array<Record<string,unknown>>>;
export declare function postStockMovement(client:any,context:StockContext,input:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function createStockTransfer(client:any,context:StockContext,input:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function completeStockTransfer(client:any,context:StockContext,id:string):Promise<Record<string,unknown>>;
