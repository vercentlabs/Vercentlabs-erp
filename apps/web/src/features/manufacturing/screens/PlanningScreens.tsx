"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  NumberField,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@vercentlabs/design-system";

import {
  MfgApiError,
  readView,
  useMfgOptions,
} from "@/features/manufacturing/shared/client";
import { label, quantity } from "@/features/manufacturing/shared/format";
import { MfgAlert, MfgPanel } from "@/features/manufacturing/shared/MfgUi";

const errorText = (error: unknown) =>
  error instanceof MfgApiError ? error.message : "That could not be completed.";

type Availability = {
  bomCode: string;
  quantity: string;
  canMakeNow: boolean;
  makeableFromStock: number | null;
  lines: Array<{
    itemId: string;
    itemCode: string;
    itemName: string;
    requiredQuantity: string;
    onHand: string;
    freeQuantity: string;
    incomingQuantity: string;
    shortageNow: string;
    shortageAfterIncoming: string;
    status: string;
  }>;
};

export function MaterialPlanningScreen() {
  const options = useMfgOptions();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const check = useMutation({
    mutationFn: () =>
      readView<{ availability: Availability }>("material-availability", {
        itemId,
        quantity: String(qty),
      }).then((r) => r.availability),
  });
  const a = check.data;
  const tone = (s: string) =>
    (s === "available"
      ? "success"
      : s === "on_order"
        ? "warning"
        : "danger") as "success" | "warning" | "danger";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Material planning"
        description="Can this be made? Every bought material at every level of the BOM against free stock and what is on order."
      />
      <MfgPanel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px]">
            <Select
              label="Product"
              options={(options.data?.items ?? []).map((i) => ({
                value: i.id,
                label: `${i.name} (${i.code})`,
              }))}
              selectedKey={itemId || null}
              onSelectionChange={(k) => setItemId(String(k ?? ""))}
              placeholder="Select product"
            />
          </div>
          <NumberField
            label="Quantity"
            value={qty}
            minValue={0}
            step={1}
            onChange={(n) => setQty(Number.isNaN(n) ? 0 : n)}
          />
          <Button
            variant="primary"
            onPress={() => check.mutate()}
            isLoading={check.isPending}
            isDisabled={!itemId || qty <= 0}
          >
            Check availability
          </Button>
        </div>
        {check.error && <MfgAlert>{errorText(check.error)}</MfgAlert>}
      </MfgPanel>
      {a && (
        <>
          <MfgAlert tone={a.canMakeNow ? "success" : "warning"}>
            {a.canMakeNow
              ? `All materials are free: ${quantity(a.quantity)} can be made now.`
              : `Not everything is free for ${quantity(a.quantity)}.`}{" "}
            From stock alone, {a.makeableFromStock ?? 0} could be made (BOM{" "}
            {a.bomCode}).
          </MfgAlert>
          <MfgPanel title="Materials">
            <div className="overflow-x-auto">
              <Table
                className="w-full text-left text-sm"
                aria-label="Material availability"
              >
                <TableHead>
                  <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                    <TableHeaderCell className="px-2 py-2">
                      Material
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      Required
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      On hand
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      Free
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      On order
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      Short now
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      Short after orders
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 py-2">
                      Status
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {a.lines.map((l) => (
                    <TableRow
                      key={l.itemId}
                      className="border-b border-border/60"
                    >
                      <TableCell className="px-2 py-2 font-medium text-text">
                        {l.itemName} ({l.itemCode})
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {quantity(l.requiredQuantity)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {quantity(l.onHand)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {quantity(l.freeQuantity)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {quantity(l.incomingQuantity)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {quantity(l.shortageNow)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {quantity(l.shortageAfterIncoming)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <StatusBadge tone={tone(l.status)}>
                          {label(l.status)}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </MfgPanel>
        </>
      )}
    </div>
  );
}
