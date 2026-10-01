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
import { createStage } from "../api/pipeline-stages-api";
import { FORECAST_CATEGORIES, type CrmStageType } from "../types";

const STAGE_TYPE_OPTIONS: SelectOption[] = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const FORECAST_CATEGORY_OPTIONS: SelectOption[] = FORECAST_CATEGORIES.map(
  (value) => ({
    value,
    label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
  }),
);

export function StageDialog({
  isOpen,
  onOpenChange,
  pipelineId,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [stageType, setStageType] = useState<CrmStageType>("open");
  const [probability, setProbability] = useState("0");
  const [forecastCategory, setForecastCategory] = useState("pipeline");
  const [staleAfterDays, setStaleAfterDays] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createStage({
        pipelineId,
        name,
        stageType,
        probability: Number(probability) || 0,
        forecastCategory,
        staleAfterDays: staleAfterDays ? Number(staleAfterDays) : null,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setStageType("open");
      setProbability("0");
      setForecastCategory("pipeline");
      setStaleAfterDays("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New stage">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select
          label="Type"
          options={STAGE_TYPE_OPTIONS}
          selectedKey={stageType}
          onSelectionChange={(key) =>
            setStageType(String(key ?? "open") as CrmStageType)
          }
        />
        {stageType === "open" && (
          <>
            <TextField
              label="Probability (%)"
              value={probability}
              onChange={setProbability}
            />
            <Select
              label="Forecast category"
              options={FORECAST_CATEGORY_OPTIONS}
              selectedKey={forecastCategory}
              onSelectionChange={(key) =>
                setForecastCategory(String(key ?? "pipeline"))
              }
            />
            <TextField
              label="Stale after (days)"
              placeholder="Optional"
              value={staleAfterDays}
              onChange={setStaleAfterDays}
            />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!name.trim()}
          >
            Create stage
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
