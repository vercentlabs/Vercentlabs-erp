import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type TransactionClient = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/** Accepted by read-only repository/query functions that run equally well inside or outside an open transaction. */
export type QueryExecutor = NodePgDatabase | TransactionClient;
