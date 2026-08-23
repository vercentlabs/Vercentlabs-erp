export type SupportContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getSupportDashboard(client: any, context: SupportContext): Promise<any>;
export declare function listSupportResource(client: any, context: SupportContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function createSupportQueue(client: any, context: SupportContext, input: Record<string, any>): Promise<any>;
export declare function createSlaPolicy(client: any, context: SupportContext, input: Record<string, any>): Promise<any>;
export declare function createSupportTicket(client: any, context: SupportContext, input: Record<string, any>): Promise<any>;
export declare function assignSupportTicket(client: any, context: SupportContext, ticketId: string, input: Record<string, any>): Promise<any>;
export declare function addSupportCommunication(client: any, context: SupportContext, ticketId: string, input: Record<string, any>): Promise<any>;
export declare function transitionSupportTicket(client: any, context: SupportContext, ticketId: string, input: Record<string, any>): Promise<any>;
export declare function createKnowledgeArticle(client: any, context: SupportContext, input: Record<string, any>): Promise<any>;
