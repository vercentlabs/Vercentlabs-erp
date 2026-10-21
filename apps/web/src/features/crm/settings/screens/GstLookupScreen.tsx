"use client";

// GST register lookup (CRM audit): the company's own GST data provider — its GSP or a GSTIN verification service — so a GSTIN is checked
// with the register (status, legal name, address) through the company's own account instead of the platform's.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PasswordField, PermissionState, TextField } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class GstLookupError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(GstLookupError, "body");
type Settings = { own: boolean; url: string | null; keyHeader: string; keySet: boolean; platform: boolean };

export function GstLookupScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "gst-lookup");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ settings: Settings }>("/api/crm/gst-lookup").then((result) => result.settings), enabled: canManage });
  if (!canManage) return <PermissionState title="You can't set up the GST lookup" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading the GST lookup" rows={2} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load the GST lookup" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <GstLookupForm settings={query.data} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />;
}

function GstLookupForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [url, setUrl] = useState(settings.url ?? "");
  const [keyHeader, setKeyHeader] = useState(settings.keyHeader);
  const [apiKey, setApiKey] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => request("/api/crm/gst-lookup", { method: "PUT", json: input }),
    onSuccess: (_result, input) => { setDone(input.clear ? "The platform's GST lookup is used again." : "Saved. GSTIN checks now use your provider."); setApiKey(""); onSaved(); },
  });
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="GST register lookup" description="Check GSTINs with the GST register (status, legal name, address) through your own GSP or GSTIN verification account." />
      {save.isError && <Notice>{save.error instanceof Error ? save.error.message : "The GST lookup could not be saved."}</Notice>}
      {done && !save.isPending && <Notice tone="success">{done}</Notice>}
      <p className="text-sm text-text-secondary">
        {settings.own ? "Your own provider answers GSTIN checks." : settings.platform ? "The platform's provider answers GSTIN checks now; set your own to use your account." : "No provider is set: CRM checks a GSTIN's format only."}
      </p>
      <TextField label="Provider address" value={url} onChange={setUrl} placeholder="https://api.yourgsp.com/taxpayers/{gstin}"
        description="Your provider's https address, with {gstin} where the GSTIN goes." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Key header" value={keyHeader} onChange={setKeyHeader} description="The header your provider reads the key from." />
        <PasswordField label="API key" value={apiKey} onChange={setApiKey} description={settings.keySet ? "Kept as it is unless you enter a new one." : undefined} />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate({ url, keyHeader, apiKey })}>Save</Button>
        {settings.own && <Button variant="secondary" isDisabled={save.isPending} onPress={() => save.mutate({ clear: true })}>Use the platform's</Button>}
      </div>
    </div>
  );
}
