export declare class TagError extends Error {
  status: number;
}
export declare function createTagDefinition(client: any, session: any, input: any): Promise<any>;
export declare function listTagDefinitions(client: any, organizationId: string, entityType?: string): Promise<any[]>;
export declare function assignEntityTag(client: any, session: any, input: any): Promise<{ tagId: string; replayed: boolean }>;
export declare function removeEntityTag(client: any, session: any, input: any): Promise<void>;
export declare function listEntityTags(client: any, organizationId: string, entityType: string, entityId: string): Promise<any[]>;
