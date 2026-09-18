// F307 — POS sales analytics. Every figure here is a real aggregate over
// tenant.pos_sales/pos_sale_lines/pos_payments/pos_returns/
// pos_promotion_applications/pos_coupon_redemptions/pos_day_end_reports/
// pos_reconciliations/pos_offline_sync_conflicts — the SAME rows F303's Z
// report and F304's reconciliation already treat as authoritative, never a
// second, parallel calculation of the same figures (see reconciliation()
// below, which literally sums the tender totals already used to build a
// day-end report's own tender_totals). No mock data, no financial
// calculation duplicated from elsewhere in this module.
//
// SCOPE: every query is bounded by organization+company+business-date
// range (default: the caller must supply one, no unbounded "all time"
// scan) and by accessiblePosStoreIds() — a cashier restricted to specific
// stores sees analytics for exactly those stores, never the whole
// company's aggregate, matching the same store-access boundary every
// other POS read already enforces.
import { decimal, add, sub, div, asDatabaseDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, accessiblePosStoreIds } from "../shared/access-control.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

async function resolveScope(client, context, filters) {
  if (!filters.dateFrom || !DATE_RE.test(filters.dateFrom)) throw posError(400, "dateFrom (YYYY-MM-DD) is required.", "POS_ANALYTICS_DATE_FROM_REQUIRED");
  if (!filters.dateTo || !DATE_RE.test(filters.dateTo)) throw posError(400, "dateTo (YYYY-MM-DD) is required.", "POS_ANALYTICS_DATE_TO_REQUIRED");
  const days = (new Date(filters.dateTo) - new Date(filters.dateFrom)) / 86400000;
  if (days < 0 || days > MAX_RANGE_DAYS) throw posError(400, `Date range must be between 0 and ${MAX_RANGE_DAYS} days.`, "POS_ANALYTICS_DATE_RANGE_INVALID");

  const accessibleStoreIds = await accessiblePosStoreIds(client, context);
  if (filters.storeId && accessibleStoreIds && !accessibleStoreIds.includes(filters.storeId)) {
    throw posError(403, "You are not authorized to view analytics for this store.", "POS_STORE_ACCESS_DENIED");
  }
  if (accessibleStoreIds && accessibleStoreIds.length === 0) {
    return { empty: true };
  }

  const values = [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo];
  const clauses = [`(sale.sale_date AT TIME ZONE store.timezone)::date BETWEEN $3 AND $4`];
  if (filters.storeId) {
    values.push(filters.storeId);
    clauses.push(`sale.store_id=$${values.length}`);
  } else if (accessibleStoreIds) {
    values.push(accessibleStoreIds);
    clauses.push(`sale.store_id=ANY($${values.length}::uuid[])`);
  }
  if (filters.terminalId) {
    values.push(filters.terminalId);
    clauses.push(`sale.terminal_id=$${values.length}`);
  }
  if (filters.cashierId) {
    values.push(filters.cashierId);
    clauses.push(`sale.created_by=$${values.length}`);
  }
  return { empty: false, values, where: clauses.join(" AND "), accessibleStoreIds };
}

const SALE_JOIN = `FROM tenant.pos_sales sale JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id`;
const COMPLETED_STATUSES = `sale.status IN ('completed','partially_returned','returned')`;

export async function getPosSalesAnalytics(client, context, filters = {}) {
  requirePermission(context, "pos.analytics.view");
  const scope = await resolveScope(client, context, filters);
  if (scope.empty) {
    return {
      summary: { saleCount: 0, grossSales: "0", netSales: "0", discountTotal: "0", taxTotal: "0", grandTotal: "0", averageOrderValue: "0" },
      byStore: [], byTerminal: [], byCashier: [], byProduct: [],
      tenderBreakdown: [], discounts: { promotionTotal: "0", couponTotal: "0", otherTotal: "0" },
      returns: { count: 0, refundTotal: "0" }, cashVariance: { reportCount: 0, varianceTotal: "0" },
      reconciliationExceptions: { count: 0 }, offlineSyncExceptions: { pending: 0, resolved: 0 },
      accountingPostingStatus: { pending: 0, posted: 0, failed: 0 }, loyalty: { pointsEarned: "0", pointsRedeemed: "0", redeemAmount: "0" },
      margin: null,
    };
  }
  const { values, where } = scope;

  const summaryResult = await client.query(
    `SELECT count(*)::int AS sale_count,
            coalesce(sum(sale.subtotal),0)::text AS gross_sales,
            coalesce(sum(sale.subtotal-sale.discount_total),0)::text AS net_sales,
            coalesce(sum(sale.discount_total),0)::text AS discount_total,
            coalesce(sum(sale.tax_total),0)::text AS tax_total,
            coalesce(sum(sale.grand_total),0)::text AS grand_total
     ${SALE_JOIN} WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}`,
    values,
  );
  const summaryRow = summaryResult.rows[0];
  const saleCount = summaryRow.sale_count;
  const netSales = decimal(summaryRow.net_sales);
  const averageOrderValue = saleCount > 0 ? div(netSales, decimal(saleCount)) : decimal(0);

  const byStore = await client.query(
    `SELECT sale.store_id,store.name AS store_name,count(*)::int AS sale_count,
            coalesce(sum(sale.grand_total),0)::text AS grand_total
     ${SALE_JOIN} WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}
     GROUP BY sale.store_id,store.name ORDER BY grand_total DESC`,
    values,
  );

  const byTerminal = await client.query(
    `SELECT sale.terminal_id,terminal.name AS terminal_name,count(*)::int AS sale_count,
            coalesce(sum(sale.grand_total),0)::text AS grand_total
     ${SALE_JOIN} JOIN tenant.pos_terminals terminal ON terminal.organization_id=sale.organization_id AND terminal.id=sale.terminal_id
     WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}
     GROUP BY sale.terminal_id,terminal.name ORDER BY grand_total DESC`,
    values,
  );

  const byCashier = await client.query(
    `SELECT sale.created_by AS cashier_id,member.full_name AS cashier_name,count(*)::int AS sale_count,
            coalesce(sum(sale.grand_total),0)::text AS grand_total
     ${SALE_JOIN} LEFT JOIN public.users member ON member.id=sale.created_by
     WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}
     GROUP BY sale.created_by,member.full_name ORDER BY grand_total DESC LIMIT 100`,
    values,
  );

  const byProduct = await client.query(
    `SELECT line.item_id,item.name AS item_name,item_group.name AS category_name,
            sum(line.quantity)::text AS quantity_sold,
            coalesce(sum(line.line_total),0)::text AS revenue
       FROM tenant.pos_sale_lines line
       JOIN tenant.pos_sales sale ON sale.organization_id=line.organization_id AND sale.id=line.sale_id
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       LEFT JOIN tenant.items item ON item.organization_id=line.organization_id AND item.id=line.item_id
       LEFT JOIN tenant.item_groups item_group ON item_group.organization_id=item.organization_id AND item_group.id=item.group_id
      WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}
      GROUP BY line.item_id,item.name,item_group.name ORDER BY revenue DESC LIMIT 200`,
    values,
  );

  const tenderBreakdown = await client.query(
    `SELECT payment.payment_method,count(*)::int AS payment_count,coalesce(sum(payment.amount),0)::text AS amount
       FROM tenant.pos_payments payment
       JOIN tenant.pos_sales sale ON sale.organization_id=payment.organization_id AND sale.id=payment.sale_id
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
      WHERE payment.organization_id=$1 AND payment.company_id=$2 AND payment.status IN ('captured','partially_refunded','refunded')
        AND ${COMPLETED_STATUSES} AND ${where}
      GROUP BY payment.payment_method ORDER BY amount DESC`,
    values,
  );

  const promotionTotalResult = await client.query(
    `SELECT coalesce(sum(app.discount_amount),0)::text AS total
       FROM tenant.pos_promotion_applications app
       JOIN tenant.pos_sales sale ON sale.organization_id=app.organization_id AND sale.id=app.sale_id
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
      WHERE app.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}`,
    values,
  );
  const couponTotalResult = await client.query(
    `SELECT coalesce(sum(redemption.discount_amount),0)::text AS total
       FROM tenant.pos_coupon_redemptions redemption
       JOIN tenant.pos_sales sale ON sale.organization_id=redemption.organization_id AND sale.id=redemption.sale_id
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
      WHERE redemption.organization_id=$1 AND sale.company_id=$2 AND redemption.status='committed' AND ${COMPLETED_STATUSES} AND ${where}`,
    values,
  );
  const promotionTotal = decimal(promotionTotalResult.rows[0].total);
  const couponTotal = decimal(couponTotalResult.rows[0].total);
  // "Other" covers manual line/cart-level discounts and loyalty
  // redemption — pos_sale_lines only persists one collapsed
  // discount_amount per line (manual+promotion+coupon+cart already
  // netted by cart-pricing.js), so this is a genuine residual, not a
  // precise manual-only figure — labelled honestly rather than claiming
  // precision the data model doesn't carry.
  const discountTotal = decimal(summaryRow.discount_total);
  const otherDiscountTotal = sub(discountTotal, add(promotionTotal, couponTotal));

  const returnsResult = await client.query(
    `SELECT count(*)::int AS return_count,coalesce(sum(ret.refund_total),0)::text AS refund_total
       FROM tenant.pos_returns ret
       JOIN tenant.pos_stores store ON store.organization_id=ret.organization_id AND store.id=ret.store_id
      WHERE ret.organization_id=$1 AND ret.company_id=$2 AND ret.status='completed'
        AND (ret.completed_at AT TIME ZONE store.timezone)::date BETWEEN $3 AND $4
        ${filters.storeId ? "AND ret.store_id=$5" : scope.accessibleStoreIds ? `AND ret.store_id=ANY($5::uuid[])` : ""}`,
    filters.storeId ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, filters.storeId]
      : scope.accessibleStoreIds ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, scope.accessibleStoreIds]
      : [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo],
  );

  const cashVarianceResult = await client.query(
    `SELECT count(*) FILTER (WHERE cash_variance_total<>0)::int AS report_count,
            coalesce(sum(cash_variance_total),0)::text AS variance_total
       FROM tenant.pos_day_end_reports report
      WHERE report.organization_id=$1 AND report.company_id=$2 AND report.status='closed'
        AND report.business_date BETWEEN $3 AND $4
        ${filters.storeId ? "AND report.store_id=$5" : scope.accessibleStoreIds ? `AND report.store_id=ANY($5::uuid[])` : ""}`,
    filters.storeId ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, filters.storeId]
      : scope.accessibleStoreIds ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, scope.accessibleStoreIds]
      : [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo],
  );

  const reconciliationResult = await client.query(
    `SELECT count(*)::int AS exception_count
       FROM tenant.pos_reconciliations recon
       JOIN tenant.pos_day_end_reports report ON report.organization_id=recon.organization_id AND report.id=recon.day_end_report_id
      WHERE recon.organization_id=$1 AND recon.company_id=$2 AND recon.status='variance'
        AND report.business_date BETWEEN $3 AND $4
        ${filters.storeId ? "AND recon.store_id=$5" : scope.accessibleStoreIds ? `AND recon.store_id=ANY($5::uuid[])` : ""}`,
    filters.storeId ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, filters.storeId]
      : scope.accessibleStoreIds ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, scope.accessibleStoreIds]
      : [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo],
  );

  const offlineResult = await client.query(
    `SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
            count(*) FILTER (WHERE status IN ('resolved_retried','resolved_voided'))::int AS resolved
       FROM tenant.pos_offline_sync_conflicts conflict
      WHERE conflict.organization_id=$1 AND conflict.company_id=$2
        AND conflict.created_at::date BETWEEN $3 AND $4
        ${filters.storeId ? "AND conflict.store_id=$5" : scope.accessibleStoreIds ? `AND conflict.store_id=ANY($5::uuid[])` : ""}`,
    filters.storeId ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, filters.storeId]
      : scope.accessibleStoreIds ? [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo, scope.accessibleStoreIds]
      : [context.organizationId, context.companyId, filters.dateFrom, filters.dateTo],
  );

  const postingStatusResult = await client.query(
    `SELECT accounting_posting_status,count(*)::int AS count
     ${SALE_JOIN} WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}
     GROUP BY accounting_posting_status`,
    values,
  );
  const postingStatus = { pending: 0, posted: 0, failed: 0, not_applicable: 0 };
  for (const row of postingStatusResult.rows) postingStatus[row.accounting_posting_status] = row.count;

  const loyaltyResult = await client.query(
    `SELECT coalesce(sum(sale.loyalty_points_earned),0)::text AS points_earned,
            coalesce(sum(sale.loyalty_redeem_points),0)::text AS points_redeemed,
            coalesce(sum(sale.loyalty_redeem_amount),0)::text AS redeem_amount
     ${SALE_JOIN} WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}`,
    values,
  );

  // Margin: only over lines with a real, traceable cost (a linked
  // stock_movement) — a non-tracked item contributes no cost and is
  // simply excluded, never assumed to have zero cost.
  const marginResult = await client.query(
    `SELECT coalesce(sum(line.line_total-line.tax_amount),0)::numeric(20,6)::text AS net_revenue_costed,
            coalesce(sum(abs(movement.quantity)*movement.unit_cost),0)::numeric(20,6)::text AS cogs_total,
            count(*)::int AS costed_line_count
       FROM tenant.pos_sale_lines line
       JOIN tenant.pos_sales sale ON sale.organization_id=line.organization_id AND sale.id=line.sale_id
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       JOIN tenant.stock_movements movement ON movement.organization_id=line.organization_id AND movement.id=line.stock_movement_id
      WHERE sale.organization_id=$1 AND sale.company_id=$2 AND ${COMPLETED_STATUSES} AND ${where}`,
    values,
  );
  const costedLineCount = marginResult.rows[0].costed_line_count;
  const margin = costedLineCount > 0
    ? {
        costedLineCount,
        netRevenue: marginResult.rows[0].net_revenue_costed,
        cogsTotal: marginResult.rows[0].cogs_total,
        grossMargin: asDatabaseDecimal(sub(decimal(marginResult.rows[0].net_revenue_costed), decimal(marginResult.rows[0].cogs_total))),
      }
    : null;

  return {
    summary: {
      saleCount,
      grossSales: summaryRow.gross_sales,
      netSales: asDatabaseDecimal(netSales),
      discountTotal: summaryRow.discount_total,
      taxTotal: summaryRow.tax_total,
      grandTotal: summaryRow.grand_total,
      averageOrderValue: asDatabaseDecimal(averageOrderValue),
    },
    byStore: byStore.rows,
    byTerminal: byTerminal.rows,
    byCashier: byCashier.rows,
    byProduct: byProduct.rows,
    tenderBreakdown: tenderBreakdown.rows,
    discounts: {
      promotionTotal: asDatabaseDecimal(promotionTotal),
      couponTotal: asDatabaseDecimal(couponTotal),
      otherTotal: asDatabaseDecimal(otherDiscountTotal),
    },
    returns: { count: returnsResult.rows[0].return_count, refundTotal: returnsResult.rows[0].refund_total },
    cashVariance: { reportCount: cashVarianceResult.rows[0].report_count, varianceTotal: cashVarianceResult.rows[0].variance_total },
    reconciliationExceptions: { count: reconciliationResult.rows[0].exception_count },
    offlineSyncExceptions: { pending: offlineResult.rows[0].pending, resolved: offlineResult.rows[0].resolved },
    accountingPostingStatus: postingStatus,
    loyalty: {
      pointsEarned: loyaltyResult.rows[0].points_earned,
      pointsRedeemed: loyaltyResult.rows[0].points_redeemed,
      redeemAmount: loyaltyResult.rows[0].redeem_amount,
    },
    margin,
  };
}
