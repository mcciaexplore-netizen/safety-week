"use client";

import { useState } from "react";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { formatRupees } from "@/lib/format";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";
import { loadScript } from "@/lib/store/razorpay";

/** Is Razorpay set up on the server? (If not, the reference box stays a plain typed field, as in development.) */
export function useRazorpayEnabled(): boolean {
  const cfg = useAsync(() => (API_MODE ? api<{ razorpay: boolean }>("/payments/config") : Promise.resolve(null)), "razorpay-config");
  return !!cfg.data?.razorpay;
}

/** Razorpay setup on the server: `test` = test keys (test payments only, no real money moves). */
export function useRazorpayConfig(): { enabled: boolean; test: boolean } {
  const cfg = useAsync(() => (API_MODE ? api<{ razorpay: boolean; test_mode?: boolean }>("/payments/config") : Promise.resolve(null)), "razorpay-config");
  return { enabled: !!cfg.data?.razorpay, test: !!cfg.data?.test_mode };
}

interface CounterOrder { order_id: string; key_id: string; amount: number; currency: string }
interface RazorpayReply { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }

/**
 * Collect a payment at the counter through Razorpay's own payment window (the same one the store uses): the customer pays by
 * UPI or card there, our server then asks Razorpay whether the money really arrived, and hands back the Razorpay payment id.
 * The invoice only accepts a payment Razorpay confirms.
 */
export function RazorpayCollect({ amount, paidId, onPaid, customer }: {
  amount: number; paidId?: string; onPaid: (paymentId: string) => void;
  /** The buyer's details from the invoice; Razorpay's window opens with them filled in instead of asking again. */
  customer?: { name?: string; email?: string; phone?: string };
}) {
  const [state, setState] = useState<"idle" | "starting" | "paying" | "paid">("idle");
  const [error, setError] = useState<string | null>(null);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const { test } = useRazorpayConfig();

  const stale = state === "paid" && paidAmount !== null && paidAmount !== Math.round(amount * 100) / 100;

  async function start() {
    setError(null);
    setState("starting");
    try {
      const [order] = await Promise.all([
        api<CounterOrder>("/payments/counter-order", { method: "POST", body: JSON.stringify({ amount: amount.toFixed(2) }) }),
        loadScript(),
      ]);
      setState("paying");
      const rz = new window.Razorpay!({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: "MCCIA",
        description: "Counter payment",
        prefill: { name: customer?.name?.trim() || undefined, email: customer?.email?.trim() || undefined, contact: customer?.phone?.replace(/[^\d+]/g, "") || undefined },
        theme: { color: "#003F8A" },
        method: { upi: true, card: true, netbanking: true, wallet: false, emi: false, paylater: false },
        modal: { ondismiss: () => setState((st) => (st === "paying" ? "idle" : st)) },
        handler: async (reply: RazorpayReply) => {
          try {
            const r = await api<{ status: "paid"; payment_id: string; amount: string }>("/payments/counter-order/verify", { method: "POST", body: JSON.stringify(reply) });
            setPaidAmount(Number(r.amount));
            setState("paid");
            onPaid(r.payment_id);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not confirm the payment. If money was taken, do not charge again: check the Razorpay dashboard.");
            setState("idle");
          }
        },
      });
      rz.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment.");
      setState("idle");
    }
  }

  if (paidId && /^pay_/.test(paidId) && !stale)
    return (
      <div role="status" data-testid="razorpay-paid" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success-fg">
        <CheckCircle2 className="size-5 shrink-0" />
        <span><strong>Paid via Razorpay</strong> — {formatRupees(amount)} received <span className="font-mono text-xs">({paidId})</span></span>
      </div>
    );

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-sm" data-testid="razorpay-collect">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={start} disabled={amount <= 0 || state === "starting" || state === "paying"} data-testid="collect-payment">
          {state === "starting" || state === "paying" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <CreditCard data-icon="inline-start" />}
          {stale ? `Collect ${formatRupees(amount)} again` : `Collect ${formatRupees(amount)} (UPI / card)`}
        </Button>
        <span className="text-xs text-muted-foreground">
          {stale ? "The amount changed, so the earlier payment no longer matches." : "Opens Razorpay's payment window: the customer pays by UPI (scan or app) or card. This screen shows “Paid” once Razorpay confirms it."}
        </span>
      </div>
      {test && (
        <p role="alert" data-testid="razorpay-test-mode" className="mt-2 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          Razorpay is in <strong>TEST mode</strong>: only test payments work and no real money moves. Real payments need the live Razorpay keys.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
