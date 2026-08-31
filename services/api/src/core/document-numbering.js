export class DocumentNumberError extends Error {
  constructor(status, message, code = "DOCUMENT_NUMBER_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new DocumentNumberError(400, `${name} is required.`, "DOCUMENT_NUMBER_INPUT_INVALID");
  return text;
}

function normalizeType(value) {
  const text = required(value, "Document type").toLowerCase();
  if (!/^[a-z0-9._:-]{1,160}$/.test(text)) {
    throw new DocumentNumberError(400, "Document type contains unsupported characters.", "DOCUMENT_NUMBER_TYPE_INVALID");
  }
  return text;
}

function normalizePrefix(value) {
  const text = required(value, "Document prefix").toUpperCase();
  if (!/^[A-Z0-9/_-]{1,40}$/.test(text)) {
    throw new DocumentNumberError(400, "Document prefix contains unsupported characters.", "DOCUMENT_NUMBER_PREFIX_INVALID");
  }
  return text;
}

/**
 * Allocate a business-visible number from a company-scoped transactional sequence.
 * The caller must already be inside the authoritative tenant transaction.
 */
export async function nextDocumentNumber(
  client,
  context,
  { documentType, prefix, periodKey = "global", padding = 6 } = {},
) {
  const companyId = context?.companyId || context?.activeCompanyId;
  if (!context?.organizationId || !companyId) {
    throw new DocumentNumberError(400, "Organization and active company are required for numbering.", "DOCUMENT_NUMBER_SCOPE_REQUIRED");
  }
  const type = normalizeType(documentType);
  const normalizedPrefix = normalizePrefix(prefix);
  const period = String(periodKey || "global").trim().toLowerCase().slice(0, 80) || "global";
  const width = Math.min(Math.max(Number(padding) || 6, 1), 18);

  const { rows } = await client.query(
    `INSERT INTO tenant.document_sequences
      (organization_id,company_id,document_type,period_key,prefix,padding,next_value)
     VALUES ($1,$2,$3,$4,$5,$6,2)
     ON CONFLICT (organization_id,company_id,document_type,period_key)
     DO UPDATE SET
       next_value=tenant.document_sequences.next_value+1,
       prefix=EXCLUDED.prefix,
       padding=EXCLUDED.padding,
       updated_at=now()
     RETURNING (next_value-1)::text AS allocated_value,prefix,padding`,
    [
      context.organizationId,
      companyId,
      type,
      period,
      normalizedPrefix,
      width,
    ],
  );
  const sequence = String(rows[0].allocated_value).padStart(Number(rows[0].padding), "0");
  return `${rows[0].prefix}-${sequence}`;
}
