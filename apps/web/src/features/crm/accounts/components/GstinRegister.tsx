"use client";

// The GST register's view of a GSTIN (CRM plan 5.6): the company's status there (active, cancelled, suspended), its registered names,
// and when it was last checked — with Verify to ask again. And, on a new company, Fill from GSTIN.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, TextField } from "@vercentlabs/design-system";
import { parseGstin } from "@vercentlabs/shared-types";

import { errorMessage, getAccountGstinCheck, lookupGstin, verifyAccountGstin, type CompanyFromGstin } from "@/features/crm/shared/gst-api";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { active: "success", cancelled: "danger", suspended: "danger", inactive: "warning", not_found: "danger" };

export function GstinRegisterStatus({ accountId, hasGstin }: { accountId: string; hasGstin: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "account", accountId, "gstin-check");
  const query = useQuery({ queryKey: key, queryFn: () => getAccountGstinCheck(accountId), enabled: hasGstin });
  const [warnings, setWarnings] = useState<string[]>([]);
  const verify = useMutation({
    mutationFn: () => verifyAccountGstin(accountId),
    onSuccess: (result) => { setWarnings(result.warnings.map((warning) => warning.message)); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  if (!hasGstin || !query.data) return null;
  const check = query.data.check;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-secondary">GST register:</span>
        {check ? <Badge tone={TONE[check.status] ?? "neutral"}>{check.statusLabel}</Badge> : <span className="text-text-muted">not checked yet</span>}
        {check?.legalName && <span>{check.legalName}{check.tradeName && check.tradeName !== check.legalName ? ` (${check.tradeName})` : ""}</span>}
        {check?.registeredOn && <span className="text-text-muted">registered {formatDate(check.registeredOn)}</span>}
        {check && <span className="text-xs text-text-muted">checked {formatDateTime(check.checkedAt)}</span>}
        {query.data.configured
          ? <Button variant="ghost" size="compact" isLoading={verify.isPending} onPress={() => verify.mutate()}>{check ? "Check again" : "Verify with the GST register"}</Button>
          : <span className="text-xs text-text-muted">Connect a GST data provider to check GSTINs with the register.</span>}
      </div>
      {verify.isError && <Notice>{errorMessage(verify.error, "The GST register could not be asked.")}</Notice>}
      {warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
    </div>
  );
}

// A GSTIN box with Fill from GSTIN: the register's name and principal address go into the form.
export function FillFromGstin({ gstin, onGstinChange, onFill }: { gstin: string; onGstinChange: (value: string) => void; onFill: (company: CompanyFromGstin) => void }) {
  const reading = parseGstin(gstin);
  const [notice, setNotice] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: () => lookupGstin(reading.gstin),
    onSuccess: (company) => {
      onFill(company);
      setNotice(!company.configured ? "The GSTIN looks right (format and check character). Connect a GST data provider to fill in the name and address from the register."
        : company.status === "active" ? null : `On the GST register this GSTIN is ${company.statusLabel.toLowerCase()}.`);
    },
    onError: (failure) => setNotice(errorMessage(failure, "The GST register could not be asked.")),
  });
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField label="GSTIN" description="Optional. Fill in the company from the GST register." value={gstin} onChange={(value) => onGstinChange(value.toUpperCase())}
            isInvalid={reading.gstin.length === 15 && !reading.valid} errorMessage={reading.gstin.length === 15 && !reading.valid ? reading.error ?? undefined : undefined} />
        </div>
        <Button variant="secondary" isLoading={lookup.isPending} isDisabled={!reading.valid} onPress={() => lookup.mutate()}>Fill from GSTIN</Button>
      </div>
      {notice && <Notice tone="info">{notice}</Notice>}
    </div>
  );
}
