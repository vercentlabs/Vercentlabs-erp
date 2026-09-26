type Env = Record<string, string | undefined>;
export function setMailTransportForTests(transport: { sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }> } | null): void;
export function smtpConfiguration(env?: Env): { host: string; port: number; secure: boolean; user: string; password: string; from: string; replyTo: string } | null;
export function getMailTransport(env?: Env): { transporter: { sendMail(message: Record<string, unknown>): Promise<any> }; from: string; replyTo: string | null } | null;
export function escapeHtml(value: unknown): string;
export function sendMail(message: { to: string; subject: string; text: string; html?: string; replyTo?: string }, env?: Env): Promise<{ sent: boolean; reason?: string; messageId?: string | null }>;
export function renderTransactionalEmail(input: { heading: string; body: string; actionLabel?: string; actionUrl?: string }): { text: string; html: string };
export function sendTransactionalEmail(
  input: { to: string; subject: string; heading: string; body: string; actionLabel?: string; actionUrl?: string },
  env?: Env,
): Promise<{ sent: boolean; reason?: string; messageId?: string | null }>;
