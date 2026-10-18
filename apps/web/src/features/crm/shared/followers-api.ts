"use client";

// Browser client for a record's followers (CRM plan 4.6).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class FollowersApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(FollowersApiError, "body");

export type FollowEntity = "leads" | "opportunities" | "accounts" | "contacts";
export type Follower = { userId: string; name: string; reason: "owner" | "followed" | "mentioned" | "automation"; since: string | null; isOwner: boolean };
export type Followers = { followers: Follower[]; following: boolean; youOwn: boolean };

export const listFollowers = (entity: FollowEntity, id: string) => request<Followers>(`/api/crm/followers/${entity}/${id}`);
export const setFollowing = (entity: FollowEntity, id: string, follow: boolean) =>
  request<Followers>(`/api/crm/followers/${entity}/${id}`, { method: "PUT", json: { follow } });
