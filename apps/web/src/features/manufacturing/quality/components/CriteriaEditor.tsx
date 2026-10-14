"use client";

// A checklist's checks as edited: name, kind (pass/fail, measurement with limits, observation, choice with the accepted choices), required and
// critical. The server validates and normalises them when the revision is saved.
import { Button, Checkbox, Select, TextField } from "@vercentlabs/design-system";

import { TYPE_LABEL, type Criterion, type CriterionType } from "../api/qi-api";

export type CriterionDraft = { key?: string; name: string; type: CriterionType; unit: string; lower: string; upper: string; choices: string; acceptedChoices: string; required: boolean; critical: boolean; instructions: string };
export const blankCriterion = (): CriterionDraft => ({ name: "", type: "PASS_FAIL", unit: "", lower: "", upper: "", choices: "", acceptedChoices: "", required: true, critical: false, instructions: "" });
export const toDraft = (row: Criterion): CriterionDraft => ({ key: row.key, name: row.name, type: row.type, unit: row.unit ?? "", lower: row.lower ?? "", upper: row.upper ?? "",
  choices: row.choices.join(", "), acceptedChoices: row.acceptedChoices.join(", "), required: row.required, critical: row.critical, instructions: row.instructions ?? "" });
export const toInput = (rows: CriterionDraft[]) => rows.filter((row) => row.name.trim()).map((row) => ({
  ...(row.key ? { key: row.key } : {}), name: row.name.trim(), type: row.type, unit: row.unit.trim() || null, lower: row.lower.trim() || null, upper: row.upper.trim() || null,
  choices: row.choices, acceptedChoices: row.acceptedChoices, required: row.required, critical: row.critical, instructions: row.instructions.trim() || null,
}));

export function CriteriaEditor({ rows, onChange }: { rows: CriterionDraft[]; onChange: (rows: CriterionDraft[]) => void }) {
  const set = (index: number, patch: Partial<CriterionDraft>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto]">
            <TextField label={`Check ${index + 1}`} value={row.name} onChange={(value) => set(index, { name: value })} placeholder="e.g. Seat height" />
            <Select label="Kind" selectedKey={row.type} onSelectionChange={(value) => set(index, { type: String(value) as CriterionType })}
              options={(Object.keys(TYPE_LABEL) as CriterionType[]).map((type) => ({ value: type, label: TYPE_LABEL[type] }))} />
            <Button size="compact" variant="ghost" onPress={() => onChange(rows.filter((_, at) => at !== index))}>Remove</Button>
          </div>
          {row.type === "NUMERIC" && (
            <div className="grid gap-2 sm:grid-cols-3">
              <TextField label="Lower limit" inputMode="decimal" value={row.lower} onChange={(value) => set(index, { lower: value })} />
              <TextField label="Upper limit" inputMode="decimal" value={row.upper} onChange={(value) => set(index, { upper: value })} />
              <TextField label="Unit" value={row.unit} onChange={(value) => set(index, { unit: value })} placeholder="mm" />
            </div>
          )}
          {row.type === "CHOICE" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextField label="Choices (comma separated)" value={row.choices} onChange={(value) => set(index, { choices: value })} placeholder="Black, Grey, Red" />
              <TextField label="Accepted choices" value={row.acceptedChoices} onChange={(value) => set(index, { acceptedChoices: value })} description="Empty: every choice passes." />
            </div>
          )}
          <TextField label="Instructions" value={row.instructions} onChange={(value) => set(index, { instructions: value })} />
          <div className="flex flex-wrap gap-4">
            <Checkbox isSelected={row.required} onChange={(value) => set(index, { required: value })}>Required</Checkbox>
            <Checkbox isSelected={row.critical} onChange={(value) => set(index, { critical: value })}>Critical (a failure blocks acceptance)</Checkbox>
          </div>
        </div>
      ))}
      <div><Button size="compact" variant="secondary" onPress={() => onChange([...rows, blankCriterion()])}>Add check</Button></div>
    </div>
  );
}
