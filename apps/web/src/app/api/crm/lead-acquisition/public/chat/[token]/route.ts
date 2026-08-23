import { appendLeadChatMessage, startLeadChatSession } from "@vercentlabs/api";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/server/lead-acquisition";
import { query, tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(
  request: Request,
  route: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await route.params;
    const input = (await request.json()) as Record<string, unknown>;
    if (input.action === "message") {
      const sessions = await query<{
        organization_id: string;
        session_id: string;
      }>("SELECT * FROM tenant.crm_public_chat_session($1)", [token]);
      const session = sessions[0];
      if (!session) throw new HttpError(404, "Chat session not found.");
      const context = {
        organizationId: session.organization_id,
        userId: "00000000-0000-4000-8000-000000000000",
        activeCompanyId: null,
        activeBranchId: null,
        allowAllCompanies: true,
      };
      const result = await tenantTransaction(
        session.organization_id,
        (client) =>
          appendLeadChatMessage(client, context, session.session_id, {
            ...input,
            senderType: "visitor",
          }),
      );
      return ok({ result });
    }
    const connections = await query<{
      organization_id: string;
      connection_id: string;
      created_by: string;
    }>("SELECT * FROM tenant.crm_public_acquisition_connection($1)", [token]);
    const connection = connections[0];
    if (!connection) throw new HttpError(404, "Chat connection not found.");
    const context = {
      organizationId: connection.organization_id,
      userId: String(
        connection.created_by || "00000000-0000-4000-8000-000000000000",
      ),
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    };
    const result = await tenantTransaction(
      connection.organization_id,
      async (client) => {
        const session = await startLeadChatSession(
          client,
          context,
          connection.connection_id,
          input,
        );
        if (input.message)
          await appendLeadChatMessage(client, context, String(session.id), {
            body: input.message,
            senderType: "visitor",
          });
        return session;
      },
    );
    return ok({ result }, 201);
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
