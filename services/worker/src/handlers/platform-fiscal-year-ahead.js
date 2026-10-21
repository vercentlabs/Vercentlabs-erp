import { z } from "zod";
import { ensureFiscalYearsAhead } from "@vercentlabs/api";

export const JOB_TYPE = "platform.automation.open_next_fiscal_year";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Every company, once a day: the next financial year is opened before the current one ends (Sales audit B3) — a company with Sales but
// not Accounting has no one to open it, and its invoices and dispatches would stop posting on 1 April.
export async function openNextFiscalYearHandler(client, systemContext) {
  return { opened: await ensureFiscalYearsAhead(client, systemContext.organizationId) };
}
