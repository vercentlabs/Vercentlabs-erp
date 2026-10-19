"use client";

// The company setup wizard (Shared Platform plan 3): legal details → financial year → your app → invite your team → bring your
// data. Steps already done (in Settings or here) show as done; the optional ones can be left for later. Finishing opens Home.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, Select, StatusBadge } from "@vercentlabs/design-system";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";

import { completeSetup, getCompany, markSetupStep, type CompanyOverview } from "./company-api";
import { CompanyImages, FinancialYearForm, LegalDetailsForm } from "./CompanyForms";

const KEY = ["settings", "company"];
const APPS = ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map((module) => ({ value: module.key, label: module.name }));

type AppChoice = { allowance: number | null; selected: string[] | null; needsChoice: boolean; grandfathered: boolean };

export function SetupWizardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: getCompany });
  const [current, setCurrent] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const mark = useMutation({ mutationFn: markSetupStep, onSuccess: (result) => { refresh(); setCurrent(result.setup.nextStep); } });
  const finish = useMutation({ mutationFn: completeSetup, onSuccess: () => { refresh(); router.replace("/"); } });
  if (query.isLoading) return <LoadingState label="Loading setup" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load setup" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const data: CompanyOverview = query.data;
  const steps = data.setup.steps;
  const step = current ?? data.setup.nextStep ?? steps[steps.length - 1].key;
  const index = steps.findIndex((entry) => entry.key === step);
  const next = () => setCurrent(steps[Math.min(index + 1, steps.length - 1)].key);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Set up your company" description="A few minutes now, so your invoices are right from the first one. You can change everything later in Settings." />
      <ol className="flex flex-wrap gap-2">
        {steps.map((entry, position) => (
          <li key={entry.key}>
            <button type="button" onClick={() => setCurrent(entry.key)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${entry.key === step ? "border-brand bg-brand-soft" : "border-border"}`}>
              <span className="tabular-nums text-text-muted">{position + 1}</span>
              {entry.label}
              {entry.done ? <StatusBadge tone="success">Done</StatusBadge> : entry.optional ? <span className="text-xs text-text-muted">optional</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {mark.error && <Notice>{mark.error instanceof Error ? mark.error.message : "That did not work."}</Notice>}
      {step === "legal" && (
        <>
          <LegalDetailsForm profile={data.profile} canManage onSaved={refresh} />
          <CompanyImages profile={data.profile} canManage onChanged={refresh} />
          <div className="flex justify-end"><Button variant="primary" isDisabled={!steps[0].done} onPress={next}>Next</Button></div>
          {!steps[0].done && steps[0].missing.length > 0 && <p className="text-right text-sm text-text-muted">{`Still needed: ${steps[0].missing.join(", ")}.`}</p>}
        </>
      )}
      {step === "financial_year" && (
        <>
          <FinancialYearForm profile={data.profile} canManage onSaved={refresh} />
          <div className="flex justify-end"><Button variant="primary" isLoading={mark.isPending} onPress={() => mark.mutate("financial_year")}>This is right</Button></div>
        </>
      )}
      {step === "app" && <AppStep onDone={() => { refresh(); next(); }} />}
      {step === "people" && (
        <Panel title="Invite your team" description="Each person signs in with their own account and sees only what their role allows.">
          <p className="text-sm">Invite people from <Link className="text-brand hover:underline" href="/settings/invitations">Settings › Invitations</Link>, with one or more roles each. On the Free plan the company has 1 user.</p>
          <div className="flex justify-end"><Button variant="secondary" isLoading={mark.isPending} onPress={() => mark.mutate("people")}>I will do this later</Button></div>
        </Panel>
      )}
      {step === "data" && (
        <Panel title="Bring your data" description="In this order, so each step finds what the one before it brought in.">
          <ol className="list-decimal pl-5 text-sm">
            <li>Customers and suppliers — <Link className="text-brand hover:underline" href="/sales/customers">Sales › Customers</Link> and <Link className="text-brand hover:underline" href="/procurement/suppliers">Procurement › Suppliers</Link> (Import on each list).</li>
            <li>Items and prices — <Link className="text-brand hover:underline" href="/inventory/items">Inventory › Items</Link>.</li>
            <li>Opening stock — <Link className="text-brand hover:underline" href="/inventory/opening-stock">Inventory › Opening stock</Link>, as on your go-live date.</li>
            <li>Opening balances — <Link className="text-brand hover:underline" href="/accounting/opening-balances">Accounting › Opening balances</Link>, from your last balance sheet.</li>
            <li>CRM leads, companies and contacts — <Link className="text-brand hover:underline" href="/crm/data/import-export">CRM › Import data</Link>.</li>
          </ol>
          <div className="flex justify-end"><Button variant="secondary" isLoading={mark.isPending} onPress={() => mark.mutate("data")}>Got it</Button></div>
        </Panel>
      )}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm text-text-muted">{data.setup.readyToFinish ? "The required steps are done." : "Finish the legal details and your app first."}</span>
        <Button variant="primary" isDisabled={!data.setup.readyToFinish} isLoading={finish.isPending} onPress={() => finish.mutate()}>Finish setup</Button>
      </div>
      {finish.error && <Notice>{finish.error instanceof Error ? finish.error.message : "Setup could not be finished."}</Notice>}
    </div>
  );
}

function AppStep({ onDone }: { onDone: () => void }) {
  const query = useQuery({ queryKey: ["settings", "billing", "apps"], queryFn: async () => (await (await fetch("/api/billing/apps", { credentials: "same-origin" })).json()).appChoice as AppChoice });
  const [picked, setPicked] = useState<string>(APPS[0]?.value ?? "");
  const choose = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/billing/apps", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: picked }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "The app could not be chosen.");
      return payload;
    },
    onSuccess: onDone,
  });
  if (query.isLoading) return <LoadingState label="Loading" rows={2} />;
  const choice = query.data;
  if (!choice || choice.allowance === null || choice.grandfathered) {
    return (
      <Panel title="Your apps" description="Your plan includes every app; switch on the ones you use in Settings › Modules.">
        <div className="flex justify-end"><Button variant="primary" onPress={onDone}>Next</Button></div>
      </Panel>
    );
  }
  return (
    <Panel title="Choose your app" description="The Free plan includes 1 app. You can switch to another once a month, or upgrade to Standard for every app.">
      {choose.error && <Notice>{choose.error instanceof Error ? choose.error.message : "That did not work."}</Notice>}
      {choice.selected?.length ? <p className="text-sm">{`You chose ${APPS.find((app) => app.value === choice.selected?.[0])?.label ?? choice.selected[0]}.`}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56"><Select label="App" selectedKey={picked} onSelectionChange={(key) => setPicked(String(key))} options={APPS} /></div>
        <Button variant="primary" isLoading={choose.isPending} onPress={() => choose.mutate()}>{choice.selected?.length ? "Use this app instead" : "Use this app"}</Button>
        {!choice.needsChoice && <Button variant="secondary" onPress={onDone}>Next</Button>}
      </div>
    </Panel>
  );
}
