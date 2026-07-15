import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const results = {};
  for (const [name, sql] of [
    [
      "sessions",
      "DELETE FROM sessions WHERE revoked_at IS NOT NULL OR expires_at <= now() OR idle_expires_at <= now()",
    ],
    [
      "email verification tokens",
      "DELETE FROM email_verification_tokens WHERE used_at IS NOT NULL OR expires_at <= now()",
    ],
    [
      "password reset tokens",
      "DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= now()",
    ],
    [
      "rate limits",
      "DELETE FROM auth_rate_limits WHERE window_started_at < now() - interval '2 days'",
    ],
    [
      "expired invitations",
      "DELETE FROM organization_invitations WHERE accepted_at IS NULL AND expires_at < now() - interval '30 days'",
    ],
  ]) {
    const result = await pool.query(sql);
    results[name] = result.rowCount || 0;
  }
  console.log("Authentication cleanup completed.");
  for (const [name, count] of Object.entries(results))
    console.log(`${name}: ${count}`);
} finally {
  await pool.end();
}
