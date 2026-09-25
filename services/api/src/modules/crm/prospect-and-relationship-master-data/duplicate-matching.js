// F008 rule-driven duplicate matching for Accounts, Contacts and the
// Lead<->Contact cross-object pair (CRM vNext Prompt 3 continuation,
// CRM-VNEXT-044/045). Replaces the previously hardcoded-weight
// findAccountDuplicates/findContactDuplicates (foundation.js re-exports
// these for backward compatibility with existing callers).
//
// Every comparison below is a fixed, code-reviewed SQL fragment — rule rows
// only ever select WHICH of these fragments participates and with what
// weight/threshold; there is no dynamic SQL assembled from rule content
// itself (weights/thresholds are always bound parameters).
import { createHash } from "node:crypto";
import { CrmError } from "../index.js";
import { activeRuleSetTimestamp, getActiveDuplicateRules } from "./duplicate-rules.js";

function signatureOf(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

// Dismissals are only ever suppressed while the rule set that produced them
// hasn't materially changed since (rules_snapshot_at). If the underlying
// record's own matched fields change, the candidate simply stops matching
// on the next scan (the WHERE clause itself no longer fires) — the
// dismissal then becomes naturally inert rather than wrongly suppressing a
// pair that no longer actually shares any signal. This is deliberately
// simpler than storing/comparing a full field-value signature, and is
// still a correct, honest staleness policy: dismissals go stale exactly
// when (a) the rules that produced the match change, since a re-run under
// the new rules is a materially different question, or (b) the match
// itself stops firing at all.
async function filterDismissed(client, context, entityType, sourceId, rows, idKey) {
  if (!sourceId || !rows.length) return rows;
  const table =
    entityType === "account" ? "crm_account_duplicate_overrides" : "crm_contact_duplicate_overrides";
  const sourceColumn = entityType === "account" ? "party_id" : "contact_id";
  const matchedColumn = entityType === "account" ? "matched_party_ids" : "matched_contact_ids";
  const asOf = await activeRuleSetTimestamp(client, context, entityType);
  const dismissed = await client.query(
    `SELECT DISTINCT unnest(${matchedColumn}) AS candidate_id
     FROM tenant.${table}
     WHERE organization_id=$1 AND ${sourceColumn}=$2 AND operation='dismiss' AND rules_snapshot_at >= $3`,
    [context.organizationId, sourceId, asOf],
  );
  const suppressed = new Set(dismissed.rows.map((row) => row.candidate_id));
  if (!suppressed.size) return rows;
  return rows.filter((row) => !suppressed.has(row[idKey]));
}

const GENERIC_COMPANY_WORDS = [
  "pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "corp", "corporation", "group", "and",
  "industries", "solutions", "systems", "services", "technologies", "tech", "enterprises", "international", "india",
  "analytics", "distributors", "exports", "realty", "foods", "pharma", "packaging", "data", "digital", "logistics",
  "engineering", "manufacturing", "healthcare", "wellness", "textiles", "chemicals", "energy", "infra", "projects",
].join("|");

export async function dismissAccountDuplicateMatch(client, context, partyId, matchedPartyIds, reason) {
  if (!Array.isArray(matchedPartyIds) || !matchedPartyIds.length) {
    throw new CrmError(400, "Choose at least one candidate to dismiss.", "CRM_DUPLICATE_DISMISS_EMPTY");
  }
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 10) {
    throw new CrmError(
      400,
      "Explain in at least 10 characters why this is not a duplicate.",
      "CRM_DUPLICATE_DISMISS_REASON_REQUIRED",
    );
  }
  return recordAccountDuplicateOverride(client, context, partyId, matchedPartyIds, "dismiss", trimmedReason);
}

// Shared by the explicit "Not a duplicate" dismissal action and the
// create/update exact-duplicate override path (F008 create-time warning) —
// same immutable ledger, same reasoned-evidence contract, only the
// `operation` value differs. The referenced Account must already exist
// (FK), so a create-time 'create' override is only ever recorded AFTER the
// new Account row itself has been inserted, in the same transaction.
export async function recordAccountDuplicateOverride(client, context, partyId, matchedPartyIds, operation, reason, sourceModule = "crm") {
  const trimmedReason = String(reason || "").trim();
  const asOf = await activeRuleSetTimestamp(client, context, "account");
  const result = await client.query(
    `INSERT INTO tenant.crm_account_duplicate_overrides
       (organization_id, party_id, matched_party_ids, operation, reason, signature, rules_snapshot_at, actor_user_id, source_module)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      context.organizationId,
      partyId,
      matchedPartyIds,
      operation,
      trimmedReason,
      signatureOf({ partyId, matchedPartyIds: [...matchedPartyIds].sort() }),
      asOf,
      context.userId,
      sourceModule,
    ],
  );
  return { id: result.rows[0].id };
}

export async function dismissContactDuplicateMatch(client, context, contactId, matchedContactIds, reason) {
  if (!Array.isArray(matchedContactIds) || !matchedContactIds.length) {
    throw new CrmError(400, "Choose at least one candidate to dismiss.", "CRM_DUPLICATE_DISMISS_EMPTY");
  }
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 10) {
    throw new CrmError(
      400,
      "Explain in at least 10 characters why this is not a duplicate.",
      "CRM_DUPLICATE_DISMISS_REASON_REQUIRED",
    );
  }
  return recordContactDuplicateOverride(client, context, contactId, matchedContactIds, "dismiss", trimmedReason);
}

export async function recordContactDuplicateOverride(client, context, contactId, matchedContactIds, operation, reason) {
  const trimmedReason = String(reason || "").trim();
  const asOf = await activeRuleSetTimestamp(client, context, "contact");
  const result = await client.query(
    `INSERT INTO tenant.crm_contact_duplicate_overrides
       (organization_id, contact_id, matched_contact_ids, operation, reason, signature, rules_snapshot_at, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      context.organizationId,
      contactId,
      matchedContactIds,
      operation,
      trimmedReason,
      signatureOf({ contactId, matchedContactIds: [...matchedContactIds].sort() }),
      asOf,
      context.userId,
    ],
  );
  return { id: result.rows[0].id };
}

// Must match tenant.crm_normalize_comparison_text(value) exactly — that
// generated-column function (business_parties.normalized_legal_name,
// contacts.normalized_name) only lowercases and collapses whitespace runs
// to a single space; it never strips punctuation. This function used to
// also strip every non-alphanumeric character (including spaces), so a
// "legal_name"/"name" normalized-method rule — no matter how it's
// configured, including as the exact/blocking signal — could never
// actually equal the SQL-side value for any multi-word name and silently
// never matched. Two real business_parties rows sharing the identical
// normalized legal name only ever got caught by the separate fuzzy rule
// (if one was configured), never by the intended exact match.
function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function normalizePhone(value) {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(-15);
}
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function ruleFor(rules, signal, method) {
  return rules.find((rule) => rule.signal === signal && rule.method === method) || null;
}

// A candidate is classified 'exact' (blocking) when any of its matched
// signals came from a rule marked blocking=true; otherwise 'probable' (any
// positive score) or 'none'. Computed in JS from the already-returned
// matched_signals array rather than more dynamic SQL.
function classifyDuplicateRows(rules, rows) {
  const blockingSignals = new Set(
    rules
      .filter((rule) => rule.blocking)
      .map((rule) => (rule.method === "fuzzy" ? `${rule.signal}_similarity` : rule.signal)),
  );
  return rows.map((row) => {
    const signals = Array.isArray(row.matched_signals) ? row.matched_signals : [];
    const classification = signals.some((signal) => blockingSignals.has(signal))
      ? "exact"
      : Number(row.match_score) > 0
        ? "probable"
        : "none";
    return { ...row, classification };
  });
}

export async function findAccountDuplicates(client, context, input = {}) {
  const rules = await getActiveDuplicateRules(client, context, "account");
  const name = normalizeText(input.name || input.displayName || input.legalName);
  const gstin = String(input.gstin || "").trim().toUpperCase();
  const pan = String(input.pan || "").trim().toUpperCase();
  const excludeId = input.excludeId || null;
  if (!name && !gstin && !pan) return [];

  const gstinRule = ruleFor(rules, "gstin", "exact");
  const panRule = ruleFor(rules, "pan", "exact");
  const legalExactRule = ruleFor(rules, "legal_name", "normalized");
  const legalFuzzyRule = ruleFor(rules, "legal_name", "fuzzy");

  const parameters = [context.organizationId];
  const p = (value) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  const orClauses = [];
  const scoreTerms = [];
  const signalTerms = [];

  if (gstinRule && gstin) {
    const bind = p(gstin);
    const weight = p(gstinRule.weight);
    orClauses.push(`upper(coalesce(party.gstin,'')) = ${bind}`);
    scoreTerms.push(`(CASE WHEN upper(coalesce(party.gstin,'')) = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN upper(coalesce(party.gstin,'')) = ${bind} THEN ARRAY['gstin'] ELSE ARRAY[]::text[] END)`);
  }
  if (panRule && pan) {
    const bind = p(pan);
    const weight = p(panRule.weight);
    orClauses.push(`party.normalized_pan = ${bind}`);
    scoreTerms.push(`(CASE WHEN party.normalized_pan = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN party.normalized_pan = ${bind} THEN ARRAY['pan'] ELSE ARRAY[]::text[] END)`);
  }
  if (legalExactRule && name) {
    const bind = p(name);
    const weight = p(legalExactRule.weight);
    orClauses.push(`party.normalized_legal_name = ${bind}`);
    scoreTerms.push(`(CASE WHEN party.normalized_legal_name = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN party.normalized_legal_name = ${bind} THEN ARRAY['legal_name'] ELSE ARRAY[]::text[] END)`);
  }
  if (legalFuzzyRule && name) {
    // Compare the distinctive part of the name: legal suffixes and common
    // business words ("Pvt Ltd", "Analytics", "Industries"...) alone must not
    // make two different companies look alike.
    const bind = p(name);
    const weight = p(legalFuzzyRule.weight);
    const threshold = p(Number(legalFuzzyRule.fuzzyThreshold || 0.55));
    const core = (expr) => `btrim(regexp_replace(regexp_replace(lower(coalesce(${expr},'')), '\\m(${GENERIC_COMPANY_WORDS})\\M', ' ', 'g'), '\\s+', ' ', 'g'))`;
    const similar = `(${core("party.normalized_legal_name")} <> '' AND ${core(bind)} <> '' AND similarity(${core("party.normalized_legal_name")}, ${core(bind)}) >= ${threshold})`;
    orClauses.push(similar);
    scoreTerms.push(`(CASE WHEN ${similar} THEN round(${weight}::numeric * similarity(${core("party.normalized_legal_name")}, ${core(bind)}))::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN ${similar} THEN ARRAY['legal_name_similarity'] ELSE ARRAY[]::text[] END)`);
  }
  if (!orClauses.length) return [];

  const excludeParam = p(excludeId);
  const result = await client.query(
    `SELECT party.id, party.code, party.display_name, party.legal_name, party.gstin, party.pan,
            party.party_type, party.status,
            (${scoreTerms.join(" + ")})::int AS match_score,
            (${signalTerms.length > 1 ? signalTerms.join(" || ") : signalTerms[0]}) AS matched_signals
       FROM tenant.business_parties party
      WHERE party.organization_id = $1
        AND party.status = 'active'
        AND (${excludeParam}::uuid IS NULL OR party.id <> ${excludeParam})
        AND (${orClauses.join(" OR ")})
      ORDER BY match_score DESC, party.updated_at DESC
      LIMIT 25`,
    parameters,
  );
  const classified = classifyDuplicateRows(rules, result.rows);
  return filterDismissed(client, context, "account", excludeId, classified, "id");
}

export async function findContactDuplicates(client, context, input = {}) {
  const rules = await getActiveDuplicateRules(client, context, "contact");
  const email = normalizeEmail(input.email);
  const mobile = normalizePhone(input.mobile || input.phone);
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const excludeId = input.excludeId || null;
  if (!email && !mobile && !firstName) return [];

  const emailRule = ruleFor(rules, "email", "exact");
  const mobileRule = ruleFor(rules, "mobile", "normalized");
  const nameExactRule = ruleFor(rules, "name", "normalized");
  const nameFuzzyRule = ruleFor(rules, "name", "fuzzy");
  const fullName = normalizeText(`${firstName} ${lastName}`);

  const parameters = [context.organizationId];
  const p = (value) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  const orClauses = [];
  const scoreTerms = [];
  const signalTerms = [];

  if (emailRule && email) {
    const bind = p(email);
    const weight = p(emailRule.weight);
    orClauses.push(`contact.normalized_email = ${bind}`);
    scoreTerms.push(`(CASE WHEN contact.normalized_email = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN contact.normalized_email = ${bind} THEN ARRAY['email'] ELSE ARRAY[]::text[] END)`);
  }
  if (mobileRule && mobile) {
    const bind = p(mobile);
    const weight = p(mobileRule.weight);
    orClauses.push(`contact.normalized_mobile = ${bind}`);
    scoreTerms.push(`(CASE WHEN contact.normalized_mobile = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN contact.normalized_mobile = ${bind} THEN ARRAY['mobile'] ELSE ARRAY[]::text[] END)`);
  }
  if (nameExactRule && firstName) {
    const bind = p(fullName);
    const weight = p(nameExactRule.weight);
    orClauses.push(`contact.normalized_name = ${bind}`);
    scoreTerms.push(`(CASE WHEN contact.normalized_name = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN contact.normalized_name = ${bind} THEN ARRAY['name'] ELSE ARRAY[]::text[] END)`);
  }
  if (nameFuzzyRule && firstName) {
    const bind = p(fullName);
    const weight = p(nameFuzzyRule.weight);
    const threshold = p(Number(nameFuzzyRule.fuzzyThreshold || 0.55));
    orClauses.push(`similarity(coalesce(contact.normalized_name,''), ${bind}) >= ${threshold}`);
    scoreTerms.push(
      `(CASE WHEN similarity(coalesce(contact.normalized_name,''), ${bind}) >= ${threshold} THEN round(${weight}::numeric * similarity(coalesce(contact.normalized_name,''), ${bind}))::int ELSE 0 END)`,
    );
    signalTerms.push(
      `(CASE WHEN similarity(coalesce(contact.normalized_name,''), ${bind}) >= ${threshold} THEN ARRAY['name_similarity'] ELSE ARRAY[]::text[] END)`,
    );
  }
  if (!orClauses.length) return [];

  const excludeParam = p(excludeId);
  const result = await client.query(
    `SELECT contact.id, contact.party_id, contact.first_name, contact.last_name,
            contact.email, contact.mobile, contact.phone, contact.designation,
            party.display_name AS account_name,
            (${scoreTerms.join(" + ")})::int AS match_score,
            (${signalTerms.length > 1 ? signalTerms.join(" || ") : signalTerms[0]}) AS matched_signals
       FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties party
         ON party.organization_id = contact.organization_id AND party.id = contact.party_id
      WHERE contact.organization_id = $1
        AND contact.status = 'active'
        AND (${excludeParam}::uuid IS NULL OR contact.id <> ${excludeParam})
        AND (${orClauses.join(" OR ")})
      ORDER BY match_score DESC, contact.updated_at DESC
      LIMIT 25`,
    parameters,
  );
  const classified = classifyDuplicateRows(rules, result.rows);
  return filterDismissed(client, context, "contact", excludeId, classified, "id");
}

// Cross-object matching (F008-CAP-002): a Lead and a Contact can represent
// the same real person, so this is the one clearly meaningful cross-object
// pair (Lead<->Account or Contact<->Account would compare a person's record
// against a company's, which is not a meaningful identity comparison and
// was deliberately not built — "do not force meaningless object
// comparisons"). Reuses the contact rule set (email/mobile/name) since it's
// the same underlying identity question asked from the Lead side.
export async function findLeadContactCrossMatches(client, context, input = {}) {
  const rules = await getActiveDuplicateRules(client, context, "contact");
  const email = normalizeEmail(input.email);
  const mobile = normalizePhone(input.mobile || input.phone);
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const fullName = normalizeText(`${firstName} ${lastName}`);
  if (!email && !mobile && !firstName) return [];

  const emailRule = ruleFor(rules, "email", "exact");
  const mobileRule = ruleFor(rules, "mobile", "normalized");
  const nameExactRule = ruleFor(rules, "name", "normalized");

  const parameters = [context.organizationId];
  const p = (value) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  const orClauses = [];
  const scoreTerms = [];
  const signalTerms = [];

  if (emailRule && email) {
    const bind = p(email);
    const weight = p(emailRule.weight);
    orClauses.push(`contact.normalized_email = ${bind}`);
    scoreTerms.push(`(CASE WHEN contact.normalized_email = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN contact.normalized_email = ${bind} THEN ARRAY['email'] ELSE ARRAY[]::text[] END)`);
  }
  if (mobileRule && mobile) {
    const bind = p(mobile);
    const weight = p(mobileRule.weight);
    orClauses.push(`contact.normalized_mobile = ${bind}`);
    scoreTerms.push(`(CASE WHEN contact.normalized_mobile = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN contact.normalized_mobile = ${bind} THEN ARRAY['mobile'] ELSE ARRAY[]::text[] END)`);
  }
  if (nameExactRule && firstName) {
    const bind = p(fullName);
    const weight = p(nameExactRule.weight);
    orClauses.push(`contact.normalized_name = ${bind}`);
    scoreTerms.push(`(CASE WHEN contact.normalized_name = ${bind} THEN ${weight}::int ELSE 0 END)`);
    signalTerms.push(`(CASE WHEN contact.normalized_name = ${bind} THEN ARRAY['name'] ELSE ARRAY[]::text[] END)`);
  }
  if (!orClauses.length) return [];

  const result = await client.query(
    `SELECT contact.id, contact.first_name, contact.last_name, contact.email, contact.mobile,
            contact.designation, party.display_name AS account_name,
            (${scoreTerms.join(" + ")})::int AS match_score,
            (${signalTerms.length > 1 ? signalTerms.join(" || ") : signalTerms[0]}) AS matched_signals
       FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties party
         ON party.organization_id = contact.organization_id AND party.id = contact.party_id
      WHERE contact.organization_id = $1
        AND contact.status = 'active'
        AND (${orClauses.join(" OR ")})
      ORDER BY match_score DESC, contact.updated_at DESC
      LIMIT 10`,
    parameters,
  );
  return result.rows;
}
