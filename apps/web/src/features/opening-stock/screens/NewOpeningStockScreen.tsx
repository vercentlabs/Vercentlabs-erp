"use client";

// New Opening Stock: the company (this workspace), one warehouse, the cutoff and accounting dates and the migration reference. The lines are
// added on the draft that opens next, typed in or imported from a spreadsheet.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, PermissionState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createOpeningStock, errorMessage, fieldErrors, getOpeningOptions } from "../api/opening-stock-api";
import { OPENING_BASE } from "./OpeningStockListScreen";

export function NewOpeningStockScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "opening-stock", "options"), queryFn: getOpeningOptions, staleTime: 60_000 });
  const [draft, setDraft] = useState({ warehouseId: "", openingDate: "", accountingDate: "", migrationReference: "", sourceSystem: "", externalReference: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof draft) => (value: string) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const create = useMutation({
    mutationFn: () => createOpeningStock({ ...draft, accountingDate: draft.accountingDate || draft.openingDate, sourceSystem: draft.sourceSystem || null, externalReference: draft.externalReference || null,
      notes: draft.notes || null }),
    onSuccess: (document) => router.push(`${OPENING_BASE}/${document.id}?tab=items`),
    onError: (failure) => setErrors(fieldErrors(failure)),
  });
  if (options.isLoading) return <LoadingState label="Loading" rows={4} />;
  if (options.data && !options.data.capabilities.prepare) return <PermissionState title="You can't prepare opening stock" description="Ask an administrator for the Prepare opening stock permission." />;
  const warehouses = options.data?.warehouses ?? [];
  return (
    <RecordFormPage
      header={{ title: "New opening stock", description: "One document per warehouse. The cutoff is the date Vercentlabs starts keeping that warehouse's stock history." }}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(OPENING_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={create.isPending} isDisabled={!draft.warehouseId || !draft.openingDate || !draft.migrationReference.trim()} onPress={() => create.mutate()}>Create draft</Button>
        </>
      }
      banner={<ErrorBanner message={create.isError && !Object.keys(fieldErrors(create.error)).length ? errorMessage(create.error) : null} />}
    >
      <FormSection title="Opening stock">
        <p className="text-sm sm:col-span-2"><span className="text-text-muted">Company: </span>{workspace.organizationName ?? "This workspace"} <span className="text-text-muted">· valued in {options.data?.currencyCode}</span></p>
        <Select className="sm:col-span-2" label="Warehouse" isRequired selectedKey={draft.warehouseId || null} onSelectionChange={(key) => set("warehouseId")(String(key))}
          errorMessage={errors.warehouseId} placeholder={warehouses.length ? "Choose the warehouse" : "No warehouse you may load into"}
          options={warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
        <TextField label="Opening (cutoff) date" type="date" isRequired value={draft.openingDate} onChange={set("openingDate")} errorMessage={errors.openingDate}
          description="The stock position on this date." />
        <TextField label="Accounting date" type="date" value={draft.accountingDate} onChange={set("accountingDate")} errorMessage={errors.accountingDate}
          description="Empty: the opening date. Its period must be open." />
        <TextField label="Migration reference" isRequired value={draft.migrationReference} onChange={set("migrationReference")} errorMessage={errors.migrationReference}
          description="Such as PUNE-CUTOVER-2026. Each reference is loaded once." />
        <TextField label="Source system" value={draft.sourceSystem} onChange={set("sourceSystem")} description="Such as Legacy ERP or Spreadsheet." />
        <TextField label="External reference" value={draft.externalReference} onChange={set("externalReference")} />
        <TextArea className="sm:col-span-2" label="Notes" rows={2} value={draft.notes} onChange={set("notes")} />
      </FormSection>
    </RecordFormPage>
  );
}
