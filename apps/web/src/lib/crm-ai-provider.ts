import { createHash } from "node:crypto";

import { HttpError } from "@/lib/http";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerText(payload: Record<string, unknown>): string {
  const direct = text(payload.body || payload.text || payload.content);
  if (direct) return direct;
  const choices = array(payload.choices);
  const first = object(choices[0]);
  const message = object(first.message);
  return text(message.content || first.text);
}

export type CrmProviderDraft = {
  generatedSubject: string;
  generatedBody: string;
  provider: string;
  model: string;
  providerEvidence: Record<string, unknown>;
};

export async function generateCrmProviderDraft(
  input: Record<string, unknown>,
): Promise<CrmProviderDraft> {
  const endpoint = text(process.env.CRM_AI_PROVIDER_URL);
  const apiKey = text(process.env.CRM_AI_PROVIDER_KEY);
  const model = text(process.env.CRM_AI_PROVIDER_MODEL || "crm-provider-model");
  if (!endpoint || !apiKey) {
    throw new HttpError(
      409,
      "CRM AI provider is not configured. Set CRM_AI_PROVIDER_URL and CRM_AI_PROVIDER_KEY, or use the governed local draft action.",
    );
  }
  if (!endpoint.startsWith("https://")) {
    throw new HttpError(500, "CRM AI provider URL must use HTTPS.");
  }
  const facts = array(input.facts).map(text).filter(Boolean);
  if (!facts.length) {
    throw new HttpError(400, "Provider drafts require grounded facts.");
  }
  const redactedContext = object(input.context);
  const requestPayload = {
    model,
    task: "crm_assistant_draft",
    purpose: text(input.purpose || "follow-up"),
    subject: text(input.subject),
    facts,
    nextStep: text(input.nextStep),
    context: redactedContext,
    requirements: {
      factualOnly: true,
      noInventedClaims: true,
      humanApprovalRequired: true,
      output: { subject: "string", body: "string" },
    },
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": hash(requestPayload),
    },
    body: JSON.stringify(requestPayload),
    signal: AbortSignal.timeout(
      Number(process.env.CRM_AI_PROVIDER_TIMEOUT_MS || 30_000),
    ),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as Record<string, unknown>)
    : { body: await response.text() };
  if (!response.ok) {
    throw new HttpError(502, `CRM AI provider failed (${response.status}).`);
  }
  let result = payload;
  const rawText = providerText(payload);
  if (rawText && (!text(payload.subject) || !text(payload.body))) {
    try {
      result = {
        ...payload,
        ...(JSON.parse(rawText) as Record<string, unknown>),
      };
    } catch {
      result = { ...payload, body: rawText };
    }
  }
  const generatedBody = text(result.body || result.text || result.content);
  if (!generatedBody) {
    throw new HttpError(502, "CRM AI provider returned no draft body.");
  }
  return {
    generatedSubject:
      text(result.subject) || text(input.subject) || "CRM follow-up",
    generatedBody,
    provider: text(result.provider || "external-provider"),
    model: text(result.model || model),
    providerEvidence: {
      requestHash: hash(requestPayload),
      responseHash: hash(payload),
      providerRequestId: text(result.id || result.requestId) || null,
      humanApprovalRequired: true,
    },
  };
}
