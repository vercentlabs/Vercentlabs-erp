import { HttpError } from "@/core/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertStockUuid(
  value: unknown,
  label: string,
  { optional = false }: { optional?: boolean } = {},
): string | undefined {
  if ((value === undefined || value === null || value === "") && optional) return undefined;
  if (!UUID.test(String(value || "")))
    throw new HttpError(400, `${label} is invalid.`, "STOCK_REFERENCE_INVALID");
  return String(value);
}

export function validateStockObjectIds(
  input: Record<string, unknown>,
  required: Array<[string, string]>,
  optional: Array<[string, string]> = [],
) {
  for (const [key, label] of required) assertStockUuid(input[key], label);
  for (const [key, label] of optional) assertStockUuid(input[key], label, { optional: true });
}
