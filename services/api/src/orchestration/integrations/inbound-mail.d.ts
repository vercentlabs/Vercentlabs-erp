type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
export function receiveInboundMail(
  runners: { runPlatform: <T>(work: (client: Client) => Promise<T>) => Promise<T>; runTenant: <T>(organizationId: string, work: (client: Client) => Promise<T>) => Promise<T> },
  input: { routeKey: string; rawBody: string; signature: string | null },
  env?: Record<string, string | undefined>,
): Promise<{ eventId: string; replayed: boolean; outcome?: string; ticketId?: string | null; communicationId?: string }>;
export function sendInboundMailTest(
  runners: { runTenant: <T>(organizationId: string, work: (client: Client) => Promise<T>) => Promise<T> },
  session: { organizationId: string; userId: string },
  routeId: string,
  env?: Record<string, string | undefined>,
): Promise<{ eventId: string; replayed: boolean; outcome?: string; ticketId?: string | null; recordType?: string | null; recordId?: string | null }>;
