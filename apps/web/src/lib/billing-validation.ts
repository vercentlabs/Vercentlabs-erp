import { z } from "zod";

export const checkoutSchema = z.object({
  planPriceId: z.string().uuid(),
});

export const verifyCheckoutSchema = z.object({
  checkoutSessionId: z.string().uuid(),
  razorpay_payment_id: z.string().min(5).max(100),
  razorpay_subscription_id: z.string().min(5).max(100),
  razorpay_signature: z.string().min(32).max(256),
});

export const cancelSubscriptionSchema = z.object({
  cancelAtCycleEnd: z.boolean().default(true),
});

export const billingProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  billingEmail: z.string().email().max(320),
  phone: z.string().trim().max(32).optional().default(""),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
      "Enter a valid GSTIN.",
    )
    .or(z.literal("")),
  addressLine1: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(100).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  country: z.string().trim().length(2).default("IN"),
});
