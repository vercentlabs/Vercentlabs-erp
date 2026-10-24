"use client";

// GST register lookup (CRM plan 5.6, own provider: CRM audit): the company's GST data provider — its GSP or a GSTIN verification service —
// so a GSTIN is checked with the GST register (status, legal and trade name, principal address) through the company's own account. It is
// what fills a new company from its GSTIN and shows a company's register status (and warns when it is cancelled or the name differs).
// Without a provider, CRM checks a GSTIN's format and check character only. Test tries the details entered before they are saved.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorState, PageHeader, PasswordField, PermissionState, TextField } from "@vercentlabs/design-system";
import { parseGstin } from "@vercentlabs/shared-types";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import type { GstinCheck } from "@/features/crm/shared/gst-api";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class GstLookupError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(GstLookupError, "body");
type Settings = { own: boolean; url: string | null; keyHeader: string; keySet: boolean; platform: boolean; recent: GstinCheck[] };
type TestResult = { gstin: string; status: string; statusLabel: string; legalName: string | null; tradeName: string | null; registeredOn: string | null;
  address: Record<string, string | null> };
const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { active: "success", cancelled: "danger", suspended: "danger", inactive: "warning", not_found: "danger" };
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const addressText = (address: Record<string, string | null>) => [address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", ");

export function GstLookupScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "gst-lookup");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ settings: Settings }>("/api/crm/gst-lookup").then((result) => result.settings), enabled: canManage });
  if (!canManage) return <PermissionState title="You can't set up the GST lookup" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading the GST lookup" rows={3} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load the GST lookup" description={message(query.error, "Refresh to try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <GstLookupForm settings={query.data} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />;
}

function GstLookupForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [url, setUrl] = useState(settings.url ?? "");
  const [keyHeader, setKeyHeader] = useState(settings.keyHeader);
  const [apiKey, setApiKey] = useState("");
  const [testGstin, setTestGstin] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => request("/api/crm/gst-lookup", { method: "PUT", json: input }),
    onSuccess: (_result, input) => {
      setDone(input.clear ? (settings.platform ? "Removed. GSTIN checks use the platform's provider again." : "Removed. CRM checks a GSTIN's format only.") : "Saved. GSTIN checks now use your provider.");
      setApiKey("");
      onSaved();
    },
  });
  const test = useMutation({
    mutationFn: () => request<{ result: TestResult }>("/api/crm/gst-lookup/test", { method: "POST", json: { url, keyHeader, apiKey: apiKey || undefined, gstin: testGstin } }).then((result) => result.result),
  });
  const reading = parseGstin(testGstin);
  const state = settings.own ? { tone: "success" as const, title: "Your provider answers GSTIN checks", text: settings.url ?? "" }
    : settings.platform ? { tone: "info" as const, title: "The platform's provider answers GSTIN checks", text: "Set your own to use your GSP or verification account." }
    : { tone: "warning" as const, title: "No provider is set", text: "CRM checks a GSTIN's format and check character only; names and addresses are not filled in." };
  const changed = url !== (settings.url ?? "") || keyHeader !== settings.keyHeader || Boolean(apiKey);

  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="GST register lookup" description="Check a customer's GSTIN with the GST register through your own GSP or GSTIN verification account." />
      <Notice tone={state.tone}><span className="font-medium">{state.title}.</span> <span className="break-all">{state.text}</span></Notice>
      {save.isError && <Notice>{message(save.error, "The GST lookup could not be saved.")}</Notice>}
      {done && !save.isPending && <Notice tone="success">{done}</Notice>}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Your provider" description="From your GSP's or verification service's API page.">
            <div className="flex flex-col gap-4">
              <TextField label="Provider address" value={url} onChange={setUrl} placeholder="https://api.yourgsp.com/taxpayers/{gstin}"
                description="The https address, with {gstin} where the GSTIN goes." />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Key header" value={keyHeader} onChange={setKeyHeader} description="The header your provider reads the key from." />
                <PasswordField label="API key" value={apiKey} onChange={setApiKey} autoComplete="new-password"
                  description={settings.keySet ? "Saved and hidden. Enter a new one to replace it." : "Kept encrypted; never shown again."} />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending && !save.variables?.clear} isDisabled={!url.trim() || save.isPending}
                  onPress={() => { setDone(null); save.mutate({ url, keyHeader, apiKey }); }}>Save</Button>
                {settings.own && (
                  <Button variant="secondary" className="w-full sm:w-auto" isLoading={save.isPending && Boolean(save.variables?.clear)} isDisabled={save.isPending}
                    onPress={() => { setDone(null); save.mutate({ clear: true }); }}>{settings.platform ? "Use the platform's instead" : "Remove my provider"}</Button>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Test" description={changed ? "Tries the details above, before you save them." : "Tries the saved details. Nothing is recorded."}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <TextField label="A GSTIN to look up" className="sm:flex-1" value={testGstin} onChange={(value) => setTestGstin(value.toUpperCase().replace(/\s/g, ""))}
                  maxLength={15} placeholder="27AAACA1000F1ZM" isInvalid={testGstin.length === 15 && !reading.valid}
                  errorMessage={testGstin.length === 15 && !reading.valid ? reading.error ?? undefined : undefined} />
                <Button variant="secondary" className="w-full sm:w-auto" isLoading={test.isPending} isDisabled={!reading.valid || !url.trim()} onPress={() => test.mutate()}>Test</Button>
              </div>
              {test.isError && <Notice>{message(test.error, "The provider could not be asked.")}</Notice>}
              {test.data && <CheckCard check={{ ...test.data, checkedAt: null }} />}
            </div>
          </Panel>

          {settings.recent.length > 0 && (
            <Panel title="Recent checks" description="The latest answer for each GSTIN. An answer is reused for 7 days.">
              <ul className="flex flex-col divide-y divide-border">
                {settings.recent.map((check) => <li key={check.gstin} className="py-3 first:pt-0 last:pb-0"><CheckCard check={check} compact /></li>)}
              </ul>
            </Panel>
          )}
        </div>

        <Panel title="What it does">
          <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-text-secondary">
            <li><span className="text-text">New company:</span> type the GSTIN and choose Fill from GSTIN; the register&apos;s name and principal address go into the form.</li>
            <li><span className="text-text">Company page:</span> shows the GSTIN&apos;s status on the register (active, cancelled, suspended) with Check again.</li>
            <li><span className="text-text">Warnings:</span> a cancelled or suspended GSTIN, or a register name that differs from the company&apos;s, before you quote or invoice.</li>
            <li><span className="text-text">Your account:</span> calls go to your provider with your key, so its charges and limits are yours.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function CheckCard({ check, compact = false }: { check: Pick<GstinCheck, "gstin" | "status" | "statusLabel" | "legalName" | "tradeName" | "registeredOn" | "address"> & { checkedAt: string | null }; compact?: boolean }) {
  const address = addressText(check.address ?? {});
  if (compact)
    return (
      <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{check.gstin}</span><Badge tone={TONE[check.status] ?? "neutral"}>{check.statusLabel}</Badge></span>
          <span className="truncate text-text-secondary">{check.legalName ?? check.tradeName ?? "No name returned"}</span>
        </span>
        {check.checkedAt && <span className="text-xs text-text-muted sm:shrink-0">{formatDateTime(check.checkedAt)}</span>}
      </div>
    );
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
      <span className="flex flex-wrap items-center gap-2 text-sm"><span className="font-mono text-xs">{check.gstin}</span><Badge tone={TONE[check.status] ?? "neutral"}>{check.statusLabel}</Badge></span>
      <Facts columns={2} items={[
        { label: "Legal name", value: check.legalName ?? "—" }, { label: "Trade name", value: check.tradeName ?? "—" },
        { label: "Registered on", value: check.registeredOn ? formatDate(check.registeredOn) : "—" }, { label: "Principal address", value: address || "—" },
      ]} />
    </div>
  );
}
