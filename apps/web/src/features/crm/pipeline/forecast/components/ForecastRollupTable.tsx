"use client";

import { Fragment } from "react";
import {
  Button,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";
import { formatMoney, humanize } from "@/shared/format/human";
import type {
  ForecastOwnerRow,
  ForecastTeamNode,
  ForecastWorkspace,
} from "../api/forecast-api";
import { SUBMISSION_TONE, SUBMISSION_LABEL, num } from "./forecast-format";

export function ForecastRollupTable({
  data,
  onReview,
  onHistory,
}: {
  data: ForecastWorkspace;
  onReview: (owner: ForecastOwnerRow) => void;
  onHistory: (owner: ForecastOwnerRow) => void;
}) {
  const currency = data.reportingCurrency;
  const canReview = (owner: ForecastOwnerRow) =>
    data.permissions.review &&
    owner.submission &&
    owner.submission.status !== "draft" &&
    (data.permissions.reviewableOwners === "all" ||
      data.permissions.reviewableOwners.includes(String(owner.ownerUserId)));
  const ownerRow = (owner: ForecastOwnerRow, depth: number) => (
    <TableRow
      key={`owner-${owner.ownerUserId ?? "none"}`}
      className="border-t border-border"
    >
      <TableCell
        className="py-2 pr-3"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {owner.ownerName}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.commit)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {owner.submission
          ? formatMoney(currency, owner.submission.commitAmount)
          : "—"}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {owner.submission && num(owner.submission.managerAdjustment) !== 0
          ? formatMoney(currency, owner.submission.managerAdjustment)
          : "—"}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right font-medium tabular-nums">
        {formatMoney(currency, owner.adjustedCommit)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.bestCase)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.pipeline)}
      </TableCell>
      <TableCell className="py-2 pr-3 text-right tabular-nums">
        {formatMoney(currency, owner.figures.won)}
      </TableCell>
      <TableCell className="py-2 pr-3">
        {owner.submission ? (
          <StatusBadge
            tone={SUBMISSION_TONE[owner.submission.status] ?? "neutral"}
          >
            {SUBMISSION_LABEL[owner.submission.status] ??
              humanize(owner.submission.status)}
          </StatusBadge>
        ) : (
          <span className="text-xs text-text-muted">Not submitted</span>
        )}
      </TableCell>
      <TableCell className="py-2">
        <div className="flex gap-1">
          {canReview(owner) && (
            <Button
              size="compact"
              variant="secondary"
              onPress={() => onReview(owner)}
              aria-label={`Review ${owner.ownerName}'s forecast`}
            >
              Review
            </Button>
          )}
          {owner.submission && (
            <Button
              size="compact"
              variant="ghost"
              onPress={() => onHistory(owner)}
              aria-label={`History of ${owner.ownerName}'s forecast`}
            >
              History
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
  const teamRows = (node: ForecastTeamNode, depth: number): React.ReactNode => (
    <Fragment key={`team-${node.id}`}>
      <TableRow className="border-t border-border bg-surface-muted">
        <TableCell
          className="py-2 pr-3 font-semibold"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {node.name}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.commit)}
        </TableCell>
        <TableCell className="py-2 pr-3" />
        <TableCell className="py-2 pr-3" />
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.adjustedCommit)}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.bestCase)}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.pipeline)}
        </TableCell>
        <TableCell className="py-2 pr-3 text-right font-semibold tabular-nums">
          {formatMoney(currency, node.rollup.figures.won)}
        </TableCell>
        <TableCell className="py-2 pr-3" />
        <TableCell className="py-2" />
      </TableRow>
      {node.owners.map((owner) => ownerRow(owner, depth + 1))}
      {node.children.map((child) => teamRows(child, depth + 1))}
    </Fragment>
  );
  return (
    <section
      aria-label="Forecast by team and seller"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">By team and seller</h2>
        <span className="text-xs text-text-muted">
          Each seller counts once, in their current team; team rows include
          sub-teams.
        </span>
      </div>
      <Table caption="Forecast by team and seller">
        <TableHead>
          <TableRow>
            <TableHeaderCell className="pr-3 text-left">
              Team / seller
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Commit (system)
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Submitted
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Adjustment
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Commit
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Best case
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">
              Pipeline
            </TableHeaderCell>
            <TableHeaderCell className="pr-3 text-right">Won</TableHeaderCell>
            <TableHeaderCell className="pr-3 text-left">Status</TableHeaderCell>
            <TableHeaderCell className="text-left">
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.rollup.teams.map((node) => teamRows(node, 0))}
          {data.rollup.unattributed.owners.length > 0 && (
            <>
              <TableRow className="border-t border-border bg-surface-muted">
                <TableCell className="py-2 pr-3 font-semibold" colSpan={10}>
                  Not in a team
                </TableCell>
              </TableRow>
              {data.rollup.unattributed.owners.map((owner) =>
                ownerRow(owner, 1),
              )}
            </>
          )}
        </TableBody>
      </Table>
    </section>
  );
}
