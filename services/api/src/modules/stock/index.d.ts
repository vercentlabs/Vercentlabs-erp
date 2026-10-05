export type StockContext={organizationId:string;userId:string;permissions:string[];roleSlugs:string[]};
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
export declare function releaseStockReservation(client:any,context:StockContext,id:string,options?:{status?:"released"|"cancelled"|"consumed";quantity?:number|null;reasonCode?:string|null;reason?:string|null}):Promise<Record<string,unknown>>;
export declare function reserveAvailableStock(client:any,context:StockContext,input:{itemId:string;warehouseId:string;maxQuantity:number;referenceType:string;referenceId:string;salesOrderId?:string;salesOrderLineId?:string;salesQuantityPerBase?:number;salesUom?:string|null}):Promise<{requested:number;reserved:number;reservations:Array<Record<string,any>>;blockedByQuality:boolean}>;
export declare function consumeStockReservation(client:any,context:StockContext,id:string,quantity:number,reference?:{deliveryId?:string;deliveryLineId?:string;issue?:{referenceType:string;referenceId:string;idempotencyKey?:string}}):Promise<Record<string,unknown>>;
export declare function reconcileStockReservations(client:any,context:StockContext,options?:{repair?:boolean}):Promise<{checked:number;mismatchCount:number;mismatches:Array<Record<string,unknown>>;repaired:number}>;
export declare function listStockOperationOptions(client:any,context:StockContext):Promise<Record<string,Array<Record<string,unknown>>>>;

export { createStockBatch, receiveSerializedStock } from "./master-operations.js";
