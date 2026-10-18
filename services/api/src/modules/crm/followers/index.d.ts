import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type FollowableType = "lead" | "opportunity" | "party" | "contact";
export type CrmFollower = { userId: string; name: string; reason: "owner" | "followed" | "mentioned" | "automation"; since: string | null; isOwner: boolean };
export type CrmFollowers = { followers: CrmFollower[]; following: boolean; youOwn: boolean };

export const FOLLOWABLE: ReadonlyArray<FollowableType>;
export function listFollowers(client: QueryClient, context: CrmContext, type: string, id: string): Promise<CrmFollowers>;
export function setFollowing(client: QueryClient, context: CrmContext, type: string, id: string, follow?: boolean): Promise<CrmFollowers>;
export function mentionedUserIds(text: string): string[];
