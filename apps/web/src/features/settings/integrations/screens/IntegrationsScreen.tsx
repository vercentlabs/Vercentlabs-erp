"use client";

import { PageHeader, PermissionState, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ConnectedAccountsPanel } from "../components/ConnectedAccountsPanel";
import { DeveloperApiPanel } from "../components/DeveloperApiPanel";
import { InboundEmailPanel } from "../components/InboundEmailPanel";
import { WebhooksPanel } from "../components/WebhooksPanel";

const TABS = ["connected-accounts", "webhooks", "developer-api", "inbound-email"] as const;
type TabKey = (typeof TABS)[number];

export function IntegrationsScreen({ canView, canManage }: { canView: boolean; canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const selected: TabKey = TABS.includes(requested as TabKey) ? (requested as TabKey) : "connected-accounts";

  if (!canView) return <PermissionState title="You can't view integrations" description="Ask an administrator with the integrations permission." />;

  const select = (key: TabKey) => {
    const next = new URLSearchParams();
    next.set("tab", key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Integrations" description="Connect outside services: provider accounts, webhooks, the developer API and inbound email." />
      <Tabs selectedKey={selected} onSelectionChange={(key) => select(key as TabKey)}>
        <TabList aria-label="Integration areas">
          <Tab id="connected-accounts">Connected accounts</Tab>
          <Tab id="webhooks">Webhooks</Tab>
          <Tab id="developer-api">Developer API</Tab>
          <Tab id="inbound-email">Inbound email</Tab>
        </TabList>
        <TabPanel id="connected-accounts">
          <ConnectedAccountsPanel canManage={canManage} outcome={searchParams.get("oauth")} reason={searchParams.get("reason")} />
        </TabPanel>
        <TabPanel id="webhooks">
          <WebhooksPanel canManage={canManage} />
        </TabPanel>
        <TabPanel id="developer-api">
          <DeveloperApiPanel canManage={canManage} />
        </TabPanel>
        <TabPanel id="inbound-email">
          <InboundEmailPanel canManage={canManage} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
