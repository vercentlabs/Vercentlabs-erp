"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { findAccountDuplicates, listAccounts } from "@/features/crm/accounts/api/accounts-api";
import { findContactDuplicates, listContacts } from "@/features/crm/contacts/api/contacts-api";
import { findLeadDuplicates, listLeads } from "@/features/crm/leads/api/leads-api";
import { humanize } from "@/features/crm/shared/human";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

export type EntityType = "lead" | "account" | "contact";
export type Suspect = { key: string; aId: string; aName: string; bId: string; bName: string; strength: "Very likely" | "Possible"; why: string[] };

const SCAN_SIZE = 40;
const STRONG = /(gstin|pan|email|mobile|phone|exact)/i;

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

// Asks the server's own matching engine, record by record, over the most recently changed records. Nothing here decides
// that two records are the same: it lists what the engine reports, with the reasons, for a person to review.
async function scan(type: EntityType): Promise<Suspect[]> {
  const found = new Map<string, Suspect>();
  const add = (aId: string, aName: string, bId: string, bName: string, signals: string[]) => {
    if (aId === bId) return;
    const key = [aId, bId].sort().join(":");
    const why = [...new Set(signals.map((s) => humanize(s).toLowerCase()))];
    const existing = found.get(key);
    const strength = signals.some((s) => STRONG.test(s)) ? "Very likely" : "Possible";
    if (!existing || (existing.strength === "Possible" && strength === "Very likely")) found.set(key, { key, aId, aName, bId, bName, strength, why });
  };

  if (type === "lead") {
    const { rows } = await listLeads({ limit: SCAN_SIZE } as never);
    await inBatches(rows, 5, async (lead) => {
      const name = lead.fullName || `${lead.firstName} ${lead.lastName ?? ""}`.trim();
      const { duplicates } = await findLeadDuplicates({ firstName: lead.firstName, lastName: lead.lastName, email: lead.email, mobile: lead.mobile, phone: lead.phone, companyName: lead.companyName }, lead.id).catch(() => ({ duplicates: [] }));
      for (const d of duplicates) if (!("restricted" in d && d.restricted) && "id" in d) add(lead.id, name, d.id, d.fullName || d.name, d.classification === "exact" ? ["exact", ...d.signals] : d.signals);
    });
  } else if (type === "account") {
    const { rows } = await listAccounts({ limit: SCAN_SIZE, status: "active" });
    await inBatches(rows, 5, async (account) => {
      const { duplicates } = await findAccountDuplicates({ displayName: account.displayName, legalName: account.legalName, gstin: account.gstin, pan: account.pan, excludeId: account.id }).catch(() => ({ duplicates: [] }));
      for (const d of duplicates) add(account.id, account.displayName, d.id, d.display_name, d.matched_signals ?? []);
    });
  } else {
    const { rows } = await listContacts({ limit: SCAN_SIZE, status: "active" });
    await inBatches(rows, 5, async (contact) => {
      const name = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
      const { duplicates } = await findContactDuplicates({ firstName: contact.firstName, lastName: contact.lastName, email: contact.email, mobile: contact.mobile, phone: contact.phone, accountId: contact.accountId, excludeId: contact.id }).catch(() => ({ duplicates: [] }));
      for (const d of duplicates) add(contact.id, name, d.id, `${d.first_name} ${d.last_name ?? ""}`.trim(), d.matched_signals ?? []);
    });
  }
  return [...found.values()].sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "Very likely" ? -1 : 1));
}

export function SuspectedDuplicates({ type, onReview }: { type: EntityType; onReview: (recordId: string) => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "duplicates-scan", type), queryFn: () => scan(type), staleTime: 60_000 });
  const noun = type === "account" ? "accounts" : `${type}s`;

  return (
    <section aria-label="Suspected duplicates" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Suspected duplicates</h2>
          <p className="text-xs text-text-muted">{`Checked across your ${SCAN_SIZE} most recently changed ${noun}. Nothing is merged until you review it and confirm.`}</p>
        </div>
        <Button variant="secondary" size="compact" onPress={() => query.refetch()} isLoading={query.isFetching && !query.isLoading}>Rescan</Button>
      </div>
      {query.isLoading ? (
        <LoadingState label={`Checking ${noun} for duplicates`} rows={3} onRetry={() => query.refetch()} />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">The scan could not finish. Try again.</p>
      ) : (query.data ?? []).length === 0 ? (
        <p className="text-sm text-text-secondary">{`No suspected duplicates among these ${noun}. You can still search for any record below.`}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(query.data ?? []).map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-text">{s.aName} <span className="text-text-muted">and</span> {s.bName}</span>
                <span className="text-xs text-text-muted">{s.why.length ? `Matched on ${s.why.join(", ")}` : "Similar details"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${s.strength === "Very likely" ? "border-danger-emphasis/30 bg-danger-soft text-danger" : "border-warning-emphasis/30 bg-warning-soft text-warning"}`}>{s.strength}</span>
                <Button variant="secondary" size="compact" onPress={() => onReview(s.aId)}>Review</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
