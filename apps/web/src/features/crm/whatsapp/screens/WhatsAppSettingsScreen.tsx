"use client";

// CRM › Setup › WhatsApp (CRM plan 4.2). Click-to-chat works for everyone without setup. Connecting the WhatsApp Business (Cloud) API
// lets CRM send messages itself and receive the customer's replies and receipts: enter the phone number ID, an access token and the app
// secret from Meta, then paste the webhook address and verify token shown once into the app's WhatsApp webhook settings.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, PermissionState, Radio, RadioGroup, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { errorMessage, getWhatsAppSettings, saveWhatsAppSettings, type WhatsAppSettings } from "@/features/crm/shared/whatsapp-api";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function WhatsAppSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "whatsapp-settings"), queryFn: getWhatsAppSettings, enabled: canManage });
  if (!canManage) return <PermissionState title="You can't set up WhatsApp" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      <div>
        <h1 className="text-xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-text-secondary">Message leads, deals, companies and contacts on WhatsApp from their page, with every message kept on the record.</p>
      </div>
      {query.isLoading ? <LoadingState label="Loading" rows={3} /> : query.data && <SettingsForm key={query.dataUpdatedAt} settings={query.data} onSaved={() => void query.refetch()} />}
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
  const save = useMutation({
    mutationFn: (newWebhook: boolean) => saveWhatsAppSettings({ mode, phoneNumberId, displayNumber, accessToken, appSecret, newWebhook }),
    onSuccess: (result) => { if (result.webhookKey) setShown({ webhookKey: result.webhookKey, verifyToken: result.verifyToken }); setAccessToken(""); setAppSecret(""); onSaved(); },
  });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
      {settings.lastError && <Notice>Last problem: {settings.lastError}</Notice>}
      <RadioGroup label="How messages go" value={mode} onChange={(value) => setMode(value as WhatsAppSettings["mode"])}>
        <Radio value="click_to_chat">Click-to-chat: WhatsApp opens on the salesperson&apos;s phone or WhatsApp Web, and CRM logs the message</Radio>
        <Radio value="cloud_api">WhatsApp Business API: CRM sends from your business number and receives replies</Radio>
      </RadioGroup>
      {mode === "cloud_api" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Phone number ID" value={phoneNumberId} onChange={setPhoneNumberId} description="WhatsApp Manager › Phone numbers (digits, not the number itself)." />
          <TextField label="Business number (shown to your team)" value={displayNumber} onChange={setDisplayNumber} />
          <TextField label="Access token" type="password" value={accessToken} onChange={setAccessToken}
            description={settings.credentialsSet.includes("accessToken") ? "Kept. Type a new one only to replace it." : "A permanent token of a system user with whatsapp_business_messaging."} />
          <TextField label="App secret" type="password" value={appSecret} onChange={setAppSecret}
            description={settings.credentialsSet.includes("appSecret") ? "Kept. Type a new one only to replace it." : "Meta for Developers › your app › App settings › Basic."} />
        </div>
      )}
      {settings.mode === "cloud_api" && (
        <p className="text-sm text-text-secondary">
          Connected{settings.lastReceivedAt ? `; last message received ${formatDateTime(settings.lastReceivedAt)}` : "; no message received yet"}. Webhook address key starts {settings.webhookKeyPrefix}…
        </p>
      )}
      {shown?.webhookKey && (
        <Notice tone="warning">
          <span className="flex flex-col gap-1">
            <span>Copy these into your Meta app (WhatsApp › Configuration › Webhook) now — they are not shown again. Subscribe to the &quot;messages&quot; field.</span>
            <code className="break-all">Callback URL: {origin}/api/crm/whatsapp/hooks/{shown.webhookKey}</code>
            {shown.verifyToken && <code className="break-all">Verify token: {shown.verifyToken}</code>}
          </span>
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate(false)}>Save</Button>
        {settings.mode === "cloud_api" && <Button variant="secondary" isDisabled={save.isPending} onPress={() => save.mutate(true)}>New webhook address</Button>}
      </div>
    </section>
  );
}
