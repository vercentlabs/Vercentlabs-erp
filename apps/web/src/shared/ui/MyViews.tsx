"use client";

// My views on any list (Shared Platform plan 5): "Save this view" keeps what the list shows now — its view tab, search, filters,
// sort and grouping, as the screen describes them in `state` — under a name; choosing a view gives that state back to the screen
// (`onApply`). A view can open by default, and those who manage the company can share a view with everyone.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Star, Trash2, Users } from "lucide-react";
import { Button, Checkbox, Dialog, Popover, PopoverTrigger, TextField } from "@vercentlabs/design-system";

type ViewState = Record<string, unknown>;
type SavedView = { id: string; name: string; state: ViewState; shared: boolean; isDefault: boolean; mine: boolean; ownerName: string | null };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}

export function MyViews<T extends ViewState>({ listKey, state, onApply }: { listKey: string; state: T; onApply: (state: T) => void }) {
  const queryClient = useQueryClient();
  const key = ["saved-views", listKey];
  const views = useQuery({ queryKey: key, queryFn: () => call<{ views: SavedView[]; canShare: boolean }>(`/api/saved-views?list=${encodeURIComponent(listKey)}`), staleTime: 60_000 });
  const [saving, setSaving] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const star = useMutation({ mutationFn: (view: SavedView) => call(`/api/saved-views/${view.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: !view.isDefault }) }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (view: SavedView) => call(`/api/saved-views/${view.id}`, { method: "DELETE" }), onSuccess: refresh });
  // The default view is applied once, when the list first opens.
  const applied = useRef(false);
  const preferred = views.data?.views.find((view) => view.isDefault && view.mine);
  useEffect(() => {
    if (applied.current || !views.data) return;
    applied.current = true;
    if (preferred) onApply({ ...state, ...preferred.state } as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the views first arrive
  }, [views.data]);

  const list = views.data?.views ?? [];
  return (
    <>
      <PopoverTrigger>
        <Button variant="outline" size="compact"><Bookmark className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">My views</span></Button>
        <Popover placement="bottom end">
          <div className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 text-sm">
            {list.length === 0 && <p className="text-text-secondary">No saved views yet. Set the filters you use often, then save them.</p>}
            <ul className="flex flex-col">
              {list.map((view) => (
                <li key={view.id} className="flex items-center justify-between gap-1">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded px-2 py-1.5 text-left hover:bg-surface-hover"
                    onClick={() => onApply({ ...state, ...view.state } as T)}>
                    {view.shared && <Users className="size-3.5 shrink-0 text-text-muted" aria-label="Shared with everyone" />}
                    <span className="truncate">{view.name}</span>
                  </button>
                  {view.mine && (
                    <Button variant="ghost" size="compact" aria-label={view.isDefault ? `Stop opening ${view.name} by default` : `Open ${view.name} by default`} onPress={() => star.mutate(view)}>
                      <Star className={`size-4 ${view.isDefault ? "fill-current text-warning" : ""}`} aria-hidden="true" />
                    </Button>
                  )}
                  {(view.mine || views.data?.canShare) && (
                    <Button variant="ghost" size="compact" aria-label={`Delete ${view.name}`} onPress={() => remove.mutate(view)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                  )}
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="compact" onPress={() => setSaving(true)}>Save this view</Button>
          </div>
        </Popover>
      </PopoverTrigger>
      {saving && <SaveDialog listKey={listKey} state={state} canShare={Boolean(views.data?.canShare)} onClose={() => setSaving(false)} onSaved={() => { setSaving(false); refresh(); }} />}
    </>
  );
}

function SaveDialog({ listKey, state, canShare, onClose, onSaved }: { listKey: string; state: ViewState; canShare: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [isDefault, setDefault] = useState(false);
  const [shared, setShared] = useState(false);
  const save = useMutation({ mutationFn: () => call("/api/saved-views", { method: "POST", body: JSON.stringify({ listKey, name, state, isDefault, shared }) }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Save this view" description="The list as it is now (view, search, filters and sort) under a name. Saving under an existing name replaces it.">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{(save.error as Error).message}</p>}
        <TextField label="Name" isRequired value={name} onChange={setName} maxLength={80} placeholder="For example: Overdue in Maharashtra" />
        <Checkbox isSelected={isDefault} onChange={setDefault}>Open this view by default</Checkbox>
        {canShare && <Checkbox isSelected={shared} onChange={setShared}>Share with everyone in the company</Checkbox>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!name.trim()} onPress={() => save.mutate()}>Save view</Button>
        </div>
      </div>
    </Dialog>
  );
}

// For a list that keeps its view, search and filters in the address (?view=…&search=…): the address is the saved state, and opening a
// view opens the list again with it.
export function UrlViews({ listKey }: { listKey: string }) {
  const query = typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");
  const params = new URLSearchParams(query);
  params.delete("page");
  return (
    <MyViews listKey={listKey} state={{ query: params.toString() }}
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the list starts again from the view's address
      onApply={(saved) => { const next = String(saved.query ?? ""); if (next !== params.toString()) window.location.assign(`${window.location.pathname}${next ? `?${next}` : ""}`); }} />
  );
}
