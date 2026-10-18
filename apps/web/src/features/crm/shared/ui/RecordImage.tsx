"use client";

// A company's logo or a contact's photo (CRM plan 5.5): shown on the record, with Change and Remove for whoever may edit it.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, User } from "lucide-react";
import { Button } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

async function readImage(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 204 || !response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

export function RecordImage({ entity, recordId, name, canEdit }: { entity: "accounts" | "contacts"; recordId: string; name: string; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const url = `/api/crm/images/${entity}/${recordId}`;
  const key = scopedQueryKey(workspace, "crm", "record-image", entity, recordId);
  const image = useQuery({ queryKey: key, queryFn: () => readImage(url), staleTime: 300_000 });
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(url, { method: "POST", body });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? "The image could not be saved.");
    },
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: key }); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The image could not be saved."),
  });
  const remove = useMutation({
    mutationFn: async () => { await fetch(url, { method: "DELETE" }); },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const Fallback = entity === "accounts" ? Building2 : User;
  return (
    <div className="flex items-center gap-3">
      <div className={`flex size-14 shrink-0 items-center justify-center overflow-hidden border border-border bg-surface-muted ${entity === "contacts" ? "rounded-full" : "rounded-[var(--radius-control)]"}`}>
        {image.data
          // eslint-disable-next-line @next/next/no-img-element -- a private image from an authorized route, not a static asset
          ? <img src={image.data} alt={`${entity === "accounts" ? "Logo of" : "Photo of"} ${name}`} className="size-full object-cover" />
          : <Fallback className="size-6 text-text-muted" aria-hidden="true" />}
      </div>
      {canEdit && (
        <div className="flex flex-col items-start gap-1">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={entity === "accounts" ? "Choose a logo" : "Choose a photo"}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
          <div className="flex gap-1">
            <Button variant="ghost" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}>{image.data ? "Change" : entity === "accounts" ? "Add logo" : "Add photo"}</Button>
            {image.data && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate()}>Remove</Button>}
          </div>
          {error && <span role="alert" className="text-xs text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}
