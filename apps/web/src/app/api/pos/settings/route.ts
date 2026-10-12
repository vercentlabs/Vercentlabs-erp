import { z } from "zod";

import { getPosSettings, updatePosSettings } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// Bounds mirror the pos_settings CHECK constraints so a bad value is a clean
// 400 here rather than a database error; the domain function re-validates and
// also enforces the cross-field rule (approval threshold <= max line discount).
const updateSchema = z
  .object({
    require_shift_reconciliation: z.boolean(),
    allow_negative_stock: z.boolean(),
    allow_price_override: z.boolean(),
    require_return_approval: z.boolean(),
    prohibit_self_return_approval: z.boolean(),
    default_currency_code: z.string().trim().length(3),
    max_line_discount_percent: z.number().min(0).max(100),
    max_cart_discount_percent: z.number().min(0).max(100),
    discount_approval_threshold_percent: z.number().min(0).max(100),
    cart_expiry_minutes: z.number().int().min(5).max(10080),
    held_cart_retention_hours: z.number().int().min(1).max(2160),
    checkout_lock_minutes: z.number().int().min(2).max(240),
    stock_reservation_max_hold_minutes: z.number().int().min(5).max(240),
    opening_variance_approval_above: z.number().min(0).nullable(),
    opening_variance_block_above: z.number().positive().nullable(),
    opening_count_denominations: z.array(z.number().positive()).min(1).max(20),
    long_open_shift_hours: z.number().int().min(1).max(72),
    closing_variance_approval_above: z.number().min(0).nullable(),
    closing_variance_block_above: z.number().positive().nullable(),
    closing_blind_count: z.boolean(),
    closing_reveal_expected_after_count: z.boolean(),
    closing_variance_reasons: z.array(z.enum(["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_ERROR", "CASH_REFUND_DISCREPANCY", "MISSING_CASH_MOVEMENT", "CASH_RECEIPT_ERROR", "DRAWER_SHORTAGE",
      "DRAWER_OVERAGE", "PREVIOUS_HANDOVER_MISMATCH", "UNKNOWN", "OTHER"])).min(1),
    closing_shortage_approval_above: z.number().min(0).nullable(),
    closing_overage_approval_above: z.number().min(0).nullable(),
    closing_shortage_block_above: z.number().positive().nullable(),
    closing_overage_block_above: z.number().positive().nullable(),
    cash_difference_unknown_note_required: z.boolean(),
    reconciliation_unknown_after_minutes: z.number().int().min(1).max(10080),
    reconciliation_refund_overdue_days: z.number().int().min(1).max(90),
    reconciliation_manual_approval_above: z.number().min(0).nullable(),
    walk_in_buyer_details_required_above: z.number().min(0).nullable(),
    manual_discount_stacking: z.enum(["non_stackable", "stackable", "manual_replaces_automatic"]),
    allow_full_line_discount: z.boolean(),
    allow_zero_total_sale: z.boolean(),
    cash_payments_enabled: z.boolean(),
    cash_quick_amounts_enabled: z.boolean(),
    max_cash_tender_amount: z.number().positive().nullable(),
    large_cash_warning_amount: z.number().positive().nullable(),
    split_payments_enabled: z.boolean(),
    // Returns (0099): the return policy.
    returns_enabled: z.boolean(),
    return_window_days: z.number().int().min(0).max(3650).nullable(),
    allow_no_receipt_returns: z.boolean(),
    require_return_reason: z.boolean(),
    require_return_condition: z.boolean(),
    allow_partial_returns: z.boolean(),
    allow_cross_outlet_returns: z.boolean(),
    require_inspection_before_refund: z.boolean(),
    return_approval_above: z.number().positive().nullable(),
    return_reasons: z.array(z.enum(["damaged_product", "defective_product", "wrong_item", "wrong_size_variant", "customer_changed_mind", "quality_issue", "not_as_described", "other"])).min(1),
    return_restrictions: z.array(z.object({ type: z.enum(["item", "category"]), id: z.string().uuid(), mode: z.enum(["blocked", "approval"]) })).max(500),
    receipt_reprint_reason_required: z.boolean(),
    refund_allocation_policy: z.enum(["proportional", "electronic_first"]),
    discount_reason_required: z.boolean(),
  })
  .partial();

export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "point-of-sale", permission: "pos.settings.manage" },
    async ({ client, session }) => {
      const result = await getPosSettings(client, posContext(session));
      return ok(result);
    },
  );
}

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    {
      module: "point-of-sale",
      permission: "pos.settings.manage",
      billingWrite: true,
    },
    async ({ client, session }) => {
      const input = updateSchema.parse(await readJson(request));
      const result = await updatePosSettings(
        client,
        posContext(session),
        input,
      );
      return ok(result);
    },
  );
}
