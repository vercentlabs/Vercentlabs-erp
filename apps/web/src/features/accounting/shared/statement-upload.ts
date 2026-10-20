import "server-only";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { toWire } from "@/core/wire";
import { accountingContext } from "@/features/accounting/shared/accounting-context";

// Bank statement uploads (Finance MVP F6) arrive as multipart, not JSON: a statement file is larger than a JSON body may be.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
type Client = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
export type StatementUpload = {
  bankAccountId: string; fileName: string; fileBase64: string; mapping?: Record<string, string | null>; openingBalance?: string; closingBalance?: string;
};

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

// multipart: file, bankAccountId, mapping (JSON), openingBalance, closingBalance.
async function statementInput(request: Request): Promise<StatementUpload> {
  const form = await request.formData().catch(() => { throw new HttpError(400, "Upload the bank statement (.csv or .xlsx)."); });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Upload the bank statement (.csv or .xlsx).");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "The file is larger than 5 MB. Split it into smaller periods.");
  if (!/\.(csv|txt|xlsx|xls)$/i.test(file.name)) throw new HttpError(400, "Upload a .csv or .xlsx file.");
  let mapping: Record<string, string | null> | undefined;
  const mappingText = field(form, "mapping");
  if (mappingText) {
    try { mapping = JSON.parse(mappingText) as Record<string, string | null>; } catch { throw new HttpError(400, "The column mapping could not be read."); }
  }
  const balance = (name: string) => {
    const value = field(form, name)?.replace(/,/g, "");
    if (value && !/^-?\d{1,15}(\.\d{1,2})?$/.test(value)) throw new HttpError(400, "Enter balances such as 125000.50.");
    return value;
  };
  return {
    bankAccountId: field(form, "bankAccountId") ?? "", fileName: file.name.slice(0, 200), fileBase64: Buffer.from(await file.arrayBuffer()).toString("base64"), mapping,
    openingBalance: balance("openingBalance"), closingBalance: balance("closingBalance"),
  };
}

export function statementRoute<T>(request: Request, run: (client: Client, context: ReturnType<typeof accountingContext>, input: StatementUpload) => Promise<T>, status = 200) {
  return workspaceRoute(request, { module: "accounting", permission: "accounting.view", billingWrite: true }, async ({ client, session }) =>
    ok(toWire(await run(client as Client, accountingContext(session), await statementInput(request))) as Record<string, unknown>, status));
}
