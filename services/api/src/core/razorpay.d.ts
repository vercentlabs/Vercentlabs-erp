export function verifyCheckoutSignature(input: { paymentId?: string; subscriptionId?: string; signature?: string }, keySecret: string): boolean;
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secrets: string[]): boolean;
export function razorpayConfig(env?: Record<string, string | undefined>): { keyId: string; keySecret: string; webhookSecrets: string[]; timeoutMs: number; checkoutEnabled: boolean; mode: "live" | "test" };
export function createRazorpayProvider(env?: Record<string, string | undefined>, fetchImpl?: typeof fetch): Record<string, any>;
