"use client";

// Settings › Company (Shared Platform plan 3): the company profile, logo and signature, bank details, financial year, the setup
// progress, and "Your data" — the full export and closing the workspace.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, PageHeader, PasswordField, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";

import { cancelClosure, getCompany, requestClosure, requestExport, type CompanyOverview } from "./company-api";
import { BankAccountsForm, CompanyImages, FinancialYearForm, LegalDetailsForm } from "./CompanyForms";

const KEY = ["settings", "company"];
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

export function CompanyScreen({ canManage, isOwner }: { canManage: boolean; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: getCompany });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  if (query.isLoading) return <LoadingState label="Loading the company" rows={6} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load the company" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const data = query.data;
  const setupOpen = !data.setup.completedAt;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Company" description="Your company's details, as printed on documents, and your data." />
      {setupOpen && canManage && (
        <Notice tone="info">
          {`Setup is ${data.setup.steps.filter((step) => step.done).length} of ${data.setup.steps.length} steps done. `}
          <Link className="font-medium underline" href="/setup">Continue setup</Link>
        </Notice>
      )}
      <LegalDetailsForm profile={data.profile} canManage={canManage} onSaved={refresh} />
      <CompanyImages profile={data.profile} canManage={canManage} onChanged={refresh} />
      <BankAccountsForm profile={data.profile} canManage={canManage} onChanged={refresh} />
      <FinancialYearForm profile={data.profile} canManage={canManage} onSaved={refresh} />
      {(isOwner || canManage) && <YourData data={data} isOwner={isOwner} onChanged={refresh} />}
    </div>
  );
}

function YourData({ data, isOwner, onChanged }: { data: CompanyOverview; isOwner: boolean; onChanged: () => void }) {
  const [closing, setClosing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const exporting = useMutation({ mutationFn: requestExport, onSuccess: onChanged });
  const close = useMutation({ mutationFn: () => requestClosure({ password, confirmName }), onSuccess: () => { setClosing(false); onChanged(); } });
  const keep = useMutation({ mutationFn: cancelClosure, onSuccess: onChanged });
  const closesOn = data.closure.closesOn;
  return (
    <Panel title="Your data" description="Download everything the company has, or close the workspace.">
      <div id="data" className="flex flex-col gap-2 text-sm">
        <p>The export is one zip: a CSV file for every kind of record and every file you have uploaded. Passwords and other secrets are never included. It is ready in a few minutes and kept for 7 days.</p>
        {exporting.isSuccess && <Notice tone="success">{exporting.data.alreadyRunning ? "An export is already being made." : "The export is being made. You will be told when it is ready."}</Notice>}
        {exporting.error && <Notice>{exporting.error instanceof Error ? exporting.error.message : "The export could not start."}</Notice>}
        {data.exports.length > 0 && (
          <ul className="flex flex-col gap-1">
            {data.exports.map((file) => (
              <li key={file.id}>
                <a className="text-brand hover:underline" href={`/api/settings/company/export/${file.id}`}>{file.fileName}</a>
                <span className="text-text-muted">{` · ${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB · until ${day(file.expiresAt)}`}</span>
              </li>
            ))}
          </ul>
        )}
        <div><Button variant="secondary" isLoading={exporting.isPending} onPress={() => exporting.mutate()}>Export all data</Button></div>
      </div>
      {isOwner && (
        <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
          {closesOn ? (
            <>
              <Notice tone="warning">{`This workspace closes on ${day(closesOn)}. After that nobody can sign in. Export your data before then.`}</Notice>
              <div><Button variant="secondary" isLoading={keep.isPending} onPress={() => keep.mutate()}>Keep the workspace</Button></div>
            </>
          ) : (
            <>
              <p>{`Closing the workspace signs everyone out for good after a ${data.closure.waitingDays}-day waiting period; you can change your mind until then. Cancel a paid subscription first.`}</p>
              <div><Button variant="danger" onPress={() => setClosing(true)}>Close the workspace</Button></div>
            </>
          )}
        </div>
      )}
      <Dialog isOpen={closing} onOpenChange={(open) => !open && setClosing(false)} title="Close the workspace?">
        <div className="flex flex-col gap-3">
          <p className="text-sm">{`It closes in ${data.closure.waitingDays} days. Type the company's name and your password to confirm.`}</p>
          {close.error && <Notice>{close.error instanceof Error ? close.error.message : "It could not be closed."}</Notice>}
          <TextField label={`Company name (${data.profile.name})`} value={confirmName} onChange={setConfirmName} />
          <PasswordField label="Your password" value={password} onChange={setPassword} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setClosing(false)}>Cancel</Button>
            <Button variant="danger" isLoading={close.isPending} isDisabled={confirmName !== data.profile.name || !password} onPress={() => close.mutate()}>Close in {data.closure.waitingDays} days</Button>
          </div>
        </div>
      </Dialog>
    </Panel>
  );
}
