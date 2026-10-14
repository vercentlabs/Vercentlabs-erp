export declare class ReferenceIntegrityError extends Error { status:number; code:string; }
export declare function requireOrganizationRecord(client:any, context:any, kind:string, id:string, options?:{forUpdate?:boolean}):Promise<any>;
export declare const requireCompanyRecord: typeof requireOrganizationRecord;
