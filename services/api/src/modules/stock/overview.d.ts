import type { StockContext } from "./index.js";
type Client = any;
export declare function getInventoryOverview(client: Client, context: StockContext): Promise<Record<string, unknown>>;
export declare function getInventoryAttentionBadges(client: Client, context: StockContext): Promise<Record<string, string | number | null>>;
export declare function searchInventory(client: Client, context: StockContext, query: string): Promise<{ results: Array<{ kind: string; kindLabel: string; id: string; title: string; subtitle: string | null; href: string }> }>;
