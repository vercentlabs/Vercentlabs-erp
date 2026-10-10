"use client";

// A terminal's barcode scanner: on or off, how its keyboard-wedge scanner (USB or Bluetooth in keyboard mode) frames a code — an optional
// prefix and the suffix it ends with — and the success / error sounds. No drivers or device management: pairing stays with the device's
// operating system. Changing it needs the terminal-hardware permission and is recorded in the terminal's history.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, Switch, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getScannerSettings, updateScannerSettings, type PosScannerSettings } from "./scanner-api";

const SUFFIX_LABEL = { enter: "Enter", tab: "Tab", custom: "Custom" } as const;

export function ScannerSettingsPanel({ terminalId }: { terminalId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos-scanner", terminalId);
  const query = useQuery({ queryKey: key, queryFn: () => getScannerSettings(terminalId) });
  const [draft, setDraft] = useState<PosScannerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateScannerSettings(terminalId, { enabled: draft!.enabled, prefix: draft!.prefix, suffix: draft!.suffix, suffixCustom: draft!.suffixCustom,
      successSound: draft!.successSound, errorSound: draft!.errorSound, expectedVersion: query.data!.version }),
    onSuccess: (next) => { queryClient.setQueryData(key, next); setDraft(null); setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-terminals") }); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The settings could not be saved."),
  });
  if (query.isLoading) return <LoadingState label="Loading scanner settings" rows={2} />;
  if (!query.data) return null;
  const settings = query.data;
  if (!draft) {
    return (
      <Panel title="Barcode scanner" description="USB and Bluetooth scanners in keyboard mode work without drivers. Pairing stays with the device's own settings."
        actions={settings.capabilities?.edit ? <Button variant="secondary" size="compact" onPress={() => setDraft(settings)}>Change</Button> : undefined}>
        <FactList columns={2} items={[
          ["Scanning", settings.enabled ? "On" : "Off — products are found by search only"],
          ["Ends each code with", settings.suffix === "custom" ? `Custom “${settings.suffixCustom}”` : SUFFIX_LABEL[settings.suffix]],
          ["Prefix", settings.prefix ? `“${settings.prefix}” (removed)` : "None"],
          ["Sounds", [settings.successSound && "success", settings.errorSound && "errors"].filter(Boolean).join(" and ") || "Off (the screen still shows every result)"],
        ]} />
      </Panel>
    );
  }
  return (
    <Panel title="Barcode scanner" description="Match these to how the scanner is programmed (its manual's suffix and prefix settings).">
      {error && <Notice>{error}</Notice>}
      <Switch isSelected={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })}>Scanning on this terminal</Switch>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Ends each code with" selectedKey={draft.suffix} onSelectionChange={(value) => setDraft({ ...draft, suffix: String(value) as PosScannerSettings["suffix"] })}
          options={[{ value: "enter", label: "Enter" }, { value: "tab", label: "Tab" }, { value: "custom", label: "Custom characters" }]} />
        {draft.suffix === "custom" && (
          <TextField label="Custom suffix" value={draft.suffixCustom ?? ""} onChange={(value) => setDraft({ ...draft, suffixCustom: value.slice(0, 10) })} />
        )}
        <TextField label="Prefix (optional)" value={draft.prefix ?? ""} onChange={(value) => setDraft({ ...draft, prefix: value.slice(0, 10) || null })}
          description="Characters the scanner sends before each code, removed before lookup." />
      </div>
      <div className="flex flex-col gap-2">
        <Switch isSelected={draft.successSound} onChange={(successSound) => setDraft({ ...draft, successSound })}>Beep when a product is added</Switch>
        <Switch isSelected={draft.errorSound} onChange={(errorSound) => setDraft({ ...draft, errorSound })}>Warning tone when a scan needs attention</Switch>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={() => setDraft(null)}>Cancel</Button>
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
      </div>
    </Panel>
  );
}
