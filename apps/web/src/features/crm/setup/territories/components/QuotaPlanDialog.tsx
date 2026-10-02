"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  NumberField,
  Select,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { createQuotaPlan } from "../api/territories-api";

const QUOTA_TYPE_OPTIONS: SelectOption[] = [
  { value: "revenue", label: "Revenue" },
  { value: "bookings", label: "Bookings" },
  { value: "margin", label: "Margin" },
  { value: "quantity", label: "Quantity" },
  { value: "new_logo", label: "New logo" },
  { value: "activity", label: "Activity" },
];

const ASSIGNEE_KIND_OPTIONS: SelectOption[] = [
  { value: "team", label: "Team" },
  { value: "territory", label: "Territory" },
  { value: "user", label: "Individual" },
];

// F020. quota-plans (tenant.crm_quota_plans; FK'd to team/territory/user,
// CHECK num_nonnulls(...)>=1). This is the setup/configuration half of
// "quotas"; F025's forecast attainment consumes these plans, it does not
// define them.
export function QuotaPlanDialog({
  isOpen,
  onOpenChange,
  teamOptions,
  territoryOptions,
  userOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  teamOptions: SelectOption[];
  territoryOptions: SelectOption[];
  userOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [assigneeKind, setAssigneeKind] = useState<
    "team" | "territory" | "user"
  >("team");
  const [assigneeId, setAssigneeId] = useState("");
  const [quotaType, setQuotaType] = useState("revenue");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [targetAmount, setTargetAmount] = useState(0);
  const [stretchAmount, setStretchAmount] = useState<number | null>(null);

  const assigneeOptions =
    assigneeKind === "team"
      ? teamOptions
      : assigneeKind === "territory"
        ? territoryOptions
        : userOptions;

  const mutation = useMutation({
    mutationFn: () =>
      createQuotaPlan({
        name,
        teamId: assigneeKind === "team" ? assigneeId : null,
        territoryId: assigneeKind === "territory" ? assigneeId : null,
        userId: assigneeKind === "user" ? assigneeId : null,
        quotaType,
        periodStart,
        periodEnd,
        currencyCode: currencyCode || null,
        targetAmount,
        stretchAmount,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setName("");
      setAssigneeId("");
      setPeriodStart("");
      setPeriodEnd("");
      setTargetAmount(0);
      setStretchAmount(null);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New quota plan">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select
          label="Assigned to"
          options={ASSIGNEE_KIND_OPTIONS}
          selectedKey={assigneeKind}
          onSelectionChange={(key) => {
            setAssigneeKind((key as "team" | "territory" | "user") ?? "team");
            setAssigneeId("");
          }}
        />
        <Select
          label={
            assigneeKind === "team"
              ? "Team"
              : assigneeKind === "territory"
                ? "Territory"
                : "User"
          }
          options={assigneeOptions}
          selectedKey={assigneeId}
          onSelectionChange={(key) => setAssigneeId(String(key ?? ""))}
        />
        <Select
          label="Quota type"
          options={QUOTA_TYPE_OPTIONS}
          selectedKey={quotaType}
          onSelectionChange={(key) => setQuotaType(String(key ?? "revenue"))}
        />
        <div className="flex gap-3">
          <TextField
            label="Period start"
            isRequired
            placeholder="YYYY-MM-DD"
            value={periodStart}
            onChange={setPeriodStart}
          />
          <TextField
            label="Period end"
            isRequired
            placeholder="YYYY-MM-DD"
            value={periodEnd}
            onChange={setPeriodEnd}
          />
        </div>
        <TextField
          label="Currency code"
          placeholder="e.g. INR, USD"
          value={currencyCode}
          onChange={setCurrencyCode}
        />
        <div className="flex gap-3">
          <NumberField
            label="Target amount"
            minValue={0}
            value={targetAmount}
            onChange={setTargetAmount}
          />
          <NumberField
            label="Stretch amount (optional)"
            minValue={0}
            value={stretchAmount ?? 0}
            onChange={(value) => setStretchAmount(value || null)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={
              !name.trim() || !assigneeId || !periodStart || !periodEnd
            }
          >
            Create quota plan
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
