"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  Select,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { humanize } from "@/shared/format/human";
import { createTerritory, updateTerritory } from "../api/territories-api";
import {
  TERRITORY_TYPES,
  type Territory,
  type TerritoryCoverage,
} from "../types";

export function TerritoryDialog({
  isOpen,
  onOpenChange,
  territory,
  managerOptions,
  parentTerritoryOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  territory: Territory | null;
  managerOptions: SelectOption[];
  parentTerritoryOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState(territory?.code ?? "");
  const [name, setName] = useState(territory?.name ?? "");
  const [territoryType, setTerritoryType] = useState(
    territory?.territoryType ?? "",
  );
  const [managerUserId, setManagerUserId] = useState(
    territory?.managerUserId ?? "",
  );
  const [parentTerritoryId, setParentTerritoryId] = useState(
    territory?.parentTerritoryId ?? "",
  );
  const [coverage, setCoverage] = useState(() =>
    coverageText(territory?.assignmentRules),
  );

  const [seededFor, setSeededFor] = useState<Territory | null | undefined>(
    undefined,
  );
  if (isOpen && territory !== seededFor) {
    setSeededFor(territory);
    setCode(territory?.code ?? "");
    setName(territory?.name ?? "");
    setTerritoryType(territory?.territoryType ?? "");
    setManagerUserId(territory?.managerUserId ?? "");
    setParentTerritoryId(territory?.parentTerritoryId ?? "");
    setCoverage(coverageText(territory?.assignmentRules));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const assignmentRules = coverageFromText(coverage);
      const input = {
        code,
        name,
        territoryType: territoryType || "geographic",
        managerUserId: managerUserId || null,
        parentTerritoryId: parentTerritoryId || null,
        assignmentRules,
      };
      return territory
        ? updateTerritory(territory.id, input, territory.updatedAt)
        : createTerritory(input);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={territory ? `Edit ${territory.name}` : "New territory"}
    >
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select
          label="Type"
          options={TERRITORY_TYPE_OPTIONS}
          selectedKey={territoryType || "geographic"}
          onSelectionChange={(key) =>
            setTerritoryType(String(key ?? "geographic"))
          }
        />
        <Select
          label="Parent territory"
          options={parentTerritoryOptions}
          selectedKey={parentTerritoryId}
          onSelectionChange={(key) => setParentTerritoryId(String(key ?? ""))}
        />
        <Select
          label="Manager"
          options={managerOptions}
          selectedKey={managerUserId}
          onSelectionChange={(key) => setManagerUserId(String(key ?? ""))}
        />
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-text">
              Which leads this territory covers
            </p>
            <p className="text-xs text-text-muted">
              Optional. Separate values with commas. A lead belongs here when
              every filled line matches it; leave all empty to use this
              territory only where an assignment rule names it. The most
              specific match wins, so a city territory beats its state.
            </p>
          </div>
          <TextField
            label="Countries (two-letter codes)"
            placeholder="IN"
            value={coverage.countryCodes}
            onChange={(value) =>
              setCoverage((current) => ({ ...current, countryCodes: value }))
            }
          />
          <TextField
            label="States"
            placeholder="Maharashtra"
            value={coverage.states}
            onChange={(value) =>
              setCoverage((current) => ({ ...current, states: value }))
            }
          />
          <TextField
            label="Cities"
            placeholder="Ahilyanagar, Shirdi"
            value={coverage.cities}
            onChange={(value) =>
              setCoverage((current) => ({ ...current, cities: value }))
            }
          />
          <TextField
            label="Industries"
            placeholder="Dairy, Food processing"
            value={coverage.industries}
            onChange={(value) =>
              setCoverage((current) => ({ ...current, industries: value }))
            }
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
            isDisabled={!code.trim() || !name.trim()}
          >
            {territory ? "Save changes" : "Create territory"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const TERRITORY_TYPE_OPTIONS = TERRITORY_TYPES.map((value) => ({
  value,
  label: humanize(value),
}));

const COVERAGE_FIELDS = [
  "countryCodes",
  "states",
  "cities",
  "industries",
] as const;

type CoverageText = Record<(typeof COVERAGE_FIELDS)[number], string> & {
  sourceIds: string[];
};

function coverageText(
  rules: TerritoryCoverage | null | undefined,
): CoverageText {
  return {
    countryCodes: (rules?.countryCodes ?? []).join(", "),
    states: (rules?.states ?? []).join(", "),
    cities: (rules?.cities ?? []).join(", "),
    industries: (rules?.industries ?? []).join(", "),
    sourceIds: rules?.sourceIds ?? [],
  };
}

function coverageFromText(text: CoverageText): TerritoryCoverage {
  const rules: TerritoryCoverage = {};
  for (const field of COVERAGE_FIELDS) {
    const values = text[field]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length) rules[field] = values;
  }
  if (text.sourceIds.length) rules.sourceIds = text.sourceIds;
  return rules;
}
