"use client";

// "Accounting recorded automatically" on a business document: whether its accounting is done, in plain words, with the debits and credits
// one click away for those who want them (people without Accounting access see only the status). A posting that failed says why and what
// to do, and links to Automatic postings where it is retried.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { POSTING_STATUS, amount, plain, sourceAccounting, type SourceAccounting } from "../api/automatic-api";

type Item = SourceAccounting["postings"][number];

const SENTENCE: Record<string, string> = {
  POSTED: "has been added to your accounts. No manual journal entry is required.",
  REVERSED: "was added to your accounts and has since been reversed; both entries are kept.",
  DRAFT: "is being recorded in your accounts.",
  PENDING: "is waiting to be recorded in your accounts.",
  CANCELLED: "will not be recorded: the posting was dismissed.",
};

// sourceType: one source type, or several separated by commas (an expense and its payment); noun: "invoice", "bill", "expense" …
export function AccountingRecorded({ sourceType, sourceId, noun = "document" }: { sourceType: string; sourceId: string | null | undefined; noun?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "source-postings", sourceType, sourceId ?? ""),
    queryFn: () => sourceAccounting(sourceType, sourceId!),
    enabled: Boolean(sourceId),
    retry: false,
  });
  if (!sourceId || query.isLoading || query.isError || !query.data) return null;
  const postings = query.data.postings;
  if (!postings.length) return null;
  const failed = postings.filter((posting) => posting.status === "FAILED");
  return (
    <Panel title={failed.length ? "Accounting not recorded yet" : "Accounting recorded automatically"}
      description={failed.length ? undefined : `Your ${noun} ${SENTENCE[postings[0].status] ?? SENTENCE.POSTED}`}>
      {failed.map((posting) => (
        <Notice key={posting.id} tone="danger">
          <span className="font-medium">{posting.label}: </span>{posting.error?.message} {posting.error?.hint}{" "}
          <Link className="underline" href="/accounting/postings">Open Automatic postings</Link>
        </Notice>
      ))}
      <ul className="flex flex-col gap-3">
        {postings.filter((posting) => posting.status !== "FAILED").map((posting) => <PostingDetails key={posting.id} posting={posting} detailed={query.data.detailed} />)}
      </ul>
    </Panel>
  );
}

function PostingDetails({ posting, detailed }: { posting: Item; detailed: boolean }) {
  const [open, setOpen] = useState(false);
  const status = POSTING_STATUS[posting.status];
  const currency = posting.currency?.trim() || "INR";
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-text">{posting.label}</span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {posting.amount && <span className="tabular-nums text-text-secondary">{amount(posting.amount, currency)}</span>}
        {posting.journalNumber && (detailed
          ? <Link className="text-xs text-brand underline" href={`/accounting/journals/${posting.journalEntryId}`}>Journal {posting.journalNumber}</Link>
          : <span className="text-xs text-text-muted">Journal {posting.journalNumber}</span>)}
        {posting.reversalNumber && <span className="text-xs text-text-muted">Reversed by {posting.reversalNumber}</span>}
        {detailed && posting.lines.length > 0 && (
          <Button size="compact" variant="ghost" onPress={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}Accounting details
          </Button>
        )}
      </div>
      {open && (
        <LinesTable columns={["Account", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }]}>
          {posting.lines.map((line) => (
            <tr key={line.account} className="border-t border-border">
              <Cell>{line.account}</Cell>
              <Cell numeric>{plain(line.debit) && `Dr ${amount(line.debit, currency)}`}</Cell>
              <Cell numeric>{plain(line.credit) && `Cr ${amount(line.credit, currency)}`}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </li>
  );
}
