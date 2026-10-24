"use client";

// CRM › Setup › WhatsApp (CRM plan 4.2). Click-to-chat works for everyone without setup. Connecting the WhatsApp Business (Cloud) API
// lets CRM send messages itself and receive the customer's replies and receipts: enter the phone number ID, an access token and the app
// secret from Meta (tried with Meta before they are kept), then paste the webhook address and verify token, shown once, into the app's
// WhatsApp webhook settings. The connection can be checked at any time, and the last 30 days are counted.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { Button, ErrorState, PageHeader, PasswordField, PermissionState, Radio, RadioGroup, StatusBadge, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { checkWhatsAppConnection, errorMessage, getWhatsAppSettings, saveWhatsAppSettings, type WhatsAppSettings } from "@/features/crm/shared/whatsapp-api";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const QUALITY: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  GREEN: { label: "High quality", tone: "success" }, YELLOW: { label: "Medium quality", tone: "warning" }, RED: { label: "Low quality", tone: "danger" },
};

export function WhatsAppSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "whatsapp-settings"), queryFn: getWhatsAppSettings, enabled: canManage });
  if (!canManage) return <PermissionState title="You can't set up WhatsApp" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="WhatsApp" description="Message leads, deals, companies and contacts on WhatsApp from their page, with every message kept on the record." />
      {query.isLoading ? <LoadingState label="Loading WhatsApp" rows={3} /> : query.isError || !query.data
        ? <ErrorState title="Could not load WhatsApp" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : <SettingsForm key={query.dataUpdatedAt} settings={query.data} onSaved={() => void query.refetch()} />}
    </div>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-xs font-medium sm:w-28 sm:shrink-0">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded-[var(--radius-control)] bg-surface px-2 py-1 text-xs">{value}</code>
      <Button size="compact" variant="secondary" className="w-full sm:w-auto" onPress={() => void navigator.clipboard.writeText(value).then(() => setCopied(true), () => setCopied(false))}>
        <Copy className="size-3.5" aria-hidden="true" />{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}

function SettingsForm({ settings, onSaved }: { settings: WhatsAppSettings; onSaved: () => void }) {
  const [mode, setMode] = useState(settings.mode);
  const [phoneNumberId, setPhoneNumberId] = useState(settings.phoneNumberId ?? "");
  const [displayNumber, setDisplayNumber] = useState(settings.displayNumber ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [shown, setShown] = useState<{ webhookKey: string | null; verifyToken: string | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (newWebhook: boolean) => saveWhatsAppSettings({ mode, phoneNumberId, displayNumber, accessToken, appSecret, newWebhook }),
    onSuccess: (result) => {
      if (result.webhookKey) setShown({ webhookKey: result.webhookKey, verifyToken: result.verifyToken });
      setDone(mode === "cloud_api" ? `Saved. Meta knows this number${result.settings.verifiedName ? ` as ${result.settings.verifiedName}` : ""}.` : "Saved: messages go by click-to-chat.");
      setAccessToken(""); setAppSecret(""); onSaved();
    },
  });
  const check = useMutation({ mutationFn: checkWhatsAppConnection, onSuccess: () => { setDone("Meta answered: the number and token work."); onSaved(); } });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const connected = settings.mode === "cloud_api";
  const quality = settings.qualityRating ? QUALITY[settings.qualityRating] : null;
  const error = save.error ?? check.error;
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        {error && <Notice>{errorMessage(error)}</Notice>}
        {done && !error && !save.isPending && !check.isPending && <Notice tone="success">{done}</Notice>}
        {settings.lastError && <Notice>{`Last problem: ${settings.lastError}`}</Notice>}

        {connected && (
          <Panel title="Your business number" actions={<Button variant="secondary" size="compact" isLoading={check.isPending} onPress={() => { setDone(null); check.mutate(); }}>
            <RefreshCw className="size-3.5" aria-hidden="true" />Check connection</Button>}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="success">Connected</StatusBadge>
                {quality && <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>}
              </div>
              <Facts columns={2} items={[
                { label: "Number", value: settings.displayNumber ?? "—" },
                { label: "Name customers see", value: settings.verifiedName ?? "Check the connection to see it" },
                { label: "Last 30 days", value: `${settings.last30Days.sent} sent · ${settings.last30Days.received} received${settings.last30Days.failed ? ` · ${settings.last30Days.failed} failed` : ""}` },
                { label: "Last reply received", value: settings.lastReceivedAt ? formatDateTime(settings.lastReceivedAt) : "None yet: send a message to the number to test replies" },
              ]} />
            </div>
          </Panel>
        )}

        <Panel title="How messages go">
          <form className="flex flex-col gap-4" autoComplete="off" onSubmit={(event) => { event.preventDefault(); setDone(null); save.mutate(false); }}>
            <RadioGroup aria-label="How messages go" value={mode} onChange={(value) => { setMode(value as WhatsAppSettings["mode"]); setDone(null); }}>
              <Radio value="click_to_chat">
                <span className="flex flex-col"><span>Click-to-chat</span><span className="text-xs text-text-muted">WhatsApp opens on the salesperson&apos;s phone or WhatsApp Web with the message ready; CRM logs it. No setup.</span></span>
              </Radio>
              <Radio value="cloud_api">
                <span className="flex flex-col"><span>WhatsApp Business API</span><span className="text-xs text-text-muted">CRM sends from your business number and receives replies, receipts and STOP messages.</span></span>
              </Radio>
            </RadioGroup>
            {mode === "cloud_api" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Phone number ID" isRequired inputMode="numeric" value={phoneNumberId} onChange={(value) => setPhoneNumberId(value.replace(/\D/g, ""))} autoComplete="off"
                  description="WhatsApp Manager › Phone numbers: the ID (digits), not the number." />
                <TextField label="Business number (for your team)" type="tel" value={displayNumber} onChange={setDisplayNumber} autoComplete="off" description="Empty: taken from Meta." />
                <PasswordField label="Access token" isRequired={!settings.credentialsSet.includes("accessToken")} value={accessToken} onChange={setAccessToken} autoComplete="new-password"
                  description={settings.credentialsSet.includes("accessToken") ? "Saved and hidden. Enter a new one only to replace it." : "A permanent token of a system user with whatsapp_business_messaging."} />
                <PasswordField label="App secret" isRequired={!settings.credentialsSet.includes("appSecret")} value={appSecret} onChange={setAppSecret} autoComplete="new-password"
                  description={settings.credentialsSet.includes("appSecret") ? "Saved and hidden. Enter a new one only to replace it." : "Meta for Developers › your app › App settings › Basic."} />
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" variant="primary" className="w-full sm:w-auto" isLoading={save.isPending && save.variables === false}>{mode === "cloud_api" ? "Save and check" : "Save"}</Button>
              {connected && mode === "cloud_api" && (
                <Button variant="secondary" className="w-full sm:w-auto" isDisabled={save.isPending} isLoading={save.isPending && save.variables === true}
                  onPress={() => { setDone(null); save.mutate(true); }}>New webhook address</Button>
              )}
            </div>
            {mode === "cloud_api" && <p className="text-xs text-text-muted">Saving asks Meta first: nothing is kept that Meta refuses.</p>}
          </form>
        </Panel>

        {shown?.webhookKey && (
          <Notice tone="warning">
            <span className="flex flex-col gap-3">
              <span>Copy these into your Meta app now (WhatsApp › Configuration › Webhook); they are not shown again. Then subscribe to the &quot;messages&quot; field.</span>
              <CopyLine label="Callback URL" value={`${origin}/api/crm/whatsapp/hooks/${shown.webhookKey}`} />
              {shown.verifyToken && <CopyLine label="Verify token" value={shown.verifyToken} />}
            </span>
          </Notice>
        )}
        {connected && !shown?.webhookKey && settings.webhookKeyPrefix && (
          <p className="text-xs text-text-muted">{`The webhook address in Meta starts …/hooks/${settings.webhookKeyPrefix}. Lost it? New webhook address makes another (paste it into Meta again).`}</p>
        )}
      </div>

      <Panel title="Connecting the Business API">
        <ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-text-secondary">
          <li>In Meta for Developers, create a Business app and add the WhatsApp product, with your business number.</li>
          <li>In Business settings › System users, make a system user, give it the app and the WhatsApp account, and generate a permanent token with whatsapp_business_messaging.</li>
          <li>Enter the phone number ID, the token and the app secret here, and save.</li>
          <li>Paste the callback URL and verify token shown into the app&apos;s webhook, and subscribe to messages.</li>
        </ol>
        <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-sm text-text-secondary">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          WhatsApp&apos;s rules are kept: outside 24 hours from a customer&apos;s last message only approved templates go, and only to people who agreed.
        </p>
      </Panel>
    </div>
  );
}
