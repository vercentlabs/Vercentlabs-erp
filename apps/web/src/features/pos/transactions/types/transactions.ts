// Transactions workspace -- shapes match the raw tenant.pos_sales/
// pos_sale_lines/pos_payments/pos_returns rows the backend
// (services/api/src/modules/point-of-sale/transaction-continuity-and-
// documents/transactions.js) returns directly, the same snake_case-row
// convention every other POS feature folder (day-end-reports, returns,
// receipts) already uses -- never a translated camelCase DTO.

export type PosTransactionStatus = "draft" | "completed" | "partially_returned" | "returned" | "voided";
export type PosAccountingPostingStatus = "pending" | "posted" | "failed" | "not_applicable";
export type PosPaymentMethod = "cash" | "card" | "upi" | "bank_transfer" | "wallet" | "store_credit";

export type PosTransactionRow = {
  id: string;
  receipt_number: string;
  store_id: string;
  store_name: string;
  store_code: string;
  terminal_id: string;
  terminal_name: string;
  terminal_code: string;
  shift_id: string;
  customer_id: string | null;
  customer_name: string | null;
  cashier_name: string | null;
  created_by: string;
  sale_date: string;
  completed_at: string | null;
  status: PosTransactionStatus;
  currency_code: string;
  grand_total: string;
  tax_total: string;
  discount_total: string;
  accounting_posting_status: PosAccountingPostingStatus;
};

export type PosTransactionListFilters = {
  search?: string;
  storeId?: string;
  terminalId?: string;
  cashierId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  sortBy?: "sale_date" | "grand_total" | "receipt_number" | "status";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type PosTransactionSale = PosTransactionRow & {
  subtotal: string;
  rounding_adjustment: string;
  paid_total: string;
  change_total: string;
  coupon_code: string | null;
  idempotency_key: string;
  shift_number: string;
  shift_opened_at: string | null;
  shift_closed_at: string | null;
  cashier_user_id: string;
  cashier_email: string | null;
  customer_display_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  accounting_invoice_id: string | null;
  invoice_generated_at: string | null;
  journal_entry_id: string | null;
  accounting_posted_at: string | null;
  accounting_posting_error: string | null;
  loyalty_points_earned: string;
  loyalty_redeem_amount: string;
};

export type PosTransactionLine = {
  id: string;
  line_number: number;
  item_id: string;
  item_code: string | null;
  item_name: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  line_total: string;
  warehouse_id: string;
  batch_id: string | null;
  serial_id: string | null;
  stock_movement_id: string | null;
  returned_quantity: string;
};

export type PosTransactionPayment = {
  id: string;
  payment_method: PosPaymentMethod;
  amount: string;
  currency_code: string | null;
  provider_key: string;
  provider_reference: string | null;
  authorization_reference: string | null;
  status: string;
  settlement_status: "not_applicable" | "pending" | "settled" | "exception";
  settled_amount: string;
  settlement_fee_amount: string;
  settled_at: string | null;
  captured_at: string | null;
  refunded_amount: string;
  failure_reason: string | null;
};

export type PosTransactionReturn = {
  id: string;
  return_number: string;
  status: string;
  reason: string;
  refund_total: string;
  requested_by: string;
  approved_by: string | null;
  completed_by: string | null;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
};

export type PosTransactionPromotionEvidence = { code: string; name: string; discount_amount: string };

export type PosTransactionStockMovement = {
  id: string;
  movement_number: string;
  movement_type: string;
  quantity: string;
  unit_cost: string;
  warehouse_id: string;
  occurred_at: string;
  sale_line_id: string;
  item_id: string;
  description: string;
};

export type PosTransactionAuditEvent = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  actor_name: string | null;
};

export type PosTransactionDetail = {
  sale: PosTransactionSale;
  lines: PosTransactionLine[];
  payments: PosTransactionPayment[];
  returns: PosTransactionReturn[];
  promotionEvidence: PosTransactionPromotionEvidence[];
  stockMovements: PosTransactionStockMovement[];
  auditTrail: PosTransactionAuditEvent[];
};
