"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError, post } from "@/features/procurement/shared/http";
import { getOptions, type ProcRecord } from "@/features/procurement/shared/api";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";
import { ChildSection } from "@/features/procurement/shared/ChildSection";
import { DocumentDetail } from "@/features/procurement/shared/DocumentDetail";
import { supplierChildren, supplierDetail } from "@/features/procurement/configs/suppliers";

// F063-F066/F089-F091: the supplier record with its sites and contacts,
// qualification assessments, certifications and performance scorecards.
export function SupplierDetailScreen({ id }: { id: string }) {
  const config = {
    ...supplierDetail,
    sections: [
      { id: "sites", label: "Sites & contacts", render: (record: { id: string; status: string }) => <ChildSection config={supplierChildren.sites} parentId={record.id} parentStatus={record.status} /> },
      { id: "qualification", label: "Qualification", render: (record: { id: string; status: string }) => (
        <>
          <ChildSection config={supplierChildren.qualifications} parentId={record.id} parentStatus={record.status} />
          <ChildSection config={supplierChildren.certifications} parentId={record.id} parentStatus={record.status} />
        </>
      ) },
      { id: "accounting", label: "Accounting", render: (record: ProcRecord) => <AccountingLink record={record} /> },
      { id: "performance", label: "Performance", render: (record: { id: string; status: string }) => <ChildSection config={supplierChildren.scorecards} parentId={record.id} parentStatus={record.status} /> },
    ],
  };
  return <DocumentDetail config={config} id={id} />;
}

function AccountingLink({ record }: { record: ProcRecord }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "options"), queryFn: getOptions });
  const [partyId, setPartyId] = useState<string>(record.accountingPartyId ?? "");
  const [saved, setSaved] = useState(false);
  const link = useMutation({
    mutationFn: () => post("/operations/supplier-accounting-link", { supplierId: record.id, accountingPartyId: partyId }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
    },
  });
  const message = link.error ? (link.error instanceof ProcApiError ? link.error.message : "The link could not be saved.") : null;
  const linkedName = (options.data?.accountingParties ?? []).find((p) => p.id === record.accountingPartyId)?.label;
  return (
    <ProcPanel title="Accounting link" description="A supplier invoice that matches cleanly is handed to Accounting as a vendor bill booked to this party. Without a link, the match stands but no bill is created.">
      {message && <ProcAlert>{message}</ProcAlert>}
      {saved && <ProcAlert tone="success">Linked.</ProcAlert>}
      <p className="text-sm text-text">{record.accountingPartyId ? `Currently linked to ${linkedName ?? "an Accounting party"}.` : "Not linked."}</p>
      {can("procurement.suppliers.manage") && (
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Accounting party" options={(options.data?.accountingParties ?? []).map((p) => ({ value: p.id, label: p.label }))} selectedKey={partyId || null} onSelectionChange={(key) => { setSaved(false); setPartyId(String(key ?? "")); }} placeholder="Select a supplier party" />
          <Button variant="secondary" onPress={() => link.mutate()} isLoading={link.isPending} isDisabled={!partyId || partyId === record.accountingPartyId}>
            Save link
          </Button>
        </div>
      )}
    </ProcPanel>
  );
}
