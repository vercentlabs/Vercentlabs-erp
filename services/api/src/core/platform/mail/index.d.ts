type Env = Record<string, string | undefined>;
export function setMailTransportForTests(transport: { sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }> } | null): void;
export function smtpConfiguration(env?: Env): { host: string; port: number; secure: boolean; user: string; password: string; from: string; replyTo: string } | null;
export function getMailTransport(env?: Env): { transporter: { sendMail(message: Record<string, unknown>): Promise<any> }; from: string; replyTo: string | null } | null;
export function escapeHtml(value: unknown): string;
export function sendMail(message: { to: string; cc?: string[] | string; subject: string; text: string; html?: string; replyTo?: string; attachments?: Array<{ filename: string; content: Uint8Array; contentType?: string }>; messageId?: string; inReplyTo?: string; references?: string[]; fromName?: string; headers?: Record<string, string> }, env?: Env): Promise<{ sent: boolean; reason?: string; messageId?: string | null }>;
export function renderTransactionalEmail(input: { heading: string; body: string; actionLabel?: string; actionUrl?: string }): { text: string; html: string };
export function sendTransactionalEmail(
  input: { to: string; subject: string; heading: string; body: string; actionLabel?: string; actionUrl?: string },
  env?: Env,
): Promise<{ sent: boolean; reason?: string; messageId?: string | null }>;

type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
// Delivery log and security-mail queue (outbox.js)
export function logMail(client: Queryable, input: { organizationId?: string | null; kind?: "business" | "security"; template?: string | null; recipients: unknown; subject?: string | null; status: string; via?: string | null; messageId?: string | null; error?: unknown }): Promise<void>;
export function queueSecurityMail(client: Queryable, input: Record<string, unknown> & { type: string; email: string }, env?: Env): Promise<boolean>;
export function processMailQueue(client: Queryable, options?: { limit?: number; env?: Env; deliver?: (input: any, env: Env) => Promise<boolean> }): Promise<{ sent: number; retry: number; failed: number; bounced: number }>;
export type MailLogEntry = { id: string; kind: string; template: string | null; recipients: string[]; subject: string | null; status: string; via: string | null; attempts: number; error: string | null; createdAt: string; sentAt: string | null };
export function listMailLog(client: Queryable, organizationId: string, options?: { limit?: number; status?: string | null }): Promise<MailLogEntry[]>;
// How the company's email is sent (company-sender.js)
export declare class MailSettingsError extends Error { status: number; code: string; details?: unknown }
export type MailSettings = {
  mode: "platform" | "domain" | "smtp"; fromName: string | null; fromAddress: string | null; replyTo: string | null; domain: string | null; domainVerifiedAt: string | null;
  dnsRecords: Array<{ type: string; host: string; value: string; note?: string }>;
  smtp: { host: string; port: number; secure: boolean; username: string; verifiedAt: string | null } | null; lastError: string | null; active: boolean;
};
export function getMailSettings(client: Queryable, organizationId: string, env?: Env): Promise<MailSettings>;
export function saveMailSettings(client: Queryable, session: Session, input: Record<string, unknown>, env?: Env): Promise<MailSettings>;
export function setupMailDomain(client: Queryable, session: Session, input: { domain: string }, env?: Env): Promise<MailSettings>;
export function verifyMailDomain(client: Queryable, session: Session, env?: Env, resolveTxt?: (host: string) => Promise<string[][]>): Promise<{ verified: boolean; problems: string[]; settings: MailSettings }>;
export function saveCompanySmtp(client: Queryable, session: Session, input: Record<string, unknown>, env?: Env, options?: { createTransport?: (options: any) => any }): Promise<{ verified: boolean; error: string | null; settings: MailSettings }>;
export function companyMailTransport(client: Queryable, organizationId: string, env?: Env): Promise<{ transporter: any; from: string; fromName?: string | null; replyTo: string | null; via: string; dkim?: Record<string, string> } | null>;

// Mail queued by this process and not yet tried; the web sends it right after the transaction commits.
export function mailWaiting(): boolean;
export function sendWaitingMail(client: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> }, options?: Record<string, unknown>): Promise<Record<string, number> | null>;
