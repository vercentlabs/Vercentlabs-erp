export declare class ReferenceIntegrityError extends Error { status:number; code:string; }
export declare function requireCompanyRecord(client:any, context:any, kind:string, id:string, options?:{forUpdate?:boolean}):Promise<any>;
export declare function requireProjectChild(client:any, context:any, kind:"milestone"|"task", id:string|null|undefined, projectId:string):Promise<any>;
