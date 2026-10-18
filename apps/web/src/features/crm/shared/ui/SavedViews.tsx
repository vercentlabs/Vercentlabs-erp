"use client";

// My views (CRM plan 5.5): a person's own named filters on a list. "Save this view" keeps the list's current filters; choosing a view
// opens the list with them; the starred view opens by default when the list is opened without filters.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Star, Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, Popover, PopoverTrigger, TextField } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class SavedViewError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(SavedViewError, "body");
type Screen = "leads" | "opportunities" | "pipeline";
type SavedView = { id: string; name: string; query: string; isDefault: boolean };

const listViews = (screen: Screen) => request<{ views: SavedView[] }>(`/api/crm/saved-views?screen=${screen}`).then((result) => result.views);
const saveView = (input: { screen: Screen; name: string; query: string; isDefault: boolean }) => request<{ view: SavedView }>("/api/crm/saved-views", { method: "POST", json: input });
const setDefault = (id: string, isDefault: boolean) => request<{ view: SavedView }>(`/api/crm/saved-views/${id}`, { method: "PATCH", json: { isDefault } });
const removeView = (id: string) => request<{ deleted: true }>(`/api/crm/saved-views/${id}`, { method: "DELETE" });

// The list's filters as a query string (empty values left out).
export function filtersToQuery(filters: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== null && value !== "" && !["limit", "offset"].includes(key)) params.set(key, String(value));
  return params.toString();
}

export function SavedViews({ screen, basePath, filters }: { screen: Screen; basePath: string; filters: object }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "saved-views", screen);
  const views = useQuery({ queryKey: key, queryFn: () => listViews(screen), staleTime: 60_000 });
  const [saving, setSaving] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const star = useMutation({ mutationFn: (view: SavedView) => setDefault(view.id, !view.isDefault), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (view: SavedView) => removeView(view.id), onSuccess: refresh });
  // A list opened without filters opens the starred view instead (once per visit).
  const preferred = views.data?.find((view) => view.isDefault);
  useEffect(() => {
    if (!preferred || typeof window === "undefined" || window.location.search) return;
    const marker = `crm-default-view:${screen}`;
    try {
      if (window.sessionStorage.getItem(marker)) return;
      window.sessionStorage.setItem(marker, "1");
    } catch {
      return;
    }
    window.location.replace(`${basePath}?${preferred.query}`);
  }, [preferred, basePath, screen]);
  // A full load: the lists read their filters from the address when they open.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the list must start again from the view's filters
  const open = (view: SavedView) => window.location.assign(`${basePath}${view.query ? `?${view.query}` : ""}`);

  return (
    <>
      <PopoverTrigger>
        <Button variant="outline" size="compact"><Bookmark className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">My views</span></Button>
        <Popover placement="bottom end">
          <div className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 text-sm">
            {(views.data ?? []).length === 0 && <p className="text-text-secondary">No saved views yet. Set the filters you use often, then save them.</p>}
            <ul className="flex flex-col">
              {(views.data ?? []).map((view) => (
                <li key={view.id} className="flex items-center justify-between gap-1">
                  <button type="button" className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left hover:bg-surface-hover" onClick={() => open(view)}>{view.name}</button>
                  <Button variant="ghost" size="compact" aria-label={view.isDefault ? `Stop opening ${view.name} by default` : `Open ${view.name} by default`} onPress={() => star.mutate(view)}>
                    <Star className={`size-4 ${view.isDefault ? "fill-current text-warning" : ""}`} aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="compact" aria-label={`Delete ${view.name}`} onPress={() => remove.mutate(view)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="compact" onPress={() => setSaving(true)}>Save this view</Button>
          </div>
        </Popover>
      </PopoverTrigger>
      {saving && <SaveDialog screen={screen} query={filtersToQuery(filters)} onClose={() => setSaving(false)} onSaved={() => { setSaving(false); refresh(); }} />}
    </>
  );
}

function SaveDialog({ screen, query, onClose, onSaved }: { screen: Screen; query: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [isDefault, setDefaultFlag] = useState(false);
  const save = useMutation({ mutationFn: () => saveView({ screen, name, query, isDefault }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Save this view" description="Your current filters, search and sort, under a name only you see. Saving under an existing name replaces it.">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{save.error instanceof Error ? save.error.message : "The view could not be saved."}</p>}
        <TextField label="Name" isRequired value={name} onChange={setName} maxLength={60} placeholder="For example: My hot leads in Pune" />
        <Checkbox isSelected={isDefault} onChange={setDefaultFlag}>Open this view by default</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!name.trim()} onPress={() => save.mutate()}>Save view</Button>
        </div>
      </div>
    </Dialog>
  );
}
