import { AccountingError, asDatabaseDecimal, decimal, isoDate, roundMoney, uuid } from "./core.js";
import { div, mul, sub } from "./money.js";

function addDays(dateValue, days) {
  const date = new Date(`${isoDate(dateValue)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function allocateInstallments(totalValue, termLines, precision = 2) {
  const total = roundMoney(decimal(totalValue), precision);
  if (total <= 0n) throw new AccountingError(400, "Payment schedule total must be positive.");
  const lines = Array.isArray(termLines) && termLines.length
    ? [...termLines].sort((left, right) => Number(left.sequence) - Number(right.sequence))
    : [{ sequence: 1, due_days: 0, percentage: "100" }];
  const percentageTotal = lines.reduce((sum, line) => sum + decimal(line.percentage), 0n);
  if (percentageTotal !== decimal(100)) throw new AccountingError(409, "Payment-term percentages must total exactly 100%. ");
  let allocated = 0n;
  return lines.map((line, index) => {
    const amount = index === lines.length - 1
      ? sub(total, allocated)
      : roundMoney(mul(total, div(line.percentage, 100)), precision);
    if (amount <= 0n) throw new AccountingError(409, "Each payment-term installment must be greater than zero.");
    allocated += amount;
    return {
      sequence: Number(line.sequence || index + 1),
      dueDays: Number(line.due_days || 0),
      percentage: asDatabaseDecimal(line.percentage),
      amount,
    };
  });
}

export async function resolvePaymentSchedule(client, context, options) {
  const documentDate = isoDate(options.documentDate, "Document date");
  if (options.explicitDueDate) {
    const dueDate = isoDate(options.explicitDueDate, "Due date");
    return {
      dueDate,
      paymentTermId: null,
      snapshot: options.snapshot && typeof options.snapshot === "object" ? options.snapshot : {},
      installments: [{ sequence: 1, dueDate, percentage: asDatabaseDecimal(100), amount: roundMoney(options.total, options.precision) }],
    };
  }
  const snapshotLines = Array.isArray(options.snapshot?.lines) ? options.snapshot.lines : [];
  if (snapshotLines.length) {
    const sourceLines = snapshotLines.map((line, index) => ({
      sequence: Number(line.sequence || index + 1),
      due_days: Number(line.dueDays ?? line.due_days ?? 0),
      percentage: line.percentage,
    }));
    const allocated = allocateInstallments(options.total, sourceLines, options.precision);
    const installments = allocated.map((line) => ({ ...line, dueDate: addDays(documentDate, line.dueDays) }));
    return {
      dueDate: installments.reduce((latest, line) => line.dueDate > latest ? line.dueDate : latest, installments[0].dueDate),
      paymentTermId: options.paymentTermId || options.partyPaymentTermId || options.snapshot?.id || null,
      snapshot: { ...options.snapshot, lines: installments.map((line) => ({ sequence: line.sequence, dueDays: line.dueDays, dueDate: line.dueDate, percentage: line.percentage, amount: asDatabaseDecimal(line.amount) })) },
      installments,
    };
  }
  const paymentTermIdValue = options.paymentTermId || options.partyPaymentTermId || null;
  if (!paymentTermIdValue) {
    const dueDate = documentDate;
    return {
      dueDate,
      paymentTermId: null,
      snapshot: {},
      installments: [{ sequence: 1, dueDate, percentage: asDatabaseDecimal(100), amount: roundMoney(options.total, options.precision) }],
    };
  }
  const paymentTermId = uuid(paymentTermIdValue, "Payment term");
  const result = await client.query(
    `SELECT term.id,term.code,term.name,term.description,term.default_due_days,
      COALESCE(jsonb_agg(jsonb_build_object(
        'sequence',line.sequence,'dueDays',line.due_days,'percentage',line.percentage
      ) ORDER BY line.sequence) FILTER (WHERE line.id IS NOT NULL),'[]'::jsonb) AS lines
     FROM tenant.payment_terms term
     LEFT JOIN tenant.payment_term_lines line
       ON line.organization_id=term.organization_id AND line.payment_term_id=term.id
     WHERE term.organization_id=$1 AND term.id=$2 AND term.status='active'
     GROUP BY term.id`,
    [context.organizationId, paymentTermId],
  );
  const term = result.rows[0];
  if (!term) throw new AccountingError(409, "The selected payment term is inactive or unavailable.");
  const sourceLines = Array.isArray(term.lines) && term.lines.length
    ? term.lines.map((line) => ({ sequence: line.sequence, due_days: line.dueDays, percentage: line.percentage }))
    : [{ sequence: 1, due_days: term.default_due_days, percentage: "100" }];
  const allocated = allocateInstallments(options.total, sourceLines, options.precision);
  const installments = allocated.map((line) => ({ ...line, dueDate: addDays(documentDate, line.dueDays) }));
  return {
    dueDate: installments.reduce((latest, line) => line.dueDate > latest ? line.dueDate : latest, installments[0].dueDate),
    paymentTermId,
    snapshot: {
      id: term.id,
      code: term.code,
      name: term.name,
      description: term.description,
      lines: installments.map((line) => ({ sequence: line.sequence, dueDays: line.dueDays, dueDate: line.dueDate, percentage: line.percentage, amount: asDatabaseDecimal(line.amount) })),
    },
    installments,
  };
}
