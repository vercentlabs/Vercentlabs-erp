declare module "react-native-razorpay" {
  export type RazorpaySuccess = {
    razorpay_payment_id: string;
    razorpay_subscription_id?: string;
    razorpay_signature?: string;
  };
  export type RazorpayFailure = {
    code?: number;
    description?: string;
    reason?: string;
  };
  const RazorpayCheckout: {
    open(options: Record<string, unknown>): Promise<RazorpaySuccess>;
  };
  export default RazorpayCheckout;
}
