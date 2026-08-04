import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import dotenv from "dotenv";
import pg from "pg";

import {
  completeConversationTranscription,
  synchronizeProviderAccount,
} from "@vercentlabs/api";
import { databaseConfig } from "@vercentlabs/config";
import { setTenantContext } from "@vercentlabs/database";
import { createLogger } from "@vercentlabs/observability";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const config = databaseConfig(process.env, { defaultPoolMaximum: 4 });
const logger = createLogger("vercentlabs-crm-provider-worker");
const workerId = randomUUID();
const batchSize = integerEnvironment("CRM_PROVIDER_BATCH_SIZE", 10, 1, 50);
const maximumAttempts = integerEnvironment(
  "CRM_PROVIDER_MAX_ATTEMPTS",
  5,
  1,
  20,
);
const requestTimeoutMs = integerEnvironment(
  "CRM_PROVIDER_TIMEOUT_MS",
  20_000,
  1_000,
  180_000,
);

const pool = new pg.Pool({
  connectionString: config.connectionString,
  max: Math.min(10, config.poolMaximum),
  idleTimeoutMillis: config.idleTimeoutMilliseconds,
  connectionTimeoutMillis: config.connectionTimeoutMilliseconds,
  query_timeout: config.queryTimeoutMilliseconds,
  statement_timeout: config.statementTimeoutMilliseconds,
  application_name: "vercentlabs-crm-provider-worker",
});

function integerEnvironment(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function credential(reference) {
  const value = String(reference || "").trim();
  if (!value) return null;
  if (!value.startsWith("env:")) {
    throw new Error(
      `Credential ${value} must be resolved by the deployment secret adapter before this worker runs.`,
    );
  }
  const variable = value.slice(4);
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(variable)) {
    throw new Error(`Credential reference ${value} is invalid.`);
  }
  const raw = process.env[variable];
  if (!raw)
    throw new Error(`Credential environment variable ${variable} is missing.`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Credential environment variable ${variable} must contain JSON.`,
    );
  }
}

function retryDelaySeconds(attempts) {
  return Math.min(3600, 30 * 2 ** Math.max(0, Number(attempts || 1) - 1));
}

async function providerRequest({
  endpoint,
  token,
  headers,
  payload,
  idempotencyKey,
}) {
  if (!endpoint || !String(endpoint).startsWith("https://")) {
    throw new Error("Provider credential must include an HTTPS endpoint.");
  }
  const response = await fetch(String(endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...object(headers),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const contentType = response.headers.get("content-type") || "";
  const receipt = contentType.includes("application/json")
    ? await response.json()
    : { body: await response.text() };
  if (!response.ok) {
    throw new Error(
      `Provider request failed (${response.status}): ${JSON.stringify(receipt).slice(0, 500)}`,
    );
  }
  return receipt;
}

async function recordReceipt(client, organizationId, input) {
  const evidence = {
    workerId,
    provider: input.provider,
    jobType: input.jobType,
    jobId: input.jobId,
    providerReference: input.providerReference || null,
    receipt: input.receipt || {},
  };
  await client.query(
    `INSERT INTO tenant.crm_provider_execution_receipts(
       organization_id,job_type,job_id,provider,status,provider_reference,
       receipt,evidence_hash,worker_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      organizationId,
      input.jobType,
      input.jobId,
      input.provider,
      input.status,
      input.providerReference || null,
      JSON.stringify(input.receipt || {}),
      hash(evidence),
      workerId,
    ],
  );
}

async function claimTelephonyCommands(client, organizationId) {
  return (
    await client.query(
      `WITH candidates AS (
         SELECT id FROM tenant.crm_telephony_commands
         WHERE organization_id=$1
           AND status IN ('queued','failed')
           AND next_attempt_at<=now()
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE tenant.crm_telephony_commands command
       SET status='processing',attempts=attempts+1,updated_at=now()
       FROM candidates
       WHERE command.organization_id=$1 AND command.id=candidates.id
       RETURNING command.*`,
      [organizationId, batchSize],
    )
  ).rows;
}

async function dispatchTelephony(client, context, command) {
  const connection = (
    await client.query(
      `SELECT * FROM tenant.crm_telephony_connections
       WHERE organization_id=$1 AND id=$2 AND status='connected'`,
      [context.organizationId, command.connection_id],
    )
  ).rows[0];
  if (!connection) throw new Error("Connected telephony provider not found.");

  let receipt;
  if (connection.provider === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Mock telephony is forbidden in production.");
    }
    receipt = {
      providerReference: `mock-call:${command.id}`,
      accepted: true,
      callbackKey: object(command.payload).callbackKey || null,
    };
  } else {
    const secret = credential(connection.credential_reference);
    receipt = await providerRequest({
      endpoint: secret.endpoint,
      token: secret.token || secret.apiKey,
      headers: secret.headers,
      idempotencyKey: command.idempotency_key,
      payload: {
        source: "vercentlabs-crm",
        provider: connection.provider,
        commandType: command.command_type,
        commandId: command.id,
        conversationId: command.conversation_id,
        webhookKey: connection.webhook_key,
        ...object(command.payload),
      },
    });
  }
  const providerReference = String(
    receipt.providerReference || receipt.callId || receipt.id || command.id,
  );
  await client.query(
    `UPDATE tenant.crm_telephony_commands
     SET status='completed',provider_reference=$3,last_error=NULL,updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, command.id, providerReference],
  );
  await client.query(
    `UPDATE tenant.crm_conversations
     SET status=CASE WHEN status='scheduled' THEN 'in_progress' ELSE status END,
         metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('providerReference',$3),updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, command.conversation_id, providerReference],
  );
  await recordReceipt(client, context.organizationId, {
    jobType: "telephony_command",
    jobId: command.id,
    provider: connection.provider,
    status: "completed",
    providerReference,
    receipt,
  });
}

async function failTelephony(client, context, command, error) {
  const dead = Number(command.attempts) >= maximumAttempts;
  await client.query(
    `UPDATE tenant.crm_telephony_commands
     SET status=$3,last_error=$4,next_attempt_at=now()+make_interval(secs=>$5),updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      command.id,
      dead ? "dead_letter" : "failed",
      String(error.message || error).slice(0, 2000),
      retryDelaySeconds(command.attempts),
    ],
  );
}

async function claimTranscriptionJobs(client, organizationId) {
  return (
    await client.query(
      `WITH candidates AS (
         SELECT id FROM tenant.crm_transcription_jobs
         WHERE organization_id=$1
           AND status IN ('queued','failed')
           AND next_attempt_at<=now()
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE tenant.crm_transcription_jobs job
       SET status='processing',attempts=attempts+1,started_at=COALESCE(started_at,now()),updated_at=now()
       FROM candidates
       WHERE job.organization_id=$1 AND job.id=candidates.id
       RETURNING job.*`,
      [organizationId, batchSize],
    )
  ).rows;
}

async function dispatchTranscription(client, context, job) {
  const recording = (
    await client.query(
      `SELECT * FROM tenant.crm_conversation_recordings
       WHERE organization_id=$1 AND id=$2 AND status='available' AND retention_until>now()`,
      [context.organizationId, job.recording_id],
    )
  ).rows[0];
  if (!recording) throw new Error("Available recording not found or expired.");

  let receipt;
  if (job.provider === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Mock transcription is forbidden in production.");
    }
    receipt = {
      providerJobId: `mock-transcript:${job.id}`,
      transcriptText:
        "Mock transcription completed by the local CRM provider worker.",
      segments: [
        {
          sequence: 1,
          speaker: "speaker-1",
          startsAtSeconds: 0,
          endsAtSeconds: 4,
          text: "Mock transcription completed by the local CRM provider worker.",
        },
      ],
      summary: "Local worker acceptance transcript.",
      sentiment: "neutral",
      actionItems: [],
    };
  } else {
    const secret = credential(job.credential_reference);
    receipt = await providerRequest({
      endpoint: secret.endpoint,
      token: secret.token || secret.apiKey,
      headers: secret.headers,
      idempotencyKey: job.idempotency_key,
      payload: {
        source: "vercentlabs-crm",
        jobId: job.id,
        conversationId: job.conversation_id,
        recording: {
          storageReference: recording.storage_reference,
          mediaType: recording.media_type,
          checksumSha256: recording.checksum_sha256,
        },
        languageCode: job.language_code,
        diarizationEnabled: job.diarization_enabled,
        redactionEnabled: job.redaction_enabled,
      },
    });
  }
  if (!receipt.transcriptText) {
    throw new Error("Transcription provider returned no transcriptText.");
  }
  const transcript = await completeConversationTranscription(
    client,
    context,
    job.id,
    receipt,
  );
  const providerReference = String(
    receipt.providerJobId || receipt.id || transcript.id || job.id,
  );
  await client.query(
    `UPDATE tenant.crm_transcription_jobs SET provider_job_id=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, job.id, providerReference],
  );
  await recordReceipt(client, context.organizationId, {
    jobType: "transcription_job",
    jobId: job.id,
    provider: job.provider,
    status: "completed",
    providerReference,
    receipt: {
      providerJobId: providerReference,
      transcriptId: transcript.id,
      contentHash: transcript.content_hash || null,
    },
  });
}

async function failTranscription(client, context, job, error) {
  const dead = Number(job.attempts) >= maximumAttempts;
  await client.query(
    `UPDATE tenant.crm_transcription_jobs
     SET status=$3,last_error=$4,next_attempt_at=now()+make_interval(secs=>$5),updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      job.id,
      dead ? "dead_letter" : "failed",
      String(error.message || error).slice(0, 2000),
      retryDelaySeconds(job.attempts),
    ],
  );
}

async function claimSyncJobs(client, organizationId) {
  return (
    await client.query(
      `WITH candidates AS (
         SELECT id FROM tenant.crm_provider_sync_jobs
         WHERE organization_id=$1
           AND status IN ('queued','failed')
           AND next_attempt_at<=now()
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE tenant.crm_provider_sync_jobs job
       SET status='processing',attempted_count=attempted_count+1,started_at=COALESCE(started_at,now()),updated_at=now()
       FROM candidates
       WHERE job.organization_id=$1 AND job.id=candidates.id
       RETURNING job.*`,
      [organizationId, batchSize],
    )
  ).rows;
}

async function dispatchSync(client, context, job) {
  const result = await synchronizeProviderAccount(
    client,
    context,
    job.sync_account_id,
    {
      syncType: job.sync_type,
      cursor: job.cursor_before,
      ...object(job.metadata),
    },
  );
  await client.query(
    `UPDATE tenant.crm_provider_sync_jobs
     SET status='completed',cursor_after=$3,processed_count=$4,failure_count=$5,
         completed_at=now(),last_error=NULL,updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      job.id,
      result.cursor || result.nextCursor || null,
      Number(result.processed || result.inserted || 0),
      Number(result.failures || 0),
    ],
  );
  await recordReceipt(client, context.organizationId, {
    jobType: "provider_sync",
    jobId: job.id,
    provider: String(result.provider || "communications"),
    status: "completed",
    receipt: result,
  });
}

async function failSync(client, context, job, error) {
  const dead = Number(job.attempted_count) >= maximumAttempts;
  await client.query(
    `UPDATE tenant.crm_provider_sync_jobs
     SET status=$3,last_error=$4,next_attempt_at=now()+make_interval(secs=>$5),updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      job.id,
      dead ? "dead_letter" : "failed",
      String(error.message || error).slice(0, 2000),
      retryDelaySeconds(job.attempted_count),
    ],
  );
}

let processed = 0;
let failed = 0;

try {
  const organizations = await pool.query(
    `SELECT id,created_by FROM public.organizations WHERE status='active' ORDER BY id`,
  );
  for (const organization of organizations.rows) {
    const client = await pool.connect();
    const context = {
      organizationId: organization.id,
      userId: organization.created_by,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      allowAllBranches: true,
    };
    try {
      await client.query("BEGIN");
      await setTenantContext(client, organization.id);

      for (const command of await claimTelephonyCommands(
        client,
        organization.id,
      )) {
        try {
          await dispatchTelephony(client, context, command);
          processed += 1;
        } catch (error) {
          failed += 1;
          await failTelephony(client, context, command, error);
          logger.error("CRM telephony command failed", {
            organizationId: organization.id,
            commandId: command.id,
            error,
          });
        }
      }

      for (const job of await claimTranscriptionJobs(client, organization.id)) {
        try {
          await dispatchTranscription(client, context, job);
          processed += 1;
        } catch (error) {
          failed += 1;
          await failTranscription(client, context, job, error);
          logger.error("CRM transcription job failed", {
            organizationId: organization.id,
            jobId: job.id,
            error,
          });
        }
      }

      for (const job of await claimSyncJobs(client, organization.id)) {
        try {
          await dispatchSync(client, context, job);
          processed += 1;
        } catch (error) {
          failed += 1;
          await failSync(client, context, job, error);
          logger.error("CRM provider sync failed", {
            organizationId: organization.id,
            jobId: job.id,
            error,
          });
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  logger.info("CRM provider worker completed", { workerId, processed, failed });
  if (failed && process.env.CRM_PROVIDER_FAIL_ON_JOB_ERROR === "true") {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
