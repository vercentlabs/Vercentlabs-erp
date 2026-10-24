// Rate contract approval under the company's approval rules: Activate asks each level in turn (core/platform/approvals/rules.js); the
// approver decides from the approvals inbox, where these handlers run. When every level approved this exact content, the buyer's next
// Activate goes through. A contract changed since asks again.
import { PurchaseOrderError } from "../purchase-orders/constants.js";
import { rateContractApprovalContent } from "./index.js";

async function currentContract(client, context, documentId) {
  const contract = (await client.query(`SELECT * FROM tenant.purchase_rate_contracts WHERE organization_id = $1 AND id = $2`, [context.organizationId, documentId])).rows[0];
  if (!contract) throw new PurchaseOrderError(404, "Rate contract not found.", "RATE_CONTRACT_NOT_FOUND");
  return contract;
}

export async function approveRateContractLevel(client, context, payload = {}) {
  const contract = await currentContract(client, context, payload.documentId);
  if (contract.status !== "draft") throw new PurchaseOrderError(409, `This rate contract is ${contract.status}; there is nothing left to approve.`, "RATE_CONTRACT_APPROVAL_STALE");
  const { contentKey } = await rateContractApprovalContent(client, context.organizationId, contract);
  if (contentKey !== payload.contentKey)
    throw new PurchaseOrderError(409, "The rate contract changed after it was sent for approval. Reject this request; the buyer sends it again on Activate.", "RATE_CONTRACT_APPROVAL_STALE");
  await client.query(`INSERT INTO tenant.purchase_rate_contract_events (organization_id, contract_id, event_type, summary, actor_user_id) VALUES ($1, $2, 'approved', $3, $4)`,
    [context.organizationId, contract.id, `Approved (level ${payload.level})`, context.userId ?? null]);
  return { rateContractId: contract.id, level: Number(payload.level) };
}

export async function rejectRateContractApproval(client, context, payload = {}) {
  const contract = await currentContract(client, context, payload.documentId);
  await client.query(`INSERT INTO tenant.purchase_rate_contract_events (organization_id, contract_id, event_type, summary, actor_user_id) VALUES ($1, $2, 'rejected', $3, $4)`,
    [context.organizationId, contract.id, `Approval refused (level ${payload.level})${payload.note ? `: ${payload.note}` : ""}`, context.userId ?? null]);
  return { rateContractId: contract.id, level: Number(payload.level), rejected: true };
}
