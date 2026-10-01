"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, TextField } from "@vercentlabs/design-system";
import { SettingsApiError, checkTerritoryMatch } from "../api/territories-api";

// F020: try a lead's details against every territory's coverage (the same
// match territory assignment rules use) before any lead arrives.
export function TerritoryMatchCheck() {
  const [lead, setLead] = useState({
    countryCode: "IN",
    state: "",
    city: "",
    industry: "",
  });
  const check = useMutation({ mutationFn: () => checkTerritoryMatch(lead) });
  const result = check.data?.match;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-border p-4">
      <div>
        <p className="text-sm font-medium text-text">
          Check a lead&apos;s territory
        </p>
        <p className="text-xs text-text-muted">
          Enter a lead&apos;s details to see which territory it would be routed
          to.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <TextField
          label="Country code"
          value={lead.countryCode}
          onChange={(value) =>
            setLead((current) => ({ ...current, countryCode: value }))
          }
        />
        <TextField
          label="State"
          value={lead.state}
          onChange={(value) =>
            setLead((current) => ({ ...current, state: value }))
          }
        />
        <TextField
          label="City"
          value={lead.city}
          onChange={(value) =>
            setLead((current) => ({ ...current, city: value }))
          }
        />
        <TextField
          label="Industry"
          value={lead.industry}
          onChange={(value) =>
            setLead((current) => ({ ...current, industry: value }))
          }
        />
      </div>
      <div>
        <Button
          variant="secondary"
          onPress={() => check.mutate()}
          isLoading={check.isPending}
        >
          Check territory
        </Button>
      </div>
      {check.isError && (
        <p className="text-sm text-danger">
          {check.error instanceof SettingsApiError
            ? check.error.message
            : "The check could not be run."}
        </p>
      )}
      {check.isSuccess && (
        <p className="text-sm text-text" role="status">
          {result
            ? `Routed to ${result.name} (matched on ${result.matchedOn.join(", ")}).${result.alternatives.length ? ` Also covered by ${result.alternatives.map((alt) => alt.name).join(", ")}, which ${result.alternatives.length === 1 ? "is" : "are"} less specific.` : ""}`
            : "No territory covers this lead. A territory rule skips it, and the next rule or the fallback owner takes it."}
        </p>
      )}
    </div>
  );
}
