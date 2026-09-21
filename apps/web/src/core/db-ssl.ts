// Database TLS policy. Certificate verification is always on in production;
// DATABASE_SSL_INSECURE only relaxes it for local development and test.
export type DbSslConfig = { rejectUnauthorized: boolean; ca?: string } | undefined;

export function resolveDbSsl(env: Record<string, string | undefined>): DbSslConfig {
  if (env.DATABASE_SSL !== "true") return undefined;
  const production = env.NODE_ENV === "production";
  const insecure = env.DATABASE_SSL_INSECURE === "true";
  if (production && insecure) {
    throw new Error("DATABASE_SSL_INSECURE is not allowed in production. Provide DATABASE_SSL_CA instead.");
  }
  const ca = env.DATABASE_SSL_CA ? env.DATABASE_SSL_CA.replace(/\\n/g, "\n") : undefined;
  return { rejectUnauthorized: !insecure, ...(ca ? { ca } : {}) };
}
