export type StockContext={organizationId:string;userId:string;permissions:string[];roleSlugs:string[]};
export declare class StockError extends Error{status:number;code:string;}
export declare function stockContext(session:Record<string,unknown>):StockContext;
export declare function getStockDashboard(client:any,context:StockContext):Promise<Record<string,unknown>>;
export declare function postStockMovement(client:any,context:StockContext,input:Record<string,unknown>):Promise<Record<string,unknown>>;

export declare function getStockAvailability(client:any,context:StockContext,input?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function reserveStock(client:any,context:StockContext,input?:Record<string,unknown>):Promise<Record<string,unknown>>;
export declare function releaseStockReservation(client:any,context:StockContext,id:string,options?:{status?:"released"|"cancelled"|"consumed";quantity?:number|null;reasonCode?:string|null;reason?:string|null}):Promise<Record<string,unknown>>;
export declare function reserveAvailableStock(client:any,context:StockContext,input:{itemId:string;warehouseId:string;maxQuantity:number;referenceType:string;referenceId:string;salesOrderId?:string;salesOrderLineId?:string;salesQuantityPerBase?:number;salesUom?:string|null}):Promise<{requested:number;reserved:number;reservations:Array<Record<string,any>>;blockedByQuality:boolean}>;
export declare function consumeStockReservation(client:any,context:StockContext,id:string,quantity:number,reference?:{deliveryId?:string;deliveryLineId?:string;issue?:{referenceType:string;referenceId:string;idempotencyKey?:string}}):Promise<Record<string,unknown>>;
export declare function listStockOperationOptions(client:any,context:StockContext):Promise<Record<string,Array<Record<string,unknown>>>>;

export { createStockBatch, receiveSerializedStock } from "./master-operations.js";
export declare function reverseStockMovements(client:any,context:StockContext,movementIds:string[],options?:{reason?:string;referenceType?:string;referenceId?:string;keyPrefix?:string}):Promise<{groupId:string|null;movements:Record<string,unknown>[]}>;
export declare function reverseInventoryMovementGroup(client:any,context:StockContext,groupId:string,options?:{reason?:string;referenceType?:string;referenceId?:string;keyPrefix?:string}):Promise<{groupId:string|null;movements:Record<string,unknown>[]}>;
export declare const RESERVATION_SOURCES:Readonly<Record<string,{label:string;sql:string}>>;
export declare function reallocateStockReservation(client:any,context:StockContext,id:string,input?:{warehouseId?:string|null;locationId?:string|null;batchId?:string|null;serialId?:string|null;reason?:string}):Promise<Record<string,unknown>>;
export declare function expireStockReservations(client:any,context:StockContext):Promise<{expired:number}>;
export declare function releaseReservation(client:any,context:StockContext,id:string,input?:{quantity?:number|string|null;reason?:string}):Promise<Record<string,unknown>>;

export declare function moveStockWithinWarehouse(client:any,context:StockContext,input:{itemId:string;warehouseId:string;fromLocationId?:string|null;toLocationId?:string|null;batchId?:string|null;serialIds?:string[];quantity:string;referenceType:string;referenceId:string;reason?:string;idempotencyKey:string}):Promise<{movements:Record<string,unknown>[]}>;
