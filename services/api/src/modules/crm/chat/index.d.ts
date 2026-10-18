import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type CrmChatChannel = { id: string; name: string; publicKey: string; welcomeMessage: string; allowedOrigins: string[]; ownerUserId: string | null; isActive: boolean; openChats: number };
export type CrmChatMessage = { id: string; sender: "visitor" | "agent" | "system"; body: string; authorName: string | null; at: string };
export type CrmChatSession = {
  id: string; channelName: string; visitorName: string | null; visitorEmail: string | null; visitorMobile: string | null; pageUrl: string | null; leadId: string | null;
  leadCode: string | null; leadStatus: string | null; opportunityId: string | null; assignedTo: string | null; assignedName: string | null; status: "open" | "closed"; unread: number;
  lastMessageAt: string; lastMessage: string | null; createdAt: string;
};
export function listChatChannels(client: QueryClient, context: CrmContext): Promise<CrmChatChannel[]>;
export function createChatChannel(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmChatChannel>;
export function updateChatChannel(client: QueryClient, context: CrmContext, channelId: string, input: Record<string, unknown>): Promise<CrmChatChannel>;
export function getPublicChat(client: QueryClient, publicKey: string): Promise<{ name: string; organizationName: string; welcomeMessage: string }>;
export function startChat(client: QueryClient, publicKey: string, input: Record<string, unknown>, request?: { origin?: string | null; selfOrigin?: string | null }): Promise<{ token: string; sessionId: string }>;
export function postVisitorMessage(client: QueryClient, publicKey: string, token: string, body: string): Promise<{ ok: true }>;
export function readVisitorChat(client: QueryClient, publicKey: string, token: string, options?: { after?: string | null }): Promise<{ status: string; messages: CrmChatMessage[] }>;
export function listChatSessions(client: QueryClient, context: CrmContext, options?: { status?: string }): Promise<CrmChatSession[]>;
export function getChatSession(client: QueryClient, context: CrmContext, sessionId: string): Promise<CrmChatSession & { messages: CrmChatMessage[] }>;
export function replyToChat(client: QueryClient, context: CrmContext, sessionId: string, body: string): Promise<CrmChatSession & { messages: CrmChatMessage[] }>;
export function closeChat(client: QueryClient, context: CrmContext, sessionId: string): Promise<CrmChatSession & { messages: CrmChatMessage[] }>;
