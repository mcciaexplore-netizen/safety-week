"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { formatRupees } from "@/lib/format";
import { API_MODE } from "@/lib/services";
import { api } from "@/lib/services/api";

/** Is Razorpay set up on the server? (If not, the reference box stays a plain typed field, as in development.) */
export function useRazorpayEnabled(): boolean {
  const cfg = useAsync(() => (API_MODE ? api<{ razorpay: boolean }>("/payments/config") : Promise.resolve(null)), "razorpay-config");
  return !!cfg.data?.razorpay;
}

interface Qr { id: string; image_url: string | null; amount: string }

/**
 * Collect a payment at the counter through Razorpay UPI: shows a QR for the exact amount, waits (polls) until Razorpay
 * says the money arrived, then hands back the Razorpay payment id. The invoice only accepts a payment Razorpay confirms.
 */
export function RazorpayCollect({ amount, paidId, onPaid }: { amount: number; paidId?: string; onPaid: (paymentId: string) => void }) {
  const [qr, setQr] = useState<Qr | null>(null);
  const [state, setState] = useState<"idle" | "creating" | "waiting" | "paid" | "closed">("idle");
  const [error, setError] = useState<string | null>(null);
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; }, [onPaid]);

  const stale = !!qr && state !== "paid" && Number(qr.amount) !== Math.round(amount * 100) / 100;

  async function create() {
    setError(null);
    setState("creating");
    try {
      const made = await api<Qr>("/payments/razorpay-qr", { method: "POST", body: JSON.stringify({ amount: amount.toFixed(2) }) });
      setQr(made);
      setState("waiting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the QR.");
      setState("idle");
    }
  }

  // ask Razorpay every 3 seconds until the customer has paid
  useEffect(() => {
    if (!qr || state !== "waiting") return;
    let live = true;
    const tick = async () => {
      try {
        const r = await api<{ status: "waiting" | "paid" | "closed"; payment_id?: string }>(`/payments/razorpay-qr/${qr.id}`);
        if (!live) return;
        if (r.status === "paid" && r.payment_id) { setState("paid"); onPaidRef.current(r.payment_id); }
        else if (r.status === "closed") setState("closed");
      } catch { /* a missed check is fine; the next one tries again */ }
    };
    const timer = window.setInterval(tick, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [qr, state]);

  if (paidId && /^pay_/.test(paidId) && (state === "paid" || !qr))
    return (
      <div role="status" data-testid="razorpay-paid" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success-fg">
        <CheckCircle2 className="size-5 shrink-0" />
        <span><strong>Paid via Razorpay UPI</strong> — {formatRupees(amount)} received <span className="font-mono text-xs">({paidId})</span></span>
      </div>
    );

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-sm" data-testid="razorpay-collect">
      {!qr || stale || state === "closed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={create} disabled={amount <= 0 || state === "creating"} data-testid="show-qr">
            {state === "creating" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : stale || state === "closed" ? <RefreshCw data-icon="inline-start" /> : <QrCode data-icon="inline-start" />}
            {stale || state === "closed" ? `Create a new QR for ${formatRupees(amount)}` : `Show UPI QR for ${formatRupees(amount)}`}
          </Button>
          <span className="text-xs text-muted-foreground">
            {stale ? "The amount changed, so the earlier QR no longer matches." : state === "closed" ? "That QR has expired." : "The customer scans it with any UPI app. This screen shows “Paid” as soon as Razorpay confirms it."}
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="space-y-1">
            <p className="font-heading text-2xl font-bold">{formatRupees(Number(qr.amount))}</p>
            <p className="text-muted-foreground">Ask the customer to scan this with any UPI app.</p>
            <p className="flex items-center justify-center gap-2 font-medium text-primary"><Loader2 className="size-4 animate-spin" />Waiting for payment…</p>
          </div>
          {qr.image_url ? (
            // Razorpay's QR card is tall with the code in the middle of it: centre it and make it as large as the screen allows
            // so the code itself is big enough to scan from a phone; click opens it full size.
            <a href={qr.image_url} target="_blank" rel="noreferrer" title="Open the QR full size" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.image_url} alt={`UPI QR for ${formatRupees(amount)}`} className="mx-auto h-[min(40rem,75vh)] w-auto max-w-full rounded-lg border bg-white object-contain shadow-sm" data-testid="qr-image" />
            </a>
          ) : <QrCode className="size-24 text-primary" />}
          <Button type="button" variant="outline" size="sm" onClick={() => { setQr(null); setState("idle"); }}>Cancel QR</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
