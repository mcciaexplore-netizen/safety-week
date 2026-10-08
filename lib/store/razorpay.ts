"use client";

import { storeApi, type Order } from "./client";

/** What Razorpay's window hands back after a successful payment. */
interface RazorpayReply { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
interface RazorpayWindow { open: () => void; on: (event: string, cb: (r: unknown) => void) => void }
declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayWindow }
}

let loading: Promise<void> | null = null;
/** Loads Razorpay's own checkout script (once). Card / UPI details are typed into THEIR window, never ours. */
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("Could not load the payment window. Please check your connection and try again.")); };
    document.body.appendChild(s);
  });
  return loading;
}

/**
 * Opens Razorpay's payment window for an order that is waiting for payment.
 * Resolves with the updated order once the payment is confirmed by our server, or with null if the shopper closed the window.
 */
export async function payForOrder(order: Order, auth: { token?: string | null; t?: string | null }): Promise<Order | null> {
  const pay = order.payment;
  if (!pay) throw new Error("This order is not waiting for payment.");
  await loadScript();
  return new Promise<Order | null>((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: pay.key_id,
      amount: pay.amount,
      currency: pay.currency,
      order_id: pay.razorpay_order_id,
      name: "MCCIA Store",
      description: `Order ${order.number}`,
      prefill: { name: order.customer.name, email: order.customer.email, contact: order.customer.phone },
      theme: { color: "#003F8A" },
      modal: { ondismiss: () => resolve(null) },
      handler: async (reply: RazorpayReply) => {
        try {
          const q = new URLSearchParams();
          if (auth.t) q.set("t", auth.t);
          resolve(await storeApi<Order>(`/orders/${order.number}/pay/verify?${q}`, { method: "POST", body: JSON.stringify(reply) }, auth.token));
        } catch (e) {
          reject(e);
        }
      },
    });
    rz.on("payment.failed", () => { /* the window stays open so the shopper can try another method */ });
    rz.open();
  });
}
