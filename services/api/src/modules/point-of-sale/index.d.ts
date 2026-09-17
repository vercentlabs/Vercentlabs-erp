export type PointOfSaleContext = {
  organizationId: string;
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roleSlugs: readonly string[];
};

export declare function getPointOfSaleDashboard(client: any, context: PointOfSaleContext): Promise<any>;
export declare function listPointOfSaleResource(client: any, context: PointOfSaleContext, resource: string, options?: Record<string, unknown>): Promise<any[]>;
export declare function createStore(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function createTerminal(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function openShift(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function completePointOfSale(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function createPointOfSaleReturn(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<any>;
export declare function approvePointOfSaleReturn(client: any, context: PointOfSaleContext, returnId: string, input?: Record<string, any>): Promise<any>;
export declare function completePointOfSaleReturn(client: any, context: PointOfSaleContext, returnId: string, input?: Record<string, any>): Promise<any>;
export declare function closeShift(client: any, context: PointOfSaleContext, shiftId: string, input: Record<string, any>): Promise<any>;

export type PointOfSaleProductMatch = {
  itemId: string;
  variantId: string | null;
  name: string;
  code: string;
  barcode: string | null;
  salesPrice: string;
  availableQuantity: number;
};
export declare function searchPointOfSalePosProducts(client: any, context: PointOfSaleContext, storeId: string, input?: Record<string, any>): Promise<PointOfSaleProductMatch[]>;
export declare function lookupPointOfSaleBarcode(client: any, context: PointOfSaleContext, storeId: string, barcode: string): Promise<PointOfSaleProductMatch>;

// F277 Cart. Field names are snake_case throughout -- getPosCart/reprice
// return the raw tenant.pos_carts/pos_cart_lines row shape directly
// (the same convention completePointOfSale/createPointOfSaleReturn
// already use for pos_sales/pos_returns), NOT a camelCase DTO. The
// [key: string]: any index signature exists only to tolerate additional
// raw columns, not as license to invent a parallel camelCase shape.
export type PosCartLine = {
  id: string;
  line_number: number;
  item_id: string;
  variant_id: string | null;
  description: string | null;
  quantity: string;
  list_price: string;
  unit_price: string;
  price_override: boolean;
  gross_amount: string;
  manual_discount_amount: string;
  manual_discount_reason: string | null;
  promotion_discount_amount: string;
  coupon_discount_amount: string;
  taxable_amount: string;
  tax_amount: string;
  line_total: string;
  tax_components: Array<{ type: string; label: string; rate: string; taxableAmount: string; taxAmount: string }>;
  warehouse_id: string | null;
  warehouse_location_id: string | null;
  batch_id: string | null;
  serial_id: string | null;
  [key: string]: any;
};
export type PosCart = {
  id: string;
  status: "draft" | "priced" | "held" | "completed" | "cancelled" | "expired";
  version: number;
  store_id: string;
  terminal_id: string;
  shift_id: string;
  customer_id: string | null;
  currency_code: string;
  subtotal: string;
  manual_discount_total: string;
  promotion_discount_total: string;
  coupon_discount_total: string;
  discount_total: string;
  tax_total: string;
  rounding_adjustment: string;
  grand_total: string;
  coupon_code: string | null;
  cart_discount_type: "percent" | "amount" | null;
  cart_discount_value: string | null;
  cart_discount_reason: string | null;
  lines: PosCartLine[];
  promotionExplanations?: Array<{ code: string; applied: boolean; amountSaved?: string; reason: string }>;
  coupon?: { id: string; code: string; amount: string } | null;
  [key: string]: any;
};
export declare function createPosCart(client: any, context: PointOfSaleContext, input: { storeId: string; terminalId: string; shiftId: string; customerId?: string | null }): Promise<PosCart>;
export declare function getPosCart(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCart>;
export declare function addPosCartLine(client: any, context: PointOfSaleContext, cartId: string, input: Record<string, any>): Promise<PosCart>;
export declare function updatePosCartLineQuantity(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { quantity: number; expectedVersion?: number }): Promise<PosCart>;
export declare function removePosCartLine(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function applyPosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input: { type: "percent" | "amount"; value: number; reason: string; expectedVersion?: number; approvedBy?: string }): Promise<PosCart>;
export declare function removePosCartLineDiscount(client: any, context: PointOfSaleContext, cartId: string, lineId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function setPosCartDiscount(client: any, context: PointOfSaleContext, cartId: string, input: { type?: "percent" | "amount" | null; value?: number; reason?: string; expectedVersion?: number; approvedBy?: string }): Promise<PosCart>;
export declare function setPosCartCustomer(client: any, context: PointOfSaleContext, cartId: string, input: { customerId: string | null; expectedVersion?: number }): Promise<PosCart>;
export declare function applyPosCartCoupon(client: any, context: PointOfSaleContext, cartId: string, input: { code: string; expectedVersion?: number }): Promise<PosCart>;
export declare function removePosCartCoupon(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function holdPosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { expectedVersion?: number }): Promise<PosCart>;
export declare function resumePosCart(client: any, context: PointOfSaleContext, cartId: string): Promise<PosCart>;
export declare function cancelPosCart(client: any, context: PointOfSaleContext, cartId: string, input?: { reason?: string }): Promise<PosCart>;
export declare function completePosCart(client: any, context: PointOfSaleContext, cartId: string, input: { idempotencyKey: string; payments: Array<{ method: string; amount: number }>; expectedVersion?: number; expectedGrandTotal?: string }): Promise<any>;

// F280 Promotions
export type PosPromotion = { id: string; code: string; name: string; status: "active" | "inactive"; [key: string]: any };
export declare function listPosPromotions(client: any, context: PointOfSaleContext, options?: { status?: string }): Promise<PosPromotion[]>;
export declare function createPosPromotion(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<PosPromotion>;
export declare function updatePosPromotion(client: any, context: PointOfSaleContext, id: string, input: Record<string, any>): Promise<PosPromotion>;
export declare function setPosPromotionActive(client: any, context: PointOfSaleContext, id: string, active: boolean): Promise<PosPromotion>;

// F281 Coupons
export type PosCoupon = { id: string; code: string; status: "active" | "inactive"; [key: string]: any };
export declare function listPosCoupons(client: any, context: PointOfSaleContext, options?: { status?: string }): Promise<PosCoupon[]>;
export declare function createPosCoupon(client: any, context: PointOfSaleContext, input: Record<string, any>): Promise<PosCoupon>;
export declare function updatePosCoupon(client: any, context: PointOfSaleContext, id: string, input: Record<string, any>): Promise<PosCoupon>;
export declare function setPosCouponActive(client: any, context: PointOfSaleContext, id: string, active: boolean): Promise<PosCoupon>;
