"use client";

// The company's Zoom app (CRM audit): with it, a meeting can ask for a Zoom link and CRM makes the Zoom meeting, hosted by the app's
// account owner or a host the company names. It is a Server-to-Server OAuth app from the Zoom Marketplace (scopes meeting:write:admin
// and user:read:admin); its Account ID, Client ID and Client secret are tried with Zoom before they are kept, encrypted. The fields
// never take the browser's saved sign-in.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Video } from "lucide-react";
import { Button, ErrorState, PageHeader, PasswordField, PermissionState, TextField } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class ZoomApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ZoomApiError, "body");
type ZoomSettings = { connected: boolean; accountId: string | null; clientId: string | null; hostEmail: string | null; hostName: string | null; linksMade: number; linksWaiting: number };
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
// Keeps the browser's password manager out of fields that hold an app's keys, not the person's sign-in.
const noAutofill = { autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true" } as const;

export function ZoomSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "zoom-settings");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ settings: ZoomSettings }>("/api/crm/zoom-settings").then((result) => result.settings), enabled: canManage });
  if (!canManage) return <PermissionState title="You can't set up Zoom" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading Zoom" rows={3} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load Zoom" description={message(query.error, "Refresh to try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <ZoomForm settings={query.data} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />;
}

function ZoomForm({ settings, onSaved }: { settings: ZoomSettings; onSaved: () => void }) {
  const [accountId, setAccountId] = useState(settings.accountId ?? "");
  const [clientId, setClientId] = useState(settings.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [hostEmail, setHostEmail] = useState(settings.hostEmail ?? "");
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => request<{ settings: ZoomSettings }>("/api/crm/zoom-settings", { method: "PUT", json: input }).then((result) => result.settings),
    onSuccess: (result, input) => {
      setDone(input.disconnect ? "Zoom is disconnected. Meetings already given a Zoom link keep it." : `Zoom is connected. Meetings are hosted by ${result.hostName ?? result.hostEmail ?? "the app's account"}.`);
      setClientSecret("");
      onSaved();
    },
  });
  const check = useMutation({
    mutationFn: () => request<{ settings: ZoomSettings }>("/api/crm/zoom-settings/check", { method: "POST", json: {} }).then((result) => result.settings),
    onSuccess: () => { setDone("Zoom answered: the connection works."); onSaved(); },
  });
  const ready = /^[A-Za-z0-9_-]{6,64}$/.test(accountId.trim()) && /^[A-Za-z0-9_-]{6,64}$/.test(clientId.trim()) && (settings.connected || Boolean(clientSecret.trim()));
  const clientIdLooksWrong = clientId.includes("@");
  const error = save.error ?? check.error;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Zoom" description="Connect your company's Zoom so a meeting can carry a Zoom link that CRM makes for it." />
      {settings.connected ? (
        <Notice tone="success"><span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" aria-hidden="true" />Zoom is connected.</span></Notice>
      ) : <Notice tone="info">Not connected: meetings can use a Google Meet or Teams link from each person&apos;s calendar (Setup › My calendar), or a pasted link.</Notice>}
      {error && <Notice>{message(error, "Zoom could not be saved.")}</Notice>}
      {done && !save.isPending && !check.isPending && !error && <Notice tone="success">{done}</Notice>}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {settings.connected && (
            <Panel title="Connection" actions={<Button variant="secondary" size="compact" isLoading={check.isPending} onPress={() => { setDone(null); check.mutate(); }}>
              <RefreshCw className="size-3.5" aria-hidden="true" />Check connection</Button>}>
              <Facts columns={2} items={[
                { label: "Meetings hosted by", value: settings.hostName ? `${settings.hostName}${settings.hostEmail ? ` (${settings.hostEmail})` : ""}` : settings.hostEmail ?? "The app's account owner" },
                { label: "Account ID", value: settings.accountId ?? "—" },
                { label: "Zoom links made", value: String(settings.linksMade) },
                { label: "Waiting for a link", value: settings.linksWaiting ? `${settings.linksWaiting} (tried again every few minutes)` : "None" },
              ]} />
            </Panel>
          )}
          <Panel title={settings.connected ? "Change the app" : "Your Zoom app"} description="From the app's App credentials page in the Zoom App Marketplace.">
            <form className="flex flex-col gap-4" autoComplete="off"
              onSubmit={(event) => { event.preventDefault(); if (ready) { setDone(null); save.mutate({ accountId: accountId.trim(), clientId: clientId.trim(), clientSecret, hostEmail: hostEmail.trim() }); } }}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Account ID" isRequired value={accountId} onChange={setAccountId} {...noAutofill} />
                <TextField label="Client ID" isRequired value={clientId} onChange={setClientId} {...noAutofill}
                  isInvalid={clientIdLooksWrong} errorMessage={clientIdLooksWrong ? "This is an email address: copy the Client ID from your Zoom app." : undefined} />
              </div>
              <PasswordField label="Client secret" isRequired={!settings.connected} value={clientSecret} onChange={setClientSecret} autoComplete="new-password"
                description={settings.connected ? "Saved and hidden. Enter a new one only to replace it." : "Kept encrypted; never shown again."} />
              <TextField label="Host's Zoom email (optional)" type="email" value={hostEmail} onChange={setHostEmail} {...noAutofill}
                description="The Zoom user meetings are made under. Empty: the account that owns the app." />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" variant="primary" className="w-full sm:w-auto" isLoading={save.isPending && !save.variables?.disconnect} isDisabled={!ready || save.isPending}>
                  {settings.connected ? "Save and check" : "Connect Zoom"}</Button>
                {settings.connected && (
                  <Button variant="secondary" className="w-full sm:w-auto" isDisabled={save.isPending} onPress={() => { setDone(null); save.mutate({ disconnect: true }); }}>Disconnect</Button>
                )}
              </div>
              <p className="text-xs text-text-muted">Saving asks Zoom first: nothing is kept that Zoom refuses.</p>
            </form>
          </Panel>
        </div>

        <Panel title="How to get these">
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-text-secondary">
            <li>In the Zoom App Marketplace, choose Develop › Build app › Server-to-Server OAuth app.</li>
            <li>Under Scopes, add <span className="font-mono text-xs">meeting:write:admin</span> and <span className="font-mono text-xs">user:read:admin</span>.</li>
            <li>Activate the app, then copy its Account ID, Client ID and Client secret here.</li>
          </ol>
          <div className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-sm text-text-secondary">
            <Video className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Then, on any meeting, choose Zoom under Video call: CRM makes the meeting and puts its link in the invitation and calendar event.</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
