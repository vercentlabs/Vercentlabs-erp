type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string };
type Env = Record<string, string | undefined>;

export const PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT: string;
export const INBOUND_MAIL_TARGETS: ReadonlyArray<Readonly<{ key: string; moduleKey: string; label: string }>>;
export class InboundMailError extends Error {
  status: number;
  code: string;
}
export type InboundMailRouteSummary = {
  id: string;
  name: string;
  target: string;
  targetLabel: string;
  companyId: string;
  companyName: string | null;
  recordedAsUserId: string;
  recordedAsName: string | null;
  routeKeyPrefix: string;
  status: "active" | "disabled";
  createdAt: string;
  lastReceivedAt: string | null;
  receivedCount: number;
};
export function listInboundMailRoutes(client: Client, organizationId: string): Promise<InboundMailRouteSummary[]>;
export function createInboundMailRoute(
  client: Client,
  session: Session,
  input: { name: string; target: string; companyId: string; recordedAsUserId?: string | null },
  env?: Env,
): Promise<{ route: InboundMailRouteSummary; routeKey: string; signingSecret: string }>;
export function setInboundMailRouteStatus(client: Client, session: Session, routeId: string, status: "active" | "disabled"): Promise<InboundMailRouteSummary>;
export function listInboundMailEvents(client: Client, organizationId: string, options?: { routeId?: string | null; limit?: number }): Promise<
  Array<{ id: string; routeId: string | null; provider: string; subject: string | null; status: string; outcome: string | null; error: string | null; ticketId: string | null; receivedAt: string; processedAt: string | null; attachmentNotes: unknown }>
>;
export function resolveInboundMailRoute(client: Client, routeKey: string): Promise<Record<string, any>>;
export function verifyInboundMailSignature(rawBody: string, signatureValue: string | null, secret: string): void;
export function routeSigningSecret(route: Record<string, any>, env?: Env): Promise<string>;
export function normalizeInboundMessage(payload: unknown): {
  provider: string;
  messageId: string;
  references: string[];
  from: string;
  fromName: string | null;
  to: string[];
  subject: string;
  text: string;
  attachments: Array<{ fileName: string; contentType: string; contentBase64: string }>;
};
export function recordInboundMailEvent(client: Client, input: { route: Record<string, any>; message: ReturnType<typeof normalizeInboundMessage>; payloadDigest: string }): Promise<{ event: Record<string, any>; replayed: boolean }>;
export function completeInboundMailEvent(client: Client, eventId: string, input: { status: string; outcome?: string | null; error?: string | null; ticketId?: string | null; communicationId?: string | null; attachmentNotes?: unknown[] }): Promise<void>;
export function inboundPayloadDigest(rawBody: string): string;
