// Customer 360: a read composition over the Account, its hierarchy, Contacts,
// CRM work, Sales, Accounting and customer-service events (raw row shape the
// web types depend on), plus the governed customer-service event command.

import { crmChildScopes, crmHasPermission as hasPermission } from "../../data-management/record-policy.js";
import { CrmAccountIntelligenceError } from "../account-intelligence-error.js";
import { projectAccountForContext } from "../account-security.js";
import { projectContactForContext } from "../contact-security.js";
import { loadScopedAccount, redactHiddenParent } from "../record-access.js";
import { getAccountHierarchy } from "./account-hierarchy.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export async function recordCustomerServiceEvent(
  client,
  context,
  partyId,
  input = {},
) {
  await loadScopedAccount(client, context, partyId);
  const eventType = text(input.eventType || input.event_type || "service_note");
  if (
    !new Set([
      "case_opened",
      "case_updated",
      "case_resolved",
      "complaint",
      "service_note",
      "escalation",
    ]).has(eventType)
  ) {
    throw new CrmAccountIntelligenceError(
      400,
      "Service event type is invalid.",
    );
  }
  const title = text(input.title);
  if (!title) throw new CrmAccountIntelligenceError(400, "Title is required.");
  const result = await client.query(
    `INSERT INTO tenant.crm_customer_service_events(
       organization_id,party_id,contact_id,external_system,external_case_id,event_type,title,description,status,priority,occurred_at,metadata,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now()),$12::jsonb,$13)
     ON CONFLICT (organization_id,external_system,external_case_id)
     DO UPDATE SET event_type=EXCLUDED.event_type,title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,priority=EXCLUDED.priority,occurred_at=EXCLUDED.occurred_at,metadata=EXCLUDED.metadata
     RETURNING *`,
    [
      context.organizationId,
      partyId,
      input.contactId || null,
      text(input.externalSystem || input.external_system || "manual"),
      text(input.externalCaseId || input.external_case_id) || null,
      eventType,
      title,
      text(input.description) || null,
      text(input.status || "open"),
      text(input.priority || "medium"),
      input.occurredAt || input.occurred_at || null,
      JSON.stringify(object(input.metadata)),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getCustomer360(client, context, partyId) {
  const party = await loadScopedAccount(client, context, partyId);
  const hierarchy = await getAccountHierarchy(client, context, partyId);
  // Contacts inherit Account access, so every Contact of a visible Account
  // is visible; sensitive fields are projected by getCustomer360ForCaller.
  const contacts = await client.query(
    `SELECT * FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 ORDER BY is_primary DESC,status,first_name,last_name`,
    [context.organizationId, partyId],
  );
  const metricParameters = [context.organizationId, partyId];
  const m = crmChildScopes(context, metricParameters);
  const metrics = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id=$1 AND opportunity.party_id=$2${m.opportunity()}) AS opportunities,
       (SELECT count(*)::int FROM tenant.sales_quotations quotation WHERE quotation.organization_id=$1 AND quotation.party_id=$2${m.sales("quotation")}) AS quotations,
       (SELECT count(*)::int FROM tenant.sales_orders sales_order WHERE sales_order.organization_id=$1 AND sales_order.party_id=$2${m.sales("sales_order")}) AS orders,
       (SELECT count(*)::int FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id=$1 AND invoice.party_id=$2${m.accounting("invoice")}) AS invoices,
       (SELECT COALESCE(sum(invoice.outstanding_amount),0) FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id=$1 AND invoice.party_id=$2 AND invoice.status NOT IN ('paid','cancelled','reversed')${m.accounting("invoice")}) AS outstanding,
       (SELECT count(*)::int FROM tenant.crm_customer_service_events event WHERE event.organization_id=$1 AND event.party_id=$2 AND event.status NOT IN ('resolved','closed')) AS open_service_cases`,
    metricParameters,
  );
  const timelineParameters = [context.organizationId, partyId];
  const t = crmChildScopes(context, timelineParameters);
  const timeline = await client.query(
    `SELECT * FROM (
       SELECT 'activity'::text AS entry_type,activity.id AS entry_id,
              COALESCE(activity.completed_at,activity.start_at,activity.created_at) AS occurred_at,
              activity.subject AS title,activity.status,NULL::numeric AS amount,NULL::text AS currency_code,
              jsonb_build_object('activityType',activity.activity_type,'description',activity.description,'outcome',activity.outcome) AS details
       FROM tenant.crm_activities activity
       WHERE activity.organization_id=$1 AND (
         (activity.entity_type='party' AND activity.entity_id=$2) OR
         (activity.entity_type='contact' AND activity.entity_id IN (SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2))
       )${t.activity()}
       UNION ALL
       SELECT 'communication',communication.id,communication.occurred_at,
              COALESCE(communication.subject,initcap(communication.channel)),communication.status,NULL,NULL,
              jsonb_build_object('channel',communication.channel,'direction',communication.direction,'provider',communication.provider)
       FROM tenant.crm_communications communication
       WHERE communication.organization_id=$1 AND (communication.party_id=$2 OR communication.contact_id IN (SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2))${t.communication()}
       UNION ALL
       SELECT 'opportunity',opportunity.id,opportunity.created_at,opportunity.name,opportunity.status,opportunity.amount,opportunity.currency_code,
              jsonb_build_object('code',opportunity.code,'probability',opportunity.probability,'expectedCloseDate',opportunity.expected_close_date)
       FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id=$1 AND opportunity.party_id=$2${t.opportunity()}
       UNION ALL
       SELECT 'quotation',quotation.id,quotation.created_at,quotation.quotation_number,quotation.lifecycle_status,version.grand_total,version.currency_code,
              jsonb_build_object('validUntil',quotation.valid_until,'acceptanceStatus',quotation.acceptance_status)
       FROM tenant.sales_quotations quotation
       LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id=quotation.organization_id AND version.id=quotation.current_version_id
       WHERE quotation.organization_id=$1 AND quotation.party_id=$2${t.sales("quotation")}
       UNION ALL
       SELECT 'sales_order',sales_order.id,sales_order.created_at,sales_order.sales_order_number,sales_order.lifecycle_status,version.grand_total,version.currency_code,
              jsonb_build_object('fulfillmentStatus',sales_order.fulfillment_status,'billingStatus',sales_order.billing_status)
       FROM tenant.sales_orders sales_order
       LEFT JOIN tenant.sales_order_versions version ON version.organization_id=sales_order.organization_id AND version.id=sales_order.current_version_id
       WHERE sales_order.organization_id=$1 AND sales_order.party_id=$2${t.sales("sales_order")}
       UNION ALL
       SELECT 'invoice',invoice.id,invoice.created_at,invoice.invoice_number,invoice.status,invoice.grand_total,invoice.currency_code,
              jsonb_build_object('invoiceDate',invoice.invoice_date,'dueDate',invoice.due_date,'outstandingAmount',invoice.outstanding_amount)
       FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id=$1 AND invoice.party_id=$2${t.accounting("invoice")}
       UNION ALL
       SELECT 'receipt',receipt.id,receipt.created_at,receipt.receipt_number,receipt.status,receipt.amount,receipt.currency_code,
              jsonb_build_object('receiptDate',receipt.receipt_date,'unappliedAmount',receipt.unapplied_amount,'paymentMethod',receipt.payment_method)
       FROM tenant.accounting_customer_receipts receipt WHERE receipt.organization_id=$1 AND receipt.party_id=$2${t.accounting("receipt")}
       UNION ALL
       SELECT 'support',event.id,event.occurred_at,event.title,event.status,NULL,NULL,
              jsonb_build_object('eventType',event.event_type,'priority',event.priority,'externalSystem',event.external_system,'externalCaseId',event.external_case_id,'description',event.description)
       FROM tenant.crm_customer_service_events event WHERE event.organization_id=$1 AND event.party_id=$2
     ) timeline
     ORDER BY occurred_at DESC,entry_type,entry_id LIMIT 500`,
    timelineParameters,
  );
  return {
    account: redactHiddenParent(party),
    hierarchy,
    contacts: contacts.rows,
    metrics: metrics.rows[0] || {},
    timeline: timeline.rows,
    sourceCoverage: {
      crm: true,
      quotations: hasPermission(context, "sales.view"),
      orders: hasPermission(context, "sales.view"),
      invoices: hasPermission(context, "accounting.view"),
      support: true,
      supportMode: "governed service-event ingestion",
    },
  };
}

export async function getCustomer360ForCaller(client, context, partyId) {
  const view = await getCustomer360(client, context, partyId);
  return {
    ...view,
    account: projectAccountForContext(context, view.account),
    contacts: view.contacts.map((row) => projectContactForContext(context, row)),
  };
}
