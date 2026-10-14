"use client";

// One inspection checklist: the checks in force, every revision (each inspection keeps the revision it started with), and — for those who manage
// checklists — a new revision, which supersedes the one in force, and making the checklist active or inactive.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus } from "@/features/manufacturing/orders/api/mo-api";
import { QI_TEMPLATES_BASE, TYPE_LABEL, getTemplate, reviseTemplate, setTemplateStatus, type Criterion, type QiTemplate } from "../api/qi-api";
import { CriteriaEditor, toDraft, toInput, type CriterionDraft } from "../components/CriteriaEditor";

const requirement = (row: Criterion) => (row.type === "NUMERIC" ? `${row.lower ?? "—"} to ${row.upper ?? "—"} ${row.unit ?? ""}` : row.type === "CHOICE"
  ? `${row.choices.join(" / ")}${row.acceptedChoices.length ? ` (accepted: ${row.acceptedChoices.join(", ")})` : ""}` : row.type === "PASS_FAIL" ? "Pass" : "Observation");

export function QiTemplateScreen({ templateId }: { templateId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "quality-template", templateId);
  const query = useQuery({ queryKey: key, queryFn: () => getTemplate(templateId), retry: false });
  const [revising, setRevising] = useState<CriterionDraft[] | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitKey = useSubmitKey();
  if (query.isLoading) return <LoadingState label="Loading the checklist" rows={6} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to inspection checklists" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the checklist" description={errorMessage(query.error)} />;
  }
  const template = query.data;
  const run = async (work: () => Promise<QiTemplate>, text: string) => {
    setBusy(true);
    try {
      queryClient.setQueryData(key, await work());
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      setMessage({ tone: "success", text });
      setRevising(null); setNotes("");
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const toolbar = template.can.manage ? (
    <div className="flex flex-wrap gap-2">
      {!revising && <Button size="compact" variant="primary" onPress={() => setRevising(template.criteria.map(toDraft))}>New revision</Button>}
      <Button size="compact" variant="ghost" isLoading={busy} onPress={() => run(() => setTemplateStatus(template.id, template.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"),
        template.status === "ACTIVE" ? "Made inactive: new inspections no longer use it." : "Made active.")}>{template.status === "ACTIVE" ? "Make inactive" : "Make active"}</Button>
    </div>
  ) : undefined;
  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={QI_TEMPLATES_BASE}>Inspection Checklists</Link>,
        title: template.name,
        status: <StatusBadge tone={template.status === "ACTIVE" ? "success" : "neutral"}>{template.status === "ACTIVE" ? "Active" : "Inactive"}</StatusBadge>,
        fields: [{ label: "Number", value: template.number }, { label: "Product", value: template.item ? `${template.item.code} · ${template.item.name}` : "Every product" },
          { label: "Stage", value: template.stage === "FINAL" ? "Final inspection" : "In-process check" }, { label: "In force", value: template.revision ? `Revision ${template.revision}` : "—" }],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {revising ? (
          <Panel title={`Revision ${(template.revision ?? 0) + 1}`} description="Saving puts it in force and supersedes the revision in force now. Inspections already started keep theirs.">
            <CriteriaEditor rows={revising} onChange={setRevising} />
            <TextField label="What changed" value={notes} onChange={setNotes} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onPress={() => setRevising(null)}>Discard</Button>
              <Button variant="primary" isLoading={busy} isDisabled={busy || !toInput(revising).length}
                onPress={() => run(() => submitKey.run(() => reviseTemplate(template.id, { criteria: toInput(revising), notes: notes.trim() || null })), "New revision in force.")}>Save revision</Button>
            </div>
          </Panel>
        ) : (
          <Panel title="Checks in force">
            <LinesTable columns={["#", "Check", "Kind", "Requirement", "Required", "Critical"]}>
              {template.criteria.map((row, index) => (
                <tr key={row.key}><Cell>{index + 1}</Cell><Cell><span className="flex flex-col"><span>{row.name}</span>{row.instructions && <span className="text-xs text-text-muted">{row.instructions}</span>}</span></Cell>
                  <Cell>{TYPE_LABEL[row.type]}</Cell><Cell>{requirement(row)}</Cell><Cell>{row.required ? "Yes" : "Optional"}</Cell><Cell>{row.critical ? "Critical" : ""}</Cell></tr>
              ))}
            </LinesTable>
          </Panel>
        )}
        <Panel title="Revisions">
          <LinesTable columns={["Revision", "Status", "Checks", "What changed", "By", "Superseded"]}>
            {template.revisions.map((row) => (
              <tr key={row.id}><Cell>Rev {row.revision}</Cell><Cell><StatusBadge tone={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status === "ACTIVE" ? "In force" : "Superseded"}</StatusBadge></Cell>
                <Cell>{row.checks}</Cell><Cell>{row.notes ?? ""}</Cell><Cell>{row.createdBy ?? ""}, {formatDateTime(row.createdAt)}</Cell><Cell>{row.supersededAt ? formatDateTime(row.supersededAt) : ""}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      </div>
    </RecordDetailsPage>
  );
}
