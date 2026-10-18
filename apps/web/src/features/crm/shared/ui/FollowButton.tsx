"use client";

// Follow a lead, deal, company or contact (CRM plan 4.6): followers are told when a note is added, when an email or WhatsApp message
// arrives, and when an automation says so. The count opens the list of who follows it (the owner always does).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { Button, Popover, PopoverTrigger } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listFollowers, setFollowing, type FollowEntity } from "../followers-api";

const REASON: Record<string, string> = { owner: "Owner", followed: "Follows", mentioned: "Mentioned in a note", automation: "Added by an automation" };

export function FollowButton({ entity, recordId }: { entity: FollowEntity; recordId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const queryKey = scopedQueryKey(workspace, "crm", "followers", entity, recordId);
  const query = useQuery({ queryKey, queryFn: () => listFollowers(entity, recordId) });
  const toggle = useMutation({
    mutationFn: (follow: boolean) => setFollowing(entity, recordId, follow),
    onSuccess: (result) => queryClient.setQueryData(queryKey, result),
  });
  const data = query.data;
  if (!data) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="secondary" isLoading={toggle.isPending} isDisabled={data.youOwn}
        onPress={() => toggle.mutate(!data.following)}>
        {data.following && !data.youOwn ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}
        {data.youOwn ? "Following (owner)" : data.following ? "Unfollow" : "Follow"}
      </Button>
      <PopoverTrigger>
        <Button variant="ghost" size="compact" aria-label={`${data.followers.length} following`}>{data.followers.length}</Button>
        <Popover placement="bottom end">
          <div className="flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-2">
            <h3 className="text-sm font-semibold">Followers</h3>
            {data.followers.length === 0 && <p className="text-sm text-text-secondary">Nobody follows this yet.</p>}
            <ul className="flex flex-col gap-1 text-sm">
              {data.followers.map((entry) => (
                <li key={entry.userId} className="flex justify-between gap-2">
                  <span>{entry.name}</span>
                  <span className="text-xs text-text-muted">{entry.isOwner ? "Owner" : REASON[entry.reason] ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        </Popover>
      </PopoverTrigger>
    </span>
  );
}
