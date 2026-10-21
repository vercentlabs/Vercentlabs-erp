"use client";

// Industry starter packs: one click sets up CRM for a kind of business — its pipeline, lead sources, fields and lost reasons. What
// already exists is kept; applying a pack twice changes nothing.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class StarterPackError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(StarterPackError, "body");

type Pack = { key: string; name: string; description: string; pipeline: string; stages: string[]; sources: string[]; fields: Array<{ entityType: string; label: string }>; lostReasons: string[] };
type Result = { pack: string; pipeline: { name: string; created: boolean; madeDefault: boolean }; sources: string[]; fields: string[]; lostReasons: string[] };
const ENTITY = { lead: "leads", opportunity: "deals", party: "companies", contact: "contacts" } as Record<string, string>;

export function StarterPacksScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const packs = useQuery({ queryKey: scopedQueryKey(workspace, "crm-starter-packs"), queryFn: () => request<{ packs: Pack[] }>("/api/crm/starter-packs").then((result) => result.packs), staleTime: Infinity });
  const [result, setResult] = useState<Result | null>(null);
  const apply = useMutation({
    mutationFn: (key: string) => request<{ result: Result }>("/api/crm/starter-packs", { method: "POST", json: { key } }).then((answer) => answer.result),
    onSuccess: (answer) => { setResult(answer); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm") }); },
  });
  if (!canManage) return <PermissionState title="You can't set up CRM" description="Ask an administrator for the Manage CRM settings permission." />;
  if (packs.isLoading) return <LoadingState label="Loading starter packs" rows={3} />;
  if (packs.isError) return <ErrorState title="Could not load the starter packs" description="Refresh to try again." action={{ label: "Try again", onPress: () => void packs.refetch() }} />;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Industry starter packs" description="Set CRM up the way your kind of business sells. Anything you already have is kept; each part can be changed afterwards in Setup." />
      {apply.isError && <Notice>{apply.error instanceof Error ? apply.error.message : "The pack could not be applied."}</Notice>}
      {result && (
        <Notice tone="success">
          {`${result.pack}: ${result.pipeline.created ? `the pipeline ${result.pipeline.name} was added` : `the pipeline ${result.pipeline.name} was already there`}`
            + `${result.pipeline.madeDefault ? " and is now the default" : ""}; `
            + `${result.sources.length} lead ${result.sources.length === 1 ? "source" : "sources"}, ${result.fields.length} ${result.fields.length === 1 ? "field" : "fields"} and `
            + `${result.lostReasons.length} lost ${result.lostReasons.length === 1 ? "reason" : "reasons"} added.`}
        </Notice>
      )}
      <ul className="grid gap-4 md:grid-cols-2">
        {(packs.data ?? []).map((pack) => (
          <li key={pack.key} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">{pack.name}</h2>
              <p className="text-sm text-text-secondary">{pack.description}</p>
            </div>
            <dl className="flex flex-col gap-2 text-sm">
              <div><dt className="text-xs text-text-muted">{`Pipeline: ${pack.pipeline}`}</dt><dd>{pack.stages.join(" → ")}</dd></div>
              <div><dt className="text-xs text-text-muted">Lead sources</dt><dd>{pack.sources.join(", ")}</dd></div>
              <div><dt className="text-xs text-text-muted">Fields</dt><dd>{pack.fields.map((field) => `${field.label} (${ENTITY[field.entityType] ?? field.entityType})`).join(", ")}</dd></div>
              <div><dt className="text-xs text-text-muted">Lost reasons</dt><dd>{pack.lostReasons.join(", ")}</dd></div>
            </dl>
            <div>
              <Button variant="secondary" isLoading={apply.isPending && apply.variables === pack.key} isDisabled={apply.isPending} onPress={() => apply.mutate(pack.key)}>Use this pack</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
