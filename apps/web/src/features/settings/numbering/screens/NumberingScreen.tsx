"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  NumberField,
  PageHeader,
  PermissionState,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextField,
} from "@vercentlabs/design-system";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import { useMemo, useState } from "react";

import { requestJson } from "@/shared/http/request-json";

type ResetPolicy = "never" | "calendar_year" | "fiscal_year";
type NumberingType = {
  documentType: string;
  label: string;
  moduleKey: string;
  scope: "organization" | "company";
  configurable: boolean;
  customized: boolean;
  prefix: string;
  padding: number;
  resetPolicy: ResetPolicy;
  version: number;
  nextValue: number;
  nextNumberPreview: string;
};
type Payload = { companies: Array<{ id: string; name: string }>; overview: { companyId: string; fiscalYearStartMonth: number; types: NumberingType[] } | null };

const MODULE_NAME = new Map<string, string>(ERP_MODULE_CATALOG.map((module) => [module.key as string, module.name]));
const RESET_LABEL: Record<ResetPolicy, string> = { never: "Never", calendar_year: "Every calendar year", fiscal_year: "Every fiscal year" };
const RESET_OPTIONS = (Object.keys(RESET_LABEL) as ResetPolicy[]).map((value) => ({ value, label: RESET_LABEL[value] }));

// Mirrors the server's format (core/platform/numbering): the period label
// uses the organisation's own fiscal-year start month.
function fiscalLabel(now: Date, startMonth: number) {
  const start = now.getUTCMonth() + 1 >= startMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function preview(prefix: string, padding: number, value: number, resetPolicy: ResetPolicy, fiscalYearStartMonth: number) {
  const sequence = String(value).padStart(padding, "0");
  const now = new Date();
  const period = resetPolicy === "calendar_year" ? String(now.getUTCFullYear()) : resetPolicy === "fiscal_year" ? fiscalLabel(now, fiscalYearStartMonth) : null;
  return period ? `${prefix}${period}-${sequence}` : `${prefix}${sequence}`;
}

export function NumberingScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<NumberingType | null>(null);
  const query = useQuery({
    queryKey: ["settings", "numbering", companyId],
    queryFn: () => requestJson<Payload>(`/api/settings/numbering${companyId ? `?companyId=${companyId}` : ""}`),
    enabled: canManage,
  });
  const overview = query.data?.overview ?? null;
  const activeCompanyId = overview?.companyId ?? null;
  const groups = useMemo(() => {
    const map = new Map<string, NumberingType[]>();
    for (const type of overview?.types ?? []) map.set(type.moduleKey, [...(map.get(type.moduleKey) ?? []), type]);
    return [...map.entries()];
  }, [overview]);

  if (!canManage) {
    return <PermissionState title="You can't manage numbering" description="Ask an administrator with the numbering permission." />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Numbering" description="How document numbers are formed. Changes apply to documents created from now on; issued numbers never change." />
      {query.data && query.data.companies.length > 1 && (
        <div className="max-w-sm">
          <Select
            label="Company"
            options={query.data.companies.map((company) => ({ value: company.id, label: company.name }))}
            selectedKey={activeCompanyId}
            onSelectionChange={(key) => setCompanyId(String(key))}
          />
        </div>
      )}
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load numbering" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : !overview ? (
        <EmptyState title="No company yet" description="Add a company first; numbering is configured per company." />
      ) : (
        groups.map(([moduleKey, types]) => (
          <section key={moduleKey} aria-label={MODULE_NAME.get(moduleKey) ?? moduleKey} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-text">{MODULE_NAME.get(moduleKey) ?? moduleKey}</h2>
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
              <Table caption={`${MODULE_NAME.get(moduleKey) ?? moduleKey} numbering`}>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Document</TableHeaderCell>
                    <TableHeaderCell>Next number</TableHeaderCell>
                    <TableHeaderCell>Restarts</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {types.map((type) => (
                    <TableRow key={type.documentType}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-text">{type.label}</span>
                          <span className="text-xs text-text-muted">{type.scope === "organization" ? "Shared by all companies" : "This company only"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{type.nextNumberPreview}</span>
                      </TableCell>
                      <TableCell>{RESET_LABEL[type.resetPolicy]}</TableCell>
                      <TableCell>
                        {type.configurable ? (
                          <Button variant="secondary" size="compact" onPress={() => setEditing(type)} aria-label={`Edit ${type.label} numbering`}>
                            Edit
                          </Button>
                        ) : (
                          <StatusBadge tone="neutral">{`Set in ${MODULE_NAME.get(type.moduleKey) ?? "module"} settings`}</StatusBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ))
      )}
      {editing && activeCompanyId && (
        <EditNumberingDialog
          type={editing}
          companyId={activeCompanyId}
          fiscalYearStartMonth={overview?.fiscalYearStartMonth ?? 4}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["settings", "numbering"] });
          }}
        />
      )}
    </div>
  );
}

function EditNumberingDialog({ type, companyId, fiscalYearStartMonth, onClose, onSaved }: { type: NumberingType; companyId: string; fiscalYearStartMonth: number; onClose: () => void; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(type.prefix);
  const [padding, setPadding] = useState(type.padding);
  const [resetPolicy, setResetPolicy] = useState<ResetPolicy>(type.resetPolicy);
  const [advanceTo, setAdvanceTo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scopeCompanyId = type.scope === "company" ? companyId : null;
  const save = useMutation({
    mutationFn: async () => {
      await requestJson("/api/settings/numbering", { method: "PUT", json: { documentType: type.documentType, companyId: scopeCompanyId, prefix: prefix.trim().toUpperCase(), padding, resetPolicy, expectedVersion: type.version } });
      if (advanceTo !== null && advanceTo > type.nextValue) {
        await requestJson("/api/settings/numbering/advance", { method: "POST", json: { documentType: type.documentType, companyId: scopeCompanyId, nextValue: advanceTo } });
      }
    },
    onSuccess: onSaved,
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The numbering could not be saved."),
  });
  const upper = prefix.trim().toUpperCase();
  const prefixError = upper && !/^[A-Z0-9][A-Z0-9/_-]{0,23}$/.test(upper) ? "Use capital letters, digits, '-', '/' or '_' (up to 24)." : undefined;
  const advanceError = advanceTo !== null && advanceTo <= type.nextValue ? `Must be greater than ${type.nextValue}. Numbers can only move forward.` : undefined;

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`${type.label} numbering`} description={type.scope === "organization" ? "Shared by all companies in this organization." : "Applies to this company only."}>
      <div className="flex flex-col gap-4">
        <TextField label="Prefix" value={prefix} onChange={setPrefix} isRequired errorMessage={prefixError} description="Include a separator if you want one, for example INV-." />
        <NumberField label="Digits" value={padding} onChange={(value) => setPadding(Number.isFinite(value) ? Math.round(value) : padding)} minValue={1} maxValue={12} />
        <Select label="Restart numbering" options={RESET_OPTIONS} selectedKey={resetPolicy} onSelectionChange={(key) => setResetPolicy(key as ResetPolicy)} description="A restart puts the year in the number, so numbers from different years never clash." />
        <NumberField
          label="Skip ahead to (optional)"
          value={advanceTo ?? Number.NaN}
          onChange={(value) => setAdvanceTo(Number.isFinite(value) ? Math.round(value) : null)}
          minValue={type.nextValue + 1}
          errorMessage={advanceError}
          description={`Currently ${type.nextValue}. You can only move forward, for example past numbers issued by a previous system.`}
        />
        <p className="text-sm text-text-secondary">
          Next document: <span className="font-mono text-text">{preview(upper || type.prefix, padding, advanceTo ?? type.nextValue, resetPolicy, fiscalYearStartMonth)}</span>
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={Boolean(prefixError || advanceError) || !upper} onPress={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
