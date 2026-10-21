/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Context = { organizationId: string; userId: string | null; permissions: string[]; roleSlugs: string[] };
type Input = Record<string, any>;

// Schemes and special rates (Sales audit M3).
export function listPricingRules(client: Client, context: Context, filters?: { search?: string; status?: string; type?: string; partyId?: string; itemId?: string }): Promise<any>;
export function getPricingRule(client: Client, context: Context, ruleId: string): Promise<any>;
export function createPricingRule(client: Client, context: Context, input: Input): Promise<any>;
export function updatePricingRule(client: Client, context: Context, ruleId: string, input: Input): Promise<any>;
export function setPricingRuleStatus(client: Client, context: Context, ruleId: string, action: "activate" | "deactivate" | "delete"): Promise<any>;
