"use client";

// The company's Zoom app (CRM audit): with it, a meeting can ask for a Zoom link and CRM makes the Zoom meeting. It is a Server-to-Server
// OAuth app from the Zoom Marketplace (scope meeting:write:admin); its Account ID, Client ID and Client secret are kept encrypted.
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

class ZoomApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ZoomApiError, "body");
type ZoomSettings = { connected: boolean; accountId: string | null; clientId: string | null };

export function ZoomSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "zoom-settings");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ settings: ZoomSettings }>("/api/crm/zoom-settings").then((result) => result.settings), enabled: canManage });
  if (!canManage) return <PermissionState title="You can't set up Zoom" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading Zoom" rows={2} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load Zoom" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <ZoomForm settings={query.data} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />;
}

function ZoomForm({ settings, onSaved }: { settings: ZoomSettings; onSaved: () => void }) {
  const [accountId, setAccountId] = useState(settings.accountId ?? "");
  const [clientId, setClientId] = useState(settings.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => request("/api/crm/zoom-settings", { method: "PUT", json: input }),
    onSuccess: (_result, input) => { setSaved(input.disconnect ? "Zoom is disconnected." : "Zoom is connected."); setClientSecret(""); onSaved(); },
  });
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Zoom" description="Connect your company's Zoom so a meeting can carry a Zoom link that CRM makes for it. Google Meet and Teams links come from each person's own calendar (Setup › My calendar)." />
      {save.isError && <Notice>{save.error instanceof Error ? save.error.message : "Zoom could not be saved."}</Notice>}
      {saved && !save.isPending && <Notice tone="success">{saved}</Notice>}
      <p className="text-sm text-text-secondary">
        In the Zoom App Marketplace, build a Server-to-Server OAuth app with the scope to create meetings, activate it, and copy its Account ID, Client ID and Client secret here.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Account ID" value={accountId} onChange={setAccountId} />
        <TextField label="Client ID" value={clientId} onChange={setClientId} />
      </div>
      <PasswordField label="Client secret" value={clientSecret} onChange={setClientSecret} description={settings.connected ? "Kept as it is unless you enter a new one." : undefined} />
      <div className="flex gap-2">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate({ accountId, clientId, clientSecret })}>{settings.connected ? "Save" : "Connect Zoom"}</Button>
        {settings.connected && <Button variant="secondary" isDisabled={save.isPending} onPress={() => save.mutate({ disconnect: true })}>Disconnect</Button>}
      </div>
    </div>
  );
}
