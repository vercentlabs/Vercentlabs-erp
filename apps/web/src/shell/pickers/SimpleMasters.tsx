"use client";

// Simple masters a form can create in place (Create-Where-You-Are plan): a unit, an item category, a payment term, an expense category,
// an asset location, a department or a designation. A name (and at most one more field) is enough; each saves through its module's own
// route, so that module's rules and permission apply.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Select, TextField } from "@vercentlabs/design-system";

import { QuickCreateLayout, failure } from "./QuickCreateParts";
import type { PickedRecord, QuickCreateProps } from "./types";

type Master = { noun: string; app: string; createPermissions: string[] };
export const SIMPLE_MASTERS = {
  uom: { noun: "unit", app: "products", createPermissions: ["products.manage_uom_master"] },
  itemCategory: { noun: "category", app: "products", createPermissions: ["products.manage_categories"] },
  paymentTerm: { noun: "payment term", app: "settings", createPermissions: ["payment_terms.manage"] },
  expenseCategory: { noun: "expense category", app: "accounting", createPermissions: ["accounting.expenses.manage_categories", "accounting.settings.manage"] },
  assetLocation: { noun: "location", app: "assets", createPermissions: ["assets.locations.create", "assets.locations.manage"] },
  department: { noun: "department", app: "hr-payroll", createPermissions: ["hr_payroll.employee.manage"] },
  designation: { noun: "designation", app: "hr-payroll", createPermissions: ["hr_payroll.employee.manage"] },
} satisfies Record<string, Master>;
export type SimpleMasterKind = keyof typeof SIMPLE_MASTERS;

// One envelope reader for the modules' different answers ({ ok, data }, { ok, ...result } or the result itself).
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? payload?.message ?? "The request could not be completed.");
  return (payload?.data ?? payload) as T;
}
const post = <T,>(url: string, body: Record<string, unknown>) => call<T>(url, { method: "POST", body: JSON.stringify(body) });
const matches = (text: string, ...values: Array<string | null | undefined>) => !text.trim() || values.some((value) => String(value ?? "").toLowerCase().includes(text.trim().toLowerCase()));
type Row = Record<string, unknown> & { id: string };
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

// A code from a name: "Box of 12" → "BOX12", "Sales Team" → "SALES_TEAM".
const codeOf = (name: string, max = 20, joiner = "_") => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, joiner).replace(new RegExp(`^${joiner}+|${joiner}+$`, "g"), "").slice(0, max);

export async function searchSimpleMaster(kind: SimpleMasterKind, text: string): Promise<PickedRecord[]> {
  const q = encodeURIComponent(text.trim());
  switch (kind) {
    case "uom": {
      const { units } = await call<{ units: Row[] }>("/api/products/units");
      return units.filter((row) => row.status !== "inactive" && matches(text, str(row.name), str(row.code)))
        .slice(0, 30).map((row) => ({ id: row.id, label: `${str(row.name)} (${str(row.code)})`, raw: row }));
    }
    case "itemCategory": {
      const { categories } = await call<{ categories: Row[] }>(`/api/products/categories?active=true&search=${q}`);
      return categories.slice(0, 30).map((row) => ({ id: row.id, label: str(row.path ?? row.label ?? row.name), description: str(row.code), raw: row }));
    }
    case "paymentTerm": {
      const { rows } = await call<{ rows: Row[] }>(`/api/settings/payment-terms?status=active&search=${q}`);
      return rows.slice(0, 30).map((row) => ({ id: row.id, label: str(row.name), description: str(row.code), raw: row }));
    }
    case "expenseCategory": {
      const { categories } = await call<{ categories: Row[] }>("/api/accounting/expense-categories");
      return categories.filter((row) => row.active !== false && row.status !== "inactive" && matches(text, str(row.name), str(row.code)))
        .slice(0, 30).map((row) => ({ id: row.id, label: str(row.name), description: str(row.accountLabel ?? row.code), raw: row }));
    }
    case "assetLocation": {
      const { rows } = await call<{ rows: Row[] }>(`/api/assets/locations?status=active&search=${q}`);
      return rows.slice(0, 30).map((row) => ({ id: row.id, label: str(row.path ?? row.name), description: str(row.kindLabel), raw: row }));
    }
    case "department":
    case "designation": {
      const { rows } = await call<{ rows: Row[] }>(`/api/hr/view/${kind === "department" ? "departments" : "designations"}`);
      return rows.filter((row) => row.active !== false && matches(text, str(row.name), str(row.code)))
        .slice(0, 30).map((row) => ({ id: row.id, label: str(row.name), description: str(row.code), raw: row }));
    }
  }
}

// ------------------------------------------------------------------ the quick-create form
export function SimpleMasterQuickCreate({ kind, initialText, onCreated, onCancel }: QuickCreateProps & { kind: SimpleMasterKind }) {
  const [name, setName] = useState(initialText.trim());
  const [code, setCode] = useState("");
  const [days, setDays] = useState("30");
  const [accountId, setAccountId] = useState("");
  // An expense category posts to an expense ledger: the first one is offered.
  const ledgers = useQuery({
    queryKey: ["quick-create", "expense-ledgers"],
    queryFn: () => call<{ options: { accounts: Array<{ id: string; label: string }> } }>("/api/accounting/expense-categories").then((result) => result.options.accounts),
    enabled: kind === "expenseCategory",
  });
  const ledger = accountId || ledgers.data?.[0]?.id || "";
  const save = useMutation({
    mutationFn: async (): Promise<PickedRecord> => {
      const label = name.trim();
      switch (kind) {
        case "uom": {
          const { unit } = await post<{ unit: Row }>("/api/products/units", { name: label, code: (code.trim() || codeOf(label, 10, "")).slice(0, 10), category: "quantity", decimalPlaces: 0 });
          return { id: unit.id, label: `${str(unit.name)} (${str(unit.code)})`, raw: unit };
        }
        case "itemCategory": {
          const { category } = await post<{ category: Row }>("/api/products/categories", { name: label, code: code.trim() || codeOf(label, 20) });
          return { id: category.id, label: str(category.name), raw: category };
        }
        case "paymentTerm": {
          const count = Math.max(0, Math.round(Number(days) || 0));
          const { term } = await post<{ term: Row }>("/api/settings/payment-terms", {
            name: label || `Net ${count} days`, code: code.trim() || codeOf(label || `NET${count}`, 20, "-"), termType: count ? "net_days" : "immediate", salesEnabled: true, purchaseEnabled: true,
            rules: [{ percentage: "100", basis: "invoice_date", kind: "days", days: count }],
          });
          return { id: term.id, label: str(term.name), raw: term };
        }
        case "expenseCategory": {
          const { category } = await post<{ category: Row }>("/api/accounting/expense-categories", { name: label, accountId: ledger });
          return { id: category.id, label: str(category.name), raw: category };
        }
        case "assetLocation": {
          const created = await post<{ locationId: string; code: string }>("/api/assets/locations", { name: label, kind: "OTHER" });
          return { id: created.locationId, label, description: created.code };
        }
        case "department":
        case "designation": {
          const { record } = await post<{ record: Row }>(`/api/hr/actions/${kind}-save`, { code: (code.trim() || codeOf(label)).slice(0, 20), name: label, active: true });
          return { id: record.id, label: str(record.name ?? label), description: str(record.code) };
        }
      }
    },
    onSuccess: onCreated,
  });
  const master = SIMPLE_MASTERS[kind];
  const needsCode = kind === "uom" || kind === "department" || kind === "designation";
  return (
    <QuickCreateLayout error={save.isError ? failure(save.error) : null} onCancel={onCancel} onSubmit={() => save.mutate()} submitLabel={`Create ${master.noun}`}
      isPending={save.isPending} isDisabled={(kind !== "paymentTerm" && !name.trim()) || (kind === "expenseCategory" && !ledger)}>
      <TextField label="Name" isRequired={kind !== "paymentTerm"} autoFocus value={name} onChange={setName}
        placeholder={kind === "paymentTerm" ? "For example: Net 30 days" : kind === "uom" ? "For example: Box" : undefined} />
      {needsCode && (
        <TextField label="Code" value={code} onChange={(value) => setCode(value.toUpperCase())} placeholder={codeOf(name, kind === "uom" ? 10 : 20, kind === "uom" ? "" : "_") || undefined}
          description="Leave empty to use the one shown." />
      )}
      {kind === "paymentTerm" && (
        <TextField label="Days to pay" inputMode="numeric" value={days} onChange={setDays} description="From the invoice date. 0 means payment on the day." />
      )}
      {kind === "expenseCategory" && (
        <Select label="Posts to" isRequired selectedKey={ledger} onSelectionChange={(key) => setAccountId(String(key))}
          options={(ledgers.data ?? []).map((account) => ({ value: account.id, label: account.label }))} description="The expense ledger the category's spending goes to." />
      )}
    </QuickCreateLayout>
  );
}
